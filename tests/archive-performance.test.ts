import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Repository, YOUTUBE_ESTIMATED_EVENTS_CTE } from '../src/data/database.js';
import { normalizeYoutubeCapture } from '../src/youtube/capture.js';

const now = new Date('2026-09-10T12:00:00Z');
function capture(repository: Repository, id: number, videoId = 'FIXTURE0001') {
  return repository.upsertYoutubeCapture(normalizeYoutubeCapture({
    sessionId: `performance-fixture-${id}`, videoId, title: 'Synthetic fixture',
    url: `https://www.youtube.com/watch?v=${videoId}`, channelTitle: 'Fixture',
    watchedAt: new Date(now.getTime() - (id + 1) * 600_000).toISOString(), actualWatchedSeconds: 42, durationSeconds: 600,
  }, now));
}

test('indexed estimate prefilter preserves exact results at boundaries, time zones and day precision', () => {
  const directory = mkdtempSync(join(tmpdir(), 'urtube-estimates-'));
  const path = join(directory, 'fixture.sqlite');
  const repository = new Repository(path);
  const db = new DatabaseSync(path);
  try {
    // Keep the original predicate as an independent reference. Only remove the
    // extra indexed prefilter from the query used by the actual repository.
    const legacy = YOUTUBE_ESTIMATED_EVENTS_CTE.replace(/\s+AND julianday\(measured.watched_at\) BETWEEN[^\n]+\n\s+AND julianday\(w.watched_at\)\+301.0\/86400/, '');
    assert.notEqual(legacy, YOUTUBE_ESTIMATED_EVENTS_CTE);
    const times = ['2026-09-01T00:00:00.000Z', '2026-09-01T00:04:59.999Z', '2026-09-01T00:05:00.000Z',
      '2026-09-01T00:05:00.001Z', '2026-08-31T23:55:00.000Z', '2026-08-31T23:54:59.999Z',
      '2026-09-01T08:04:59.999+08:00', '2026-08-31T20:04:59.999-04:00', '2026-09-01 00:04:59.999',
      '2026-09-02T00:00:00Z', '2026-09-03T00:00:00Z'];
    times.forEach((_time, id) => capture(repository, id));
    const rows = db.prepare('SELECT event_id, activity_id FROM youtube_watch_events ORDER BY event_id').all();
    rows.forEach((row, id) => {
      db.prepare('UPDATE youtube_watch_events SET watched_at=?, actual_watched_seconds=? WHERE event_id=?').run(times[id], id === 0 ? 42 : null, row.event_id);
      db.prepare('UPDATE activities SET occurred_at=?, occurred_precision=? WHERE id=?').run(times[id], id >= 9 ? 'day' : 'exact', row.activity_id);
    });
    // Add widely distributed repeated views and mixed measured/unmeasured rows.
    for (let id = 20; id < 120; id++) capture(repository, id, id % 3 ? 'FIXTURE0001' : 'FIXTURE0002');
    db.exec('UPDATE youtube_watch_events SET actual_watched_seconds=NULL WHERE rowid % 3 = 0;');
    const select = ' SELECT event_id, estimated_watch_seconds FROM estimated_events ORDER BY event_id';
    const expected = db.prepare(legacy + select).all();
    assert.deepEqual(db.prepare(YOUTUBE_ESTIMATED_EVENTS_CTE + select).all(), expected);
    assert.deepEqual(repository.youtubeWatchIntervals({ limit: 5000 }).map(row => ({ event_id: row.eventId, estimated_watch_seconds: row.estimatedWatchSeconds })).sort((a, b) => a.event_id.localeCompare(b.event_id)),
      expected.map(row => ({ ...row })).sort((a, b) => String(a.event_id).localeCompare(String(b.event_id))));
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + YOUTUBE_ESTIMATED_EVENTS_CTE + select).all();
    assert.ok(plan.some(row => /youtube_watch_measured_time_idx.*video_id=\?.*<expr>>\?.*<expr><\?/.test(String(row.detail))), 'planner must bound lookup by video and time');
  } finally { db.close(); repository.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('schema 14 creates only the measured-time index and preserves data across reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'urtube-index-migration-'));
  const path = join(directory, 'fixture.sqlite');
  try {
    const before = new Repository(path);
    capture(before, 1);
    const expected = before.youtubeWatchIntervals();
    before.close();
    const old = new DatabaseSync(path);
    old.exec('DROP INDEX youtube_watch_measured_time_idx; PRAGMA user_version=13;');
    const tables = old.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const contents = tables.map(row => old.prepare(`SELECT * FROM "${row.name}" ORDER BY rowid`).all());
    old.close();
    const upgraded = new Repository(path);
    assert.deepEqual(upgraded.youtubeWatchIntervals(), expected);
    upgraded.close();
    const check = new DatabaseSync(path);
    assert.equal(check.prepare('PRAGMA user_version').get()!.user_version, 14);
    assert.deepEqual(tables.map(row => check.prepare(`SELECT * FROM "${row.name}" ORDER BY rowid`).all()), contents);
    assert.ok(check.prepare("SELECT name FROM sqlite_master WHERE name='youtube_watch_measured_time_idx'").get());
    check.close();
    const reopened = new Repository(path);
    assert.deepEqual(reopened.youtubeWatchIntervals(), expected);
    reopened.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('capture repairs only its video while explicit reconciliation still repairs older rows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'urtube-capture-repair-'));
  const path = join(directory, 'fixture.sqlite');
  const repository = new Repository(path);
  const db = new DatabaseSync(path);
  try {
    capture(repository, 1, 'FIXTURE0001'); capture(repository, 2, 'FIXTURE0002');
    db.exec("UPDATE youtube_videos SET channel_id='fixture-channel';");
    capture(repository, 3, 'FIXTURE0001');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM youtube_watch_events WHERE video_id='FIXTURE0001' AND channel_id='fixture-channel'").get()!.n, 2);
    assert.equal(db.prepare("SELECT channel_id FROM youtube_watch_events WHERE video_id='FIXTURE0002'").get()!.channel_id, null);
    assert.equal(repository.backfillYoutubeChannelIds(), 1);
    assert.equal(repository.backfillYoutubeChannelIds(), 0);
    capture(repository, 3, 'FIXTURE0001');
    assert.equal(repository.youtubeCounts().watches, 3);
  } finally { db.close(); repository.close(); rmSync(directory, { recursive: true, force: true }); }
});
