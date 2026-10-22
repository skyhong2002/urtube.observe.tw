import assert from 'node:assert/strict';
import test from 'node:test';
import { sameSitePath } from '../src/auth.js';
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
    assert.match(attackerCookie, /urtube_login_state=/);
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
  for (const next of ['//evil.example', '/\\evil.example', '/\\/evil.example', 'https://evil.example/', 'javascript:alert(1)', '']) {
    assert.equal(sameSitePath(next), '', next);
  }
});
