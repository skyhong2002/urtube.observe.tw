import { createHash, randomBytes, type Hash } from 'node:crypto';
import { mkdtemp, open, readdir, rm, stat, statfs, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';

// Takeout uploads larger than memory (approved 2026-11-13). A ZIP is never
// held in memory: it streams to a private temporary file (directory 0700,
// file 0600) while being hashed, the import reads only its history entries
// from disk (src/youtube/zip-file.ts), and the file is deleted as soon as the
// import ends, successful or not.
//
// Browsers reach the site through Cloudflare, which refuses request bodies
// over 100 MB. Larger files are therefore sent in chunks to one upload
// session (start, chunk..., then the normal form submission names the
// session); smaller ones, and browsers without JavaScript, post the file in
// the multipart form as before. Either way the server receives one file.
//
// Uploads in flight, plus the import that follows each, are limited per
// process (TAKEOUT_UPLOAD_CONCURRENCY, default 1): each import may hold up
// to TAKEOUT_MAX_UNCOMPRESSED_MB of history in memory on a small host.

export class UploadTooLarge extends Error { constructor() { super('YouTube archive exceeds compressed size limit'); } }
export class UploadBusy extends Error { constructor() { super('Another Takeout upload is in progress'); } }
export class UploadNoSpace extends Error { constructor() { super('Not enough temporary space for this upload'); } }
// Malformed request or an upload session that is not (or no longer) usable.
export class UploadRejected extends Error {}
export class UploadNotFound extends Error { constructor() { super('Upload not found'); } }

const PREFIX = 'urtube-takeout-';

// "2 GB", "512 MB": the configured limit as shown to people.
export function archiveLimitLabel(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  return gib >= 1 && Number.isInteger(gib * 10) ? `${Number(gib.toFixed(1))} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}
// Room left on the temporary file system beyond the upload itself.
const FREE_SPACE_MARGIN = 256 * 1024 * 1024;
const MAX_PART_HEADER_BYTES = 16 * 1024;
const MAX_FIELD_BYTES = 64 * 1024;

export interface TakeoutUploadOptions {
  tempDirectory: string;
  maxArchiveBytes: number;
  concurrency: number;
  // Bytes per chunk request: under Cloudflare's 100 MB request limit.
  chunkBytes?: number;
  // An upload session with no chunk for this long is deleted.
  idleMs?: number;
  // Free bytes on the temporary file system (tests).
  freeBytes?: (directory: string) => Promise<number>;
}

// A received archive. cleanup deletes the file and frees the upload slot; it
// is idempotent and must run once the import has finished.
export interface SpooledArchive {
  path: string;
  bytes: number;
  sha256: string;
  cleanup(): Promise<void>;
}

class Spool {
  bytes = 0;
  private readonly hash: Hash = createHash('sha256');
  private constructor(readonly directory: string, readonly path: string, private handle: FileHandle | null) {}

  static async create(tempDirectory: string): Promise<Spool> {
    const directory = await mkdtemp(join(tempDirectory, PREFIX));
    try {
      const path = join(directory, 'archive.zip');
      return new Spool(directory, path, await open(path, 'wx', 0o600));
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async write(chunk: Uint8Array, limit: number): Promise<void> {
    if (!this.handle) throw new UploadRejected('Upload already finished');
    if (this.bytes + chunk.byteLength > limit) throw new UploadTooLarge();
    this.hash.update(chunk);
    let offset = 0;
    while (offset < chunk.byteLength) {
      const { bytesWritten } = await this.handle.write(chunk, offset, chunk.byteLength - offset);
      offset += bytesWritten;
    }
    this.bytes += chunk.byteLength;
  }

  async finish(release: () => void): Promise<SpooledArchive> {
    await this.handle?.close();
    this.handle = null;
    const sha256 = this.hash.digest('hex');
    let cleaned = false;
    return {
      path: this.path, bytes: this.bytes, sha256,
      cleanup: async () => {
        if (cleaned) return;
        cleaned = true;
        try { await rm(this.directory, { recursive: true, force: true }); } finally { release(); }
      },
    };
  }

  async discard(): Promise<void> {
    const handle = this.handle;
    this.handle = null;
    try { await handle?.close(); } catch { /* already closed */ }
    await rm(this.directory, { recursive: true, force: true });
  }
}

interface Session {
  id: string;
  owner: number;
  size: number;
  received: number;
  busy: boolean;
  spool: Spool;
  release: () => void;
  timer: ReturnType<typeof setTimeout>;
}

function boundaryOf(contentType: string): string {
  const match = /;\s*boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2] ?? '';
  if (!boundary || boundary.length > 70) throw new UploadRejected('Invalid multipart boundary');
  return boundary;
}

function dispositionParam(header: string, name: string): string | undefined {
  const match = new RegExp(`;\\s*${name}="((?:[^"\\\\]|\\\\.)*)"`, 'i').exec(header) ?? new RegExp(`;\\s*${name}=([^;\\s]+)`, 'i').exec(header);
  return match ? match[1].replace(/\\(.)/g, '$1') : undefined;
}

export interface MultipartUpload {
  fields: Record<string, string>;
  file?: SpooledArchive;
  // The submitted file name, when a file was chosen.
  filename?: string;
}

export class TakeoutUploads {
  private active = 0;
  private readonly sessions = new Map<string, Session>();
  readonly chunkBytes: number;
  private readonly idleMs: number;

  constructor(readonly options: TakeoutUploadOptions) {
    this.chunkBytes = options.chunkBytes ?? 32 * 1024 * 1024;
    // Long enough for one 32 MiB chunk on a slow uplink; an abandoned session
    // holds an upload slot until then.
    this.idleMs = options.idleMs ?? 15 * 60_000;
  }

  get maxArchiveBytes(): number { return this.options.maxArchiveBytes; }
  get inFlight(): number { return this.active; }

  // A slot for one upload and its import, or null when all are taken.
  private tryAcquire(): (() => void) | null {
    if (this.active >= this.options.concurrency) return null;
    this.active++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; } };
  }

  private async ensureSpace(bytes: number): Promise<void> {
    let free: number;
    try {
      free = this.options.freeBytes ? await this.options.freeBytes(this.options.tempDirectory)
        : await statfs(this.options.tempDirectory).then(info => Number(info.bavail) * Number(info.bsize));
    } catch { return; }
    if (free < bytes + FREE_SPACE_MARGIN) throw new UploadNoSpace();
  }

  private async open(expectedBytes: number): Promise<{ spool: Spool; release: () => void }> {
    const release = this.tryAcquire();
    if (!release) throw new UploadBusy();
    try {
      await this.ensureSpace(expectedBytes);
      return { spool: await Spool.create(this.options.tempDirectory), release };
    } catch (error) {
      release();
      throw error;
    }
  }

  // A raw application/zip request body (the ingest API).
  async receiveBody(request: Request): Promise<SpooledArchive> {
    const limit = this.options.maxArchiveBytes;
    const declared = Number(request.headers.get('content-length'));
    if (declared > limit) {
      void request.body?.cancel().catch(() => {});
      throw new UploadTooLarge();
    }
    if (!request.body) throw new UploadRejected('Empty upload');
    const reader = request.body.getReader();
    let opened: { spool: Spool; release: () => void } | undefined;
    try {
      opened = await this.open(declared > 0 ? declared : limit);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await opened.spool.write(value, limit);
      }
      return await opened.spool.finish(opened.release);
    } catch (error) {
      void reader.cancel().catch(() => {});
      if (opened) { await opened.spool.discard(); opened.release(); }
      throw error;
    } finally { reader.releaseLock(); }
  }

  // A browser multipart form: small text fields are kept, the one file part
  // named `field` streams to disk. The slot is taken only when a file part
  // starts, so a form naming an upload session needs none of its own.
  // accept is checked on the file name before any of it is written.
  async receiveMultipart(request: Request, field: string, accept: (filename: string) => boolean): Promise<MultipartUpload> {
    const limit = this.options.maxArchiveBytes;
    // Multipart framing adds a little overhead around the file.
    const bodyLimit = limit + 1024 * 1024;
    const declared = Number(request.headers.get('content-length'));
    if (declared > bodyLimit) {
      void request.body?.cancel().catch(() => {});
      throw new UploadTooLarge();
    }
    const delimiter = Buffer.from(`\r\n--${boundaryOf(request.headers.get('content-type') ?? '')}`);
    if (!request.body) throw new UploadRejected('Empty upload');
    const reader = request.body.getReader();
    const result: MultipartUpload = { fields: {} };
    let opened: { spool: Spool; release: () => void } | undefined;
    let fieldName: string | null = null;
    let fieldBytes = 0;
    let fieldChunks: Buffer[] = [];
    let part: 'file' | 'field' | 'skip' = 'skip';
    // A leading CRLF lets the first delimiter match like every later one.
    let buffer: Buffer = Buffer.from('\r\n');
    let state: 'preamble' | 'delimiter' | 'headers' | 'body' | 'done' = 'preamble';
    let total = 0;
    const emit = async (bytes: Buffer) => {
      if (!bytes.length) return;
      if (part === 'file') await opened!.spool.write(bytes, limit);
      else if (part === 'field') {
        fieldBytes += bytes.length;
        if (fieldBytes > MAX_FIELD_BYTES) throw new UploadRejected('Form field too large');
        fieldChunks.push(bytes);
      }
    };
    const endPart = async () => {
      if (part === 'file') {
        result.file = await opened!.spool.finish(opened!.release);
        opened = undefined;
      } else if (part === 'field' && fieldName !== null) {
        result.fields[fieldName] = Buffer.concat(fieldChunks).toString('utf8');
      }
      part = 'skip';
      fieldName = null;
      fieldChunks = [];
    };
    const startPart = async (headers: string) => {
      const disposition = /^content-disposition:(.*)$/im.exec(headers)?.[1] ?? '';
      const name = dispositionParam(disposition, 'name');
      const filename = dispositionParam(disposition, 'filename');
      if (name === field && filename !== undefined) {
        // No file chosen: browsers send an empty part with an empty name.
        if (filename === '') { part = 'skip'; return; }
        if (result.file || opened) throw new UploadRejected('Only one archive per upload');
        result.filename = filename;
        if (!accept(filename)) throw new UploadRejected('Not a ZIP file');
        opened = await this.open(declared > 0 ? declared : limit);
        part = 'file';
      } else if (name !== undefined && filename === undefined) {
        part = 'field';
        fieldName = name;
      } else part = 'skip';
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > bodyLimit) throw new UploadTooLarge();
        const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
        buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
        for (;;) {
          if (state === 'preamble') {
            const at = buffer.indexOf(delimiter);
            if (at < 0) { buffer = buffer.subarray(Math.max(0, buffer.length - delimiter.length + 1)); break; }
            buffer = buffer.subarray(at + delimiter.length);
            state = 'delimiter';
          } else if (state === 'delimiter') {
            if (buffer.length < 2) break;
            if (buffer[0] === 0x2d && buffer[1] === 0x2d) { state = 'done'; buffer = Buffer.alloc(0); break; }
            if (buffer[0] !== 0x0d || buffer[1] !== 0x0a) throw new UploadRejected('Malformed multipart body');
            buffer = buffer.subarray(2);
            state = 'headers';
          } else if (state === 'headers') {
            const at = buffer.indexOf('\r\n\r\n');
            if (at < 0) {
              if (buffer.length > MAX_PART_HEADER_BYTES) throw new UploadRejected('Malformed multipart body');
              break;
            }
            await startPart(buffer.subarray(0, at).toString('utf8'));
            buffer = buffer.subarray(at + 4);
            state = 'body';
          } else if (state === 'body') {
            const at = buffer.indexOf(delimiter);
            if (at < 0) {
              // Keep a possible partial delimiter for the next chunk.
              const safe = buffer.length - delimiter.length + 1;
              if (safe > 0) { await emit(buffer.subarray(0, safe)); buffer = buffer.subarray(safe); }
              break;
            }
            await emit(buffer.subarray(0, at));
            await endPart();
            buffer = buffer.subarray(at + delimiter.length);
            state = 'delimiter';
          } else break;
        }
        // Anything after the closing delimiter is ignored, but still counted.
        if (state === 'done') buffer = Buffer.alloc(0);
      }
      if (state !== 'done') throw new UploadRejected('Truncated multipart body');
      return result;
    } catch (error) {
      void reader.cancel().catch(() => {});
      if (opened) { await opened.spool.discard(); opened.release(); }
      await result.file?.cleanup();
      throw error;
    } finally { reader.releaseLock(); }
  }

  // Chunked upload session for one account. Starting another replaces the
  // account's earlier session (a reload must not lock its owner out).
  async start(owner: number, size: number): Promise<{ id: string; chunkBytes: number }> {
    if (!Number.isSafeInteger(size) || size <= 0) throw new UploadRejected('Invalid upload size');
    if (size > this.options.maxArchiveBytes) throw new UploadTooLarge();
    for (const session of [...this.sessions.values()]) if (session.owner === owner) await this.drop(session);
    const { spool, release } = await this.open(size);
    const id = randomBytes(18).toString('base64url');
    const session: Session = { id, owner, size, received: 0, busy: false, spool, release, timer: undefined as never };
    this.sessions.set(id, session);
    this.touch(session);
    return { id, chunkBytes: this.chunkBytes };
  }

  private touch(session: Session): void {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => { void this.drop(session); }, this.idleMs);
    session.timer.unref?.();
  }

  private async drop(session: Session): Promise<void> {
    if (this.sessions.get(session.id) !== session) return;
    this.sessions.delete(session.id);
    clearTimeout(session.timer);
    try { await session.spool.discard(); } finally { session.release(); }
  }

  private session(owner: number, id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner) throw new UploadNotFound();
    return session;
  }

  // Appends the next chunk. Chunks arrive in order; a failed one ends the
  // session (the running hash cannot be rewound), so the browser starts over.
  async appendChunk(owner: number, id: string, offset: number, request: Request): Promise<{ received: number; size: number }> {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner || session.busy || offset !== session.received) {
      void request.body?.cancel().catch(() => {});
      if (!session || session.owner !== owner) throw new UploadNotFound();
      throw new UploadRejected(session.busy ? 'A chunk is already being received' : 'Unexpected chunk offset');
    }
    const declared = Number(request.headers.get('content-length'));
    const room = Math.min(this.chunkBytes, session.size - session.received);
    if (declared > room) {
      void request.body?.cancel().catch(() => {});
      await this.drop(session);
      throw new UploadTooLarge();
    }
    if (!request.body) throw new UploadRejected('Empty chunk');
    session.busy = true;
    const reader = request.body.getReader();
    const end = session.received + room;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await session.spool.write(value, end);
      }
      if (session.spool.bytes === session.received) throw new UploadRejected('Empty chunk');
      session.received = session.spool.bytes;
      this.touch(session);
      return { received: session.received, size: session.size };
    } catch (error) {
      void reader.cancel().catch(() => {});
      await this.drop(session);
      throw error;
    } finally {
      session.busy = false;
      reader.releaseLock();
    }
  }

  // Hands a fully received session to the import. Its slot stays taken
  // until the returned archive is cleaned up.
  async complete(owner: number, id: string): Promise<SpooledArchive> {
    const session = this.session(owner, id);
    if (session.busy || session.received !== session.size) {
      await this.drop(session);
      throw new UploadRejected('Upload incomplete');
    }
    this.sessions.delete(id);
    clearTimeout(session.timer);
    return session.spool.finish(session.release);
  }

  async cancel(owner: number, id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (session && session.owner === owner) await this.drop(session);
  }
}

// Removes temporary upload directories left by a process that stopped
// mid-upload (sessions live in memory only). Another process may share the
// directory, so only a directory untouched for maxAgeMs counts as abandoned:
// live uploads write at least every chunk and expire after idleMs (15 min).
export async function sweepStaleTakeoutUploads(tempDirectory: string, maxAgeMs = 45 * 60_000, now = Date.now()): Promise<number> {
  let removed = 0;
  let names: string[];
  try { names = await readdir(tempDirectory); } catch { return 0; }
  for (const name of names) {
    if (!name.startsWith(PREFIX)) continue;
    const directory = join(tempDirectory, name);
    try {
      let newest = (await stat(directory)).mtimeMs;
      for (const file of await readdir(directory)) newest = Math.max(newest, (await stat(join(directory, file))).mtimeMs);
      if (now - newest < maxAgeMs) continue;
      await rm(directory, { recursive: true, force: true });
      removed++;
    } catch { /* removed meanwhile */ }
  }
  return removed;
}
