import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../src/config.js';
import { createApp } from '../src/index.js';
import { writeOpsStatus } from '../src/ops-status.js';
import { UserRegistry } from '../src/users.js';
import { settings } from '../src/matching-v3/model.js';
import { computeClient } from '../src/matching-v3/compute.js';
import { MatchingStore } from '../src/matching-v3/store.js';

test('queue-age migration keeps old jobs and their unknown age without clearing caches', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);
      INSERT INTO users VALUES(1);
      CREATE TABLE matching_v3_jobs(user_id INTEGER PRIMARY KEY, fingerprint TEXT, version TEXT,
        state TEXT, token TEXT, lease_until INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0,
        retry_at INTEGER DEFAULT 0, error TEXT);
      INSERT INTO matching_v3_jobs(user_id,fingerprint,version,state) VALUES(1,'old-source','v1','queued');`);
    const store = new MatchingStore(db);
    db.prepare('INSERT INTO matching_v3_cache VALUES(?,?,?)').run('retained-fixture', JSON.stringify({ preserved: true }), 1);
    assert.equal(store.readiness().queued, 1);
    assert.equal(store.readiness().queuedAgeUnknown, 1);
    assert.equal(store.readiness().oldestQueuedAgeMs, null);
    store.schedule(1, 'old-source', 'v1');
    assert.equal(store.readiness().oldestQueuedAgeMs, null, 'unchanged sources do not restart or invent an old queue age');
    store.schedule(1, 'new-source', 'v1');
    assert.equal(store.readiness().queuedAgeUnknown, 0);
    assert.ok(store.readiness().oldestQueuedAgeMs! >= 0);
    assert.equal(db.prepare('SELECT count(*) count FROM matching_v3_cache').get()!.count, 1);
  } finally { db.close(); }
});

test('readiness requires the enabled matching worker and numeric lane, without exposing jobs or calling providers', async () => {
  const registry = new UserRegistry(':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'urtube-v3-ready-'));
  const previous = { directory: config.opsStatusDirectory, signup: config.signupEnabled };
  try {
    config.opsStatusDirectory = dir;
    config.signupEnabled = false;
    const now = new Date().toISOString();
    writeOpsStatus('worker', { running: true, heartbeatAt: now });
    writeOpsStatus('backup', { lastCompletedAt: now });
    const store = registry.matchingV3Store();
    const user = registry.createUser('synthetic-readiness', 'Synthetic');
    store.schedule(user.id, 'source', 'version');
    assert.equal(store.readiness().queued, 1);
    assert.ok(store.readiness().oldestQueuedAgeMs! >= 0);
    let computeReady = false;
    const app = createApp(registry, { matchingV3: { settings: settings({ MATCHING_V3_ENABLED: 'true' }), compute: {
      ready: async () => computeReady,
      cluster: async () => { throw new Error('readiness must not cluster'); },
      compare: async () => { throw new Error('readiness must not compare'); },
    } } });
    let response = await app.request('/readyz');
    assert.equal(response.status, 503);
    store.workerHeartbeat();
    response = await app.request('/readyz');
    const failed = await response.json() as any;
    assert.equal(failed.checks.matchingWorker, true);
    assert.equal(failed.checks.matchingCompute, false);
    computeReady = true;
    response = await app.request('/readyz');
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.doesNotMatch(text, /synthetic-readiness|source|version|token/);
    assert.equal(store.readiness(Date.now() + 121_000).worker, false);
    assert.equal(store.readiness(Date.now() - 1000).worker, false);
    // Retry preserves the original wait age and completed jobs leave the queue.
    const job = store.claim()!;
    store.defer(job, 'synthetic quota', false, Date.now() + 60_000);
    assert.equal(store.readiness().queued, 1);
    assert.ok(store.readiness().oldestQueuedAgeMs! >= 0);
  } finally {
    config.opsStatusDirectory = previous.directory;
    config.signupEnabled = previous.signup;
    registry.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('numeric readiness coalesces callers and rejects a mismatched service', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = (async (input, init) => {
      calls++;
      assert.equal(String(input), 'http://synthetic-compare.invalid/healthz');
      assert.ok(init?.signal);
      return Response.json({ status: 'ready', algorithm: 'compact-medoid-v1' });
    }) as typeof fetch;
    const s = settings({ MATCHING_V3_COMPARE_URL: 'http://synthetic-compare.invalid', MATCHING_V3_COMPUTE_TOKEN: 'synthetic-compute-token-32-characters' });
    const client = computeClient(s);
    assert.deepEqual(await Promise.all([client.ready!(), client.ready!(), client.ready!()]), [true, true, true]);
    assert.equal(calls, 1);
    globalThis.fetch = (async () => Response.json({ status: 'ready', algorithm: 'wrong' })) as typeof fetch;
    assert.equal(await computeClient(s).ready!(), false);
    globalThis.fetch = (async () => { throw new Error('synthetic offline'); }) as typeof fetch;
    assert.equal(await computeClient(s).ready!(), false);
  } finally { globalThis.fetch = original; }
});
