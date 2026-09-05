import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Repository } from '../src/data/database.js';
import { cachedRead, clearReadCaches } from '../src/data/read-cache.js';
import { normalizeYoutubeCapture } from '../src/youtube/capture.js';

test('cached aggregates reuse unchanged data and detect measured-time updates from ingest and other connections', () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-read-cache-'));
  const path = join(root, 'archive.sqlite');
  const repository = new Repository(path);
  const external = new DatabaseSync(path);
  const now = new Date();
  const capture = normalizeYoutubeCapture({
    sessionId: '12345678-1234-4123-8123-123456789abc', videoId: 'dQw4w9WgXcQ',
    title: 'Synthetic video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    channelTitle: 'Synthetic channel', watchedAt: now.toISOString(),
    actualWatchedSeconds: 12, durationSeconds: 213,
  }, now);
  let reads = 0;
  const read = () => cachedRead(repository, 'dashboard:all', () => {
    reads++;
    return repository.youtubeDashboard('all');
  });
  try {
    repository.upsertYoutubeCapture(capture, now.toISOString());
    const first = read();
    assert.equal(first.stats.estimatedWatchSeconds, 12);
    const summary = repository.youtubeDashboard('all', now, false);
    for (const key of ['stats', 'topChannels', 'topVideos', 'daily', 'recent'] as const) {
      assert.deepEqual(summary[key], first[key], `lightweight projection preserves ${key}`);
    }
    assert.deepEqual(summary.keywords, []);
    assert.deepEqual(summary.topicTrend, []);
    assert.deepEqual(summary.channelRace.frames, []);
    const overview = repository.youtubeDashboard('all', now, 'overview');
    const full = repository.youtubeDashboard('all', now);
    assert.deepEqual(overview.keywords, []);
    assert.deepEqual(overview.channelRace, full.channelRace);
    assert.deepEqual(overview.topicTrend, full.topicTrend);
    assert.deepEqual(overview.topics, full.topics);
    assert.equal(read(), first);
    assert.equal(reads, 1, 'TEMP materialization must not invalidate its own cache');
    repository.upsertYoutubeCapture({ ...capture, actualWatchedSeconds: 24 }, now.toISOString());
    assert.equal(read().stats.estimatedWatchSeconds, 24, 'same row count, updated measurement');
    assert.equal(reads, 2);
    external.exec('UPDATE youtube_watch_events SET actual_watched_seconds=36');
    assert.equal(read().stats.estimatedWatchSeconds, 36, 'worker/ingest connection invalidates immediately');
    assert.equal(reads, 3);
    external.exec('DELETE FROM youtube_watch_events');
    assert.equal(read().stats.watchEvents, 0);
    assert.equal(reads, 4);
    clearReadCaches();
    read();
    assert.equal(reads, 5);
  } finally {
    external.close(); repository.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('read caches are isolated by repository, bounded, and expire with the clock', () => {
  const a = new Repository(':memory:');
  const b = new Repository(':memory:');
  try {
    assert.equal(cachedRead(a, 'same-handle', () => 'Alice'), 'Alice');
    assert.equal(cachedRead(b, 'same-handle', () => 'Bob'), 'Bob');
    assert.equal(cachedRead(a, 'same-handle', () => 'fresh', 0), 'fresh');
    for (let i = 0; i < 130; i++) cachedRead(a, `range:${i}`, () => i);
    assert.equal(cachedRead(a, 'same-handle', () => 'evicted'), 'evicted');
  } finally {
    a.close(); b.close();
  }
});
