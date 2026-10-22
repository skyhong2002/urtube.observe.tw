import assert from 'node:assert/strict';
import test from 'node:test';
import { Repository } from '../src/data/database.js';
import { HistoryQueryError, normalizeHistoryQuery } from '../src/youtube/history.js';
import type { YoutubeWatchInput } from '../src/youtube/types.js';

const now = new Date('2026-09-19T12:00:00.000Z');

function watch(index: number, overrides: Partial<YoutubeWatchInput> = {}): YoutubeWatchInput {
  const videoId = `VID${String(index).padStart(8, '0')}`;
  return {
    eventId: `event-${String(index).padStart(5, '0')}`, videoId,
    title: `Video ${index}`, url: `https://www.youtube.com/watch?v=${videoId}`,
    channelId: null, channelTitle: 'Fixture channel', channelUrl: null,
    watchedAt: new Date(now.getTime() - index * 60_000).toISOString(),
    actualWatchedSeconds: null, activityType: 'video', ...overrides,
  };
}

function ingest(repository: Repository, rows: YoutubeWatchInput[], archiveHash = 'fixture'): void {
  repository.ingestYoutubeArchive({ archiveHash, source: 'takeout', searches: [], watches: rows });
}

test('history pages browse every event beyond the former 100-row limit and return in both directions', () => {
  const repository = new Repository(':memory:');
  try {
    const rows = Array.from({ length: 123 }, (_, index) => watch(index));
    ingest(repository, rows);
    const first = repository.youtubeHistoryPage({}, now);
    assert.equal(first.filters.range, '365d');
    assert.equal(first.entries.length, 50);
    assert.equal(first.newerCursor, null);
    assert.ok(first.olderCursor);
    const second = repository.youtubeHistoryPage({ cursor: first.olderCursor }, now);
    const third = repository.youtubeHistoryPage({ cursor: second.olderCursor! }, now);
    assert.equal(third.entries.length, 23);
    assert.equal(third.olderCursor, null);
    assert.deepEqual([...first.entries, ...second.entries, ...third.entries].map(row => row.eventId), rows.map(row => row.eventId));
    const backToSecond = repository.youtubeHistoryPage({ cursor: third.newerCursor!, direction: 'newer' }, now);
    const backToFirst = repository.youtubeHistoryPage({ cursor: backToSecond.newerCursor!, direction: 'newer' }, now);
    assert.deepEqual(backToSecond.entries, second.entries);
    assert.deepEqual(backToFirst.entries, first.entries);
    assert.equal(backToFirst.newerCursor, null);
    assert.equal(repository.youtubeHistoryPage({ limit: 10_000 }, now).entries.length, 100);
    assert.equal(repository.youtubeHistoryPage({ limit: 0 }, now).entries.length, 1);
  } finally { repository.close(); }
});

test('keyset pages keep equal timestamps and repeat watches distinct when newer records arrive', () => {
  const repository = new Repository(':memory:');
  try {
    const repeatedVideo = 'REPEAT00001';
    ingest(repository, [
      ...Array.from({ length: 9 }, (_, index) => watch(index, { watchedAt: '2026-09-19T11:00:00.000Z' })),
      watch(20, { videoId: repeatedVideo, watchedAt: '2026-09-19T10:00:00.000Z' }),
      watch(21, { videoId: repeatedVideo, watchedAt: '2026-09-19T09:00:00.000Z' }),
    ]);
    const initial = repository.youtubeHistoryPage({ range: 'all', limit: 100 }, now);
    const first = repository.youtubeHistoryPage({ range: 'all', limit: 4 }, now);
    ingest(repository, [watch(99, { watchedAt: '2026-09-19T11:59:00.000Z' })], 'later-import');
    const collected = [...first.entries];
    let cursor = first.olderCursor;
    while (cursor) {
      const page = repository.youtubeHistoryPage({ range: 'all', limit: 4, cursor }, now);
      collected.push(...page.entries);
      cursor = page.olderCursor;
    }
    assert.deepEqual(collected.map(row => row.eventId), initial.entries.map(row => row.eventId));
    assert.equal(new Set(collected.map(row => row.eventId)).size, 11);
    assert.equal(collected.filter(row => row.videoId === repeatedVideo).length, 2);
    const second = repository.youtubeHistoryPage({ range: 'all', limit: 4, cursor: first.olderCursor! }, now);
    assert.deepEqual(repository.youtubeHistoryPage({ range: 'all', limit: 4, cursor: second.newerCursor!, direction: 'newer' }, now).entries,
      first.entries);
    assert.equal(repository.youtubeHistoryPage({ range: 'all', limit: 4 }, now).entries[0].eventId, 'event-00099');
  } finally { repository.close(); }
});

test('history searches literal Unicode title and channel text without SQL or LIKE wildcard interpretation', () => {
  const repository = new Repository(':memory:');
  try {
    ingest(repository, [
      watch(0, { title: '100% Complete _ guide \\ draft', channelTitle: 'ÉCOLE 音樂' }),
      watch(1, { title: '100 percent Complete X guide / draft', channelTitle: 'Unrelated' }),
      watch(2, { title: "Literal ' OR 1=1 -- text", channelTitle: '第二頻道' }),
      watch(3, { title: '中文字與 🚀 火箭', channelTitle: '頻道測試' }),
    ]);
    for (const q of ['%', '_', '\\', '  100% COMPLETE  ', 'école', 'ÉcOlE', '音樂']) {
      assert.deepEqual(repository.youtubeHistoryPage({ q }, now).entries.map(row => row.eventId), ['event-00000'], q);
    }
    assert.deepEqual(repository.youtubeHistoryPage({ q: "' OR 1=1 --" }, now).entries.map(row => row.eventId), ['event-00002']);
    assert.deepEqual(repository.youtubeHistoryPage({ q: '中文字' }, now).entries.map(row => row.eventId), ['event-00003']);
    assert.deepEqual(repository.youtubeHistoryPage({ q: '頻道測試' }, now).entries.map(row => row.eventId), ['event-00003']);
    assert.equal(repository.youtubeHistoryPage({ q: 'no matching text' }, now).entries.length, 0);
    assert.equal(repository.youtubeHistoryPage({ q: ' video ' }, now).filters.q, 'video');
  } finally { repository.close(); }
});

test('history search uses the displayed metadata title and channel fallbacks and never searches private search ciphertext', () => {
  const repository = new Repository(':memory:');
  try {
    ingest(repository, [
      watch(0, { title: 'Raw fallback', channelTitle: null }),
      watch(1, { title: 'Old raw title', channelTitle: 'Event channel' }),
      watch(2, { title: 'Raw-only item', videoId: null, channelTitle: null }),
      watch(3, { title: 'Non-video post', activityType: 'post' }),
    ]);
    repository.upsertYoutubeVideoMetadata([0, 1].map(index => ({
      videoId: watch(index).videoId!, title: index ? 'Current metadata title' : '',
      channelId: null, channelTitle: 'Metadata channel', description: 'Never searched description', tags: ['Never searched tag'],
      thumbnailUrl: '', durationSeconds: null, publishedAt: null, categoryId: null,
      availability: 'available' as const, metadataHash: `metadata-${index}`,
    })));
    repository.ingestYoutubeArchive({ archiveHash: 'private-search', source: 'takeout', watches: [], searches: [{
      eventId: 'private-search-event', searchedAt: now.toISOString(), queryCiphertext: 'Private search needle', activityType: 'search',
    }] });
    assert.deepEqual(repository.youtubeHistoryPage({ q: 'Raw fallback' }, now).entries.map(row => row.eventId), ['event-00000']);
    assert.deepEqual(repository.youtubeHistoryPage({ q: 'Metadata channel' }, now).entries.map(row => row.eventId), ['event-00000']);
    assert.deepEqual(repository.youtubeHistoryPage({ q: 'Event channel' }, now).entries.map(row => row.eventId), ['event-00001']);
    assert.deepEqual(repository.youtubeHistoryPage({ q: 'Current metadata title' }, now).entries.map(row => row.eventId), ['event-00001']);
    assert.deepEqual(repository.youtubeHistoryPage({ q: 'Raw-only' }, now).entries.map(row => row.eventId), ['event-00002']);
    for (const q of ['Private search needle', 'Non-video post', 'Never searched', 'Old raw title']) {
      assert.equal(repository.youtubeHistoryPage({ q }, now).entries.length, 0, q);
    }
  } finally { repository.close(); }
});

test('custom dates use inclusive Taipei days, override presets and preserve date-only precision', () => {
  const repository = new Repository(':memory:');
  try {
    ingest(repository, [
      watch(0, { watchedAt: '2024-02-28T15:59:59.999Z' }),
      watch(1, { watchedAt: '2024-02-28T16:00:00.000Z' }),
      watch(2, { watchedAt: '2024-02-29T04:00:00.000Z', precision: 'day' }),
      watch(3, { watchedAt: '2024-02-29T15:59:59.999Z' }),
      watch(4, { watchedAt: '2024-02-29T16:00:00.000Z' }),
    ]);
    assert.equal(repository.youtubeHistoryPage({}, now).entries.length, 0);
    const page = repository.youtubeHistoryPage({ range: '7d', from: '2024-02-29', to: '2024-02-29' }, now);
    assert.deepEqual(page.filters, { range: 'all', q: '', from: '2024-02-29', to: '2024-02-29' });
    assert.deepEqual(page.entries.map(row => row.eventId), ['event-00003', 'event-00002', 'event-00001']);
    assert.deepEqual(page.entries.map(row => row.precision), ['exact', 'day', 'exact']);
    assert.equal(repository.youtubeHistoryPage({ from: '2024-02-29' }, now).entries.length, 4);
    assert.equal(repository.youtubeHistoryPage({ to: '2024-02-29' }, now).entries.length, 4);
    assert.equal(repository.youtubeHistoryPage({ range: 'all' }, now).entries.length, 5);
  } finally { repository.close(); }
});

test('query validation rejects invalid dates and oversized text without truncating Unicode characters', () => {
  assert.equal(normalizeHistoryQuery({ q: '🚀'.repeat(120) }).filters.q.length, 240);
  assert.throws(() => normalizeHistoryQuery({ q: '🚀'.repeat(121) }), { name: 'HistoryQueryError', field: 'q' });
  assert.throws(() => normalizeHistoryQuery({ q: 'null\0text' }), { name: 'HistoryQueryError', field: 'q' });
  for (const date of ['2026-02-29', '2024-02-30', '2026-04-31', '2026-13-01', '2026-00-01', '2026-9-01', '0000-01-01', 'yesterday']) {
    assert.throws(() => normalizeHistoryQuery({ from: date }), { name: 'HistoryQueryError', field: 'dates' }, date);
    assert.throws(() => normalizeHistoryQuery({ to: date }), HistoryQueryError, date);
  }
  assert.throws(() => normalizeHistoryQuery({ from: '2026-09-20', to: '2026-09-19' }), { field: 'dates' });
  assert.throws(() => normalizeHistoryQuery({ range: 'invalid' as 'all' }), { field: 'dates' });
});

test('the final four-digit Taipei calendar day has an ordinary UTC upper bound', () => {
  const filters = { from: '9999-12-31', to: '9999-12-31' };
  assert.equal(normalizeHistoryQuery(filters).end, '9999-12-31T16:00:00.000Z');
  const repository = new Repository(':memory:');
  try {
    ingest(repository, [
      watch(0, { watchedAt: '9999-12-30T15:59:59.999Z' }),
      watch(1, { watchedAt: '9999-12-30T16:00:00.000Z' }),
      watch(2, { watchedAt: '9999-12-31T15:59:59.999Z' }),
      watch(3, { watchedAt: '9999-12-31T16:00:00.000Z' }),
    ]);
    assert.deepEqual(repository.youtubeHistoryPage(filters, now).entries.map(row => row.eventId), ['event-00002', 'event-00001']);
  } finally { repository.close(); }
});

test('cursors are bounded, typed, versioned and scoped to the normalized filters', () => {
  const repository = new Repository(':memory:');
  try {
    ingest(repository, [watch(0), watch(1), watch(2)]);
    const filters = { q: 'Video', range: 'all' as const };
    const first = repository.youtubeHistoryPage({ ...filters, limit: 1 }, now);
    const cursor = first.olderCursor!;
    assert.equal(repository.youtubeHistoryPage({ ...filters, q: '  Video ', cursor, limit: 1 }, now).entries.length, 1);
    for (const changes of [{ q: 'other' }, { range: '7d' as const }, { from: '2026-09-19' }, { to: '2026-09-19' }]) {
      assert.throws(() => repository.youtubeHistoryPage({ ...filters, ...changes, cursor }, now), { field: 'cursor' });
    }
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    for (const invalid of ['', '.', '%%%invalid', 'a'.repeat(2049),
      Buffer.from('null').toString('base64url'), Buffer.from('[]').toString('base64url'),
      ...[{ v: 2 }, { at: 'not a date' }, { at: 1 }, { at: 'September 19, 2026' },
        { at: '2026-02-30T12:00:00.000Z' }, { at: '2026-09-19T24:00:00Z' },
        { at: '2026-09-19T12:00:00' }, { id: '' }, { id: 7 }, { id: 'x'.repeat(1025) }, { filters: '' }]
        .map(changes => Buffer.from(JSON.stringify({ ...value, ...changes })).toString('base64url'))]) {
      if (!invalid) continue; // An empty optional cursor means the first page.
      assert.throws(() => repository.youtubeHistoryPage({ ...filters, cursor: invalid }, now), { field: 'cursor' }, invalid.slice(0, 40));
    }
    assert.throws(() => repository.youtubeHistoryPage({ direction: 'invalid' }, now), { field: 'cursor' });
    assert.throws(() => repository.youtubeHistoryPage({ direction: 'newer' }, now), { field: 'cursor' });
    for (const at of ['2026-09-19T12:00:00Z', '2026-09-19T12:00:00.123456Z', '2026-09-19T20:00:00+08:00']) {
      const legacyCursor = Buffer.from(JSON.stringify({ ...value, at })).toString('base64url');
      assert.equal(normalizeHistoryQuery({ ...filters, cursor: legacyCursor }).cursor?.at, at);
    }
  } finally { repository.close(); }
});
