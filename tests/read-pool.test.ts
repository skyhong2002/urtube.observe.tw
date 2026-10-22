import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { Repository } from '../src/data/database.js';
import { cachedReadAsync, clearReadCaches } from '../src/data/read-cache.js';
import { readOffThread, runRead } from '../src/read-pool.js';
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
