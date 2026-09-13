// Daily complete backup scheduler. Bundles land on the host-mounted /backups
// directory, while status is written to the shared data volume for readiness
// monitoring. Old bundles are retained for a configurable number of days.
import {
  existsSync, readdirSync, rmSync, statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { config } from '../src/config.js';
import { readOpsStatus, writeOpsStatus } from '../src/ops-status.js';
import { createFullBackup } from './backup.js';

const databasePath = resolve(process.env.DATABASE_PATH ?? './data/urtube.sqlite');
const registryPath = resolve(process.env.USERS_DATABASE_PATH ?? './data/users.sqlite');
const backupRoot = resolve(config.backup.directory);
const intervalHours = config.backup.intervalHours;
const retentionDays = config.backup.retentionDays;

export interface BackupStatus {
  lastStartedAt: string;
  lastCompletedAt?: string;
  lastBundle?: string;
  files?: number;
  users?: number;
  lastError?: string;
}

export function backupCycleStartedStatus(previous: BackupStatus | null, now: Date): BackupStatus {
  // The last restorable bundle remains valid while the next one is written.
  // A previous failure must remain visible until a new backup succeeds.
  return { ...previous, lastStartedAt: now.toISOString() };
}

export function backupCycleDue(previous: BackupStatus | null, now = Date.now()): boolean {
  const completedAt = Date.parse(previous?.lastCompletedAt ?? '');
  return Boolean(previous?.lastError) || !Number.isFinite(completedAt)
    || now - completedAt >= intervalHours * 3600_000;
}

function recordStatus(status: BackupStatus): void {
  try {
    writeOpsStatus('backup', status);
  } catch (error) {
    console.error('backup status write failed:', error instanceof Error ? error.message : error);
  }
}

function pruneOldBundles(now = Date.now()): void {
  if (backupRoot === '/' || backupRoot === dirname(backupRoot) || !existsSync(backupRoot)) return;
  const cutoff = now - retentionDays * 86400_000;
  for (const name of readdirSync(backupRoot)) {
    if (!/^urtube-\d{4}-\d{2}-\d{2}T/.test(name)) continue;
    const path = join(backupRoot, name);
    if (!statSync(path).isDirectory() || statSync(path).mtimeMs >= cutoff) continue;
    rmSync(path, { recursive: true, force: true });
  }
}

export function runBackupCycle(now = new Date()): BackupStatus {
  const started = backupCycleStartedStatus(readOpsStatus<BackupStatus>('backup'), now);
  recordStatus(started);
  try {
    const name = `urtube-${now.toISOString().replace(/[:.]/g, '-')}`;
    const manifest = createFullBackup({
      registryPath,
      databasePath,
      dataDir: join(dirname(registryPath), 'users'),
      outputDir: join(backupRoot, name),
      ownerHandle: process.env.OWNER_HANDLE ?? 'sky',
      privateDataKey: process.env.YOUTUBE_PRIVATE_DATA_KEY,
    });
    const complete: BackupStatus = {
      lastStartedAt: started.lastStartedAt,
      lastCompletedAt: new Date().toISOString(),
      lastBundle: name,
      files: manifest.files.length,
      users: manifest.users.length,
      lastError: '',
    };
    recordStatus(complete);
    pruneOldBundles();
    return complete;
  } catch (error) {
    const failed: BackupStatus = {
      ...started,
      lastError: error instanceof Error ? error.stack ?? error.message : String(error),
    };
    recordStatus(failed);
    throw error;
  }
}

if (process.env.NODE_ENV !== 'test') {
  const run = (): boolean => {
    try {
      console.log(JSON.stringify(runBackupCycle()));
      return true;
    } catch (error) {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      return false;
    }
  };
  const previous = readOpsStatus<BackupStatus>('backup');
  const due = backupCycleDue(previous);
  let timer: NodeJS.Timeout;
  const schedule = (delay: number) => {
    timer = setTimeout(() => {
      const succeeded = run();
      schedule(succeeded ? intervalHours * 3600_000 : 5 * 60_000);
    }, delay);
  };
  if (due) {
    const succeeded = run();
    schedule(succeeded ? intervalHours * 3600_000 : 5 * 60_000);
  } else {
    const elapsed = Date.now() - Date.parse(previous!.lastCompletedAt!);
    schedule(Math.max(1000, intervalHours * 3600_000 - elapsed));
  }
  process.once('SIGTERM', () => {
    clearTimeout(timer);
    process.exit(0);
  });
}
