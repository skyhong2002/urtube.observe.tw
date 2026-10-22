import assert from 'node:assert/strict';
import test from 'node:test';
import { completeGoogleLogin, loginNonce, loginStateCookie, sameSitePath } from '../src/auth.js';
import { config } from '../src/config.js';
import { createApp } from '../src/index.js';
import { UserRegistry } from '../src/users.js';

test('Google callback rejects a state that was not issued to this browser', async () => {
  const registry = new UserRegistry(':memory:');
  const previous = { ...config.login };
  try {
    config.login.googleClientId = 'binding-client';
    config.login.googleClientSecret = 'binding-secret';
    const app = createApp(registry);

    // Attacker starts their own login and keeps the state for a victim.
    const attacker = await app.request('/auth/google');
    const state = new URL(attacker.headers.get('location')!).searchParams.get('state')!;
    const attackerCookie = attacker.headers.get('set-cookie')!;
    assert.match(attackerCookie, /urtube_login_state_[a-f0-9]{32}=/);
    assert.match(attackerCookie, /HttpOnly/i);

    const victim = await app.request(`/auth/google/callback?code=c&state=${encodeURIComponent(state)}`);
    assert.equal(victim.status, 400);
    const otherBrowser = await app.request(`/auth/google/callback?code=c&state=${encodeURIComponent(state)}`, {
      headers: { cookie: 'urtube_login_state=someone-else' },
    });
    assert.equal(otherBrowser.status, 400);
    assert.ok(registry.consumeLoginState(state).valid, 'rejected callbacks do not burn the real state');
  } finally {
    Object.assign(config.login, previous);
    registry.close();
  }
});

test('post-login destinations stay on this site', () => {
  for (const next of ['/account', '/matches?page=2#top', '/extension-setup']) {
    assert.equal(sameSitePath(next), next);
  }
  for (const next of ['//evil.example', '/\\evil.example', '/\\/evil.example', 'https://evil.example/', 'javascript:alert(1)', '',
    '/a/..//evil.example', '/a/%2e%2e//evil.example', '/\t/evil.example', '/\n/evil.example', '/account\u0000']) {
    assert.equal(sameSitePath(next), '', next);
  }
  for (const next of ['/a/../account', '/%2Fexample.invalid', '/matches?range=all#details']) {
    assert.equal(new URL(sameSitePath(next), config.publicBaseUrl).origin, new URL(config.publicBaseUrl).origin);
  }
});

test('Google identity claims are bound to issuer, client, lifetime and login nonce', async () => {
  const registry = new UserRegistry(':memory:');
  const previous = { ...config.login };
  try {
    config.login.googleClientId = 'claims-fixture';
    const valid = (state: string) => ({ sub: 'synthetic-sub', iss: 'https://accounts.google.com',
      aud: 'claims-fixture', nonce: loginNonce(state), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
    const invalid = [
      { iss: 'https://wrong.invalid' }, { iss: ['https://accounts.google.com'] }, { aud: 'another-client' }, { aud: ['claims-fixture', 'other'] },
      { azp: 'other' }, { exp: 0 }, { exp: '9999999999' }, { iat: Date.now() / 1000 + 3600 },
      { nonce: 'another-login' }, { nonce: undefined }, { sub: {} }, { sub: '' },
    ];
    for (const overrides of invalid) {
      const state = registry.createLoginState('/account');
      const payload = Buffer.from(JSON.stringify({ ...valid(state), ...overrides })).toString('base64url');
      await assert.rejects(completeGoogleLogin(registry, 'code', state,
        (async () => Response.json({ id_token: `header.${payload}.signature` })) as typeof fetch), /identity claims/);
      assert.equal(registry.consumeLoginState(state).valid, false, 'invalid tokens cannot replay their consumed state');
    }
    const state = registry.createLoginState('/account');
    const payload = Buffer.from(JSON.stringify({ ...valid(state), aud: ['claims-fixture', 'other'], azp: 'claims-fixture' })).toString('base64url');
    const fetcher = (async (_input, init) => {
      assert.equal(init?.redirect, 'error'); assert.ok(init?.signal);
      return Response.json({ id_token: `header.${payload}.signature` });
    }) as typeof fetch;
    assert.equal((await completeGoogleLogin(registry, 'code', state, fetcher)).sub, 'synthetic-sub');
    await assert.rejects(completeGoogleLogin(registry, 'code', state, fetcher), /state is invalid/);
  } finally { Object.assign(config.login, previous); registry.close(); }
});

test('malformed Google responses fail without exposing upstream data and cannot replay state', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    for (const body of [null, {}, { error: 'synthetic-private-upstream-detail' }]) {
      const state = registry.createLoginState();
      await assert.rejects(completeGoogleLogin(registry, 'synthetic-code', state,
        (async () => Response.json(body)) as typeof fetch), error => error instanceof Error && error.message === 'Google token exchange failed');
      assert.equal(registry.consumeLoginState(state).valid, false);
    }
    for (const claims of [null, [], 'invalid', 123]) {
      const state = registry.createLoginState();
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      await assert.rejects(completeGoogleLogin(registry, 'synthetic-code', state,
        (async () => Response.json({ id_token: `header.${payload}.signature` })) as typeof fetch), /identity claims/);
      assert.equal(registry.consumeLoginState(state).valid, false);
    }
  } finally { registry.close(); }
});

test('parallel login tabs survive cancellation and success clears only its own cookie', async () => {
  const registry = new UserRegistry(':memory:');
  const previous = { ...config.login }, originalFetch = globalThis.fetch;
  try {
    config.login.googleClientId = 'tabs-fixture'; config.login.googleClientSecret = 'synthetic-secret';
    const user = registry.createUser('login-tabs', 'Synthetic login');
    registry.linkGoogle(user.handle, 'synthetic-tab-sub', '');
    const app = createApp(registry);
    const first = await app.request('/auth/google');
    const second = await app.request('/auth/google');
    const a = new URL(first.headers.get('location')!).searchParams;
    const b = new URL(second.headers.get('location')!).searchParams;
    assert.notEqual(loginStateCookie(a.get('state')!), loginStateCookie(b.get('state')!));
    assert.equal(b.get('nonce'), loginNonce(b.get('state')!));
    const cookie = [first, second].map(response => response.headers.get('set-cookie')!.split(';')[0]).join('; ');
    const cancelled = await app.request(`/auth/google/callback?error=access_denied&state=${a.get('state')}`, { headers: { cookie } });
    assert.equal(cancelled.status, 302);
    assert.ok(cancelled.headers.get('set-cookie')!.includes(loginStateCookie(a.get('state')!)));
    assert.ok(!cancelled.headers.get('set-cookie')!.includes(loginStateCookie(b.get('state')!)));
    assert.equal(registry.consumeLoginState(a.get('state')!).valid, false);
    globalThis.fetch = (async () => {
      const claims = { iss: 'accounts.google.com', aud: 'tabs-fixture', nonce: b.get('nonce'),
        sub: 'synthetic-tab-sub', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
      return Response.json({ id_token: `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature` });
    }) as typeof fetch;
    const callback = `/auth/google/callback?code=synthetic-code&state=${b.get('state')}`;
    const success = await app.request(callback, { headers: { cookie } });
    assert.equal(success.status, 302);
    assert.match(success.headers.get('set-cookie')!, /urtube_session=/);
    assert.equal((await app.request(callback, { headers: { cookie } })).status, 400);
  } finally { globalThis.fetch = originalFetch; Object.assign(config.login, previous); registry.close(); }
});
