import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { config } from '../src/config.js';
import { createIngestApp } from '../src/ingest.js';
import { matchingRoutes } from '../src/matching-v3/routes.js';
import { settings } from '../src/matching-v3/model.js';
import { bodyLimit, PayloadTooLarge, privateResponses, readLimitedBody, sameOriginWrites } from '../src/request-security.js';
import { UserRegistry } from '../src/users.js';

const origin = new URL(config.publicBaseUrl).origin;

function streamRequest(chunks: Uint8Array[], headers: RequestInit['headers'] = {}, path = '/upload') {
  let reads = 0, cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { if (reads < chunks.length) controller.enqueue(chunks[reads++]); else controller.close(); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  return {
    request: new Request(origin + path, { method: 'POST', headers, body, duplex: 'half' } as RequestInit),
    state: () => ({ reads, cancelled }),
  };
}

test('body reader counts bytes and cancels oversized streams even with misleading lengths', async () => {
  for (const length of [undefined, '1', 'garbage']) {
    const streamed = streamRequest([new Uint8Array(6), new Uint8Array(5), new Uint8Array(99)], length === undefined ? {} : { 'content-length': length });
    await assert.rejects(readLimitedBody(streamed.request, 10), PayloadTooLarge);
    assert.deepEqual(streamed.state(), { reads: 2, cancelled: true });
    assert.equal(streamed.request.body!.locked, false);
  }
  const exact = streamRequest([new Uint8Array([1, 2]), new Uint8Array([3])]);
  assert.deepEqual([...await readLimitedBody(exact.request, 3)], [1, 2, 3]);
  const declared = streamRequest([new Uint8Array(100)], { 'content-length': '100' });
  await assert.rejects(readLimitedBody(declared.request, 10), PayloadTooLarge);
  assert.deepEqual(declared.state(), { reads: 0, cancelled: true });
});

test('oversized streams cannot delay rejection by leaving cancellation pending', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(11)); },
    cancel() { cancelled = true; return new Promise<void>(() => {}); },
  }, { highWaterMark: 0 });
  const request = new Request(origin + '/upload', { method: 'POST', body, duplex: 'half' } as RequestInit);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      assert.rejects(readLimitedBody(request, 10), PayloadTooLarge),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('waited for cancellation')), 1000); }),
    ]);
    assert.equal(cancelled, true);
    assert.equal(request.body!.locked, false);
  } finally { clearTimeout(timer); }
});

test('body middleware preserves parsing and error responses without exposing stream errors', async () => {
  const app = new Hono();
  app.use('*', bodyLimit({ maxSize: 10, onError: c => c.json({ error: 'fixture limit' }, 413) }));
  app.post('/upload', async c => c.text(await c.req.text()));
  assert.equal(await (await app.request('/upload', { method: 'POST', body: '小😀' })).text(), '小😀');
  const tooLarge = await app.request(streamRequest([new Uint8Array(11)], { 'content-length': '1' }).request);
  assert.equal(tooLarge.status, 413);
  assert.deepEqual(await tooLarge.json(), { error: 'fixture limit' });
  const body = new ReadableStream({ start(controller) { controller.error(new Error('synthetic-private-stream-detail')); } });
  const failed = await app.request('/upload', { method: 'POST', body, duplex: 'half' } as RequestInit);
  assert.equal(failed.status, 400);
  assert.deepEqual(await failed.json(), { error: 'Unable to read request body' });
});

test('session write guard rejects foreign, opaque and absent proof before reading a body', async () => {
  const app = new Hono();
  let writes = 0;
  app.use('*', sameOriginWrites(origin));
  app.all('*', c => { writes++; return c.text('ok'); });
  const invalid: Record<string, string>[] = [
    {}, { origin: 'null' }, { origin: 'https://foreign.invalid' }, { origin: origin + '.foreign.invalid' },
    { origin: origin + '/' }, { origin: origin + ' https://foreign.invalid' },
    { origin: 'null', referer: origin + '/account', 'sec-fetch-site': 'same-origin' },
    { referer: 'https://foreign.invalid/account', 'sec-fetch-site': 'same-origin' },
    { referer: '', 'sec-fetch-site': 'same-origin' }, { referer: 'invalid' },
    { origin, 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
  ];
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const headers of invalid) {
      const response = await app.request('/write', { method, headers });
      assert.equal(response.status, 403, `${method} ${JSON.stringify(headers)}`);
      assert.deepEqual(await response.json(), { error: 'invalid_origin' });
    }
  }
  assert.equal(writes, 0);
  const streamed = streamRequest([new Uint8Array(11)], { origin: 'https://foreign.invalid' });
  assert.equal((await app.request(streamed.request)).status, 403);
  assert.equal(streamed.state().reads, 0);
  await streamed.request.body!.cancel();
  for (const proof of [{ origin }, { referer: origin + '/account' }, { 'sec-fetch-site': 'same-origin' }]) {
    assert.equal((await app.request('/write', { method: 'POST', headers: proof })).status, 200);
  }
  for (const method of ['GET', 'HEAD', 'OPTIONS']) assert.equal((await app.request('/read', { method })).status, 200);
});

test('private responses cover pending identities, redirects and failures without disabling anonymous public caching', async () => {
  const app = new Hono();
  app.use('*', privateResponses());
  app.use('*', sameOriginWrites(origin));
  app.all('*', c => {
    c.header('Cache-Control', 'public, max-age=3600');
    return c.req.path === '/account' ? c.redirect('/signup') : c.text('fixture', 404);
  });
  for (const [path, cookie] of [
    ['/signup', ''], ['/auth/google/callback', ''], ['/extension-setup', ''], ['/account', ''],
    ['/api/matching-v3/admin', ''], ['/healthz', ''], ['/readyz', ''], ['/status', ''],
    ['/unknown', 'urtube_signup=synthetic'], ['/unknown', 'urtube_session=synthetic'],
    ['/unknown', 'lang=en; urtube_dash_id_1=synthetic'], ['/unknown', 'urtube_dash_old-handle=synthetic'],
  ]) {
    const response = await app.request(path, { headers: { cookie } });
    assert.equal(response.headers.get('cache-control'), 'private, no-store', path);
  }
  const rejected = await app.request('/account', { method: 'POST' });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get('cache-control'), 'private, no-store');
  assert.equal((await app.request('/public')).headers.get('cache-control'), 'public, max-age=3600');
});

test('ingest authenticates before reading and enforces each existing payload limit on actual bytes', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('security-ingest', 'Synthetic');
    const app = createIngestApp(registry);
    for (const [route, kib, error] of [
      ['capture', 16, 'Capture payload exceeds 16 KiB'],
      ['progress', 96, 'Progress payload exceeds 96 KiB'],
      ['backfill', 256, 'Backfill payload exceeds 256 KiB'],
      ['history', 256, 'History payload exceeds 256 KiB'],
      ['takeout', 100 * 1024, 'YouTube archive exceeds compressed size limit'],
    ] as const) {
      const path = '/api/ingest/youtube/' + route;
      const unauthorized = streamRequest([new Uint8Array(20_000)], {}, path);
      assert.equal((await app.request(unauthorized.request)).status, 401, route);
      assert.equal(unauthorized.state().reads, 0);
      await unauthorized.request.body!.cancel();
      // Reuse a 1 KiB chunk to exercise the 100 MiB ZIP boundary without a
      // giant fixture allocation. The rejected request never enters parsing.
      const chunks = Array<Uint8Array>(kib).fill(new Uint8Array(1024));
      const streamed = streamRequest([...chunks, new Uint8Array(1), new Uint8Array(1)], {
        authorization: `Bearer ${user.captureToken}`, 'content-type': route === 'takeout' ? 'application/zip' : 'application/json', 'content-length': '1',
      }, path);
      const response = await app.request(streamed.request);
      assert.equal(response.status, 413, route);
      assert.deepEqual(await response.json(), { error });
      assert.deepEqual(streamed.state(), { reads: kib + 1, cancelled: true });
    }
    assert.equal(registry.repositoryFor(user).youtubeCounts().watches, 0);
    assert.equal(registry.userByHandle(user.handle)!.dashboardPublic, false);
    assert.equal(registry.userByHandle(user.handle)!.matchingOptIn, false);
  } finally { registry.close(); }
});

test('matching limits run after session authorization and count an understated body length', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('security-match', 'Synthetic');
    const app = matchingRoutes(registry, settings({ MATCHING_V3_ENABLED: 'true' }), origin, {
      cluster: async () => { throw new Error('unexpected compute'); },
      compare: async () => { throw new Error('unexpected compute'); },
    });
    const path = '/api/matching-v3/preferences';
    const unauthorized = streamRequest([new Uint8Array(33 * 1024)], { origin }, path);
    assert.equal((await app.request(unauthorized.request)).status, 401);
    assert.equal(unauthorized.state().reads, 0);
    await unauthorized.request.body!.cancel();
    const streamed = streamRequest([new Uint8Array(32 * 1024), new Uint8Array(1), new Uint8Array(1)], {
      origin, cookie: `urtube_session=${registry.createSession(user)}`, 'content-type': 'application/json', 'content-length': '1',
    }, path);
    assert.equal((await app.request(streamed.request)).status, 413);
    assert.deepEqual(streamed.state(), { reads: 2, cancelled: true });
  } finally { registry.close(); }
});

function revokedDuringUpload(path: string, payload: string, headers: Record<string, string>, revoke: () => void, method = 'POST'): Request {
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(new TextEncoder().encode(payload));
      } else {
        revoke();
        controller.close();
      }
    },
  }, { highWaterMark: 0 });
  return new Request(origin + path, { method, headers, body, duplex: 'half' } as RequestInit);
}

for (const revoke of ['session', 'consent'] as const) test(`matching rechecks ${revoke} after receiving a streamed body`, async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('streamed-match', 'Synthetic');
    registry.setMatchingOptIn(user.handle, true);
    const session = registry.createSession(user);
    const store = registry.matchingV3Store();
    const app = matchingRoutes(registry, settings({ MATCHING_V3_ENABLED: 'true' }), origin);
    let preferencesAfterRevocation: ReturnType<typeof store.preferences> | undefined;
    const request = revokedDuringUpload('/api/matching-v3/preferences', JSON.stringify({ genres: ['Music'], topics: [] }),
      { origin, cookie: `urtube_session=${session}`, 'content-type': 'application/json' }, () => {
        if (revoke === 'session') registry.deleteSession(session);
        else registry.setMatchingOptIn(user.handle, false);
        preferencesAfterRevocation = store.preferences(user.id);
      }, 'PUT');
    const response = await app.request(request);
    assert.equal(response.status, revoke === 'session' ? 401 : 403);
    assert.deepEqual(store.preferences(user.id), preferencesAfterRevocation);
  } finally { registry.close(); }
});

for (const route of ['capture', 'progress', 'backfill', 'history', 'takeout']) test(`ingest rejects a capture token rotated during ${route} upload`, async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('streamed-ingest', 'Synthetic');
    const repository = registry.repositoryFor(user);
    const before = repository.youtubeCounts();
    const app = createIngestApp(registry);
    let replacementToken = '';
    const payload = JSON.stringify({
      sessionId: 'synthetic-streamed-watch-session',
      videoId: 'HIS00000000', title: 'Synthetic streamed watch', watchedAt: new Date().toISOString(),
      url: 'https://www.youtube.com/watch?v=HIS00000000', actualWatchedSeconds: 42, durationSeconds: 90,
    });
    const request = revokedDuringUpload('/api/ingest/youtube/' + route, payload,
    { authorization: `Bearer ${user.captureToken}`, 'content-type': route === 'takeout' ? 'application/zip' : 'application/json' },
    () => { replacementToken = registry.rotateTokens(user.handle).captureToken; });
    assert.equal((await app.request(request)).status, 401);
    assert.deepEqual(repository.youtubeCounts(), before);
    if (route === 'capture') {
      const accepted = await app.request('/api/ingest/youtube/capture', { method: 'POST', body: payload,
        headers: { authorization: `Bearer ${replacementToken}`, 'content-type': 'application/json' } });
      assert.equal(accepted.status, 201, 'the same valid watch is accepted with the replacement token');
      assert.equal(repository.youtubeCounts().watches, before.watches + 1);
    }
  } finally { registry.close(); }
});
