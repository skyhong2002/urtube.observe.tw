// Verify and restore a complete bundle produced by scripts/backup.ts.
// Run only while app/ingest/worker are stopped. Existing databases are moved
// aside with a .pre-restore timestamp suffix before the verified copies land.
//
// Usage:
//   npx tsx scripts/restore-backup.ts <bundle-directory> [target-data-directory]
import { createHash } from 'node:crypto';
import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync,
  renameSync, rmSync, statSync,
} from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { BackupManifest } from './backup.js';

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

function safeTarget(value: string): boolean {
  return value === 'users.sqlite'
    || value === 'urtube.sqlite'
    || /^users\/[a-z0-9][a-z0-9.-]{1,31}\.sqlite$/.test(value);
}

export interface RestoreReport {
  ok: true;
  restoredAt: string;
  files: string[];
  previousSuffix: string;
}

export function restoreFullBackup(
  bundleDirectory: string,
  targetDataDirectory: string,
  privateDataKey = process.env.YOUTUBE_PRIVATE_DATA_KEY ?? '',
): RestoreReport {
  const bundleDir = resolve(bundleDirectory);
  const targetDir = resolve(targetDataDirectory);
  if (targetDir === '/' || targetDir === dirname(targetDir)) {
    throw new Error(`Unsafe restore target: ${targetDir}`);
  }
  const manifestPath = join(bundleDir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`Backup manifest not found: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupManifest;
  if (manifest.formatVersion !== 1 || !Array.isArray(manifest.files)) {
    throw new Error('Unsupported or invalid backup manifest');
  }
  const expectedKey = manifest.secretFingerprints?.YOUTUBE_PRIVATE_DATA_KEY;
  if (expectedKey) {
    const actualKey = privateDataKey ? createHash('sha256').update(privateDataKey).digest('hex') : '';
    if (actualKey !== expectedKey) {
      throw new Error('YOUTUBE_PRIVATE_DATA_KEY is missing or does not match this backup');
    }
  }

  const stage = join(targetDir, `.urtube-restore-stage-${process.pid}`);
  if (existsSync(stage)) throw new Error(`Restore staging path already exists: ${stage}`);
  mkdirSync(join(stage, 'users'), { recursive: true });
  const targets = new Set<string>();
  try {
    for (const file of manifest.files) {
      if (!safeTarget(file.target) || normalize(file.target) !== file.target) {
        throw new Error(`Unsafe backup target: ${file.target}`);
      }
      if (targets.has(file.target)) throw new Error(`Duplicate backup target: ${file.target}`);
      targets.add(file.target);
      if (file.backup !== join('databases', file.target)) {
        throw new Error(`Unsafe backup path: ${file.backup}`);
      }
      const source = join(bundleDir, file.backup);
      if (!existsSync(source)) throw new Error(`Backup file missing: ${file.backup}`);
      if (statSync(source).size !== file.bytes || fileHash(source) !== file.sha256) {
        throw new Error(`Backup checksum mismatch: ${file.backup}`);
      }
      const db = new DatabaseSync(source, { readOnly: true });
      try {
        const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
        if (integrity.integrity_check !== 'ok') throw new Error(`Backup integrity check failed: ${file.backup}`);
      } finally {
        db.close();
      }
      const staged = join(stage, file.target);
      mkdirSync(dirname(staged), { recursive: true });
      copyFileSync(source, staged);
    }
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }

  mkdirSync(targetDir, { recursive: true });
  const suffix = `.pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const moveAside = (path: string) => {
    if (existsSync(path)) renameSync(path, `${path}${suffix}`);
  };
  moveAside(join(targetDir, 'users'));
  for (const name of ['users.sqlite', 'urtube.sqlite']) {
    moveAside(join(targetDir, name));
    moveAside(join(targetDir, `${name}-wal`));
    moveAside(join(targetDir, `${name}-shm`));
  }
  renameSync(join(stage, 'users'), join(targetDir, 'users'));
  for (const name of ['users.sqlite', 'urtube.sqlite']) {
    const staged = join(stage, name);
    if (existsSync(staged)) renameSync(staged, join(targetDir, name));
  }
  rmSync(stage, { recursive: true, force: true });

  return {
    ok: true,
    restoredAt: new Date().toISOString(),
    files: manifest.files.map(({ target }) => target),
    previousSuffix: suffix,
  };
}

const isMain = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const [bundleDirectory, requestedTarget] = process.argv.slice(2);
  if (!bundleDirectory) {
    console.error('Usage: npx tsx scripts/restore-backup.ts <bundle-directory> [target-data-directory]');
    process.exit(2);
  }
  const target = resolve(requestedTarget ?? dirname(process.env.DATABASE_PATH ?? './data/urtube.sqlite'));
  console.log(JSON.stringify(restoreFullBackup(bundleDirectory, target), null, 2));
}
