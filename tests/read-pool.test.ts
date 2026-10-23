import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { Repository } from '../src/data/database.js';
import { cachedReadAsync, clearReadCaches, forgetDurableReads, type DurableRead } from '../src/data/read-cache.js';
import { readMethodOffThread, readOffThread, runRead } from '../src/read-pool.js';
import { parseYoutubeArchive } from '../src/youtube/takeout.js';

const SECRET = 'test-private-data-key-with-at-least-32-characters';

function seeded(path: string): Repository {
  const repository = new Repository(path);
  const entries = Array.from({ length: 300 }, (_, index) => ({
    header: 'YouTube', title: `Watched Synthetic ${index % 40}`,
    titleUrl: `https://www.youtube.com/watch?v=${String(index % 40).padStart(11, 'B')}`,
    subtitles: [{ name: `Channel ${index % 7}`, url: `https://www.youtube.com/channel/UC${String(index % 7).padStart(22, 'x')}` }],
    time: new Date(Date.UTC(2026, 6, 1) + index * 3_600_000).toISOString(),
    products: ['YouTube'], activityControls: ['YouTube watch history'],
  }));
  const archive = zipSync({ 'Takeout/YouTube and YouTube Music/history/watch-history.json': strToU8(JSON.stringify(entries)) });
  repository.ingestYoutubeArchive(parseYoutubeArchive(archive, SECRET, 'takeout'));
  return repository;
}

test('reads on the pool equal the same reads on this thread', async () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-read-pool-'));
  const path = join(root, 'archive.sqlite');
  const repository = seeded(path);
  try {
    const now = '2026-08-01T00:00:00.000Z';
    const cases = [
      ['dashboard', { range: 'all', now, includeInsights: true }],
      ['dashboard', { range: '30d', now, includeInsights: 'overview' }],
      ['dashboard', { range: 'all', now, includeInsights: 'summary' }],
      ['crystalShifts', { now }],
      ['popularity', { range: 'all', now }],
    ] as const;
    for (const [kind, args] of cases) {
      const here = runRead(repository, kind, args as never);
      const there = await readOffThread(repository, path, kind, args as never);
      assert.deepEqual(there, JSON.parse(JSON.stringify(here)), `${kind} ${JSON.stringify(args)}`);
    }
    const historyQuery = { range: 'all' as const, q: 'Synthetic', limit: 50 };
    const history = await readMethodOffThread(repository, path, 'youtubeHistoryPage', historyQuery, new Date(now));
    assert.deepEqual(history, repository.youtubeHistoryPage(historyQuery, new Date(now)), 'private history works on a read-only connection');
    assert.ok(history.olderCursor);
    const olderQuery = { ...historyQuery, cursor: history.olderCursor };
    assert.deepEqual(await readMethodOffThread(repository, path, 'youtubeHistoryPage', olderQuery, new Date(now)),
      repository.youtubeHistoryPage(olderQuery, new Date(now)), 'history cursors survive worker serialization');
    const updatedAt = await readMethodOffThread(repository, path, 'youtubeReferenceDataUpdatedAt');
    assert.ok(updatedAt);
    assert.equal(updatedAt, repository.youtubeReferenceDataUpdatedAt(), 'reference freshness reads on the pool');
    await assert.rejects(readOffThread(repository, join(root, 'missing.sqlite'), 'popularity', { range: 'all', now: new Date().toISOString() }), /./);
  } finally {
    repository.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('concurrent requests share one read and later writes recompute', async () => {
  clearReadCaches();
  const repository = new Repository(':memory:');
  try {
    let reads = 0;
    const read = async () => { reads++; await new Promise((resolve) => setTimeout(resolve, 10)); return reads; };
    const [a, b] = await Promise.all([cachedReadAsync(repository, 'key', read), cachedReadAsync(repository, 'key', read)]);
    assert.equal(reads, 1);
    assert.equal(a, b);
    assert.equal(await cachedReadAsync(repository, 'key', read), 1, 'cached until the archive changes');
    repository.setYoutubeSyncState('fixture', 'changed');
    assert.equal(await cachedReadAsync(repository, 'key', read), 2);
  } finally {
    repository.close();
  }
});

test('stale-while-revalidate serves the previous value during one background refresh', async () => {
  clearReadCaches();
  const repository = new Repository(':memory:');
  try {
    let reads = 0;
    let release = () => {};
    const read = async () => {
      const n = ++reads;
      if (n > 1) await new Promise<void>((resolve) => { release = resolve; });
      return n;
    };
    const visitor = () => cachedReadAsync(repository, 'key', read, 300_000, { staleFor: 60_000 });
    assert.equal(await visitor(), 1);
    repository.setYoutubeSyncState('fixture', 'changed');
    assert.equal(await visitor(), 1, 'previous value while the archive refreshes');
    assert.equal(await visitor(), 1);
    assert.equal(reads, 2, 'one background refresh');
    const owner = cachedReadAsync(repository, 'key', read);
    release();
    assert.equal(await owner, 2, 'without staleFor (the owner) a request waits for current data');
    assert.equal(await visitor(), 2);

    let fail = true;
    const failing = async () => { if (fail) throw new Error('unavailable'); return 'fresh'; };
    fail = false;
    assert.equal(await cachedReadAsync(repository, 'failing', failing, 300_000, { staleFor: 60_000 }), 'fresh');
    fail = true;
    repository.setYoutubeSyncState('fixture', 'again');
    assert.equal(await cachedReadAsync(repository, 'failing', failing, 300_000, { staleFor: 60_000 }), 'fresh', 'a failed refresh keeps the entry');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await assert.rejects(cachedReadAsync(repository, 'failing', failing, 300_000, { staleFor: 1 }), /unavailable/, 'not beyond staleFor');
  } finally {
    repository.close();
  }
});

type Value = { n: number; recent: string[] };
function durableFixture(path: string, subject = 7, version = 'test:1'): DurableRead {
  return {
    path, subject, version,
    project: (value) => ({ ...(value as Value), recent: [] }),
    valid: (value) => typeof value === 'object' && value !== null && typeof (value as Value).n === 'number'
      && Array.isArray((value as Value).recent) && (value as Value).recent.length === 0,
  };
}
// Durable copies are written after the read settles; wait until nothing is pending.
// expectFiles: wait (up to 5 s) for at least one; otherwise give pending
// writes a moment and report what exists.
async function settled(directory: string, expectFiles = false): Promise<string[]> {
  let listing: string | undefined;
  for (let i = 0; i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const next = existsSync(directory) ? readdirSync(directory).sort().join() : '';
    if (next === listing && !next.includes('.tmp') && (next || !expectFiles) && i >= 3) break;
    listing = next;
  }
  return existsSync(directory) ? readdirSync(directory) : [];
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
const importOne = (repository: Repository) => repository.ingestYoutubeArchive(parseYoutubeArchive(zipSync({ 'Takeout/YouTube and YouTube Music/history/watch-history.json': strToU8(JSON.stringify([{
  header: 'YouTube', title: 'Watched Another', titleUrl: 'https://www.youtube.com/watch?v=BBBBBBBBBBB',
  time: '2026-07-20T00:00:00.000Z', products: ['YouTube'], activityControls: ['YouTube watch history'],
}])) }), SECRET, 'takeout'));

test('durable copies hold only the public projection, are private files, and never serve the owner', async () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-durable-'));
  const path = join(root, 'archive.sqlite');
  const directory = `${path}-aggregates`;
  let repository = seeded(path);
  try {
    clearReadCaches();
    let reads = 0;
    const read = async (): Promise<Value> => ({ n: ++reads, recent: ['private watch at 2026-07-01T00:00:00Z'] });
    const visitor = (r: Repository, durable = durableFixture(path)) =>
      cachedReadAsync(r, 'key', read, 300_000, { staleFor: 60_000, refreshAfter: 60_000, archive: path, durable });
    const owner = (r: Repository) => cachedReadAsync(r, 'key', read, 300_000, { archive: path, durable: durableFixture(path) });

    assert.deepEqual(await owner(repository), { n: 1, recent: ['private watch at 2026-07-01T00:00:00Z'] }, 'the owner gets complete data');
    assert.deepEqual(await settled(directory), [], 'the owner never writes a copy');
    clearReadCaches();
    assert.equal((await visitor(repository)).n, 2);
    const [file] = await settled(directory, true);
    const raw = readFileSync(join(directory, file), 'utf8');
    assert.doesNotMatch(raw, /private watch/, 'individual watches never reach the disk');
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(statSync(join(directory, file)).mode & 0o777, 0o600);

    // A restart: no memory cache, a new connection.
    clearReadCaches();
    repository.close();
    repository = new Repository(path);
    assert.deepEqual(await visitor(repository), { n: 2, recent: [] }, 'the projection is served after a restart');
    assert.equal(reads, 2, 'young enough: no recompute (refreshAfter)');
    assert.deepEqual(await owner(repository), { n: 3, recent: ['private watch at 2026-07-01T00:00:00Z'] },
      'the owner never gets the loaded projection, even from memory');
    clearReadCaches();
    assert.equal((await visitor(repository, durableFixture(path, 8))).n, 4, 'another account never reads it');
    clearReadCaches();
    assert.equal((await visitor(repository, durableFixture(path, 7, 'test:2'))).n, 5, 'another calculation version recomputes');
    await settled(directory, true);
    clearReadCaches();
    assert.equal((await visitor(repository, { ...durableFixture(path, 7, 'test:2'), valid: () => false })).n, 6, 'an unexpected shape recomputes');
  } finally {
    repository.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('an import that lands while a copy is read is never served from before it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-durable-import-'));
  const path = join(root, 'archive.sqlite');
  const repository = seeded(path);
  try {
    clearReadCaches();
    let reads = 0;
    const read = async (): Promise<Value> => ({ n: ++reads, recent: [] });
    const visitor = () => cachedReadAsync(repository, 'key', read, 300_000, { staleFor: 60_000, refreshAfter: 60_000, archive: path, durable: durableFixture(path) });
    assert.equal((await visitor()).n, 1);
    await settled(`${path}-aggregates`, true);
    clearReadCaches();
    // The request runs synchronously up to reading the file; the import
    // commits while that read is pending.
    const request = visitor();
    importOne(repository);
    assert.equal((await request).n, 2, 'recomputed, not the pre-import copy');
  } finally {
    repository.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a read that spans an import or deletion neither returns nor writes its result', async () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-durable-forget-'));
  const path = join(root, 'archive.sqlite');
  const directory = `${path}-aggregates`;
  const repository = seeded(path);
  try {
    for (const outcome of ['retried', 'deleted'] as const) {
      clearReadCaches();
      const first = deferred<Value>();
      const started = deferred<void>();
      let calls = 0;
      const read = (): Promise<Value> => {
        calls++;
        if (calls === 1) { started.resolve(); return first.promise; }
        return outcome === 'retried' ? Promise.resolve({ n: 2, recent: [] }) : Promise.reject(new Error('archive is gone'));
      };
      const request = cachedReadAsync(repository, `key-${outcome}`, read, 300_000, { staleFor: 60_000, archive: path, durable: durableFixture(path) });
      await started.promise;
      // The import or deletion lands while the read is running.
      forgetDurableReads(path);
      first.resolve({ n: 1, recent: [] });
      if (outcome === 'retried') assert.equal((await request).n, 2, 'the pre-import result is not returned');
      else await assert.rejects(request, /archive is gone/, 'nothing from the deleted archive is returned');
      const left = await settled(directory);
      if (outcome === 'deleted') assert.deepEqual(left, [], 'nothing from the deleted archive is written back');
      forgetDurableReads(path);
    }
    assert.equal(existsSync(directory), false);
  } finally {
    repository.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('an older refresh that finishes later never replaces a newer copy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-durable-order-'));
  const path = join(root, 'archive.sqlite');
  const repository = seeded(path);
  try {
    clearReadCaches();
    const older = deferred<Value>();
    const options = { staleFor: 60_000, refreshAfter: 60_000, archive: path, durable: durableFixture(path) };
    const first = cachedReadAsync(repository, 'key', () => older.promise, 300_000, options);
    await new Promise((resolve) => setTimeout(resolve, 5));
    clearReadCaches();
    assert.equal((await cachedReadAsync(repository, 'key', async () => ({ n: 2, recent: [] }), 300_000, options)).n, 2);
    await settled(`${path}-aggregates`, true);
    older.resolve({ n: 1, recent: [] });
    await first;
    await settled(`${path}-aggregates`);
    clearReadCaches();
    assert.equal((await cachedReadAsync(repository, 'key', async () => ({ n: 3, recent: [] }), 300_000, options)).n, 2, 'the newer copy is kept');
  } finally {
    repository.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('the web server opens archives without the full-table channel repair', () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-repair-'));
  const path = join(root, 'archive.sqlite');
  try {
    seeded(path).close();
    const prototype = Repository.prototype as unknown as { backfillYoutubeChannelIds: (...args: unknown[]) => number };
    const saved = prototype.backfillYoutubeChannelIds;
    let calls = 0;
    prototype.backfillYoutubeChannelIds = function (this: Repository, ...args: unknown[]) { calls++; return saved.apply(this, args); };
    try {
      new Repository(path, { repairOnOpen: false }).close();
      assert.equal(calls, 0, 'skipped when asked');
      new Repository(path).close();
      assert.equal(calls, 1, 'the default (worker, ingest) still repairs on open');
    } finally { prototype.backfillYoutubeChannelIds = saved; }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
