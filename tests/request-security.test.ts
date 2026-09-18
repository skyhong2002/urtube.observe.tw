import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import { createApp } from '../src/index.js';
import { createIngestApp } from '../src/ingest.js';
import { UserRegistry } from '../src/users.js';
import { completeGoogleLogin, safeLoginNext } from '../src/auth.js';
import { PayloadTooLarge, readLimitedBody } from '../src/request-security.js';
import { settings } from '../src/matching-v3/model.js';

const origin = new URL(config.publicBaseUrl).origin;
const claims = (overrides = {}) => ({ iss: 'https://accounts.google.com', aud: config.login.googleClientId,
  exp: Date.now() / 1000 + 300, sub: 'security-test-subject', email: 'synthetic@example.invalid', ...overrides });
const tokenResponse = (value: unknown) => Response.json({ id_token: `header.${Buffer.from(JSON.stringify(value)).toString('base64url')}.signature` });

function streamRequest(chunks: Uint8Array[], headers: RequestInit['headers'] = {}, path = '/upload') {
  let reads = 0, cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { if (reads < chunks.length) controller.enqueue(chunks[reads++]); else controller.close(); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const request = new Request(origin + path, { method: 'POST', headers, body: stream, duplex: 'half' } as RequestInit);
  return { request, state: () => ({ reads, cancelled }) };
}

test('body reader counts actual bytes, cancels at the boundary and ignores misleading lengths', async () => {
  for (const length of [undefined, '1', 'garbage']) {
    const streamed = streamRequest([new Uint8Array(6), new Uint8Array(5), new Uint8Array(99)], length === undefined ? {} : { 'content-length': length });
    await assert.rejects(readLimitedBody(streamed.request, 10), PayloadTooLarge);
    assert.deepEqual(streamed.state(), { reads: 2, cancelled: true });
  }
  const exact = streamRequest([new Uint8Array([1, 2]), new Uint8Array([3])]);
  assert.deepEqual([...await readLimitedBody(exact.request, 3)], [1, 2, 3]);
  const declared = streamRequest([new Uint8Array(100)], { 'content-length': '100' });
  await assert.rejects(readLimitedBody(declared.request, 10), PayloadTooLarge);
  assert.deepEqual(declared.state(), { reads: 0, cancelled: true });
});

test('ingest authorizes before reading and limits every payload using actual stream bytes', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('security-ingest', 'Fixture');
    const app = createIngestApp(registry);
    const unauthorized = streamRequest([new Uint8Array(20_000)], {}, '/api/ingest/youtube/capture');
    assert.equal((await app.request(unauthorized.request)).status, 401);
    assert.equal(unauthorized.state().reads, 0);
    for (const [route, limit] of [['capture', 16], ['progress', 96], ['backfill', 256], ['history', 256]] as const) {
      const streamed = streamRequest([new Uint8Array(limit * 1024), new Uint8Array(1), new Uint8Array(1)], {
        authorization: `Bearer ${user.captureToken}`, 'content-type': 'application/json', 'content-length': '1',
      }, '/api/ingest/youtube/' + route);
      assert.equal((await app.request(streamed.request)).status, 413, route);
      assert.deepEqual(streamed.state(), { reads: 2, cancelled: true });
    }
    const chunk = new Uint8Array(1024 * 1024);
    const takeout = streamRequest(Array(102).fill(chunk), {
      authorization: `Bearer ${user.captureToken}`, 'content-type': 'application/zip',
    }, '/api/ingest/youtube/takeout');
    assert.equal((await app.request(takeout.request)).status, 413);
    assert.deepEqual(takeout.state(), { reads: 101, cancelled: true });
    assert.equal(registry.repositoryFor(user).youtubeCounts().watches, 0);
  } finally { registry.close(); }
});

test('browser uploads and profile bodies reject oversized streams before parsing', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('security-upload', 'Fixture');
    const cookie = `urtube_session=${registry.createSession(user)}`;
    const app = createApp(registry);
    const chunk = new Uint8Array(1024 * 1024);
    const upload = streamRequest(Array(103).fill(chunk), { cookie, origin, 'content-type': 'multipart/form-data; boundary=fixture', 'content-length': '1' }, '/account/takeout');
    assert.equal((await app.request(upload.request)).status, 413);
    assert.deepEqual(upload.state(), { reads: 102, cancelled: true });
    const form = streamRequest([new Uint8Array(100_001), new Uint8Array(1)], { cookie, origin, 'content-type': 'application/x-www-form-urlencoded', 'content-length': '1' }, '/account/profile');
    assert.equal((await app.request(form.request)).status, 413);
    assert.deepEqual(form.state(), { reads: 1, cancelled: true });
    const v3 = createApp(registry, { matchingV3: { settings: { ...settings({}), enabled: true }, compute: {} as never } });
    const preference = streamRequest([new Uint8Array(32 * 1024 + 1), new Uint8Array(1)], { cookie, origin, 'content-type': 'application/json', 'content-length': '1' }, '/api/matching-v3/preferences');
    assert.equal((await v3.request(preference.request)).status, 413);
    assert.deepEqual(preference.state(), { reads: 1, cancelled: true });
  } finally { registry.close(); }
});

test('all browser writes reject cross-origin, opaque and missing origins without consuming the session', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('security-origin', 'Fixture');
    const session = registry.createSession(user);
    const cookie = `urtube_session=${session}`;
    const app = createApp(registry);
    for (const headers of [{}, { origin: 'null' }, { origin: 'https://foreign.invalid', 'sec-fetch-site': 'same-site' },
      { origin: origin + '.foreign.invalid' }, { referer: 'https://foreign.invalid/account' },
      { origin, 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) {
      for (const path of ['/account/visibility', '/account/matching', '/account/export', '/account/delete', '/account/rotate', '/onboarding', '/signup', '/logout', '/extension-setup/token', '/matches/request']) {
        const response = await app.request(path, { method: 'POST', headers: { cookie, ...headers }, body: 'dashboardPublic=1' });
        assert.equal(response.status, 403, path);
      }
    }
    assert.equal(registry.userByHandle(user.handle)!.dashboardPublic, false);
    assert.equal(registry.userBySession(session)!.id, user.id);
    for (const proof of [{ origin }, { referer: origin + '/account' }, { 'sec-fetch-site': 'same-origin' }]) {
      assert.equal((await app.request('/account/visibility', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', ...proof }, body: 'dashboardPublic=1' })).status, 302);
    }
    assert.equal(registry.userByHandle(user.handle)!.dashboardPublic, true);
  } finally { registry.close(); }
});

test('Google login is bound to the initiating browser, single use, cancellable and host-only on HTTPS', async () => {
  const registry = new UserRegistry(':memory:');
  const previous = { ...config.login }, previousBase = config.publicBaseUrl;
  try {
    config.login.googleClientId = 'security-client'; config.login.googleClientSecret = 'synthetic-secret';
    config.publicBaseUrl = 'https://urtube.example.invalid';
    const user = registry.createUser('security-login', 'Fixture', { googleSub: 'security-test-subject' });
    let exchanges = 0;
    const app = createApp(registry, { googleFetch: (async () => { exchanges++; return tokenResponse(claims()); }) as typeof fetch });
    const start = await app.request('/auth/google?next=%2Faccount');
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const setCookie = start.headers.get('set-cookie')!;
    assert.match(setCookie, /^__Host-urtube_login=/);
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=600']) assert.ok(setCookie.includes(attribute));
    assert.ok(!setCookie.includes('Domain='));
    const cookie = setCookie.split(';')[0];
    const callback = `/auth/google/callback?code=synthetic-code&state=${state}`;
    for (const headers of [{}, { cookie: '__Host-urtube_login=wrong-browser' }]) {
      assert.equal((await app.request(callback, { headers })).status, 400);
    }
    assert.equal(exchanges, 0);
    const success = await app.request(callback, { headers: { cookie } });
    assert.equal(success.status, 302);
    assert.equal(success.headers.get('location'), '/account');
    assert.match(success.headers.get('set-cookie')!, /urtube_session=/);
    assert.match(success.headers.get('set-cookie')!, /Max-Age=0/);
    assert.equal(exchanges, 1);
    assert.equal((await app.request(callback, { headers: { cookie } })).status, 400);
    assert.equal(exchanges, 1);
    assert.equal(registry.userByGoogleSub('security-test-subject')!.id, user.id);
    const cancelledStart = await app.request('/auth/google');
    const cancelledState = new URL(cancelledStart.headers.get('location')!).searchParams.get('state')!;
    const cancelled = await app.request(`/auth/google/callback?error=access_denied&state=${cancelledState}`, { headers: { cookie: cancelledStart.headers.get('set-cookie')!.split(';')[0] } });
    assert.equal(cancelled.status, 302);
    assert.match(cancelled.headers.get('set-cookie')!, /Max-Age=0/);
    assert.equal(registry.consumeLoginState(cancelledState).valid, false);
  } finally { Object.assign(config.login, previous); config.publicBaseUrl = previousBase; registry.close(); }
});

test('Google login verifies issuer, audience, expiry and subject; failed exchanges do not echo upstream data', async () => {
  const registry = new UserRegistry(':memory:');
  const previous = config.login.googleClientId;
  try {
    config.login.googleClientId = 'security-client';
    for (const invalid of [{ iss: 'https://foreign.invalid' }, { aud: 'different-client' }, { exp: 1 }, { exp: '99999999999' },
      { sub: 123 }, { sub: '' }, { aud: ['security-client', 'another-client'] }, { azp: 'different-client' }]) {
      await assert.rejects(completeGoogleLogin(registry, 'code', registry.createLoginState(), (async () => tokenResponse(claims(invalid))) as typeof fetch), /Invalid Google identity token/);
    }
    for (const valid of [{}, { iss: 'accounts.google.com' }, { aud: ['security-client', 'another-client'], azp: 'security-client' }]) {
      assert.equal((await completeGoogleLogin(registry, 'code', registry.createLoginState(), (async () => tokenResponse(claims(valid))) as typeof fetch)).sub, 'security-test-subject');
    }
    await assert.rejects(completeGoogleLogin(registry, 'code', registry.createLoginState(), (async (_input, init) => {
      assert.equal(init?.redirect, 'error'); assert.ok(init?.signal); assert.equal(init.signal.aborted, false);
      return Response.json({ error: 'synthetic-sensitive-upstream-detail' }, { status: 400 });
    }) as typeof fetch), error => error instanceof Error && error.message === 'Google token exchange failed');
  } finally { config.login.googleClientId = previous; registry.close(); }
});

test('only the latest browser login can finish and expired states cannot create sessions', async t => {
  const registry = new UserRegistry(':memory:');
  const previous = { ...config.login };
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  try {
    config.login.googleClientId = 'security-client'; config.login.googleClientSecret = 'synthetic-secret';
    let exchanges = 0;
    const app = createApp(registry, { googleFetch: (async () => { exchanges++; return tokenResponse(claims()); }) as typeof fetch });
    const start = async () => {
      const response = await app.request('/auth/google');
      return { cookie: response.headers.get('set-cookie')!.split(';')[0], state: new URL(response.headers.get('location')!).searchParams.get('state')! };
    };
    const first = await start(), latest = await start();
    const outdated = await app.request(`/auth/google/callback?code=code&state=${first.state}`, { headers: { cookie: latest.cookie } });
    assert.equal(outdated.status, 400);
    assert.equal(outdated.headers.get('set-cookie'), null, 'an unrelated callback must not clear the latest login');
    const complete = await app.request(`/auth/google/callback?code=code&state=${latest.state}`, { headers: { cookie: latest.cookie } });
    assert.equal(complete.status, 302);
    assert.match(complete.headers.get('set-cookie')!, /urtube_signup=/);
    assert.equal(exchanges, 1);
    const expired = await start();
    t.mock.timers.tick(600_001);
    const rejected = await app.request(`/auth/google/callback?code=code&state=${expired.state}`, { headers: { cookie: expired.cookie } });
    assert.equal(rejected.status, 400);
    assert.doesNotMatch(rejected.headers.get('set-cookie')!, /urtube_(?:session|signup)=/);
    assert.equal(exchanges, 1);
  } finally { Object.assign(config.login, previous); registry.close(); }
});

test('token exchange timeout aborts the operation and leaves the login state consumed', async t => {
  const registry = new UserRegistry(':memory:');
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => { assert.equal(milliseconds, 10_000); return timeout(1); });
  try {
    const state = registry.createLoginState();
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      await assert.rejects(completeGoogleLogin(registry, 'code', state, (async (_input, init) => new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
      })) as typeof fetch), { name: 'TimeoutError' });
    } finally { clearTimeout(keepAlive); }
    assert.equal(registry.consumeLoginState(state).valid, false);
  } finally { registry.close(); }
});

test('login continuation remains a relative path even after URL normalization', () => {
  for (const unsafe of ['https://foreign.invalid', '//foreign.invalid', '/\\foreign.invalid', '/\t/foreign.invalid', '/a/..//foreign.invalid', '/\n/foreign.invalid', ' /account']) assert.equal(safeLoginNext(unsafe), '');
  for (const safe of ['/account', '/matches?range=all#details', '/%2Fforeign.invalid', '/a/../account']) {
    const target = safeLoginNext(safe);
    assert.ok(target.startsWith('/'));
    assert.equal(new URL(target, origin).origin, origin);
  }
});

test('personalized pages and failures are never cached; public probes omit archive data and raw errors', async t => {
  const registry = new UserRegistry(':memory:');
  try {
    const owner = registry.ensureDefaultUser(), user = registry.createUser('security-cache', 'Fixture');
    const app = createApp(registry);
    const pending = registry.createPendingSignup('pending-sub', 'synthetic-private@example.invalid');
    const session = registry.createSession(user);
    for (const [path, cookie] of [['/signup', `urtube_signup=${pending}`], ['/extension-setup', `urtube_session=${session}`], ['/account', ''], ['/auth/google/callback', '']]) {
      const response = await app.request(path, { headers: { cookie } });
      assert.equal(response.headers.get('cache-control'), 'private, no-store', path);
    }
    const repository = registry.repositoryFor(owner);
    repository.setYoutubeSyncState('last_error', 'synthetic-internal-detail');
    t.mock.method(repository, 'youtubeCounts', () => { throw new Error('Aggregates must not run in health probes'); });
    const health = await app.request('/healthz');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'healthy', service: 'urtube' });
    const readiness = await (await app.request('/readyz')).json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(readiness).sort(), ['checks', 'status']);
    assert.equal((await app.request('/status')).status, 401);
    assert.equal((await app.request('/status', { headers: { cookie: `urtube_session=${session}` } })).status, 403);
    t.mock.restoreAll();
    const detailed = await app.request('/status', { headers: { cookie: `urtube_session=${registry.createSession(owner)}` } });
    assert.equal(detailed.status, 200);
    assert.match(await detailed.text(), /synthetic-internal-detail/);
    t.mock.method(repository, 'checkReadable', () => { throw new Error('synthetic-private-database-path'); });
    const unhealthy = await app.request('/healthz');
    assert.equal(unhealthy.status, 503);
    assert.deepEqual(await unhealthy.json(), { status: 'unhealthy', service: 'urtube' });
    assert.equal((await (await app.request('/readyz')).json() as { checks: { databases: boolean } }).checks.databases, false);
  } finally { registry.close(); }
});
