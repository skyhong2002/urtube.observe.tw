import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { MatchingStore } from '../src/matching-v3/store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { UserRegistry } from '../src/users.js';
import { AdminMonitoring } from '../src/matching-v3/monitoring.js';
import { readAdminSnapshot } from '../src/matching-v3/monitoring-read.js';
import { matchingRoutes } from '../src/matching-v3/routes.js';
import { settings, version } from '../src/matching-v3/model.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'urtube-monitoring-'));
  const path = join(dir, 'users.sqlite');
  const registry = new UserRegistry(path, ':memory:');
  registry.createUser('monitoradmin', 'Admin');
  registry.createUser('monitorviewer', 'Viewer');
  const store = registry.matchingV3Store();
  store.putCache('vector', [1, 2, 3]);
  store.putCache('classification', { assignments: [] });
  store.putCache('channel', { category: 'test' });
  const db = new DatabaseSync(path);
  const s = settings({ MATCHING_V3_ENABLED: 'true', MATCHING_V3_ADMIN_HANDLES: 'monitoradmin' });
  db.prepare('INSERT INTO matching_v3_profiles VALUES (?, ?)').run(registry.userByHandle('monitorviewer')!.id,
    JSON.stringify({ version: version(s), builtAt: '2026-09-06T00:00:00Z', totalVideos: 2, processedVideos: 2,
      genres: { Sport: { status: 'ready', clusters: [{ centroid: [0.4, 0.6], tags: [{ text: 'private-test-tag' }] }] } } }));
  const reader = new AdminMonitoring(path, () => { throw new Error('Must use the worker'); });
  const app = matchingRoutes(registry, s, 'http://localhost:3000');
  const token = registry.createSession(registry.userByHandle('monitoradmin')!);
  const headers = { Cookie: `urtube_session=${token}` };
  return { registry, store, db, reader, s, app, token, headers,
    close() { reader.close(); registry.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('file-backed monitoring coalesces readers, caches snapshots, refreshes on expiry and only returns summaries', async () => {
  const f = fixture();
  try {
    const v = version(f.s);
    const values = await Promise.all(Array.from({ length: 8 }, () => f.reader.read(v)));
    for (const value of values) assert.equal(value, values[0], 'all tabs share one scan');
    const expected = readAdminSnapshot(f.db, v);
    assert.deepEqual({ ...values[0], sampledAt: 0 }, JSON.parse(JSON.stringify({ ...expected, sampledAt: 0 })));
    assert.equal(values[0].cache.length, 3);
    assert.doesNotMatch(JSON.stringify(values[0]), /value_json|profile_json|capture_token|centroid|private-test-tag/);
    assert.equal(values[0].users.find(user => user.handle === 'monitorviewer')?.usable, true);
    assert.equal(values[0].users.find(user => user.handle === 'monitorviewer')?.profile?.genres.Sport.clusterCount, 1);
    f.store.putCache('vector-2', [4, 5]);
    assert.equal(await f.reader.read(v), values[0], 'polling does not rescan during TTL');
    const originalNow = Date.now;
    Date.now = () => originalNow() + 31_000;
    try {
      const fresh = await f.reader.read(v);
      assert.equal(fresh.cache.find(row => row.kind === 'embedding')?.count, 2);
    } finally { Date.now = originalNow; }
  } finally { f.close(); }
});

test('a blocked monitoring SQLite read leaves the HTTP event loop responsive and failures back off', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'urtube-monitoring-lock-'));
  const path = join(dir, 'users.sqlite');
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, handle TEXT)');
  new MatchingStore(db);
  const reader = new AdminMonitoring(path, () => { throw new Error('Must use the worker'); });
  const app = new Hono();
  app.get('/admin', async c => {
    try { return c.json(await reader.read('test')); }
    catch { return c.json({ error: 'monitoring_unavailable' }, 503); }
  });
  app.get('/ping', c => c.text('ok'));
  try {
    // Synthetic rollback-journal lock deliberately stalls the reader for 1s.
    // A synchronous request implementation would also stall timers and /ping.
    db.exec('BEGIN EXCLUSIVE');
    const start = performance.now();
    const pending = app.request('/admin');
    await delay(100);
    assert.ok(performance.now() - start < 700, 'HTTP thread must not wait for SQLite');
    assert.equal((await app.request('/ping')).status, 200);
    assert.equal((await pending).status, 503);
    assert.ok(performance.now() - start >= 900, 'fixture must actually stall the SQLite read');
    db.exec('ROLLBACK');
    const retry = performance.now();
    assert.equal((await app.request('/admin')).status, 503);
    assert.ok(performance.now() - retry < 300, 'failed scans have a cooldown');
  } finally {
    if (db.isTransaction) db.exec('ROLLBACK');
    reader.close(); db.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('monitoring rechecks sessions after asynchronous reads and removes deleted or renamed cached identities', async () => {
  const f = fixture();
  try {
    const original = f.registry.matchingV3Monitoring.bind(f.registry);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.registry.matchingV3Monitoring = async v => { const result = await original(v); await gate; return result; };
    const pending = f.app.request('/api/matching-v3/admin', { headers: f.headers });
    await original(version(f.s));
    f.registry.deleteSession(f.token);
    release();
    assert.equal((await pending).status, 401);
    f.registry.matchingV3Monitoring = original;
    const headers = { Cookie: `urtube_session=${f.registry.createSession(f.registry.userByHandle('monitoradmin')!)}` };
    f.registry.renameUser('monitorviewer', 'renamedviewer');
    const renamed = await (await f.app.request('/api/matching-v3/admin', { headers })).json() as { users: { handle: string }[] };
    assert.ok(renamed.users.some((user: { handle: string }) => user.handle === 'renamedviewer'));
    assert.ok(!renamed.users.some((user: { handle: string }) => user.handle === 'monitorviewer'));
    f.registry.deleteUser('renamedviewer');
    const deleted = await (await f.app.request('/api/matching-v3/admin', { headers })).json() as { users: unknown[] };
    assert.equal(deleted.users.length, 1);
  } finally { f.close(); }
});

test('closing monitoring rejects an in-flight reader and prevents future work', async () => {
  const f = fixture();
  try {
    const pending = f.reader.read(version(f.s));
    const rejected = assert.rejects(pending, /Monitoring closed/);
    f.reader.close();
    await rejected;
    await assert.rejects(f.reader.read(version(f.s)), /Monitoring closed/);
  } finally { f.close(); }
});


test("concurrent profile versions do not reuse each other's summaries", async () => {
  const f = fixture();
  const versions: string[] = [];
  const reader = new AdminMonitoring(':memory:', v => { versions.push(v); return readAdminSnapshot(f.db, v); });
  try {
    await Promise.all([reader.read('old'), reader.read('new')]);
    assert.deepEqual(versions, ['old', 'new']);
  } finally { reader.close(); f.close(); }
});
