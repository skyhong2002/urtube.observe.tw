// Offline synthetic benchmark. Always creates disposable databases under tmpdir;
// never opens configured archives, calls providers, or starts application services.
// Run: NODE_ENV=test node --import tsx scripts/benchmark-archive.ts
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { Repository } from '../src/data/database.js';
import { normalizeYoutubeCapture } from '../src/youtube/capture.js';

// Main superseded #95's permanent expression index with a TEMP covering lookup.
// Extract the production query without making it part of the application API;
// replace only the measured-neighbor probe to reproduce the old quadratic path.
const source = readFileSync(new URL('../src/data/database.ts', import.meta.url), 'utf8');
const optimized = source.match(/const YOUTUBE_ESTIMATED_EVENTS_CTE = `([\s\S]*?)`;/)?.[1];
assert.ok(optimized, 'find the production estimated-events CTE');
const legacy = optimized.replace(/SELECT 1 FROM temp\.youtube_measured_events measured[\s\S]*?<=300/, `
  SELECT 1 FROM youtube_watch_events measured
  WHERE measured.video_id=w.video_id AND measured.actual_watched_seconds IS NOT NULL
    AND ABS((julianday(measured.watched_at)-julianday(w.watched_at))*86400)<=300`);
assert.notEqual(legacy, optimized, 'replace only the indexed measured-neighbor probe');

function median(run: () => void): number {
  run();
  const timings = Array.from({ length: 5 }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  });
  return timings.sort((a, b) => a - b)[2];
}

const directory = mkdtempSync(join(tmpdir(), 'urtube-archive-benchmark-'));
const results: unknown[] = [];
let sqlite = '';
try {
  for (const count of [250, 500, 1000, 2000]) {
    for (const repeated of [false, true]) {
      const repository = new Repository(join(directory, `${count}-${repeated}.sqlite`));
      const internal = repository as unknown as {
        db: DatabaseSync; estimatedEventsKey: string; estimatedEventsRevision: string;
        ensureEstimatedEvents(): void;
      };
      const db = internal.db;
      try {
        sqlite = String(db.prepare('SELECT sqlite_version() v').get()!.v);
        const now = new Date('2026-09-10T12:00:00Z');
        repository.upsertYoutubeCapture(normalizeYoutubeCapture({
          sessionId: 'benchmark-fixture-session', videoId: 'FIXTURE0001', title: 'Synthetic',
          url: 'https://www.youtube.com/watch?v=FIXTURE0001', channelTitle: 'Fixture',
          watchedAt: '2026-09-01T00:00:00Z', actualWatchedSeconds: 42, durationSeconds: 600,
        }, now));
        const tables = ['activities', 'youtube_watch_events', 'youtube_videos'];
        const templates = Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table} LIMIT 1`).get()!]));
        const insert = Object.fromEntries(Object.entries(templates).map(([table, template]) => [table,
          db.prepare(`INSERT INTO ${table} (${Object.keys(template).join(',')}) VALUES (${Object.keys(template).map(() => '?').join(',')})`)]));
        const put = (table: string, values: Record<string, SQLOutputValue>) => insert[table].run(...Object.values({ ...templates[table], ...values }));
        db.exec('BEGIN; DELETE FROM youtube_watch_events; DELETE FROM activities; DELETE FROM youtube_videos;');
        if (repeated) put('youtube_videos', {});
        for (let i = 0; i < count; i++) {
          const time = new Date(now.getTime() - (i + 1) * 600_000).toISOString();
          const video = repeated ? 'FIXTURE0001' : `synthetic-${i}`;
          if (!repeated) put('youtube_videos', { video_id: video });
          put('activities', { id: `activity-${i}`, dedupe_key: `dedupe-${i}`, source_item_id: `item-${i}`, occurred_at: time });
          put('youtube_watch_events', { event_id: `event-${i}`, activity_id: `activity-${i}`, video_id: video,
            watched_at: time, actual_watched_seconds: i % 10 === 0 ? 42 : null });
        }
        db.exec('COMMIT;');
        const beforeMs = median(() => db.exec(`
          DROP TABLE IF EXISTS temp.legacy_estimated_events;
          CREATE TEMP TABLE legacy_estimated_events AS ${legacy} SELECT * FROM estimated_events;
          CREATE INDEX temp.legacy_time_idx ON legacy_estimated_events(watched_at);
          CREATE INDEX temp.legacy_video_idx ON legacy_estimated_events(video_id);
        `));
        const afterMs = median(() => {
          internal.estimatedEventsKey = '';
          internal.estimatedEventsRevision = '';
          internal.ensureEstimatedEvents();
        });
        assert.deepEqual(db.prepare('SELECT * FROM temp.youtube_estimated_events ORDER BY event_id').all(),
          db.prepare('SELECT * FROM temp.legacy_estimated_events ORDER BY event_id').all());
        assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='youtube_watch_measured_time_idx'").get()!.n, 0,
          'benchmark main without adding the obsolete persistent index');
        assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 14);
        // The real refresh drops this lookup on completion; recreate just its
        // projection to inspect the production CTE's plan after all timings.
        db.exec(`CREATE TEMP TABLE youtube_measured_events AS
          SELECT video_id, julianday(watched_at) watched_jd FROM youtube_watch_events WHERE actual_watched_seconds IS NOT NULL;
          CREATE INDEX temp.youtube_measured_video_time_idx ON youtube_measured_events(video_id, watched_jd);`);
        const lookup: string[] = db.prepare(`EXPLAIN QUERY PLAN ${optimized} SELECT * FROM estimated_events`).all()
          .map(row => String(row.detail)).filter(detail => detail.includes('measured'));
        assert.ok(lookup.some(detail => /COVERING INDEX youtube_measured_video_time_idx.*video_id=\?.*watched_jd>\?.*watched_jd<\?/.test(detail)),
          'production probe must use both covering lookup columns');
        results.push({ count, scenario: repeated ? 'same-video' : 'distinct-videos',
          beforeMs, afterMs, speedup: beforeMs / afterMs, identical: true, lookup });
      } finally { repository.close(); }
    }
  }
  console.log(JSON.stringify({ node: process.version, sqlite, schemaVersion: 14,
    samples: 5, measuredFraction: 0.1, timing: 'full materialization; current path includes freshness and TEMP lookup construction', results }, null, 2));
} finally { rmSync(directory, { recursive: true, force: true }); }
