import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Repository } from '../src/data/database.js';
import { UserRegistry } from '../src/users.js';

// Another process holds the database briefly (as the ingest or worker does
// while it recovers the WAL during a deploy). Opening must wait, not crash.
async function whileLockedElsewhere(path: string, open: () => void): Promise<void> {
  const child = spawn(process.execPath, ['-e', `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(path)});
    db.exec('BEGIN EXCLUSIVE');
    process.stdout.write('locked\\n');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    db.exec('COMMIT');
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((resolve) => child.stdout!.once('data', () => resolve()));
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try { open(); } finally { await exited; }
}

for (const kind of ['registry', 'archive'] as const) {
  test(`opening a ${kind} waits for another process's lock instead of failing`, async () => {
    const root = mkdtempSync(join(tmpdir(), `urtube-lock-${kind}-`));
    const path = join(root, `${kind}.sqlite`);
    try {
      // A rollback-journal database: switching it to WAL needs the lock.
      const setup = new DatabaseSync(path);
      setup.exec('CREATE TABLE seed (id INTEGER)');
      setup.close();
      await whileLockedElsewhere(path, () => {
        if (kind === 'registry') new UserRegistry(path).close();
        else new Repository(path).close();
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
