// Complete multi-user online backup. Every SQLite database is copied with
// VACUUM INTO, then recorded in a checksummed manifest. The encryption key is
// never written to the bundle; only its one-way fingerprint is recorded so a
// restore can refuse the wrong key.
//
// Usage:
//   npx tsx scripts/backup.ts [output-directory]
import { createHash } from 'node:crypto';
import {
  closeSync, existsSync, mkdirSync, openSync, readSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export interface BackupFileReport {
  target: string;
  backup: string;
  bytes: number;
  sha256: string;
  tables: Record<string, number>;
}

export interface BackupManifest {
  formatVersion: 1;
  createdAt: string;
  users: string[];
  files: BackupFileReport[];
  requiredSecrets: string[];
  secretFingerprints: Record<string, string>;
}

export interface FullBackupOptions {
  registryPath: string;
  databasePath: string;
  dataDir: string;
  outputDir: string;
  ownerHandle: string;
  privateDataKey?: string;
}

function sqlIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function databaseReport(path: string): Record<string, number> {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (integrity.integrity_check !== 'ok') throw new Error(`Integrity check failed for ${path}`);
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all() as Array<{ name: string }>;
    return Object.fromEntries(tables.map(({ name }) => {
      const row = db.prepare(`SELECT COUNT(*) count FROM ${sqlIdentifier(name)}`).get() as { count: number };
      return [name, Number(row.count)];
    }));
  } finally {
    db.close();
  }
}

function fileHash(path: string): string {
  const hash = createHash('sha256');
  const descriptor = openSync(path, 'r');
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes = 0;
    while ((bytes = readSync(descriptor, chunk, 0, chunk.length, null)) > 0) {
      hash.update(chunk.subarray(0, bytes));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest('hex');
}

export function backupDatabase(sourcePath: string, targetPath: string): BackupFileReport {
  if (!existsSync(sourcePath)) throw new Error(`Database not found: ${sourcePath}`);
  if (existsSync(targetPath)) throw new Error(`Backup target already exists: ${targetPath}`);
  mkdirSync(dirname(targetPath), { recursive: true });
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    source.exec(`VACUUM INTO '${resolve(targetPath).replace(/'/g, "''")}'`);
  } finally {
    source.close();
  }
  return {
    target: '',
    backup: '',
    bytes: statSync(targetPath).size,
    sha256: fileHash(targetPath),
    tables: databaseReport(targetPath),
  };
}

export function createFullBackup(options: FullBackupOptions): BackupManifest {
  if (!options.privateDataKey || options.privateDataKey.length < 32) {
    throw new Error('YOUTUBE_PRIVATE_DATA_KEY is required for a restorable backup');
  }
  const outputDir = resolve(options.outputDir);
  if (existsSync(outputDir)) throw new Error(`Backup output already exists: ${outputDir}`);
  const partialDir = `${outputDir}.partial-${process.pid}`;
  if (existsSync(partialDir)) rmSync(partialDir, { recursive: true, force: true });
  mkdirSync(join(partialDir, 'databases', 'users'), { recursive: true });

  try {
    const files: BackupFileReport[] = [];
    const add = (source: string, target: string) => {
      const backup = join('databases', target);
      files.push({
        ...backupDatabase(resolve(source), join(partialDir, backup)),
        target,
        backup,
      });
    };

    // Snapshot the registry first, then use that snapshot as the authoritative
    // user set for the remainder of this bundle.
    add(options.registryPath, 'users.sqlite');
    const registryBackup = new DatabaseSync(join(partialDir, 'databases', 'users.sqlite'), { readOnly: true });
    let users: string[];
    try {
      users = (registryBackup.prepare('SELECT handle FROM users ORDER BY id').all() as Array<{ handle: string }>)
        .map(({ handle }) => handle);
    } finally {
      registryBackup.close();
    }

    add(options.databasePath, 'urtube.sqlite');
    for (const handle of users) {
      if (handle === options.ownerHandle) continue;
      const source = join(options.dataDir, `${handle}.sqlite`);
      // A just-created account may not have opened its data database yet.
      if (existsSync(source)) add(source, join('users', `${handle}.sqlite`));
    }

    const secretFingerprints = {
      YOUTUBE_PRIVATE_DATA_KEY: createHash('sha256').update(options.privateDataKey).digest('hex'),
    };
    const manifest: BackupManifest = {
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      users,
      files,
      requiredSecrets: ['YOUTUBE_PRIVATE_DATA_KEY'],
      secretFingerprints,
    };
    writeFileSync(join(partialDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    mkdirSync(dirname(outputDir), { recursive: true });
    renameSync(partialDir, outputDir);
    return manifest;
  } catch (error) {
    rmSync(partialDir, { recursive: true, force: true });
    throw error;
  }
}

function defaultOutputDir(databasePath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(dirname(databasePath), 'backups', `urtube-${timestamp}`);
}

const isMain = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const registryPath = resolve(process.env.USERS_DATABASE_PATH ?? './data/users.sqlite');
  const databasePath = resolve(process.env.DATABASE_PATH ?? './data/urtube.sqlite');
  const outputDir = resolve(process.argv[2] ?? defaultOutputDir(databasePath));
  const manifest = createFullBackup({
    registryPath,
    databasePath,
    dataDir: join(dirname(registryPath), 'users'),
    outputDir,
    ownerHandle: process.env.OWNER_HANDLE ?? 'sky',
    privateDataKey: process.env.YOUTUBE_PRIVATE_DATA_KEY,
  });
  console.log(JSON.stringify({ ok: true, outputDir, ...manifest }, null, 2));
}
