// Consistent online backup: VACUUM INTO writes a compact, transactionally
// consistent copy without stopping writers. Usage:
//   npx tsx scripts/backup.ts [source.sqlite] [target.sqlite]
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const source = resolve(process.argv[2] ?? process.env.DATABASE_PATH ?? './data/urtube.sqlite');
const target = resolve(
  process.argv[3]
  ?? `${source.replace(/\.sqlite$/, '')}-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`
);

mkdirSync(dirname(target), { recursive: true });
const db = new DatabaseSync(source, { readOnly: true });
try {
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  const counts: Record<string, number> = {};
  for (const table of ['activities', 'youtube_watch_events', 'youtube_search_events', 'youtube_videos', 'youtube_video_progress']) {
    try {
      counts[table] = Number((db.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
    } catch {
      // Table may not exist in a partial database; report what does.
    }
  }
  console.log(JSON.stringify({ ok: true, source, target, counts }, null, 2));
} finally {
  db.close();
}
