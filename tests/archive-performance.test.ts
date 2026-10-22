import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import test from 'node:test';
import { Repository } from '../src/data/database.js';

// Frozen pre-optimization estimator from PR #95's base. Keep the complete
// independent oracle: day precision and saved progress are not covered by the
// simplified known-duration oracle in watch-performance.test.ts.
const LEGACY_ESTIMATES = `
  WITH timeline AS (
    SELECT 'watch' kind, event_id, watched_at occurred_at
    FROM youtube_watch_events WHERE activity_type='video'
    UNION ALL
    SELECT 'search', event_id, searched_at FROM youtube_search_events
  ), ordered AS (
    SELECT kind, event_id, occurred_at,
      LEAD(occurred_at) OVER (ORDER BY occurred_at, kind, event_id) next_activity_at
    FROM timeline
  ) SELECT w.event_id,
    CASE
      WHEN w.actual_watched_seconds IS NOT NULL THEN w.actual_watched_seconds
      WHEN EXISTS (
        SELECT 1 FROM youtube_watch_events measured
        WHERE measured.video_id=w.video_id AND measured.actual_watched_seconds IS NOT NULL
          AND ABS((julianday(measured.watched_at)-julianday(w.watched_at))*86400)<=300
      ) THEN 0
      WHEN a.occurred_precision='day' THEN MIN(
        COALESCE(vp.progress_seconds, v.duration_seconds, 0),
        COALESCE(v.duration_seconds, vp.progress_seconds, 0), 600
      )
      WHEN v.duration_seconds IS NULL OR o.next_activity_at IS NULL THEN 0
      ELSE MIN(v.duration_seconds,
        MAX(0, CAST((julianday(o.next_activity_at)-julianday(w.watched_at))*86400 AS INTEGER)),
        CASE WHEN (julianday(o.next_activity_at)-julianday(w.watched_at))*86400 >= v.duration_seconds
          THEN COALESCE(vp.progress_seconds, v.duration_seconds) ELSE v.duration_seconds END
      )
    END estimated_watch_seconds
  FROM youtube_watch_events w
  JOIN ordered o ON o.kind='watch' AND o.event_id=w.event_id
  JOIN activities a ON a.id=w.activity_id
  LEFT JOIN youtube_videos v ON v.video_id=w.video_id
  LEFT JOIN youtube_video_progress vp ON vp.video_id=w.video_id
  WHERE w.activity_type='video' ORDER BY w.event_id
`;

const NOW = '2026-10-18T00:00:00.000Z';
const fixtureDatabase = (repository: Repository) => (repository as unknown as { db: DatabaseSync }).db;

function seed(database: DatabaseSync): void {
  const activity = database.prepare(`INSERT INTO activities (
    id, dedupe_key, source, type, media_kind, title, image, occurred_at,
    occurred_precision, visibility, extra_json, first_seen_at, last_seen_at
  ) VALUES (?, ?, 'youtube', 'video', 'video', 'Synthetic', '', ?, ?, 'summary', '{}', ?, ?)`);
  const event = database.prepare(`INSERT INTO youtube_watch_events (
    event_id, activity_id, video_id, watched_at, raw_title, raw_url,
    actual_watched_seconds, imported_at, activity_type
  ) VALUES (?, ?, ?, ?, 'Synthetic', '', ?, ?, ?)`);
  database.prepare('INSERT INTO youtube_progress_imports(scan_id, observed_at, started_at) VALUES (?, ?, ?)')
    .run('synthetic-scan', NOW, NOW);
  const add = (id: string, time: string, {
    videoId = id, seconds = null, duration = 900, progress = null, precision = 'exact', activityType = 'video',
  }: { videoId?: string | null; seconds?: number | null; duration?: number | null;
    progress?: number | null; precision?: 'day' | 'exact'; activityType?: 'video' | 'post' } = {}) => {
    if (videoId !== null) {
      database.prepare('INSERT OR IGNORE INTO youtube_videos(video_id, title, duration_seconds) VALUES (?, ?, ?)')
        .run(videoId, 'Synthetic', duration);
      if (progress !== null) database.prepare(`INSERT OR REPLACE INTO youtube_video_progress (
        video_id, progress_seconds, confidence, observed_at, scan_id
      ) VALUES (?, ?, 'resume', ?, 'synthetic-scan')`).run(videoId, progress, NOW);
    }
    activity.run(id, id, time, precision, NOW, NOW);
    event.run(id, id, videoId, time, seconds, NOW, activityType);
  };
  database.exec('BEGIN');
  // Each pair has its own video so another nearby measured event cannot mask
  // a five-minute endpoint error. Keep raw offset/fractional timestamps.
  const formats = ['2026-09-01T00:00:00.000Z', '2026-09-01T08:00:00+08:00',
    '2026-08-31T20:00:00-04:00', '2026-09-01 00:00:00', '2026-09-01T00:00:00.0004Z', 'invalid'];
  for (const [index, time] of formats.entries()) {
    for (const delta of [-301000, -300001, -300000, -299999, 0, 299999, 300000, 300001, 301000]) {
      const videoId = `boundary-${index}-${delta}`;
      add(`${videoId}-history`, time, { videoId });
      add(`${videoId}-measured`, new Date(Date.parse('2026-09-01T00:00:00Z') + delta).toISOString(), { videoId, seconds: 42 });
    }
  }
  add('day-capped', '2026-09-03T00:00:00Z', { precision: 'day', duration: 9000, progress: 5000 });
  add('day-progress', '2026-09-04T00:00:00Z', { precision: 'day', progress: 120 });
  add('day-duration', '2026-09-05T00:00:00Z', { precision: 'day', duration: 90, progress: 120 });
  add('day-unknown', '2026-09-06T00:00:00Z', { precision: 'day', duration: null });
  add('day-progress-only', '2026-09-07T00:00:00Z', { precision: 'day', duration: null, progress: 350 });
  add('day-neighbor', '2026-09-08T00:00:00Z', { precision: 'day', progress: 500 });
  add('day-measured', '2026-09-08T00:01:00Z', { videoId: 'day-neighbor', seconds: 42 });
  add('gap-progress', '2026-09-09T00:00:00Z', { duration: 600, progress: 123 });
  add('search-gap', '2026-09-10T00:00:00Z', { duration: 600, progress: 10 });
  database.prepare(`INSERT INTO youtube_search_events(event_id, searched_at, query_ciphertext, imported_at, activity_type)
    VALUES ('search', '2026-09-10T00:02:00Z', 'unused-synthetic', ?, 'search')`).run(NOW);
  add('exact-unknown', '2026-09-11T00:00:00Z', { duration: null, progress: 300 });
  add('measured-zero', '2026-09-12T00:00:00Z', { seconds: 0 });
  add('null-video-measured', '2026-09-13T00:00:00Z', { videoId: null, seconds: 17 });
  add('null-video-history', '2026-09-13T00:01:00Z', { videoId: null });
  add('post', '2026-09-14T00:00:00Z', { activityType: 'post', seconds: 42 });
  add('post-neighbor', '2026-09-14T00:01:00Z', { videoId: 'post' });
  add('last-event', '2026-09-15T00:00:00Z', { duration: 600 });
  // Synthetic completed classifications/checkpoints must survive reopen.
  database.prepare(`INSERT INTO youtube_video_matching_topics
    (video_id, taxonomy_version, topic_key, metadata_hash, classified_at)
    VALUES ('gap-progress', 1, 'music', 'synthetic-completed-hash', ?)`).run(NOW);
  database.prepare('INSERT INTO youtube_sync_state(key, value, updated_at) VALUES (?, ?, ?)')
    .run('synthetic-checkpoint', 'completed', NOW);
  database.exec('COMMIT');
}

test('archive estimates equal the full legacy estimator including progress and day precision', () => {
  const repository = new Repository(':memory:');
  try {
    const database = fixtureDatabase(repository);
    seed(database);
    const expected = database.prepare(LEGACY_ESTIMATES).all().map(row => ({
      eventId: String(row.event_id), seconds: Number(row.estimated_watch_seconds ?? 0),
    })).sort((a, b) => a.eventId.localeCompare(b.eventId));
    const actual = () => repository.youtubeWatchIntervals({ limit: 5000 }).map(row => ({
      eventId: row.eventId, seconds: row.estimatedWatchSeconds,
    })).sort((a, b) => a.eventId.localeCompare(b.eventId));
    assert.deepEqual(actual(), expected);
    assert.deepEqual(actual(), expected, 'warm materialization preserves the same estimates');
    const byId = new Map(expected.map(row => [row.eventId, row.seconds]));
    for (const [id, seconds] of Object.entries({ 'day-capped': 600, 'day-progress': 120, 'day-duration': 90,
      'day-unknown': 0, 'day-progress-only': 350, 'day-neighbor': 0, 'gap-progress': 123,
      'exact-unknown': 0, 'measured-zero': 0, 'null-video-measured': 17, 'null-video-history': 0,
      'post-neighbor': 0, 'last-event': 0 })) assert.equal(byId.get(id), seconds, id);
    assert.ok(byId.get('search-gap')! >= 119 && byId.get('search-gap')! <= 120,
      'a later search limits the exact interval; saved progress only caps a long gap');
    assert.equal(byId.has('post'), false, 'non-video watches stay outside the estimated timeline');
  } finally { repository.close(); }
});

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
function tableSnapshots(database: DatabaseSync) {
  return database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => {
    const name = String(row.name);
    const columns = database.prepare(`PRAGMA table_info(${quote(name)})`).all().map(column => String(column.name));
    return { name, columns, rows: database.prepare(`SELECT * FROM ${quote(name)} ORDER BY rowid`).all() };
  });
}

for (const fromVersion of [13, 14]) {
  test(`schema ${fromVersion} upgrade/reopen and readonly estimates preserve every stored row`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'urtube-archive-preservation-'));
    const path = join(directory, 'synthetic.sqlite');
    try {
      const initial = new Repository(path);
      try {
        seed(fixtureDatabase(initial));
        fixtureDatabase(initial).prepare('UPDATE youtube_videos SET view_count=12345, statistics_fetched_at=?').run(NOW);
      } finally { initial.close(); }
      const old = new DatabaseSync(path);
      let snapshots: ReturnType<typeof tableSnapshots>;
      let indexes: Array<Record<string, SQLOutputValue>>;
      try {
        if (fromVersion === 13) old.exec(`ALTER TABLE youtube_videos DROP COLUMN view_count;
          ALTER TABLE youtube_videos DROP COLUMN statistics_fetched_at; PRAGMA user_version=13;`);
        snapshots = tableSnapshots(old);
        indexes = old.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' ORDER BY name").all();
      } finally { old.close(); }
      const upgraded = new Repository(path);
      let expected: ReturnType<Repository['youtubeWatchIntervals']>;
      try { expected = upgraded.youtubeWatchIntervals({ limit: 5000 }); }
      finally { upgraded.close(); }
      const readOnly = new Repository(path, { readOnly: true });
      try {
        assert.deepEqual(readOnly.youtubeWatchIntervals({ limit: 5000 }), expected);
        assert.deepEqual(readOnly.youtubeWatchIntervals({ limit: 5000 }), expected);
        assert.equal(fixtureDatabase(readOnly).prepare("SELECT COUNT(*) n FROM sqlite_temp_master WHERE name='youtube_measured_events'").get()!.n, 0);
      } finally { readOnly.close(); }
      const reopened = new Repository(path);
      try { assert.deepEqual(reopened.youtubeWatchIntervals({ limit: 5000 }), expected); }
      finally { reopened.close(); }
      const check = new DatabaseSync(path, { readOnly: true });
      try {
        assert.equal(check.prepare('PRAGMA user_version').get()!.user_version, 14,
          'schema 14 belongs to video statistics; the superseded PR index needs no migration');
        assert.deepEqual(tableSnapshots(check).map(table => table.name), snapshots.map(table => table.name));
        for (const { name, columns, rows } of snapshots) assert.deepEqual(
          check.prepare(`SELECT ${columns.map(quote).join(',')} FROM ${quote(name)} ORDER BY rowid`).all(), rows, name);
        assert.deepEqual(check.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' ORDER BY name").all(), indexes);
        assert.deepEqual(check.prepare('SELECT DISTINCT view_count, statistics_fetched_at FROM youtube_videos').all().map(row => ({ ...row })),
          [{ view_count: fromVersion === 13 ? null : 12345, statistics_fetched_at: fromVersion === 13 ? null : NOW }]);
        assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(), []);
        assert.equal(check.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
      } finally { check.close(); }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
