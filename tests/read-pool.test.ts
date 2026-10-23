import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { Repository } from '../src/data/database.js';
import { cachedReadAsync, clearReadCaches, forgetDurableReads } from '../src/data/read-cache.js';
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

test('durable aggregates serve visitors after a restart, never the owner, and never across an import', async () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-durable-'));
  const path = join(root, 'archive.sqlite');
  let repository = seeded(path);
  try {
    clearReadCaches();
    let reads = 0;
    const read = async () => ++reads;
    const durable = { path, subject: 7 };
    const visitor = (r: Repository, options = {}) => cachedReadAsync(r, 'key', read, 300_000, { staleFor: 60_000, refreshAfter: 60_000, durable, ...options });
    assert.equal(await cachedReadAsync(repository, 'key', read, 300_000, { durable }), 1, 'the owner computes and writes the copy');
    for (let i = 0; i < 50 && !existsSync(`${path}-aggregates`); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(readdirSync(`${path}-aggregates`).length, 1);

    // A restart: a new process has no memory cache and a new connection.
    clearReadCaches();
    repository.close();
    repository = new Repository(path);
    assert.equal(await visitor(repository), 1, 'served from the durable copy');
    assert.equal(reads, 1, 'young enough: no recompute (refreshAfter)');
    assert.equal(await visitor(repository, { durable: { path, subject: 8 } }), 1, 'memory entry still answers this process');
    clearReadCaches();
    assert.equal(await visitor(repository, { durable: { path, subject: 8 } }), 2, 'another account never reads it');
    clearReadCaches();
    assert.equal(await cachedReadAsync(repository, 'key', read, 300_000, { durable }), 3, 'the owner never reads a copy');

    // An import makes every earlier copy unusable, even for visitors.
    clearReadCaches();
    repository.ingestYoutubeArchive(parseYoutubeArchive(zipSync({ 'Takeout/YouTube and YouTube Music/history/watch-history.json': strToU8(JSON.stringify([{
      header: 'YouTube', title: 'Watched Another', titleUrl: 'https://www.youtube.com/watch?v=BBBBBBBBBBB',
      time: '2026-07-20T00:00:00.000Z', products: ['YouTube'], activityControls: ['YouTube watch history'],
    }])) }), SECRET, 'takeout'));
    assert.equal(await visitor(repository), 4, 'a pre-import copy is never served');

    forgetDurableReads(path);
    assert.equal(existsSync(`${path}-aggregates`), false);
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
