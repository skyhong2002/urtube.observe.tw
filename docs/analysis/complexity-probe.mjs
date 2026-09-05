// Reproduce the SQL evidence with synthetic data and the repository's real schema.
// Run from the repository root:
//   node --import tsx docs/analysis/complexity-probe.mjs
// Only :memory: databases are opened. No HTTP requests are made.
import { readFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
process.env.USERS_DATABASE_PATH = ':memory:';
const { Repository } = await import('../../src/data/database.ts');
const source = readFileSync(new URL('../../src/data/database.ts', import.meta.url), 'utf8');

function extract(pattern, name) {
  const match = source.match(pattern);
  if (!match) throw new Error(`Source changed; review the ${name} probe before running it.`);
  return match[1];
}

const cte = extract(/const YOUTUBE_ESTIMATED_EVENTS_CTE = `([\s\S]*?)`;/, 'estimated events');
const placeholder = extract(/const selectDayPlaceholders = this.db.prepare\(`([\s\S]*?)`\)/, 'placeholder');
const backfill = extract(/const statement = this.db.prepare\(`([\s\S]*?)`\)/, 'channel backfill')
  .replace("${videoIds ? ' AND video_id=?' : ''}", '');
const sourceQuery = extract(
  /const rows = this.db.prepare\(`(SELECT v.video_id, v.title, v.tags_json,[\s\S]*?)`\)/,
  'matching source',
);
const audit = { node: process.version, sqlite: null, plans: {}, measurements: [] };

for (const mode of ['unique', 'repeat']) {
  for (const n of [250, 500, 1000, 2000]) {
    const repository = new Repository(':memory:');
    // Diagnostic access to the actual connection; no production database is used.
    const db = repository.db;
    try {
      audit.sqlite = db.prepare('SELECT sqlite_version() version').get().version;
      const video = db.prepare("INSERT INTO youtube_videos(video_id,title,duration_seconds) VALUES (?,'synthetic',600)");
      const activity = db.prepare(`
        INSERT INTO activities(id,dedupe_key,source,type,media_kind,title,image,occurred_at,
          occurred_precision,visibility,extra_json,first_seen_at,last_seen_at)
        VALUES (?,?,'youtube','watch','video','synthetic','',?,'exact','summary','{}',?,?)
      `);
      const watch = db.prepare(`
        INSERT INTO youtube_watch_events(event_id,activity_id,video_id,watched_at,
          raw_title,raw_url,imported_at,activity_type)
        VALUES (?,?,?,?,'synthetic','https://example.invalid',?,'video')
      `);
      db.exec('BEGIN');
      for (let i = 0; i < n; i++) {
        const id = String(i);
        const videoId = mode === 'repeat' ? 'v0' : `v${i}`;
        const date = new Date(Date.UTC(2020, 0, 1) + i * 3_600_000).toISOString();
        if (mode === 'unique' || i === 0) video.run(videoId);
        activity.run(id, id, date, date, date);
        watch.run(id, id, videoId, date, date);
      }
      db.exec('COMMIT');

      if (n === 250 && mode === 'repeat') {
        audit.plans.estimate = db.prepare(`EXPLAIN QUERY PLAN ${cte} SELECT SUM(estimated_watch_seconds) FROM estimated_events`).all();
        audit.plans.placeholder = db.prepare(`EXPLAIN QUERY PLAN ${placeholder}`).all('v0', '2020-01-01');
        audit.plans.backfill = db.prepare(`EXPLAIN QUERY PLAN ${backfill}`).all();
        audit.plans.source = db.prepare(`EXPLAIN QUERY PLAN ${sourceQuery}`).all(2000);
      }

      const statement = db.prepare(`${cte} SELECT SUM(estimated_watch_seconds) FROM estimated_events`);
      statement.get();
      const samples = [];
      for (let iteration = 0; iteration < 5; iteration++) {
        const start = performance.now();
        statement.get();
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      audit.measurements.push({ mode, n, medianMs: Math.round(samples[2] * 1000) / 1000 });
    } finally {
      repository.close();
    }
  }
}

console.log(JSON.stringify(audit, null, 2));
