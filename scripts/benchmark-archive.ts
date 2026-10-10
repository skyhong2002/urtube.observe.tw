// Synthetic SQLite benchmark only: never opens the configured user databases.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { Repository, YOUTUBE_ESTIMATED_EVENTS_CTE } from '../src/data/database.js';
import { normalizeYoutubeCapture } from '../src/youtube/capture.js';

const legacy = YOUTUBE_ESTIMATED_EVENTS_CTE.replace(/\s+AND julianday\(measured.watched_at\) BETWEEN[^\n]+\n\s+AND julianday\(w.watched_at\)\+301.0\/86400/, '');
const select = ' SELECT event_id, estimated_watch_seconds FROM estimated_events ORDER BY event_id';
const directory = mkdtempSync(join(tmpdir(), 'urtube-benchmark-'));
const results: unknown[] = [];
let sqlite = '';
try {
  for (const count of [250, 500, 1000, 2000]) {
    for (const repeated of [false, true]) {
      const path = join(directory, `${count}-${repeated}.sqlite`);
      const repository = new Repository(path);
      const now = new Date('2026-09-10T12:00:00Z');
      repository.upsertYoutubeCapture(normalizeYoutubeCapture({ sessionId: 'benchmark-fixture-session', videoId: 'FIXTURE0001', title: 'Synthetic',
        url: 'https://www.youtube.com/watch?v=FIXTURE0001', channelTitle: 'Fixture', watchedAt: '2026-09-01T00:00:00Z', actualWatchedSeconds: 42, durationSeconds: 600,
      }, now));
      repository.close();
      const db = new DatabaseSync(path);
      try {
        sqlite = String(db.prepare('SELECT sqlite_version() v').get()!.v);
        const templates = Object.fromEntries(['activities', 'youtube_watch_events', 'youtube_videos'].map(table => [table, db.prepare(`SELECT * FROM ${table} LIMIT 1`).get()!]));
        const insert = Object.fromEntries(Object.entries(templates).map(([table, template]) => [table, db.prepare(`INSERT INTO ${table} (${Object.keys(template).join(',')}) VALUES (${Object.keys(template).map(() => '?').join(',')})`)]));
        const put = (table: string, values: Record<string, SQLOutputValue>) => insert[table].run(...Object.values({ ...templates[table], ...values }));
        db.exec('BEGIN; DELETE FROM youtube_watch_events; DELETE FROM activities; DELETE FROM youtube_videos;');
        if (repeated) put('youtube_videos', {});
        for (let i = 0; i < count; i++) {
          const time = new Date(now.getTime() - (i + 1) * 600_000).toISOString();
          const video = repeated ? 'FIXTURE0001' : `synthetic-${i}`;
          if (!repeated) put('youtube_videos', { video_id: video });
          put('activities', { id: `activity-${i}`, dedupe_key: `dedupe-${i}`, source_item_id: `item-${i}`, occurred_at: time });
          put('youtube_watch_events', { event_id: `event-${i}`, activity_id: `activity-${i}`, video_id: video, watched_at: time, actual_watched_seconds: i % 10 === 0 ? 42 : null });
        }
        db.exec('COMMIT; DROP INDEX youtube_watch_measured_time_idx;');
        const sample = (sql: string) => {
          const statement = db.prepare(sql + select);
          const rows = statement.all();
          const timings = Array.from({ length: 5 }, () => { const start = performance.now(); statement.all(); return performance.now() - start; });
          return { rows, milliseconds: timings.sort((a, b) => a - b)[2] };
        };
        const before = sample(legacy);
        const migrationStart = performance.now();
        db.exec('CREATE INDEX youtube_watch_measured_time_idx ON youtube_watch_events(video_id, julianday(watched_at)) WHERE actual_watched_seconds IS NOT NULL;');
        const indexBuildMs = performance.now() - migrationStart;
        const after = sample(YOUTUBE_ESTIMATED_EVENTS_CTE);
        assert.deepEqual(after.rows, before.rows);
        results.push({ count, scenario: repeated ? 'same-video' : 'distinct-videos', beforeMs: before.milliseconds, afterMs: after.milliseconds,
          speedup: before.milliseconds / after.milliseconds, indexBuildMs, identical: true,
          lookup: db.prepare('EXPLAIN QUERY PLAN ' + YOUTUBE_ESTIMATED_EVENTS_CTE + select).all().filter(row => String(row.detail).includes('measured')) });
      } finally { db.close(); }
    }
  }
  console.log(JSON.stringify({ node: process.version, sqlite, samples: 5, measuredFraction: 0.1, results }, null, 2));
} finally { rmSync(directory, { recursive: true, force: true }); }
