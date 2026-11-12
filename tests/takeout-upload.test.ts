import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { deflateRawSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { importArchive } from '../src/archive-import.js';
import { config } from '../src/config.js';
import { Repository } from '../src/data/database.js';
import { createApp } from '../src/index.js';
import { createIngestApp } from '../src/ingest.js';
import { uploadFeedbackScript } from '../src/output/form-feedback.js';
import {
  archiveLimitLabel, sweepStaleTakeoutUploads, TakeoutUploads, UploadBusy, UploadNoSpace, UploadNotFound, UploadRejected, UploadTooLarge,
} from '../src/takeout-upload.js';
import { UserRegistry } from '../src/users.js';
import { parseYoutubeArchive, parseYoutubeArchiveFile } from '../src/youtube/takeout.js';

// Every archive here is synthetic. Approved 2026-11-13: Takeout ZIPs over
// 100 MB stream to a temporary file and only the history is inflated.
const SECRET = 'test-private-data-key-with-at-least-32-characters';
const origin = new URL(config.publicBaseUrl).origin;
const WATCH = 'Takeout/YouTube and YouTube Music/history/watch-history.json';
const SEARCH = 'Takeout/YouTube and YouTube Music/history/search-history.json';

function history(count: number, offset = 0): Buffer {
  return Buffer.from(JSON.stringify(Array.from({ length: count }, (_, index) => ({
    header: 'YouTube', title: `Watched Synthetic ${index + offset}`,
    titleUrl: `https://www.youtube.com/watch?v=${String(index + offset).padStart(11, 'A')}`,
    time: new Date(Date.UTC(2025, 0, 1) + (index + offset) * 60_000).toISOString(),
    products: ['YouTube'], activityControls: ['YouTube watch history'],
  }))));
}
const searches = Buffer.from(JSON.stringify([{
  header: 'YouTube', title: 'Searched for synthetic query', titleUrl: 'https://www.youtube.com/results?search_query=synthetic+query',
  time: '2025-01-01T00:00:00Z', products: ['YouTube'], activityControls: ['YouTube search history'],
}]));

interface RawEntry { name: string; data: Buffer; method?: 0 | 8 | 99; declaredSize?: number; compressed?: Buffer }
// A hand-built ZIP, so tests can forge sizes, use ZIP64 or store garbage.
function rawZip(entries: RawEntry[], { zip64 = false } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? 8;
    const compressed = entry.compressed ?? (method === 8 ? deflateRawSync(entry.data) : entry.data);
    const size = entry.declaredSize ?? entry.data.length;
    const name = Buffer.from(entry.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(zip64 ? 0xffffffff : compressed.length, 18); local.writeUInt32LE(zip64 ? 0xffffffff : size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);
    const extra = zip64 ? Buffer.alloc(28) : Buffer.alloc(0);
    if (zip64) {
      extra.writeUInt16LE(1, 0); extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(size), 4); extra.writeBigUInt64LE(BigInt(compressed.length), 12); extra.writeBigUInt64LE(BigInt(offset), 20);
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(45, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(zip64 ? 0xffffffff : compressed.length, 20); central.writeUInt32LE(zip64 ? 0xffffffff : size, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt16LE(extra.length, 30);
    central.writeUInt32LE(zip64 ? 0xffffffff : offset, 42);
    centrals.push(central, name, extra);
    offset += 30 + name.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const tail: Buffer[] = [];
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0); record.writeBigUInt64LE(44n, 4); record.writeUInt16LE(45, 12); record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(entries.length), 24); record.writeBigUInt64LE(BigInt(entries.length), 32);
    record.writeBigUInt64LE(BigInt(directory.length), 40); record.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0); locator.writeBigUInt64LE(BigInt(offset + directory.length), 8); locator.writeUInt32LE(1, 16);
    tail.push(record, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(zip64 ? 0xffff : entries.length, 8); end.writeUInt16LE(zip64 ? 0xffff : entries.length, 10);
  end.writeUInt32LE(zip64 ? 0xffffffff : directory.length, 12); end.writeUInt32LE(zip64 ? 0xffffffff : offset, 16);
  return Buffer.concat([...locals, directory, ...tail, end]);
}

function scratch(): { root: string; write(name: string, data: Uint8Array): string; leftovers(): string[]; done(): void } {
  const root = mkdtempSync(join(tmpdir(), 'urtube-upload-test-'));
  return {
    root,
    write: (name, data) => { const path = join(root, name); writeFileSync(path, data); return path; },
    leftovers: () => readdirSync(root).filter(name => name.startsWith('urtube-takeout-')),
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}

function multipart(boundary: string, parts: Array<{ name: string; filename?: string; data: Buffer | string }>): Buffer {
  const chunks: Buffer[] = [Buffer.from('preamble ignored\r\n')];
  for (const part of parts) {
    const disposition = `form-data; name="${part.name}"${part.filename !== undefined ? `; filename="${part.filename}"` : ''}`;
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: ${disposition}\r\n${part.filename !== undefined ? 'Content-Type: application/zip\r\n' : ''}\r\n`));
    chunks.push(Buffer.isBuffer(part.data) ? part.data : Buffer.from(part.data), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

// A body delivered in fixed-size pieces, optionally paused before the end.
function streamed(body: Buffer, pieceBytes: number, hold?: Promise<void>) {
  let offset = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (hold && offset + pieceBytes >= body.length) await hold;
      if (offset >= body.length) return controller.close();
      controller.enqueue(new Uint8Array(body.subarray(offset, offset + pieceBytes)));
      offset += pieceBytes;
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  return { stream, cancelled: () => cancelled };
}

function multipartRequest(body: Buffer, boundary: string, pieceBytes = body.length, hold?: Promise<void>, headers: Record<string, string> = {}) {
  const { stream, cancelled } = streamed(body, pieceBytes, hold);
  return {
    request: new Request('http://localhost/account/takeout', {
      method: 'POST', body: stream, duplex: 'half',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length), ...headers },
    } as RequestInit),
    cancelled,
  };
}

test('a ZIP on disk parses like the in-memory parser, including its archive identity', async () => {
  const dir = scratch();
  try {
    const archive = zipSync({ [WATCH]: strToU8(history(3).toString()), [SEARCH]: strToU8(searches.toString()) });
    const path = dir.write('takeout.zip', archive);
    const fromMemory = parseYoutubeArchive(archive, SECRET);
    const fromDisk = await parseYoutubeArchiveFile(path, SECRET);
    assert.equal(fromDisk.archiveHash, fromMemory.archiveHash, 'same SHA-256 identity, so re-imports stay idempotent');
    assert.equal(fromDisk.archiveHash, createHash('sha256').update(archive).digest('hex'));
    assert.deepEqual(fromDisk.watches, fromMemory.watches);
    assert.equal(fromDisk.searches.length, 1);
    // A hash supplied by the receiver is used as given.
    assert.equal((await parseYoutubeArchiveFile(path, SECRET, 'takeout', { archiveHash: 'f'.repeat(64) })).archiveHash, 'f'.repeat(64));
    // ZIP64 directories (some writers always use them) parse the same way.
    const zip64 = dir.write('zip64.zip', rawZip([{ name: WATCH, data: history(3) }], { zip64: true }));
    assert.deepEqual((await parseYoutubeArchiveFile(zip64, SECRET)).watches, fromMemory.watches);
  } finally { dir.done(); }
});

test('only the history entries are read; everything else in the ZIP is skipped', async () => {
  const dir = scratch();
  try {
    const path = dir.write('mixed.zip', rawZip([
      // Uploaded videos dominate a large export. Garbage data, a 4 GB declared
      // size and an unknown compression method: any attempt to read them fails.
      { name: 'Takeout/YouTube and YouTube Music/videos/clip.mp4', data: Buffer.alloc(0), compressed: Buffer.from('not deflate data'), declaredSize: 0xfffffff0 },
      { name: 'Takeout/YouTube and YouTube Music/videos/other.mp4', data: Buffer.from('x'), method: 99 },
      { name: WATCH, data: history(2) },
      { name: 'Takeout/YouTube and YouTube Music/subscriptions/subscriptions.csv', data: Buffer.from('a,b'), compressed: Buffer.from('zz') },
    ]));
    const parsed = await parseYoutubeArchiveFile(path, SECRET, 'takeout', { maxUncompressedBytes: 1024 * 1024 });
    assert.equal(parsed.watches.length, 2);
    // A selected entry in an unsupported format is an error, not silently empty.
    const unsupported = dir.write('unsupported.zip', rawZip([{ name: WATCH, data: history(1), method: 99 }]));
    await assert.rejects(parseYoutubeArchiveFile(unsupported, SECRET), /Unsupported ZIP compression method/);
    // Unsafe entry names reject the archive, as in the in-memory parser.
    const unsafe = dir.write('unsafe.zip', rawZip([{ name: '../watch-history.json', data: history(1) }]));
    await assert.rejects(parseYoutubeArchiveFile(unsafe, SECRET), /Unsafe archive entry/);
    await assert.rejects(parseYoutubeArchiveFile(dir.write('plain.zip', Buffer.from('not a zip at all, just text')), SECRET), /Not a ZIP archive/);
    const truncated = readFileSync(path).subarray(0, 200);
    await assert.rejects(parseYoutubeArchiveFile(dir.write('truncated.zip', truncated), SECRET));
    // A split export's part without history gets the existing message.
    const videosOnly = dir.write('part2.zip', rawZip([{ name: 'Takeout/YouTube and YouTube Music/videos/a.mp4', data: Buffer.from('x') }]));
    await assert.rejects(parseYoutubeArchiveFile(videosOnly, SECRET), /no recognized YouTube watch or search history/);
  } finally { dir.done(); }
});

test('zip bombs stop at the uncompressed budget, whatever the headers declare', async () => {
  const dir = scratch();
  const limit = { maxUncompressedBytes: 1024 * 1024 };
  try {
    // 8 MiB of padding deflates to a few KiB.
    const bomb = Buffer.concat([history(1), Buffer.alloc(8 * 1024 * 1024, 0x20)]);
    const honest = dir.write('honest.zip', rawZip([{ name: WATCH, data: bomb }]));
    assert.ok(readFileSync(honest).length < 64 * 1024);
    await assert.rejects(parseYoutubeArchiveFile(honest, SECRET, 'takeout', limit), /exceeds uncompressed size limit/);
    // The same data declaring 100 bytes: rejected while inflating.
    const forged = dir.write('forged.zip', rawZip([{ name: WATCH, data: bomb, declaredSize: 100 }]));
    await assert.rejects(parseYoutubeArchiveFile(forged, SECRET, 'takeout', limit), /exceeds uncompressed size limit/);
    // The budget spans entries: three 600 KiB entries declaring 100 bytes each.
    const spread = dir.write('spread.zip', rawZip([0, 1, 2].map(n => ({
      name: `Takeout/My Activity/YouTube/part-${n}.json`, data: Buffer.concat([history(1), Buffer.alloc(600 * 1024, 0x20)]), declaredSize: 100,
    }))));
    await assert.rejects(parseYoutubeArchiveFile(spread, SECRET, 'takeout', limit), /exceeds uncompressed size limit/);
    // The compressed size limit still applies to the file itself.
    await assert.rejects(parseYoutubeArchiveFile(honest, SECRET, 'takeout', { maxArchiveBytes: 1024 }), /exceeds compressed size limit/);
  } finally { dir.done(); }
});

test('the import worker reads an archive from disk', async () => {
  const dir = scratch();
  const databasePath = join(dir.root, 'user.sqlite');
  const live = new Repository(databasePath);
  try {
    const path = dir.write('takeout.zip', rawZip([{ name: WATCH, data: history(500) }]));
    const result = await importArchive(live, { databasePath, archivePath: path, archiveHash: 'a'.repeat(64), dataKey: SECRET, source: 'takeout' });
    assert.equal(result.watchesInserted, 500);
    assert.equal(live.youtubeCounts().watches, 500);
    await assert.rejects(importArchive(live, { databasePath, archivePath: join(dir.root, 'missing.zip'), dataKey: SECRET, source: 'takeout' }));
  } finally { live.close(); dir.done(); }
});

test('multipart uploads stream the file to a private temporary file, split across any chunk boundary', async () => {
  const dir = scratch();
  try {
    const uploads = new TakeoutUploads({ tempDirectory: dir.root, maxArchiveBytes: 1024 * 1024, concurrency: 1 });
    const boundary = '----synthetic-boundary';
    // File bytes that look like a delimiter without being one.
    const file = Buffer.concat([Buffer.from('PK\r\n--'), Buffer.from(`\r\n--${boundary.slice(0, -1)}X`), Buffer.alloc(70_000, 7), Buffer.from('\r\n-')]);
    const body = multipart(boundary, [{ name: 'note', data: 'hello' }, { name: 'takeout', filename: 'takeout-1.zip', data: file }]);
    for (const piece of [1, 7, 64, 4096, body.length]) {
      const { request } = multipartRequest(body, boundary, piece);
      const form = await uploads.receiveMultipart(request, 'takeout', name => name.endsWith('.zip'));
      assert.equal(form.fields.note, 'hello', `piece ${piece}`);
      assert.equal(form.filename, 'takeout-1.zip');
      assert.ok(form.file);
      assert.deepEqual(readFileSync(form.file.path), file, `piece ${piece}`);
      assert.equal(form.file.sha256, createHash('sha256').update(file).digest('hex'));
      assert.equal(form.file.bytes, file.length);
      assert.equal(uploads.inFlight, 1, 'the slot is held until the import is done');
      await form.file.cleanup();
      await form.file.cleanup();
      assert.equal(uploads.inFlight, 0);
      assert.deepEqual(dir.leftovers(), []);
    }
    // A form naming an earlier upload session carries no file and takes no slot.
    const fieldsOnly = multipart(boundary, [{ name: 'upload', data: 'session-id' }, { name: 'takeout', filename: '', data: '' }]);
    const form = await uploads.receiveMultipart(multipartRequest(fieldsOnly, boundary).request, 'takeout', () => true);
    assert.deepEqual(form, { fields: { upload: 'session-id' } });
    // A non-ZIP name is refused before anything is written.
    await assert.rejects(uploads.receiveMultipart(multipartRequest(body, boundary).request, 'takeout', name => name.endsWith('.txt')), UploadRejected);
    // Truncated or malformed bodies leave nothing behind.
    await assert.rejects(uploads.receiveMultipart(multipartRequest(body.subarray(0, body.length - 30), boundary).request, 'takeout', () => true), /Truncated/);
    await assert.rejects(uploads.receiveMultipart(new Request('http://localhost/', { method: 'POST', body: 'x', headers: { 'content-type': 'multipart/form-data' } }), 'takeout', () => true), /boundary/);
    assert.deepEqual(dir.leftovers(), []);
    assert.equal(uploads.inFlight, 0);
  } finally { dir.done(); }
});

test('oversized uploads are cut off while streaming and their partial files deleted', async () => {
  const dir = scratch();
  try {
    const uploads = new TakeoutUploads({ tempDirectory: dir.root, maxArchiveBytes: 100 * 1024, concurrency: 1 });
    const boundary = 'b';
    const body = multipart(boundary, [{ name: 'takeout', filename: 'big.zip', data: Buffer.alloc(150 * 1024, 1) }]);
    // The declared length alone is enough to refuse.
    const declared = multipartRequest(body, boundary, 1024, undefined, { 'content-length': String(2 * 1024 * 1024) });
    await assert.rejects(uploads.receiveMultipart(declared.request, 'takeout', () => true), UploadTooLarge);
    assert.ok(declared.cancelled());
    // An understated length is caught by counting: the file passes 100 KiB.
    const understated = multipartRequest(body, boundary, 1024, undefined, { 'content-length': '10' });
    await assert.rejects(uploads.receiveMultipart(understated.request, 'takeout', () => true), UploadTooLarge);
    assert.ok(understated.cancelled());
    const raw = streamed(Buffer.alloc(150 * 1024), 1024);
    await assert.rejects(uploads.receiveBody(new Request('http://localhost/', { method: 'POST', body: raw.stream, duplex: 'half' } as RequestInit)), UploadTooLarge);
    assert.ok(raw.cancelled());
    assert.deepEqual(dir.leftovers(), []);
    assert.equal(uploads.inFlight, 0);
    assert.equal(archiveLimitLabel(2 * 1024 ** 3), '2 GB');
    assert.equal(archiveLimitLabel(1536 * 1024 ** 2), '1.5 GB');
    assert.equal(archiveLimitLabel(100 * 1024 ** 2), '100 MB');
  } finally { dir.done(); }
});

test('uploads beyond the concurrency limit are refused before their body is read', async () => {
  const dir = scratch();
  try {
    const uploads = new TakeoutUploads({ tempDirectory: dir.root, maxArchiveBytes: 1024 * 1024, concurrency: 1 });
    const boundary = 'c';
    const body = multipart(boundary, [{ name: 'takeout', filename: 'a.zip', data: Buffer.alloc(10_000, 2) }]);
    let release!: () => void;
    const first = uploads.receiveMultipart(multipartRequest(body, boundary, 1000, new Promise(resolve => { release = resolve; })).request, 'takeout', () => true);
    while (uploads.inFlight === 0) await new Promise(resolve => setTimeout(resolve, 1));
    const second = multipartRequest(body, boundary, 1000);
    await assert.rejects(uploads.receiveMultipart(second.request, 'takeout', () => true), UploadBusy);
    assert.ok(second.cancelled());
    await assert.rejects(uploads.receiveBody(new Request('http://localhost/', { method: 'POST', body: 'PK' })), UploadBusy);
    await assert.rejects(uploads.start(2, 10), UploadBusy);
    release();
    const done = await first;
    assert.equal(uploads.inFlight, 1, 'held through the import');
    await assert.rejects(uploads.start(2, 10), UploadBusy);
    await done.file!.cleanup();
    const next = await uploads.receiveBody(new Request('http://localhost/', { method: 'POST', body: 'PK' }));
    assert.equal(next.bytes, 2);
    await next.cleanup();
    // Two slots allow two.
    const wider = new TakeoutUploads({ tempDirectory: dir.root, maxArchiveBytes: 1024, concurrency: 2 });
    const a = await wider.start(1, 10);
    const b = await wider.start(2, 10);
    assert.notEqual(a.id, b.id);
    await assert.rejects(wider.start(3, 10), UploadBusy);
    await wider.cancel(1, a.id);
    await wider.cancel(2, b.id);
    assert.equal(wider.inFlight, 0);
    assert.deepEqual(dir.leftovers(), []);
  } finally { dir.done(); }
});

test('chunked uploads accept ordered chunks for their owner only and clean up on every exit', async () => {
  const dir = scratch();
  try {
    const uploads = new TakeoutUploads({ tempDirectory: dir.root, maxArchiveBytes: 1000, concurrency: 1, chunkBytes: 300, idleMs: 60_000 });
    const file = Buffer.from(Array.from({ length: 700 }, (_, i) => i % 251));
    const chunk = (from: number, to: number) => new Request('http://localhost/', { method: 'POST', body: file.subarray(from, to) });
    await assert.rejects(uploads.start(1, 1001), UploadTooLarge);
    await assert.rejects(uploads.start(1, 0), UploadRejected);
    const { id, chunkBytes } = await uploads.start(1, file.length);
    assert.equal(chunkBytes, 300);
    await assert.rejects(uploads.appendChunk(2, id, 0, chunk(0, 300)), UploadNotFound, 'another account cannot write');
    await assert.rejects(uploads.complete(2, id), UploadNotFound);
    await assert.rejects(uploads.appendChunk(1, id, 300, chunk(300, 600)), /Unexpected chunk offset/);
    assert.deepEqual(await uploads.appendChunk(1, id, 0, chunk(0, 300)), { received: 300, size: 700 });
    assert.deepEqual(await uploads.appendChunk(1, id, 300, chunk(300, 600)), { received: 600, size: 700 });
    assert.deepEqual(await uploads.appendChunk(1, id, 600, chunk(600, 700)), { received: 700, size: 700 });
    const archive = await uploads.complete(1, id);
    assert.deepEqual(readFileSync(archive.path), file);
    assert.equal(archive.sha256, createHash('sha256').update(file).digest('hex'));
    await assert.rejects(uploads.complete(1, id), UploadNotFound, 'a session completes once');
    assert.equal(uploads.inFlight, 1);
    await archive.cleanup();
    assert.equal(uploads.inFlight, 0);

    // A chunk over the session's room ends the session.
    const oversized = await uploads.start(1, 400);
    await assert.rejects(uploads.appendChunk(1, oversized.id, 0, new Request('http://localhost/', { method: 'POST', body: Buffer.alloc(301) })), UploadTooLarge);
    await assert.rejects(uploads.appendChunk(1, oversized.id, 0, chunk(0, 10)), UploadNotFound);
    assert.equal(uploads.inFlight, 0);
    // Completing early discards the partial file.
    const early = await uploads.start(1, 700);
    await uploads.appendChunk(1, early.id, 0, chunk(0, 300));
    await assert.rejects(uploads.complete(1, early.id), /incomplete/);
    assert.equal(uploads.inFlight, 0);
    // Starting again replaces the account's previous session.
    const old = await uploads.start(1, 700);
    const replacement = await uploads.start(1, 700);
    await assert.rejects(uploads.appendChunk(1, old.id, 0, chunk(0, 300)), UploadNotFound);
    await uploads.cancel(1, replacement.id);
    assert.equal(uploads.inFlight, 0);
    assert.deepEqual(dir.leftovers(), []);
  } finally { dir.done(); }
});

test('idle chunked sessions expire, and a full disk is refused up front', async () => {
  const dir = scratch();
  try {
    const idle = new TakeoutUploads({ tempDirectory: dir.root, maxArchiveBytes: 1000, concurrency: 1, idleMs: 20 });
    const session = await idle.start(1, 10);
    assert.equal(dir.leftovers().length, 1);
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(idle.inFlight, 0);
    assert.deepEqual(dir.leftovers(), []);
    await assert.rejects(idle.appendChunk(1, session.id, 0, new Request('http://localhost/', { method: 'POST', body: 'x' })), UploadNotFound);
    const full = new TakeoutUploads({ tempDirectory: dir.root, maxArchiveBytes: 1000, concurrency: 1, freeBytes: async () => 100 * 1024 * 1024 });
    await assert.rejects(full.start(1, 10), UploadNoSpace);
    await assert.rejects(full.receiveBody(new Request('http://localhost/', { method: 'POST', body: 'PK' })), UploadNoSpace);
    assert.equal(full.inFlight, 0);
    assert.deepEqual(dir.leftovers(), []);
  } finally { dir.done(); }
});

test('the start-up sweep removes only abandoned upload directories', async () => {
  const dir = scratch();
  try {
    const now = Date.now();
    const make = (name: string, ageMs: number) => {
      const path = join(dir.root, name);
      mkdirSync(path);
      writeFileSync(join(path, 'archive.zip'), 'x');
      const at = new Date(now - ageMs);
      utimesSync(join(path, 'archive.zip'), at, at);
      utimesSync(path, at, at);
      return path;
    };
    const abandoned = make('urtube-takeout-old', 2 * 3600_000);
    const live = make('urtube-takeout-live', 60_000);
    const unrelated = make('something-else', 5 * 3600_000);
    assert.equal(await sweepStaleTakeoutUploads(dir.root, 45 * 60_000, now), 1);
    assert.equal(existsSync(abandoned), false);
    assert.equal(existsSync(live), true);
    assert.equal(existsSync(unrelated), true);
    assert.equal(await sweepStaleTakeoutUploads(join(dir.root, 'missing')), 0);
  } finally { dir.done(); }
});

function signedIn(registry: UserRegistry, handle: string) {
  const user = registry.createUser(handle, 'Synthetic');
  return { user, cookie: `urtube_session=${registry.createSession(user)}` };
}

test('the account form imports a streamed Takeout ZIP and deletes the temporary file', async () => {
  const dir = scratch();
  const registry = new UserRegistry(':memory:');
  try {
    const takeoutUploads = new TakeoutUploads({ tempDirectory: dir.root, maxArchiveBytes: 256 * 1024, concurrency: 1 });
    const app = createApp(registry, { takeoutUploads });
    const { user, cookie } = signedIn(registry, 'stream-import');
    const boundary = 'form-boundary';
    const post = (body: Buffer, extra: Record<string, string> = {}) => app.request('/account/takeout?lang=en', {
      method: 'POST', body: streamed(body, 4096).stream, duplex: 'half',
      headers: { cookie, origin, 'content-type': `multipart/form-data; boundary=${boundary}`, ...extra },
    } as RequestInit);
    const archive = rawZip([{ name: WATCH, data: history(5) }, { name: 'Takeout/YouTube and YouTube Music/videos/v.mp4', data: Buffer.alloc(50_000, 9), method: 0 }]);
    const ok = await post(multipart(boundary, [{ name: 'upload', data: '' }, { name: 'takeout', filename: 'takeout-20261113.zip', data: archive }]));
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /Import complete: 5 of 5 watch records/);
    assert.equal(registry.repositoryFor(user).youtubeCounts().watches, 5);
    assert.deepEqual(dir.leftovers(), []);
    assert.equal(takeoutUploads.inFlight, 0);
    // The same ZIP again is an idempotent import.
    const again = await post(multipart(boundary, [{ name: 'takeout', filename: 'takeout-20261113.zip', data: archive }]));
    assert.match(await again.text(), /Import complete: 0 of 5 watch records/);
    // A failed import deletes its file too.
    const broken = await post(multipart(boundary, [{ name: 'takeout', filename: 'broken.zip', data: Buffer.from('PK not really') }]));
    assert.equal(broken.status, 400);
    assert.match(await broken.text(), /could not be read/);
    assert.deepEqual(dir.leftovers(), []);
    // Error codes: wrong file type, too large (413, the new limit named), no file.
    const text = await post(multipart(boundary, [{ name: 'takeout', filename: 'notes.txt', data: 'x' }]));
    assert.equal(text.status, 400);
    assert.match(await text.text(), /Choose the original Google Takeout \.zip file/);
    const large = await post(multipart(boundary, [{ name: 'takeout', filename: 'large.zip', data: Buffer.alloc(300 * 1024) }]));
    assert.equal(large.status, 413);
    assert.match(await large.text(), /The Takeout ZIP exceeds the \d+ MB upload limit/);
    const empty = await post(multipart(boundary, [{ name: 'takeout', filename: '', data: '' }]));
    assert.equal(empty.status, 400);
    assert.deepEqual(dir.leftovers(), []);
    // Signed out: redirected without reading the body.
    const anonymous = streamed(multipart(boundary, [{ name: 'takeout', filename: 'a.zip', data: archive }]), 1024);
    const redirected = await app.request('/account/takeout', { method: 'POST', body: anonymous.stream, duplex: 'half',
      headers: { origin, 'content-type': `multipart/form-data; boundary=${boundary}` } } as RequestInit);
    assert.equal(redirected.status, 302);
    assert.equal(redirected.headers.get('location'), '/signup');
  } finally { registry.close(); dir.done(); }
});

test('the account routes answer busy uploads with 429 and a full temporary disk with 507', async () => {
  const dir = scratch();
  const registry = new UserRegistry(':memory:');
  try {
    const takeoutUploads = new TakeoutUploads({ tempDirectory: dir.root, maxArchiveBytes: 1024 * 1024, concurrency: 1 });
    const app = createApp(registry, { takeoutUploads });
    const { user: other } = signedIn(registry, 'busy-other');
    const { cookie } = signedIn(registry, 'busy-self');
    const held = await takeoutUploads.start(other.id, 100);
    const boundary = 'busy';
    const response = await app.request('/account/takeout?lang=zh', { method: 'POST',
      body: multipart(boundary, [{ name: 'takeout', filename: 'a.zip', data: rawZip([{ name: WATCH, data: history(1) }]) }]),
      headers: { cookie, origin, 'content-type': `multipart/form-data; boundary=${boundary}` } });
    assert.equal(response.status, 429);
    assert.match(await response.text(), /伺服器正在匯入另一份 Takeout 檔案/);
    const start = await app.request('/account/takeout/upload?lang=en', { method: 'POST', body: JSON.stringify({ size: 10, name: 'a.zip' }),
      headers: { cookie, origin, 'content-type': 'application/json' } });
    assert.equal(start.status, 429);
    assert.match((await start.json() as { error: string }).error, /importing another Takeout archive/);
    await takeoutUploads.cancel(other.id, held.id);

    const full = createApp(registry, { takeoutUploads: new TakeoutUploads({ tempDirectory: dir.root, maxArchiveBytes: 1024 * 1024, concurrency: 1, freeBytes: async () => 0 }) });
    const noSpace = await full.request('/account/takeout/upload?lang=en', { method: 'POST', body: JSON.stringify({ size: 10, name: 'a.zip' }),
      headers: { cookie, origin, 'content-type': 'application/json' } });
    assert.equal(noSpace.status, 507);
    assert.deepEqual(dir.leftovers(), []);
  } finally { registry.close(); dir.done(); }
});

test('a chunked upload through the account routes is imported by the form submission', async () => {
  const dir = scratch();
  const registry = new UserRegistry(':memory:');
  try {
    const takeoutUploads = new TakeoutUploads({ tempDirectory: dir.root, maxArchiveBytes: 1024 * 1024, concurrency: 1, chunkBytes: 1000 });
    const app = createApp(registry, { takeoutUploads });
    const { user, cookie } = signedIn(registry, 'chunk-import');
    const { cookie: otherCookie } = signedIn(registry, 'chunk-other');
    const archive = rawZip([{ name: WATCH, data: history(40) }, { name: SEARCH, data: searches }]);
    const json = { 'content-type': 'application/json' };
    const bad = await app.request('/account/takeout/upload', { method: 'POST', body: JSON.stringify({ size: 10, name: 'a.txt' }), headers: { cookie, origin, ...json } });
    assert.equal(bad.status, 400);
    const tooLarge = await app.request('/account/takeout/upload?lang=en', { method: 'POST', body: JSON.stringify({ size: 2 * 1024 * 1024, name: 'a.zip' }), headers: { cookie, origin, ...json } });
    assert.equal(tooLarge.status, 413);
    assert.match((await tooLarge.json() as { error: string }).error, /exceeds the 1 MB upload limit/);
    assert.equal((await app.request('/account/takeout/upload', { method: 'POST', body: '{}', headers: { origin, ...json } })).status, 401);
    const started = await app.request('/account/takeout/upload', { method: 'POST', body: JSON.stringify({ size: archive.length, name: 'takeout.zip' }), headers: { cookie, origin, ...json } });
    assert.equal(started.status, 201);
    const { id, chunkBytes } = await started.json() as { id: string; chunkBytes: number };
    assert.equal(chunkBytes, 1000);
    const chunk = (offset: number, who = cookie) => app.request(`/account/takeout/upload/${id}/chunk?offset=${offset}`, {
      method: 'POST', body: archive.subarray(offset, offset + chunkBytes), headers: { cookie: who, origin, 'content-type': 'application/octet-stream' } });
    assert.equal((await chunk(0, otherCookie)).status, 404, 'another account cannot add to it');
    for (let offset = 0; offset < archive.length; offset += chunkBytes) {
      const response = await chunk(offset);
      assert.equal(response.status, 200, `offset ${offset}`);
    }
    const boundary = 'final';
    // Another account cannot import it, and trying does not consume it.
    const stolen = await app.request('/account/takeout?lang=en', { method: 'POST', body: multipart(boundary, [{ name: 'upload', data: id }, { name: 'takeout', filename: '', data: '' }]),
      headers: { cookie: otherCookie, origin, 'content-type': `multipart/form-data; boundary=${boundary}` } });
    assert.equal(stolen.status, 400);
    assert.match(await stolen.text(), /did not finish or has expired/);
    const final = await app.request('/account/takeout?lang=en', { method: 'POST', body: multipart(boundary, [{ name: 'upload', data: id }, { name: 'takeout', filename: '', data: '' }]),
      headers: { cookie, origin, 'content-type': `multipart/form-data; boundary=${boundary}` } });
    assert.equal(final.status, 200);
    assert.match(await final.text(), /Import complete: 40 of 40 watch records and 1 of 1 searches/);
    assert.equal(registry.repositoryFor(user).youtubeCounts().watches, 40);
    assert.deepEqual(dir.leftovers(), []);
    assert.equal(takeoutUploads.inFlight, 0);
    // The session is gone after use.
    const reuse = await app.request('/account/takeout?lang=en', { method: 'POST', body: multipart(boundary, [{ name: 'upload', data: id }]),
      headers: { cookie, origin, 'content-type': `multipart/form-data; boundary=${boundary}` } });
    assert.equal(reuse.status, 400);
    assert.equal((await chunk(0)).status, 404);
    const cancel = await app.request(`/account/takeout/upload/${id}/cancel`, { method: 'POST', headers: { cookie, origin } });
    assert.equal(cancel.status, 204);
  } finally { registry.close(); dir.done(); }
});

test('the ingest API streams Takeout to a temporary file and enforces its limits', async () => {
  const dir = scratch();
  const registry = new UserRegistry(':memory:');
  try {
    const takeoutUploads = new TakeoutUploads({ tempDirectory: dir.root, maxArchiveBytes: 64 * 1024, concurrency: 1 });
    const app = createIngestApp(registry, { takeoutUploads });
    const user = registry.createUser('ingest-stream', 'Synthetic');
    const headers = { authorization: `Bearer ${user.captureToken}`, 'content-type': 'application/zip' };
    const archive = rawZip([{ name: WATCH, data: history(3) }]);
    const response = await app.request('/api/ingest/youtube/takeout', { method: 'POST', body: streamed(archive, 333).stream, duplex: 'half', headers } as RequestInit);
    assert.equal(response.status, 201);
    assert.equal((await response.json() as { watchesInserted: number }).watchesInserted, 3);
    assert.deepEqual(dir.leftovers(), []);
    const large = await app.request('/api/ingest/youtube/takeout', { method: 'POST', body: Buffer.alloc(65 * 1024), headers });
    assert.equal(large.status, 413);
    const held = await takeoutUploads.start(99, 10);
    const busy = await app.request('/api/ingest/youtube/takeout', { method: 'POST', body: archive, headers });
    assert.equal(busy.status, 429);
    await takeoutUploads.cancel(99, held.id);
    assert.deepEqual(dir.leftovers(), []);
  } finally { registry.close(); dir.done(); }
});

test('the browser sends large files in chunks, then submits the form naming the upload', async () => {
  const listeners = new Map<string, (event: { defaultPrevented?: boolean; preventDefault(): void }) => void>();
  const calls: Array<{ url: string; body: unknown }> = [];
  let submitted = 0;
  const input = { files: [{ name: 'takeout.zip', size: 2500, slice: (a: number, b: number) => ({ a, b }) }], disabled: false,
    setCustomValidity() {}, reportValidity() {}, addEventListener() {} };
  const button = { disabled: false, textContent: 'Import' };
  const status = { textContent: '' };
  const session = { value: '' };
  const form = {
    dataset: { maxBytes: '1000000', directMax: '1000', chunkStart: '/account/takeout/upload', progress: 'Uploading… {percent}%',
      uploadFailed: 'Interrupted', invalidFile: 'Choose ZIP', tooLarge: 'Too large', uploading: 'Importing', wait: 'Keep open' },
    querySelector: (selector: string) => selector === 'input[type=file]' ? input : selector === 'button[type=submit]' ? button
      : selector === 'input[name=upload]' ? session : null,
    addEventListener: (type: string, fn: (event: { defaultPrevented?: boolean; preventDefault(): void }) => void) => listeners.set(type, fn),
    setAttribute() {}, removeAttribute() {},
    submit() { submitted++; },
  };
  let failAt = -1;
  const fetch = async (url: string, init: { body?: unknown }) => {
    calls.push({ url, body: init.body });
    if (url === '/account/takeout/upload') return { ok: true, json: async () => ({ id: 'abc', chunkBytes: 1000 }) };
    if (url.includes('/chunk') && calls.length - 1 === failAt) return { ok: false, json: async () => ({ error: 'Server says no' }) };
    return { ok: true, json: async () => ({}) };
  };
  vm.runInNewContext(uploadFeedbackScript, { document: { querySelector: () => form, getElementById: () => status }, addEventListener() {}, fetch, JSON, Math, String, encodeURIComponent });
  let prevented = false;
  listeners.get('submit')!({ preventDefault() { prevented = true; } });
  assert.ok(prevented, 'the browser does not post the large file itself');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(calls.map(call => call.url), ['/account/takeout/upload', '/account/takeout/upload/abc/chunk?offset=0',
    '/account/takeout/upload/abc/chunk?offset=1000', '/account/takeout/upload/abc/chunk?offset=2000']);
  assert.deepEqual(calls.slice(1).map(call => call.body), [{ a: 0, b: 1000 }, { a: 1000, b: 2000 }, { a: 2000, b: 2500 }]);
  assert.equal(session.value, 'abc');
  assert.equal(input.disabled, true, 'the file is not sent again');
  assert.equal(submitted, 1);
  assert.equal(status.textContent, 'Keep open');

  // A failed chunk cancels the session and lets the visitor retry.
  calls.length = 0; submitted = 0; failAt = 2;
  listeners.get('pageshow' as never)?.({ preventDefault() {} });
  input.disabled = false; button.disabled = false; session.value = '';
  vm.runInNewContext(uploadFeedbackScript, { document: { querySelector: () => form, getElementById: () => status }, addEventListener() {}, fetch, JSON, Math, String, encodeURIComponent });
  listeners.get('submit')!({ preventDefault() {} });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(submitted, 0);
  assert.equal(status.textContent, 'Server says no');
  assert.equal(button.disabled, false);
  assert.equal(session.value, '');
  assert.ok(calls.some(call => call.url === '/account/takeout/upload/abc/cancel'));

  // Small files post the form directly, as before.
  input.files = [{ name: 'small.zip', size: 999, slice: (a: number, b: number) => ({ a, b }) }];
  calls.length = 0;
  vm.runInNewContext(uploadFeedbackScript, { document: { querySelector: () => form, getElementById: () => status }, addEventListener() {}, fetch, JSON, Math, String, encodeURIComponent });
  listeners.get('submit')!({ preventDefault() { assert.fail('a small file is posted with the form'); } });
  assert.deepEqual(calls, []);
});
