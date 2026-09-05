import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { UserRegistry, type User } from '../src/users.js';
import { MATCHING_TAXONOMY } from '../src/youtube/matching.js';
import {
  REGISTRY_CRYSTAL_VERSION,
  type RegistryMatchingCrystal,
} from '../src/youtube/registry-crystal.js';

const topic = (key: string, share: number) => ({
  key,
  name: MATCHING_TAXONOMY.topics.find((item) => item.key === key)?.name ?? key,
  share,
});

function crystal(): RegistryMatchingCrystal {
  return {
    kind: 'matching',
    version: REGISTRY_CRYSTAL_VERSION,
    taxonomyVersion: MATCHING_TAXONOMY.version,
    generatedAt: '2026-09-05T12:00:00.000Z',
    windowDays: 90,
    data: {
      watchEvents: 240,
      uniqueVideos: 90,
      estimatedWatchSeconds: 140_000,
      activeDays: 20,
      topicCoverage: 1,
    },
    topics: [topic('music', 0.7), topic('gaming', 0.3)],
    channels: [{ key: 'shared', name: 'Shared Channel', share: 1 }],
  };
}

function publish(registry: UserRegistry, user: User): void {
  registry.upsertMatchingCrystal(user, crystal());
  registry.setMatchingPreferences(user.handle, true, 'topics_and_channel');
}

function form(values: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values).toString(),
  };
}

test('mutual consent is required before self-authored profile details are returned', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const alice = registry.createUser('alice-match', 'Alice');
    const bob = registry.createUser('bob-match', 'Bob');
    const carol = registry.createUser('carol-match', 'Carol');
    for (const user of [alice, bob, carol]) publish(registry, user);
    const aliceCookie = `urtube_session=${registry.createSession(alice)}`;
    const bobCookie = `urtube_session=${registry.createSession(bob)}`;
    const carolCookie = `urtube_session=${registry.createSession(carol)}`;

    await app.request('/account/match-profile', {
      ...form({ matchingIntroduction: 'Alice likes making things.', matchingContact: '@alice-private' }),
      headers: { ...form({}).headers, cookie: aliceCookie },
    });
    await app.request('/account/match-profile', {
      ...form({ matchingIntroduction: 'Bob likes live music.', matchingContact: '@bob-private' }),
      headers: { ...form({}).headers, cookie: bobCookie },
    });

    const candidates = await (await app.request('/matches', { headers: { cookie: aliceCookie } })).text();
    const bobCard = candidates.match(/<article class="mt-card">[\s\S]*?<h2>Bob<\/h2>[\s\S]*?href="\/matches\/profile\/([A-Za-z0-9_-]+)"/);
    assert.ok(bobCard);
    assert.doesNotMatch(candidates, /@bob-private|bob-match|candidateUserId/);
    assert.match(candidates, />100%<small>match<\/small>/);
    assert.doesNotMatch(candidates, /Strong fit|Aligned|Some overlap|Different/);
    for (const script of candidates.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      assert.doesNotThrow(() => Function(script[1]));
    }

    const profile = await app.request(`/matches/profile/${bobCard[1]}`, {
      headers: { cookie: aliceCookie },
    });
    assert.equal(profile.status, 200);
    assert.equal(profile.headers.get('cache-control'), 'no-store');
    const profileHtml = await profile.text();
    assert.match(profileHtml, /Bounded candidate profile/);
    assert.match(profileHtml, /100%/);
    assert.match(profileHtml, /action="\/matches\/request"/);
    assert.match(profileHtml, new RegExp(`href="/matches/compare/${bobCard[1]}"`));
    assert.doesNotMatch(profileHtml, /@bob-private|bob-match|alice-match|candidateUserId|watchEvents|estimatedWatchSeconds|topicCoverage/);

    const comparison = await app.request(`/matches/compare/${bobCard[1]}`, {
      headers: { cookie: aliceCookie },
    });
    assert.equal(comparison.status, 200);
    const comparisonHtml = await comparison.text();
    assert.match(comparisonHtml, /Alice/);
    assert.match(comparisonHtml, /Bob/);
    assert.match(comparisonHtml, /100%/);
    assert.match(comparisonHtml, /Topic intersection/);
    assert.match(comparisonHtml, /Channel intersection/);
    assert.doesNotMatch(comparisonHtml, /@bob-private|bob-match|alice-match|candidateUserId|watchEvents|estimatedWatchSeconds|topicCoverage/);
    assert.equal((await app.request(`/avatar/match/${bobCard[1]}/viewer`, {
      headers: { cookie: aliceCookie },
    })).status, 200);
    assert.equal((await app.request(`/matches/profile/${bobCard[1]}`, {
      headers: { cookie: carolCookie },
    })).status, 404);
    assert.equal((await app.request('/dashboard', { headers: { cookie: aliceCookie } })).headers.get('location'),
      '/alice-match');
    assert.equal((await app.request('/dashboard')).headers.get('location'),
      '/auth/google?next=%2Fdashboard');

    const unscoped = await app.request('/matches/request', {
      ...form({ actionToken: bobCard[1] }),
      headers: { ...form({}).headers, cookie: carolCookie },
    });
    assert.equal(unscoped.status, 400);
    const invalid = await app.request('/matches/request', {
      ...form({ actionToken: 'not-a-valid-action-token' }),
      headers: { ...form({}).headers, cookie: aliceCookie },
    });
    assert.equal(invalid.status, 400);

    const sent = await app.request('/matches/request', {
      ...form({ actionToken: bobCard[1] }),
      headers: { ...form({}).headers, cookie: aliceCookie },
    });
    assert.equal(sent.status, 302);
    const duplicate = await app.request('/matches/request', {
      ...form({ actionToken: bobCard[1] }),
      headers: { ...form({}).headers, cookie: aliceCookie },
    });
    assert.equal(duplicate.status, 302);
    assert.equal(registry.matchingInboxFor(alice).sent.length, 1);
    assert.equal((await app.request(`/matches/profile/${bobCard[1]}`, {
      headers: { cookie: aliceCookie },
    })).status, 404, 'sending a request revokes the browse token');

    const request = registry.matchingInboxFor(bob).incoming[0];
    assert.ok(request);
    const beforeAlice = await (await app.request('/matches', { headers: { cookie: aliceCookie } })).text();
    const beforeBob = await (await app.request('/matches', { headers: { cookie: bobCookie } })).text();
    assert.match(beforeBob, /Alice/);
    assert.doesNotMatch(beforeAlice, /@bob-private/);
    assert.doesNotMatch(beforeBob, /@alice-private/);

    const forged = await app.request('/matches/respond', {
      ...form({ requestToken: request.requestToken, response: 'accept' }),
      headers: { ...form({}).headers, cookie: carolCookie },
    });
    assert.equal(forged.status, 400);
    assert.equal(registry.matchingInboxFor(alice).connections.length, 0);

    const accepted = await app.request('/matches/respond', {
      ...form({ requestToken: request.requestToken, response: 'accept' }),
      headers: { ...form({}).headers, cookie: bobCookie },
    });
    assert.equal(accepted.status, 302);
    const afterAlice = await (await app.request('/matches', { headers: { cookie: aliceCookie } })).text();
    const afterBob = await (await app.request('/matches', { headers: { cookie: bobCookie } })).text();
    const afterCarol = await (await app.request('/matches', { headers: { cookie: carolCookie } })).text();
    assert.match(afterAlice, /Bob likes live music\./);
    assert.match(afterAlice, /@bob-private/);
    assert.match(afterBob, /Alice likes making things\./);
    assert.match(afterBob, /@alice-private/);
    assert.match(afterAlice, /You both make room for Music/);
    assert.match(afterAlice, /action="\/matches\/withdraw"/);
    assert.match(afterAlice, /Disconnect/);
    assert.doesNotMatch(afterCarol, /@alice-private|@bob-private/);
    assert.doesNotMatch(afterAlice, /bob-match|candidateUserId|watchEvents|exact score/);

    const connectionToken = registry.matchingInboxFor(alice).connections[0]?.requestToken;
    assert.ok(connectionToken);
    const disconnected = await app.request('/matches/withdraw', {
      ...form({ requestToken: connectionToken }),
      headers: { ...form({}).headers, cookie: bobCookie },
    });
    assert.equal(disconnected.status, 302);
    assert.equal(registry.matchingInboxFor(alice).connections.length, 0);
    assert.doesNotMatch(
      await (await app.request('/matches', { headers: { cookie: aliceCookie } })).text(),
      /@bob-private/,
    );
  } finally {
    registry.close();
  }
});

test('decline, withdrawal, opt-out, and deletion revoke request access', () => {
  const registry = new UserRegistry(':memory:');
  try {
    const alice = registry.createUser('alice-flow', 'Alice');
    const bob = registry.createUser('bob-flow', 'Bob');
    const carol = registry.createUser('carol-flow', 'Carol');
    const dave = registry.createUser('dave-flow', 'Dave');
    const eve = registry.createUser('eve-flow', 'Eve');
    for (const user of [alice, bob, carol, dave, eve]) publish(registry, user);

    const bobToAlice = registry.issueMatchActionToken(bob, alice.id, ['Music']);
    registry.createMatchRequest(bob, bobToAlice);
    const incoming = registry.matchingInboxFor(alice).incoming[0];
    registry.respondToMatchRequest(alice, incoming.requestToken, 'decline');
    assert.equal(registry.matchingInboxFor(alice).incoming.length, 0);
    assert.equal(registry.matchingInboxFor(bob).sent.length, 0);
    assert.ok(!registry.listMatchingCandidatesFor(alice).some(({ userId }) => userId === bob.id));
    assert.ok(!registry.listMatchingCandidatesFor(bob).some(({ userId }) => userId === alice.id));

    const aliceToCarol = registry.issueMatchActionToken(alice, carol.id, ['Music']);
    registry.createMatchRequest(alice, aliceToCarol);
    const outgoing = registry.matchingInboxFor(alice).sent[0];
    registry.withdrawMatchRequest(alice, outgoing.requestToken);
    assert.equal(registry.matchingInboxFor(carol).incoming.length, 0);
    assert.equal(registry.matchingCandidateForAction(alice, aliceToCarol), null);
    assert.throws(() => registry.createMatchRequest(alice, aliceToCarol), /no longer valid/);

    const aliceToDave = registry.issueMatchActionToken(alice, dave.id, ['Music']);
    registry.createMatchRequest(alice, aliceToDave);
    registry.respondToMatchRequest(dave, registry.matchingInboxFor(dave).incoming[0].requestToken, 'accept');
    assert.equal(registry.matchingInboxFor(alice).connections.length, 1);
    registry.setMatchingDimensions(
      dave.handle,
      MATCHING_TAXONOMY.version,
      ['gaming'],
      ['music'],
    );
    assert.deepEqual(registry.matchingInboxFor(alice).connections[0]?.topics, []);
    registry.setMatchingPreferences(dave.handle, false, 'topics_only');
    assert.equal(registry.matchingInboxFor(alice).connections.length, 0);

    const aliceToEve = registry.issueMatchActionToken(alice, eve.id, ['Music']);
    registry.createMatchRequest(alice, aliceToEve);
    registry.respondToMatchRequest(eve, registry.matchingInboxFor(eve).incoming[0].requestToken, 'accept');
    assert.equal(registry.matchingInboxFor(alice).connections.length, 1);
    registry.deleteUser(eve.handle);
    assert.equal(registry.matchingInboxFor(alice).connections.length, 0);
  } finally {
    registry.close();
  }
});

test('expired discovery tokens revoke profiles, comparisons, avatars, and requests', async () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-match-expiry-'));
  const path = join(root, 'users.sqlite');
  const registry = new UserRegistry(path, join(root, 'users'));
  const app = createApp(registry);
  try {
    const alice = registry.createUser('expiry-alice', 'Alice');
    const bob = registry.createUser('expiry-bob', 'Bob');
    publish(registry, alice);
    publish(registry, bob);
    const cookie = `urtube_session=${registry.createSession(alice)}`;
    const token = registry.issueMatchActionToken(alice, bob.id, ['Music']);
    assert.equal((await app.request(`/matches/profile/${token}`, { headers: { cookie } })).status, 200);
    assert.equal((await app.request(`/matches/compare/${token}`, { headers: { cookie } })).status, 200);

    const direct = new DatabaseSync(path);
    direct.prepare("UPDATE match_action_tokens SET expires_at='2000-01-01T00:00:00.000Z'").run();
    direct.close();

    assert.equal((await app.request(`/matches/profile/${token}`, { headers: { cookie } })).status, 404);
    assert.equal((await app.request(`/matches/compare/${token}`, { headers: { cookie } })).status, 404);
    assert.equal((await app.request(`/avatar/match/${token}`, { headers: { cookie } })).status, 404);
    assert.throws(() => registry.createMatchRequest(alice, token), /no longer valid/);
  } finally {
    registry.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('registry upgrade adds mutual-match storage and bounds profile text by code point', () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-match-request-upgrade-'));
  const path = join(root, 'users.sqlite');
  let registry = new UserRegistry(path, join(root, 'users'));
  registry.createUser('upgrade-user', 'Upgrade');
  registry.close();
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    DROP TABLE match_action_tokens;
    DROP TABLE match_requests;
    ALTER TABLE users DROP COLUMN matching_introduction;
    ALTER TABLE users DROP COLUMN matching_contact;
  `);
  legacy.close();
  try {
    registry = new UserRegistry(path, join(root, 'users'));
    const longIntroduction = '🪴'.repeat(170);
    const saved = registry.setMatchingProfile('upgrade-user', longIntroduction, '  @contact  ');
    assert.equal([...saved.matchingIntroduction].length, 160);
    assert.equal(saved.matchingContact, '@contact');
    registry.close();
    const migrated = new DatabaseSync(path, { readOnly: true });
    assert.deepEqual(
      migrated.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('match_action_tokens', 'match_requests') ORDER BY name")
        .all().map((row) => (row as { name: string }).name),
      ['match_action_tokens', 'match_requests'],
    );
    migrated.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
