import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MatchingStore } from '../src/matching-v3/store.js';

test('score snapshots persist across database reopen, isolate selections and cascade on account deletion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'urtube-score-'));
  let db = new DatabaseSync(join(dir, 'fixture.sqlite'));
  try {
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2)');
    let store = new MatchingStore(db);
    store.saveScore(1, 2, '["Music"]', { result: { score: .65 } });
    db.close(); db = new DatabaseSync(join(dir, 'fixture.sqlite'));
    db.exec('PRAGMA foreign_keys=ON'); store = new MatchingStore(db);
    assert.deepEqual(store.score(1, 2, '["Music"]'), { result: { score: .65 } });
    assert.equal(store.score(1, 2, '["Sport"]'), null);
    assert.equal(store.score(2, 1, '["Music"]'), null);
    db.exec('DELETE FROM users WHERE id=2');
    assert.equal(store.score(1, 2, '["Music"]'), null);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
