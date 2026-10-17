// Offline synthetic probe; never opens the configured/live database or calls AI.
// Run: NODE_ENV=test node --import tsx scripts/benchmark-watch-neighbors.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { DatabaseSync } from 'node:sqlite';
import { Repository } from '../src/data/database.js';

const source = readFileSync(new URL('../src/data/database.ts', import.meta.url), 'utf8');
const optimized = source.match(/const YOUTUBE_ESTIMATED_EVENTS_CTE = `([\s\S]*?)`;/)?.[1];
assert.ok(optimized, 'find the production estimated-events CTE');
const legacy = optimized.replace(/SELECT 1 FROM temp\.youtube_measured_events measured[\s\S]*?<=300/, `
  SELECT 1 FROM youtube_watch_events measured
  WHERE measured.video_id=w.video_id AND measured.actual_watched_seconds IS NOT NULL
    AND ABS((julianday(measured.watched_at)-julianday(w.watched_at))*86400)<=300`);
assert.notEqual(legacy, optimized, 'replace only the indexed neighbor probe with its old form');

function median(run: () => void): number {
  run(); // Warm prepared/cache paths before reporting five samples.
  const samples = Array.from({ length: 5 }, () => {
    const start = performance.now(); run(); return performance.now() - start;
  }).sort((a, b) => a - b);
  return Number(samples[2].toFixed(3));
}

const cases = [
  ...[0, 0.1, 1].flatMap(ratio => [250, 500, 1000, 2000].map(count => ({
    scenario: 'far', unmeasured: count, measured: Math.floor(count * ratio),
  }))),
  { scenario: 'near', unmeasured: 2000, measured: 2000 },
  { scenario: 'all-measured', unmeasured: 0, measured: 2000 },
].filter(fixture => !process.argv.includes('--edge-cases') || fixture.scenario !== 'far');
for (const fixture of cases) {
  const repository = new Repository(':memory:');
  const internal = repository as unknown as {
    db: DatabaseSync; estimatedEventsKey: string; estimatedEventsRevision: string;
    ensureEstimatedEvents(): void;
  };
  const database = internal.db;
  try {
    database.exec("INSERT INTO youtube_videos(video_id, title, duration_seconds) VALUES ('synthetic', 'Synthetic', 600)");
    const activity = database.prepare(`INSERT INTO activities (
      id, dedupe_key, source, type, media_kind, title, image, occurred_at,
      occurred_precision, visibility, extra_json, first_seen_at, last_seen_at
    ) VALUES (?, ?, 'youtube', 'video', 'video', 'Synthetic', '', ?, 'exact', 'summary', '{}', ?, ?)`);
    const event = database.prepare(`INSERT INTO youtube_watch_events (
      event_id, activity_id, video_id, watched_at, raw_title, raw_url,
      actual_watched_seconds, imported_at, activity_type
    ) VALUES (?, ?, 'synthetic', ?, 'Synthetic', '', ?, ?, 'video')`);
    database.exec('BEGIN');
    for (const kind of ['unmeasured', 'measured']) {
      const size = kind === 'measured' ? fixture.measured : fixture.unmeasured;
      const epoch = Date.parse(kind === 'measured' && fixture.scenario !== 'near' ? '2026-10-01T00:00:00Z' : '2026-01-01T00:00:00Z');
      for (let index = 0; index < size; index++) {
        const id = `${kind}-${index}`;
        const time = new Date(epoch + index * 1000).toISOString();
        activity.run(id, id, time, time, time);
        event.run(id, id, time, kind === 'measured' ? 42 : null, time);
      }
    }
    database.exec('COMMIT');
    const oldMs = median(() => database.exec(`
      DROP TABLE IF EXISTS temp.legacy_estimated_events;
      CREATE TEMP TABLE legacy_estimated_events AS ${legacy} SELECT * FROM estimated_events;
      CREATE INDEX temp.legacy_time_idx ON legacy_estimated_events(watched_at);
      CREATE INDEX temp.legacy_video_idx ON legacy_estimated_events(video_id);
    `));
    const newMs = median(() => {
      internal.estimatedEventsKey = '';
      internal.estimatedEventsRevision = '';
      internal.ensureEstimatedEvents();
    });
    const oldRows = database.prepare('SELECT event_id, estimated_watch_seconds FROM temp.legacy_estimated_events ORDER BY event_id').all();
    const newRows = database.prepare('SELECT event_id, estimated_watch_seconds FROM temp.youtube_estimated_events ORDER BY event_id').all();
    assert.deepEqual(newRows, oldRows);
    console.log(JSON.stringify({ ...fixture, legacyMs: oldMs, indexedRebuildMs: newMs,
      speedup: Number((oldMs / newMs).toFixed(2)), equal: true }));
    if (fixture.scenario === 'far' && fixture.measured === 2000) {
      database.exec(`CREATE TEMP TABLE youtube_measured_events AS
        SELECT video_id, julianday(watched_at) watched_jd FROM youtube_watch_events WHERE actual_watched_seconds IS NOT NULL;
        CREATE INDEX temp.youtube_measured_video_time_idx ON youtube_measured_events(video_id, watched_jd);`);
      const plan = database.prepare(`EXPLAIN QUERY PLAN ${optimized} SELECT * FROM estimated_events`).all();
      console.log(JSON.stringify({ neighborPlan: plan.map(row => String(row.detail)).filter(detail => detail.includes('measured')) }));
    }
  } finally { repository.close(); }
}
