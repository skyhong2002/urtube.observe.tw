import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Repository } from '../src/data/database.js';
import type { YoutubeCapturedWatch, YoutubeWatchInput } from '../src/youtube/types.js';

const NOW = '2026-10-18T00:00:00.000Z';
const fixtureDatabase = (repository: Repository) => (repository as unknown as { db: DatabaseSync }).db;
function watch(eventId: string, videoId: string, watchedAt: string, seconds: number | null = null): YoutubeWatchInput {
  return { eventId, videoId, watchedAt, actualWatchedSeconds: seconds, title: 'Synthetic fixture',
    url: `https://www.youtube.com/watch?v=${videoId}`, channelId: null, channelTitle: null,
    channelUrl: null, activityType: 'video', durationSeconds: 600 };
}

test('indexed measured neighbors preserve the original Julian-date predicate across formats and boundaries', () => {
  const repository = new Repository(':memory:');
  try {
    // Seed only synthetic records. Use raw timestamps so normalization cannot
    // hide offset, missing-millisecond, invalid-date or submillisecond cases.
    const database = fixtureDatabase(repository);
    const activity = database.prepare(`INSERT INTO activities (
      id, dedupe_key, source, type, media_kind, title, image, occurred_at,
      occurred_precision, visibility, extra_json, first_seen_at, last_seen_at
    ) VALUES (?, ?, 'youtube', 'video', 'video', 'Synthetic', '', ?, 'exact', 'summary', '{}', ?, ?)`);
    const event = database.prepare(`INSERT INTO youtube_watch_events (
      event_id, activity_id, video_id, watched_at, raw_title, raw_url,
      actual_watched_seconds, imported_at, activity_type
    ) VALUES (?, ?, ?, ?, 'Synthetic', '', ?, ?, 'video')`);
    const rows: YoutubeWatchInput[] = [];
    const formats = [
      '2026-10-17T12:00:00.000Z', '2026-10-17T20:00:00+08:00',
      '2026-10-17T08:00:00-04:00', '2026-10-17T12:00:00Z',
      '2026-10-17 12:00:00', '2026-10-17T12:00:00.0004Z', 'invalid',
    ];
    for (const [formatIndex, time] of formats.entries()) {
      for (const delta of [-300001, -300000, -299999, 0, 299999, 300000, 300001]) {
        const id = `synthetic-${formatIndex}-${delta}`;
        const measuredAt = new Date(Date.parse('2026-10-17T12:00:00Z') + delta).toISOString();
        rows.push(watch(`${id}-history`, id, time), watch(`${id}-measured`, id, measuredAt, 42));
      }
    }
    rows.push(watch('no-measured-history', 'unmeasured', '2026-10-17T12:00:00Z'));
    rows.push(watch('invalid-measured', 'invalid-measured', 'invalid', 17));
    rows.push(watch('invalid-measured-history', 'invalid-measured', '2026-10-17T12:00:00Z'));
    rows.push({ ...watch('null-video-measured', 'unused', '2026-10-17T12:00:00Z', 17), videoId: null });
    rows.push({ ...watch('null-video-history', 'unused', '2026-10-17T12:00:00Z'), videoId: null });
    for (const row of rows) {
      if (row.videoId !== null) database.prepare("INSERT OR IGNORE INTO youtube_videos(video_id, title, duration_seconds) VALUES (?, 'Synthetic', 600)").run(row.videoId);
      activity.run(row.eventId, row.eventId, row.watchedAt, NOW, NOW);
      event.run(row.eventId, row.eventId, row.videoId, row.watchedAt, row.actualWatchedSeconds, NOW);
    }
    database.prepare("INSERT INTO youtube_search_events(event_id, searched_at, query_ciphertext, imported_at, activity_type) VALUES ('end', '2026-10-18T00:00:00Z', 'unused', ?, 'search')").run(NOW);
    // Independent pre-optimization oracle. These fixtures all have a known
    // 600-second duration and no saved progress or day-precision override.
    const expected = database.prepare(`
      WITH timeline AS (
        SELECT 'watch' kind, event_id, watched_at occurred_at FROM youtube_watch_events
        UNION ALL SELECT 'search', event_id, searched_at FROM youtube_search_events
      ), ordered AS (
        SELECT *, LEAD(occurred_at) OVER (ORDER BY occurred_at, kind, event_id) next_at FROM timeline
      ) SELECT w.event_id eventId,
        CASE WHEN w.actual_watched_seconds IS NOT NULL THEN w.actual_watched_seconds
          WHEN EXISTS (SELECT 1 FROM youtube_watch_events measured
            WHERE measured.video_id=w.video_id AND measured.actual_watched_seconds IS NOT NULL
              AND ABS((julianday(measured.watched_at)-julianday(w.watched_at))*86400)<=300) THEN 0
          WHEN w.video_id IS NULL OR o.next_at IS NULL THEN 0
          ELSE MIN(600, MAX(0, CAST((julianday(o.next_at)-julianday(w.watched_at))*86400 AS INTEGER)))
        END seconds
      FROM youtube_watch_events w JOIN ordered o ON o.kind='watch' AND o.event_id=w.event_id
      ORDER BY w.watched_at, w.event_id
    `).all().map(row => ({ eventId: String(row.eventId), seconds: Number(row.seconds ?? 0) }));
    assert.deepEqual(repository.youtubeWatchIntervals().map(row => ({
      eventId: row.eventId, seconds: row.estimatedWatchSeconds,
    })), expected);
    assert.deepEqual(repository.youtubeWatchIntervals().map(row => ({
      eventId: row.eventId, seconds: row.estimatedWatchSeconds,
    })), expected, 'a repeated read reuses the completed materialization');
  } finally { repository.close(); }
});

test('a newly measured session invalidates the neighbor lookup and playback updates preserve measured seconds', () => {
  const repository = new Repository(':memory:');
  try {
    const measured = watch('later-capture', 'SYNTHETIC01', '2026-10-17T12:01:00.000Z');
    repository.ingestYoutubeArchive({ archiveHash: 'synthetic-neighbor-refresh', source: 'takeout', searches: [], watches: [
      watch('history', 'SYNTHETIC01', '2026-10-17T12:00:00.000Z'), measured,
      watch('later-history', 'SYNTHETIC02', '2026-10-17T12:10:00.000Z'),
    ] });
    assert.ok(repository.youtubeWatchIntervals().find(row => row.eventId === 'history')!.estimatedWatchSeconds > 0);
    const capture = { ...measured, actualWatchedSeconds: 42, durationSeconds: 600 } as YoutubeCapturedWatch;
    repository.upsertYoutubeCapture(capture, NOW);
    const refreshed = repository.youtubeWatchIntervals();
    assert.equal(refreshed.find(row => row.eventId === 'history')!.estimatedWatchSeconds, 0);
    assert.equal(refreshed.find(row => row.eventId === 'later-capture')!.estimatedWatchSeconds, 42);
    repository.upsertYoutubeCapture({ ...capture, actualWatchedSeconds: 84 }, NOW);
    assert.equal(repository.youtubeWatchIntervals().find(row => row.eventId === 'later-capture')!.estimatedWatchSeconds, 84);
  } finally { repository.close(); }
});

test('empty materialization succeeds and failed rebuilds restore the previous cache and discard the lookup', (t) => {
  const repository = new Repository(':memory:');
  try {
    assert.deepEqual(repository.youtubeWatchIntervals(), []);
    const database = fixtureDatabase(repository);
    const captured = { ...watch('capture', 'SYNTHETIC01', '2026-10-17T12:00:00.000Z', 42),
      durationSeconds: 600 } as YoutubeCapturedWatch;
    repository.upsertYoutubeCapture(captured, NOW);
    const exec = database.exec.bind(database);
    const injected = t.mock.method(database, 'exec', (sql: string) => exec(sql.replace(
      'CREATE TEMP TABLE youtube_estimated_events AS',
      'SELECT synthetic_missing_column; CREATE TEMP TABLE youtube_estimated_events AS',
    )));
    assert.throws(() => repository.youtubeWatchIntervals(), /synthetic_missing_column/);
    injected.mock.restore();
    assert.equal(database.prepare('SELECT COUNT(*) n FROM temp.youtube_estimated_events').get()!.n, 0,
      'rollback restores the previously completed empty cache');
    assert.equal(database.prepare("SELECT COUNT(*) n FROM sqlite_temp_master WHERE name='youtube_measured_events'").get()!.n, 0);
    database.exec('BEGIN; ROLLBACK'); // No leaked savepoint/transaction.
    assert.equal(repository.youtubeWatchIntervals()[0].estimatedWatchSeconds, 42);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM sqlite_temp_master WHERE name='youtube_measured_events'").get()!.n, 0,
      'successful materialization also releases its temporary lookup');
  } finally { repository.close(); }
});

test('capture reconciles every event for its own video and leaves unrelated history to batch reconciliation', () => {
  const repository = new Repository(':memory:');
  try {
    repository.ingestYoutubeArchive({ archiveHash: 'synthetic-channel-target', source: 'takeout', searches: [], watches: [
      watch('earlier-same-video', 'SYNTHETIC01', '2026-10-17T10:00:00.000Z'),
      watch('unrelated-video', 'SYNTHETIC02', '2026-10-17T11:00:00.000Z'),
    ] });
    // Simulate metadata arriving after startup reconciliation, without the
    // metadata-upsert helper that would itself reconcile both videos.
    const database = fixtureDatabase(repository);
    database.exec("UPDATE youtube_videos SET channel_id='synthetic-channel', channel_title='Metadata channel'");
    const capture = { ...watch('new-capture', 'SYNTHETIC01', '2026-10-17T12:00:00.000Z', 42),
      durationSeconds: 600 } as YoutubeCapturedWatch;
    repository.upsertYoutubeCapture(capture, NOW);
    const events = database.prepare('SELECT * FROM youtube_watch_events').all();
    const sameVideo = events.filter(row => row.video_id === 'SYNTHETIC01');
    assert.equal(sameVideo.length, 2);
    assert.ok(sameVideo.every(row => row.channel_id === 'synthetic-channel' && row.channel_title === 'Metadata channel'));
    assert.equal(events.find(row => row.video_id === 'SYNTHETIC02')!.channel_id, null);
    assert.equal(repository.backfillYoutubeChannelIds(), 1, 'batch reconciliation still covers unrelated history');
  } finally { repository.close(); }
});
