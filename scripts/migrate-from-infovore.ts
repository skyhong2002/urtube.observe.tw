// Build a YouTube-only urtube database from an Infovore production backup.
// Copies exactly the tables listed in YOUTUBE_BOUNDARY.md, verifies row
// counts, and exits non-zero on any mismatch. The source is opened read-only
// and never modified. Usage:
//   npx tsx scripts/migrate-from-infovore.ts <infovore-backup.sqlite> <target.sqlite>
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Repository } from '../src/data/database.js';

interface TableCopy {
  table: string;
  where?: string;
}

const TABLES: TableCopy[] = [
  { table: 'activities', where: "source='youtube'" },
  { table: 'youtube_imports' },
  { table: 'youtube_videos' },
  { table: 'youtube_channels' },
  { table: 'youtube_watch_events' },
  { table: 'youtube_search_events' },
  { table: 'youtube_topics' },
  { table: 'youtube_video_topics' },
  { table: 'youtube_progress_imports' },
  { table: 'youtube_video_progress' },
  { table: 'youtube_sync_state' },
  { table: 'youtube_oauth' },
];

export interface MigrationReport {
  ok: boolean;
  tables: Array<{ table: string; source: number; target: number }>;
}

export function migrateFromInfovore(sourcePath: string, targetPath: string): MigrationReport {
  // Creating the Repository runs the full (Infovore-compatible) migration
  // chain, so the target schema matches the source exactly.
  new Repository(targetPath).close();

  const db = new DatabaseSync(targetPath);
  const report: MigrationReport = { ok: true, tables: [] };
  try {
    db.exec(`ATTACH DATABASE '${resolve(sourcePath).replace(/'/g, "''")}' AS src`);
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      for (const { table, where } of TABLES) {
        const clause = where ? ` WHERE ${where}` : '';
        db.exec(`DELETE FROM main.${table}`);
        // Older snapshots lack additive metadata columns; let their target
        // defaults apply while preserving every column present in the source.
        const sourceColumns = db.prepare(`PRAGMA src.table_info(${table})`).all() as Array<{ name: string }>;
        const targetColumns = new Set((db.prepare(`PRAGMA main.table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
        const columns = sourceColumns.filter((column) => targetColumns.has(column.name))
          .map((column) => `"${column.name.replaceAll('"', '""')}"`).join(', ');
        db.exec(`INSERT INTO main.${table} (${columns}) SELECT ${columns} FROM src.${table}${clause}`);
        const source = Number((db.prepare(`SELECT COUNT(*) count FROM src.${table}${clause}`).get() as { count: number }).count);
        const target = Number((db.prepare(`SELECT COUNT(*) count FROM main.${table}`).get() as { count: number }).count);
        report.tables.push({ table, source, target });
        if (source !== target) report.ok = false;
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    db.exec('DETACH DATABASE src');
  } finally {
    db.close();
  }
  return report;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (isMain) {
  const [sourcePath, targetPath] = process.argv.slice(2);
  if (!sourcePath || !targetPath) {
    console.error('Usage: npx tsx scripts/migrate-from-infovore.ts <infovore-backup.sqlite> <target.sqlite>');
    process.exit(2);
  }
  if (!existsSync(sourcePath)) {
    console.error(`Source database not found: ${sourcePath}`);
    process.exit(2);
  }
  if (existsSync(targetPath)) {
    console.error(`Target already exists, refusing to overwrite: ${targetPath}`);
    process.exit(2);
  }
  const report = migrateFromInfovore(sourcePath, targetPath);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    console.error('Row counts do not match; migration failed.');
    process.exit(1);
  }
}
