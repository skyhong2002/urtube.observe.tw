import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { backupCycleDue, runBackupCycle, type BackupStatus } from '../scripts/backup-worker.js';
import { config } from '../src/config.js';
import { readOpsStatus, writeOpsStatus } from '../src/ops-status.js';

test('failed backup keeps the successful bundle and is retried after restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'urtube-backup-status-'));
  const previousDirectory = config.opsStatusDirectory;
  const previousKey = process.env.YOUTUBE_PRIVATE_DATA_KEY;
  try {
    config.opsStatusDirectory = dir;
    // Fail validation before createFullBackup touches any database or bundle.
    process.env.YOUTUBE_PRIVATE_DATA_KEY = '';
    const previous: BackupStatus = {
      lastStartedAt: new Date(Date.now() - 120_000).toISOString(),
      lastCompletedAt: new Date(Date.now() - 60_000).toISOString(),
      lastBundle: 'previous-fixture-bundle', files: 3, users: 2, lastError: '',
    };
    writeOpsStatus('backup', previous);
    assert.equal(backupCycleDue(previous), false);
    const started = new Date();
    assert.throws(() => runBackupCycle(started), /required for a restorable backup/);
    const failed = readOpsStatus<BackupStatus>('backup')!;
    assert.equal(failed.lastStartedAt, started.toISOString());
    assert.equal(failed.lastCompletedAt, previous.lastCompletedAt);
    assert.equal(failed.lastBundle, previous.lastBundle);
    assert.equal(failed.files, previous.files);
    assert.equal(failed.users, previous.users);
    assert.match(failed.lastError!, /required for a restorable backup/);
    assert.equal(backupCycleDue(failed), true,
      'a retained recent completion must not defer a failed retry until tomorrow');
  } finally {
    config.opsStatusDirectory = previousDirectory;
    if (previousKey === undefined) delete process.env.YOUTUBE_PRIVATE_DATA_KEY;
    else process.env.YOUTUBE_PRIVATE_DATA_KEY = previousKey;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('backup scheduling runs missing, invalid, and expired completions', () => {
  const now = Date.now();
  const lastStartedAt = new Date(now).toISOString();
  assert.equal(backupCycleDue(null, now), true);
  assert.equal(backupCycleDue({ lastStartedAt }, now), true);
  assert.equal(backupCycleDue({ lastStartedAt, lastCompletedAt: 'invalid' }, now), true);
  const lastCompletedAt = new Date(now - config.backup.intervalHours * 3600_000).toISOString();
  assert.equal(backupCycleDue({ lastStartedAt, lastCompletedAt }, now - 1), false);
  assert.equal(backupCycleDue({ lastStartedAt, lastCompletedAt }, now), true);
});
