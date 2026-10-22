import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import { createApp } from '../src/index.js';
import { settings } from '../src/matching-v3/model.js';
import { UserRegistry } from '../src/users.js';

const origin = new URL(config.publicBaseUrl).origin;

test('site-wide origin checks protect consent and session writes before body handling', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('origin-fixture', 'Synthetic');
    const session = registry.createSession(user);
    const cookie = `urtube_session=${session}`;
    const app = createApp(registry);
    for (const headers of [{}, { origin: 'null' }, { origin: 'https://foreign.invalid' }, { origin, 'sec-fetch-site': 'cross-site' }]) {
      for (const path of ['/account/visibility', '/account/matching', '/account/reference-population', '/account/export', '/account/delete',
        '/account/rotate', '/account/takeout', '/onboarding', '/signup', '/logout', '/extension-setup/token', '/matches/request']) {
        const response = await app.request(path, {
          method: 'POST', headers: { cookie, ...headers, 'content-type': 'application/x-www-form-urlencoded' },
          body: 'dashboardPublic=1&matchingOptIn=1&referenceOptIn=1',
        });
        assert.equal(response.status, 403, path);
        assert.deepEqual(await response.json(), { error: 'invalid_origin' });
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
      }
    }
    assert.equal(registry.userByHandle(user.handle)!.dashboardPublic, false);
    assert.equal(registry.userByHandle(user.handle)!.matchingOptIn, false);
    assert.equal(registry.userBySession(session)!.id, user.id);
    for (const proof of [{ origin }, { referer: origin + '/account' }, { 'sec-fetch-site': 'same-origin' }]) {
      assert.equal((await app.request('/account/visibility', {
        method: 'POST', headers: { cookie, ...proof, 'content-type': 'application/x-www-form-urlencoded' }, body: 'dashboardPublic=1',
      })).status, 302);
    }
    assert.equal(registry.userByHandle(user.handle)!.dashboardPublic, true);
  } finally { registry.close(); }
});

test('site body guards enforce actual lengths while retaining the current form and upload limits', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('body-fixture', 'Synthetic');
    const cookie = `urtube_session=${registry.createSession(user)}`;
    const app = createApp(registry, { matchingV3: { settings: settings({ MATCHING_V3_ENABLED: 'true' }), compute: {
      cluster: async () => { throw new Error('unexpected compute'); },
      compare: async () => { throw new Error('unexpected compute'); },
    } } });
    for (const [path, maxSize, type] of [
      ['/account/profile', 100_000, 'application/x-www-form-urlencoded'],
      ['/account/visibility', 1024 * 1024, 'application/x-www-form-urlencoded'],
      ['/account/takeout', 101 * 1024 * 1024, 'multipart/form-data; boundary=synthetic'],
      ['/api/matching-v3/preferences', 32 * 1024, 'application/json'],
    ] as const) {
      let bytes = 0, cancelled = false;
      const chunk = new Uint8Array(1024);
      const body = new ReadableStream<Uint8Array>({
        pull(controller) { bytes += chunk.byteLength; controller.enqueue(chunk); },
        cancel() { cancelled = true; },
      }, { highWaterMark: 0 });
      const response = await app.request(path, {
        method: 'POST', headers: { cookie, origin, 'content-type': type, 'content-length': '1' }, body, duplex: 'half',
      } as RequestInit);
      assert.equal(response.status, 413, path);
      assert.equal(cancelled, true, path);
      assert.ok(bytes > maxSize && bytes <= maxSize + 1024, path);
      if (path === '/account/takeout') assert.match(await response.text(), /<html/i, 'retains the account-page upload error');
    }
  } finally { registry.close(); }
});

test('site privacy headers protect pending identities, redirects and authentication failures', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('cache-fixture', 'Synthetic');
    const cookie = `urtube_session=${registry.createSession(user)}`;
    const pending = registry.createPendingSignup('synthetic-pending-sub', 'synthetic@example.invalid');
    const app = createApp(registry);
    for (const [path, headers] of [
      ['/signup', { cookie: `urtube_signup=${pending}` }], ['/extension-setup', { cookie }],
      ['/account', {}], ['/auth/google/callback', {}], ['/logout', { cookie }],
    ] as const) {
      assert.equal((await app.request(path, { headers })).headers.get('cache-control'), 'private, no-store', path);
    }
  } finally { registry.close(); }
});

test('public health probes omit operational details while status requires an allowlisted session', async t => {
  const registry = new UserRegistry(':memory:');
  try {
    const owner = registry.ensureDefaultUser();
    const admin = registry.createUser('status-admin-fixture', 'Synthetic admin');
    const viewer = registry.createUser('status-viewer-fixture', 'Synthetic viewer');
    const s = settings({ MATCHING_V3_ADMIN_HANDLES: admin.storageName });
    const app = createApp(registry, { matchingV3: { settings: s, compute: {} as never } });
    const repository = registry.repositoryFor(owner);
    repository.setYoutubeSyncState('last_error', 'synthetic-private-operational-detail');
    for (const [user, status] of [[null, 401], [owner, 403], [viewer, 403], [admin, 200]] as const) {
      const response = await app.request('/status', { headers: user ? { cookie: `urtube_session=${registry.createSession(user)}` } : {} });
      assert.equal(response.status, status);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      if (status === 200) assert.match(await response.text(), /synthetic-private-operational-detail/);
    }
    const session = registry.createSession(admin);
    registry.renameUser(admin.handle, 'renamed-status-admin');
    assert.equal((await app.request('/status', { headers: { cookie: `urtube_session=${session}` } })).status, 200,
      'admin allowlisting uses immutable storage identity');
    const emptyAllowlist = createApp(registry, { matchingV3: { settings: settings({}), compute: {} as never } });
    assert.equal((await emptyAllowlist.request('/status', { headers: { cookie: `urtube_session=${session}` } })).status, 403);

    t.mock.method(repository, 'youtubeCounts', () => { throw new Error('health must not aggregate archives'); });
    const health = await app.request('/healthz');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'healthy', service: 'urtube' });
    const readiness = await app.request('/readyz');
    const ready = await readiness.json() as { status: string; checks: Record<string, boolean> };
    assert.deepEqual(Object.keys(ready).sort(), ['checks', 'status']);
    assert.ok(Object.values(ready.checks).every(value => typeof value === 'boolean'));
    assert.equal(readiness.status, Object.values(ready.checks).every(Boolean) ? 200 : 503);
    t.mock.method(repository, 'ping', () => { throw new Error('synthetic-private-database-path'); });
    const unhealthy = await app.request('/healthz');
    assert.equal(unhealthy.status, 503);
    assert.deepEqual(await unhealthy.json(), { status: 'unhealthy', service: 'urtube' });
    const notReady = await app.request('/readyz');
    assert.equal(notReady.status, 503);
    assert.equal((await notReady.json() as { checks: { databases: boolean } }).checks.databases, false);
  } finally { registry.close(); }
});
