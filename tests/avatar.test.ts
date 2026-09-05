import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { completeGoogleLogin, googleLoginUrl } from '../src/auth.js';
import {
  AVATAR_FETCH_TIMEOUT_MS,
  AVATAR_MAX_BYTES,
  AvatarService,
  safeGoogleAvatarUrl,
  type AvatarImage,
} from '../src/avatars.js';
import { config } from '../src/config.js';
import { createApp } from '../src/index.js';
import { UserRegistry, type User } from '../src/users.js';
import { MATCHING_TAXONOMY } from '../src/youtube/matching.js';
import {
  REGISTRY_CRYSTAL_VERSION,
  type RegistryMatchingCrystal,
} from '../src/youtube/registry-crystal.js';

function matchingCrystal(): RegistryMatchingCrystal {
  return {
    kind: 'matching',
    version: REGISTRY_CRYSTAL_VERSION,
    taxonomyVersion: MATCHING_TAXONOMY.version,
    generatedAt: new Date().toISOString(),
    windowDays: 90,
    data: {
      watchEvents: 300,
      uniqueVideos: 120,
      estimatedWatchSeconds: 180_000,
      activeDays: 30,
      topicCoverage: 1,
    },
    topics: [{ key: 'music', name: 'Music', share: 1 }],
    channels: [{ key: 'shared-channel', name: 'Shared Channel', share: 1 }],
  };
}

function enableMatching(registry: UserRegistry, user: User): void {
  registry.upsertMatchingCrystal(user, matchingCrystal());
  registry.setMatchingPreferences(user.handle, true, 'topics_and_channel');
}

function pngAvatar(source: AvatarImage['source'] = 'fallback'): AvatarImage {
  return { body: new Uint8Array([137, 80, 78, 71]), contentType: 'image/png', source };
}

test('existing registries gain the nullable avatar column without losing users', () => {
  const directory = mkdtempSync(join(tmpdir(), 'urtube-avatar-migration-'));
  const registryPath = join(directory, 'registry.sqlite');
  try {
    const original = new UserRegistry(registryPath, join(directory, 'users'));
    original.createUser('migration-user', 'Migration User', {
      googleSub: 'migration-google-sub', googleEmail: 'migration@example.test',
    });
    original.close();

    const legacy = new DatabaseSync(registryPath);
    legacy.exec('ALTER TABLE users DROP COLUMN avatar_url');
    legacy.close();

    const migrated = new UserRegistry(registryPath, join(directory, 'users'));
    const user = migrated.userByHandle('migration-user');
    assert.equal(user?.avatarUrl, null);
    const pictured = migrated.refreshGoogleIdentity(
      user!, 'new-email@example.test', 'https://lh3.googleusercontent.com/a/new-picture',
    );
    assert.equal(pictured.googleEmail, 'new-email@example.test');
    assert.equal(pictured.avatarUrl, 'https://lh3.googleusercontent.com/a/new-picture');
    assert.equal(migrated.refreshGoogleIdentity(pictured, pictured.googleEmail!, null).avatarUrl,
      'https://lh3.googleusercontent.com/a/new-picture');
    migrated.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Google login requests profile scope and accepts picture claims', async () => {
  const registry = new UserRegistry(':memory:');
  const previous = { ...config.login };
  try {
    config.login.googleClientId = 'avatar-client';
    config.login.googleClientSecret = 'avatar-secret';
    const login = new URL(googleLoginUrl(registry, '/account'));
    assert.deepEqual(login.searchParams.get('scope')?.split(' ').sort(), ['email', 'openid', 'profile']);
    assert.ok(login.searchParams.get('scope')?.includes('profile'));

    const state = login.searchParams.get('state')!;
    const claims = Buffer.from(JSON.stringify({
      sub: 'google-avatar-user',
      email: 'avatar@example.test',
      picture: 'https://lh3.googleusercontent.com/a/avatar-value#fragment',
    })).toString('base64url');
    const identity = await completeGoogleLogin(registry, 'code', state, (async () =>
      new Response(JSON.stringify({ id_token: `header.${claims}.signature` }), {
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch);
    assert.deepEqual(identity, {
      sub: 'google-avatar-user',
      email: 'avatar@example.test',
      avatarUrl: 'https://lh3.googleusercontent.com/a/avatar-value',
      next: '/account',
    });
    assert.equal(safeGoogleAvatarUrl('http://lh3.googleusercontent.com/a/x'), null);
    assert.equal(safeGoogleAvatarUrl('https://example.test/a/x'), null);
  } finally {
    Object.assign(config.login, previous);
    registry.close();
  }
});

test('avatar service prefers Google and temporarily uses Gravatar when no Google picture exists', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const googleUser = registry.createUser('google-avatar', 'Google Avatar', {
      googleEmail: 'Google.Avatar@Example.test ',
      avatarUrl: 'https://lh3.googleusercontent.com/a/google-avatar',
    });
    const requested: Array<{ url: string; signal: AbortSignal | null }> = [];
    const googleService = new AvatarService((async (input, init) => {
      requested.push({ url: String(input), signal: init?.signal as AbortSignal | null });
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'image/jpeg', 'content-length': '3' },
      });
    }) as typeof fetch);
    assert.equal((await googleService.avatarFor(googleUser)).source, 'google');
    assert.equal((await googleService.avatarFor(googleUser)).source, 'google');
    assert.equal(requested.length, 1, 'second read comes from the in-memory cache');
    assert.equal(requested[0]!.url, googleUser.avatarUrl);
    assert.ok(requested[0]!.signal);

    const noPictureUser = registry.createUser('no-picture', 'Local Initial', {
      googleEmail: 'local@example.test',
    });
    let externalCalls = 0;
    const localService = new AvatarService((async () => {
      externalCalls++;
      return new Response(new Uint8Array([4, 5, 6]), { headers: { 'content-type': 'image/png' } });
    }) as typeof fetch);
    assert.equal((await localService.avatarFor(noPictureUser)).source, 'gravatar');
    assert.equal(externalCalls, 1, 'Gravatar is the temporary fallback');
    assert.equal(AVATAR_FETCH_TIMEOUT_MS, 3_000);
  } finally {
    registry.close();
  }
});

test('invalid, oversized, and unavailable remote avatars fail closed to a local SVG', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('fallback-user', '<Fallback>', {
      googleEmail: 'fallback@example.test',
      avatarUrl: 'https://lh3.googleusercontent.com/a/fallback',
    });
    let calls = 0;
    const service = new AvatarService((async () => {
      calls++;
      return calls === 1
        ? new Response('not an image', { headers: { 'content-type': 'text/plain' } })
        : new Response(new Uint8Array([1]), {
          headers: { 'content-type': 'image/png', 'content-length': String(AVATAR_MAX_BYTES + 1) },
        });
    }) as typeof fetch);
    const avatar = await service.avatarFor(user);
    assert.equal(calls, 2, 'failed Google and oversized Gravatar images use the local fallback');
    assert.equal((await service.avatarFor({ ...user, avatarUrl: user.avatarUrl + '-oversized' })).source, 'fallback');
    assert.equal(calls, 4, 'both failed remote sources use the local fallback');
    assert.equal(avatar.source, 'fallback');
    assert.equal(avatar.contentType, 'image/svg+xml');
    const svg = Buffer.from(avatar.body).toString();
    assert.match(svg, /^<svg/);
    assert.doesNotMatch(svg, /<Fallback>/);
  } finally {
    registry.close();
  }
});

test('same-origin avatar routes enforce dashboard and matching authorization', async () => {
  const registry = new UserRegistry(':memory:');
  const avatarService = { avatarFor: async () => pngAvatar() };
  const app = createApp(registry, { avatarService });
  try {
    const viewer = registry.createUser('avatar-viewer', 'Avatar Viewer', {
      googleEmail: 'viewer@example.test', dashboardPublic: true,
    });
    const candidate = registry.createUser('avatar-candidate', 'Avatar Candidate', {
      googleEmail: 'candidate@example.test',
    });
    const outsider = registry.createUser('avatar-outsider', 'Avatar Outsider');
    const viewerCookie = `urtube_session=${registry.createSession(viewer)}`;
    const candidateCookie = `urtube_session=${registry.createSession(candidate)}`;
    const outsiderCookie = `urtube_session=${registry.createSession(outsider)}`;

    assert.equal((await app.request('/avatar/avatar-viewer')).status, 200);
    assert.equal((await app.request('/avatar/avatar-candidate')).status, 404);
    assert.equal((await app.request('/avatar/avatar-candidate', { headers: { cookie: candidateCookie } })).status, 200);
    assert.equal((await app.request('/avatar/avatar-candidate', { headers: { cookie: outsiderCookie } })).status, 404);

    enableMatching(registry, viewer);
    enableMatching(registry, candidate);
    enableMatching(registry, outsider);
    const matches = await (await app.request('/matches', { headers: { cookie: viewerCookie } })).text();
    assert.match(matches, /src="\/avatar\/member\/avatar-candidate"/, 'candidate card uses a same-origin member avatar URL');
    assert.doesNotMatch(matches, /gravatar\.com|googleusercontent\.com|candidate@example\.test/);

    // Members of the pool see each other; anyone who left or never joined
    // gets nothing, and so does an unknown handle.
    assert.equal((await app.request('/avatar/member/avatar-candidate', { headers: { cookie: viewerCookie } })).status, 200);
    assert.equal((await app.request('/avatar/member/avatar-candidate', { headers: { cookie: outsiderCookie } })).status, 200);
    assert.equal((await app.request('/avatar/member/avatar-candidate')).status, 404);
    assert.equal((await app.request('/avatar/member/nobody', { headers: { cookie: viewerCookie } })).status, 404);
    registry.setMatchingPreferences(outsider.handle, false, 'topics_and_channel');
    assert.equal((await app.request('/avatar/member/avatar-candidate', { headers: { cookie: outsiderCookie } })).status, 404);
    assert.equal((await app.request('/avatar/member/avatar-outsider', { headers: { cookie: viewerCookie } })).status, 404);
    registry.setMatchingPreferences(outsider.handle, true, 'topics_and_channel');

    const actionToken = registry.issueMatchActionToken(viewer, candidate.id, []);
    registry.createMatchRequest(viewer, actionToken);
    const requestToken = registry.matchingInboxFor(viewer).sent[0]?.requestToken;
    assert.ok(requestToken);
    assert.equal((await app.request(`/avatar/request/${requestToken}`, { headers: { cookie: viewerCookie } })).status, 200);
    assert.equal((await app.request(`/avatar/request/${requestToken}`, { headers: { cookie: candidateCookie } })).status, 200);
    assert.equal((await app.request(`/avatar/request/${requestToken}`, { headers: { cookie: outsiderCookie } })).status, 404);

    registry.setMatchingPreferences(candidate.handle, false, 'topics_only');
    assert.equal((await app.request(`/avatar/request/${requestToken}`, { headers: { cookie: viewerCookie } })).status, 404);
  } finally {
    registry.close();
  }
});

test('missing token picture uses same-account UserInfo and keeps login working on failure', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    for (const scenario of ['valid', 'different-account', 'failed']) {
      const claims = Buffer.from(JSON.stringify({ sub: 'userinfo-user', email: 'fixture@example.test' })).toString('base64url');
      let requests = 0;
      const identity = await completeGoogleLogin(registry, 'code', registry.createLoginState('/account'), (async (input, init) => {
        if (++requests === 1) return Response.json({ id_token: `header.${claims}.sig`, access_token: 'fixture-token' });
        assert.equal(String(input), 'https://openidconnect.googleapis.com/v1/userinfo');
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer fixture-token');
        assert.ok(init?.signal);
        if (scenario === 'failed') throw new Error('unavailable');
        return Response.json({ sub: scenario === 'valid' ? 'userinfo-user' : 'another-user', picture: 'https://lh3.googleusercontent.com/a/fixture' });
      }) as typeof fetch);
      assert.equal(requests, 2);
      assert.equal(identity.avatarUrl, scenario === 'valid' ? 'https://lh3.googleusercontent.com/a/fixture' : null);
      assert.equal(identity.next, '/account');
    }
  } finally { registry.close(); }
});

test('temporary Gravatar fallback retries Google after a minute', async t => {
  let now = 1000000;
  t.mock.method(Date, 'now', () => now);
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('retry-picture', 'Retry', { googleEmail: 'fixture@example.test', avatarUrl: 'https://lh3.googleusercontent.com/a/fixture' });
    const requests: string[] = [];
    let recovered = false;
    const service = new AvatarService((async input => {
      requests.push(String(input));
      if (String(input).includes('googleusercontent') && !recovered) return new Response('', { status: 503 });
      return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } });
    }) as typeof fetch);
    assert.equal((await service.avatarFor(user)).source, 'gravatar');
    assert.match(requests[1]!, /^https:\/\/gravatar.com\/avatar\/[a-f0-9]{64}\?/);
    assert.equal((await service.avatarFor(user)).source, 'gravatar');
    assert.equal(requests.length, 2);
    now += 60001; recovered = true;
    assert.equal((await service.avatarFor(user)).source, 'google');
    assert.equal(requests.length, 3);
  } finally { registry.close(); }
});
