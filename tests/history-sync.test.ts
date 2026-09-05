import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeYoutubeBackfillBatch, normalizeYoutubeHistoryBatch } from '../src/youtube/history-sync.js';

const batch = (watchedAt: string) => ({
  scanId: 'synthetic_scan_0001',
  observedAt: '2026-09-06T09:00:00+08:00',
  items: [{ videoId: 'SYNTHETIC01', title: 'Synthetic video', watchedAt }],
});

test('day-precision backfill accepts today at noon before noon and preserves its timestamp and identity', () => {
  const input = batch('2026-09-06T12:00:00+08:00');
  const morning = normalizeYoutubeBackfillBatch(input, new Date('2026-09-06T09:00:00+08:00'));
  const evening = normalizeYoutubeBackfillBatch(input, new Date('2026-09-06T20:00:00+08:00'));
  assert.deepEqual(morning, evening);
  assert.equal(morning.watches[0].watchedAt, '2026-09-06T04:00:00.000Z');
  assert.equal(morning.watches[0].precision, 'day');
});

test('backfill uses Taipei calendar boundaries, including when UTC is still yesterday', () => {
  const now = new Date('2026-09-06T00:01:00+08:00');
  assert.equal(normalizeYoutubeBackfillBatch(batch('2026-09-06T04:00:00Z'), now).watches.length, 1);
  assert.equal(normalizeYoutubeBackfillBatch(batch('2019-03-01T04:00:00Z'), now).watches.length, 1);
  assert.throws(() => normalizeYoutubeBackfillBatch(batch('2026-09-06T16:00:00Z'), now), /too far in the future/);
  // Tomorrow stays invalid even if only one minute ahead of the current time.
  assert.throws(() => normalizeYoutubeBackfillBatch(batch('2026-09-07T00:00:00+08:00'), new Date('2026-09-06T23:59:00+08:00')), /too far in the future/);
  assert.throws(() => normalizeYoutubeBackfillBatch(batch('2004-01-01T04:00:00Z'), now), /predates YouTube/);
});

test('exact history events still reject future times on the same day', () => {
  const now = new Date('2026-09-06T09:00:00+08:00');
  assert.throws(() => normalizeYoutubeHistoryBatch({
    syncId: 'synthetic_sync_0001', observedAt: now.toISOString(),
    events: [{ kind: 'watch', occurredAt: '2026-09-06T12:00:00+08:00',
      videoId: 'SYNTHETIC01', title: 'Synthetic video',
      url: 'https://www.youtube.com/watch?v=SYNTHETIC01', activityType: 'video' }],
  }, 'synthetic-private-key-at-least-32-characters', now), /History event time is too far in the future/);
});
