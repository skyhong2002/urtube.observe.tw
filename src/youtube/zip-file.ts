import { createReadStream } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';

// Reads selected entries of a ZIP file on disk without loading the archive.
// A Takeout ZIP can be gigabytes of uploaded videos around a few megabytes of
// history (#takeout-large, 2026-11-13): only the central directory and the
// selected entries are read, and each is inflated as a stream whose output is
// counted, so neither a forged size header nor overlapping entries can make
// it produce more than the caller's budget (zip bomb protection).

export class ZipFormatError extends Error {}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
// Upper bounds on what the directory itself may make us hold in memory.
const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 1_000_000;

export interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface ZipSelection {
  // Called for every entry name; may throw to reject the whole archive.
  select: (name: string) => boolean;
  // Total inflated bytes allowed across all selected entries.
  maxUncompressedBytes: number;
  limitError: () => Error;
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (!bytesRead) throw new ZipFormatError('Truncated ZIP archive');
    offset += bytesRead;
  }
  return buffer;
}

function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipFormatError('ZIP archive offsets are too large');
  return Number(value);
}

async function directory(handle: FileHandle, size: number): Promise<{ offset: number; size: number; entries: number }> {
  if (size < 22) throw new ZipFormatError('Not a ZIP archive');
  const tailLength = Math.min(size, 22 + 0xffff);
  const tailStart = size - tailLength;
  const tail = await readAt(handle, tailStart, tailLength);
  let at = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD && i + 22 + tail.readUInt16LE(i + 20) <= tail.length) { at = i; break; }
  }
  if (at < 0) throw new ZipFormatError('Not a ZIP archive');
  let disk = tail.readUInt16LE(at + 4);
  let directoryDisk = tail.readUInt16LE(at + 6);
  let entries = tail.readUInt16LE(at + 10);
  let directorySize = tail.readUInt32LE(at + 12);
  let directoryOffset = tail.readUInt32LE(at + 16);
  const eocdPosition = tailStart + at;
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff || disk === 0xffff) {
    if (eocdPosition < 20) throw new ZipFormatError('Invalid ZIP64 archive');
    const locator = await readAt(handle, eocdPosition - 20, 20);
    if (locator.readUInt32LE(0) !== ZIP64_LOCATOR) throw new ZipFormatError('Invalid ZIP64 archive');
    const recordOffset = safeNumber(locator.readBigUInt64LE(8));
    if (recordOffset + 56 > eocdPosition) throw new ZipFormatError('Invalid ZIP64 archive');
    const record = await readAt(handle, recordOffset, 56);
    if (record.readUInt32LE(0) !== ZIP64_EOCD) throw new ZipFormatError('Invalid ZIP64 archive');
    disk = record.readUInt32LE(16);
    directoryDisk = record.readUInt32LE(20);
    entries = safeNumber(record.readBigUInt64LE(32));
    directorySize = safeNumber(record.readBigUInt64LE(40));
    directoryOffset = safeNumber(record.readBigUInt64LE(48));
  }
  // Google splits large exports into several complete ZIPs, never into one
  // spanned archive; each part is uploaded and imported on its own.
  if (disk !== 0 || directoryDisk !== 0) throw new ZipFormatError('Spanned ZIP archives are not supported');
  if (entries > MAX_ENTRIES || directorySize > MAX_CENTRAL_DIRECTORY_BYTES) throw new ZipFormatError('ZIP directory is too large');
  if (directoryOffset + directorySize > eocdPosition) throw new ZipFormatError('Truncated ZIP archive');
  return { offset: directoryOffset, size: directorySize, entries };
}

function parseDirectory(buffer: Buffer, count: number): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== CENTRAL) throw new ZipFormatError('Invalid ZIP directory');
    const flags = buffer.readUInt16LE(p + 8);
    const method = buffer.readUInt16LE(p + 10);
    let compressedSize = buffer.readUInt32LE(p + 20);
    let uncompressedSize = buffer.readUInt32LE(p + 24);
    const nameLength = buffer.readUInt16LE(p + 28);
    const extraLength = buffer.readUInt16LE(p + 30);
    const commentLength = buffer.readUInt16LE(p + 32);
    let localHeaderOffset = buffer.readUInt32LE(p + 42);
    const end = p + 46 + nameLength + extraLength + commentLength;
    if (end > buffer.length) throw new ZipFormatError('Invalid ZIP directory');
    const rawName = buffer.subarray(p + 46, p + 46 + nameLength);
    // Same decoding as fflate (the in-memory parser): UTF-8 when flagged.
    const name = rawName.toString(flags & 0x800 ? 'utf8' : 'latin1');
    if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      let e = p + 46 + nameLength;
      const extraEnd = e + extraLength;
      let found = false;
      while (e + 4 <= extraEnd) {
        const id = buffer.readUInt16LE(e);
        const length = buffer.readUInt16LE(e + 2);
        if (e + 4 + length > extraEnd) break;
        if (id === 0x0001) {
          let q = e + 4;
          const next = () => {
            if (q + 8 > e + 4 + length) throw new ZipFormatError('Invalid ZIP64 entry');
            const value = safeNumber(buffer.readBigUInt64LE(q));
            q += 8;
            return value;
          };
          if (uncompressedSize === 0xffffffff) uncompressedSize = next();
          if (compressedSize === 0xffffffff) compressedSize = next();
          if (localHeaderOffset === 0xffffffff) localHeaderOffset = next();
          found = true;
          break;
        }
        e += 4 + length;
      }
      if (!found) throw new ZipFormatError('Invalid ZIP64 entry');
    }
    entries.push({ name, flags, method, compressedSize, uncompressedSize, localHeaderOffset });
    p = end;
  }
  return entries;
}

async function inflateEntry(path: string, handle: FileHandle, entry: ZipEntry, limit: number, directoryOffset: number,
  budget: { used: number }, limitError: () => Error): Promise<Uint8Array> {
  if (entry.flags & 0x1) throw new ZipFormatError('Encrypted ZIP entries are not supported');
  if (entry.method !== 0 && entry.method !== 8) throw new ZipFormatError('Unsupported ZIP compression method');
  const header = await readAt(handle, entry.localHeaderOffset, 30);
  if (header.readUInt32LE(0) !== LOCAL) throw new ZipFormatError('Invalid ZIP entry');
  const start = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  // Entry data lies before the central directory.
  if (start + entry.compressedSize > directoryOffset) throw new ZipFormatError('Truncated ZIP archive');
  if (entry.compressedSize === 0) {
    if (entry.method === 8) throw new ZipFormatError('Invalid ZIP entry');
    return new Uint8Array(0);
  }
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      budget.used += chunk.length;
      if (budget.used > limit) return callback(limitError());
      chunks.push(chunk);
      callback();
    },
  });
  const source = createReadStream(path, { start, end: start + entry.compressedSize - 1, highWaterMark: 256 * 1024 });
  if (entry.method === 8) await pipeline(source, createInflateRaw(), sink);
  else await pipeline(source, sink);
  return new Uint8Array(Buffer.concat(chunks));
}

// Like fflate's unzipSync with a filter: select sees every entry name, the
// declared sizes of selected entries are checked before any inflation, and
// the actual output is counted while inflating.
export async function extractZipEntries(path: string, selection: ZipSelection): Promise<Record<string, Uint8Array>> {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const dir = await directory(handle, size);
    const entries = parseDirectory(await readAt(handle, dir.offset, dir.size), dir.entries);
    const selected: ZipEntry[] = [];
    let declared = 0;
    for (const entry of entries) {
      if (!selection.select(entry.name)) continue;
      declared += entry.uncompressedSize;
      if (declared > selection.maxUncompressedBytes) throw selection.limitError();
      selected.push(entry);
    }
    const files: Record<string, Uint8Array> = {};
    const budget = { used: 0 };
    for (const entry of selected) {
      files[entry.name] = await inflateEntry(path, handle, entry, selection.maxUncompressedBytes, dir.offset, budget, selection.limitError);
    }
    return files;
  } finally {
    await handle.close();
  }
}
