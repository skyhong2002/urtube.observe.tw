import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { tsImport } from 'tsx/esm/api';

// Explicit TS loading also works in Node 22's production tsx process. Never
// construct UserRegistry/MatchingStore here: their constructors perform writes.
const { readAdminSnapshot } = await tsImport('./monitoring-read.ts', import.meta.url);
const db = new DatabaseSync(workerData.path, { readOnly: true });
try {
  db.exec('PRAGMA busy_timeout = 1000; PRAGMA query_only = ON; BEGIN');
  const snapshot = readAdminSnapshot(db, workerData.version);
  db.exec('COMMIT');
  parentPort.postMessage(snapshot);
} finally {
  db.close();
}
