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

test('candidate directory keeps every relationship in one comparison-first flow', async () => {
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

    // Legacy rows may still contain the retired profile/contact fields; the
    // comparison-first UI must never render them.
    registry.setMatchingProfile(alice.handle, 'Alice likes making things.', '@alice-private');
    registry.setMatchingProfile(bob.handle, 'Bob likes live music.', '@bob-private');

    const tokenIn = (html: string): string => {
      const match = html.match(/name="actionToken" value="([A-Za-z0-9_-]+)"/);
      assert.ok(match, 'comparison page mints an action token for its forms');
      return match[1]!;
    };
    const candidates = await (await app.request('/matches', { headers: { cookie: aliceCookie } })).text();
    assert.match(candidates, /<article class="mt-card">[\s\S]*?<h2>Bob<\/h2>[\s\S]*?href="\/alice-match\/compare\/bob-match"/);
    assert.doesNotMatch(candidates, /@bob-private|candidateUserId|actionToken/);
    assert.match(candidates, />100%<small>match<\/small>/);
    assert.match(candidates, /<a class="mt-person-link" href="\/bob-match"><img class="mt-avatar" src="\/avatar\/member\/bob-match"/);
    assert.doesNotMatch(candidates, /matches\/profile|matches\/compare|You both said yes|Bob likes live music/);
    assert.doesNotMatch(candidates, /Strong fit|Aligned|Some overlap|Different/);

    // Legacy token links forward to the stable address while valid.
    const legacyToken = registry.issueMatchActionToken(alice, bob.id, ['Music']);
    for (const legacyPath of [`/matches/profile/${legacyToken}?lang=zh`, `/matches/compare/${legacyToken}?lang=zh`]) {
      const legacy = await app.request(legacyPath, { headers: { cookie: aliceCookie } });
      assert.equal(legacy.status, 302);
      assert.equal(legacy.headers.get('location'), '/alice-match/compare/bob-match?lang=zh');
    }
    // The address is symmetric for the two people involved and closed to everyone else.
    const swapped = await app.request('/bob-match/compare/alice-match', { headers: { cookie: aliceCookie } });
    assert.equal(swapped.status, 302);
    assert.equal(swapped.headers.get('location'), '/alice-match/compare/bob-match');
    assert.equal((await app.request('/alice-match/compare/bob-match')).status, 302, 'anonymous visitors sign in first');

    const comparison = await app.request('/alice-match/compare/bob-match', {
      headers: { cookie: aliceCookie },
    });
    assert.equal(comparison.status, 200);
    const comparisonHtml = await comparison.text();
    const bobToken = tokenIn(comparisonHtml);
    assert.match(comparisonHtml, /Alice/);
    assert.match(comparisonHtml, /Bob/);
    assert.match(comparisonHtml, /100%/);
    assert.match(comparisonHtml, /Topic intersection/);
    assert.match(comparisonHtml, /Channel intersection/);
    assert.match(comparisonHtml, /Shared interests/);
    assert.doesNotMatch(comparisonHtml, /Private by default|Recent 90 days|Mutual consent gates details/);
    assert.match(comparisonHtml, /Opening or liking a comparison sends no private details/);
    assert.match(comparisonHtml, /action="\/matches\/request"/);
    assert.doesNotMatch(comparisonHtml, /@bob-private|candidateUserId|watchEvents|estimatedWatchSeconds|topicCoverage/);
    assert.equal((await app.request('/avatar/member/alice-match', {
      headers: { cookie: aliceCookie },
    })).status, 200);
    assert.equal((await app.request('/alice-match/compare/bob-match', {
      headers: { cookie: carolCookie },
    })).status, 404);
    assert.equal((await app.request('/carol-match/compare/nobody-match', {
      headers: { cookie: carolCookie },
    })).status, 404);
    assert.equal((await app.request('/dashboard', { headers: { cookie: aliceCookie } })).headers.get('location'),
      '/alice-match');
    assert.equal((await app.request('/dashboard')).headers.get('location'),
      '/auth/google?next=%2Fdashboard');

    const unscoped = await app.request('/matches/request', {
      ...form({ actionToken: bobToken }),
      headers: { ...form({}).headers, cookie: carolCookie },
    });
    assert.equal(unscoped.status, 400);
    const invalid = await app.request('/matches/request', {
      ...form({ actionToken: 'not-a-valid-action-token' }),
      headers: { ...form({}).headers, cookie: aliceCookie },
    });
    assert.equal(invalid.status, 400);

    const sent = await app.request('/matches/request', {
      ...form({ actionToken: bobToken }),
      headers: { ...form({}).headers, cookie: aliceCookie },
    });
    assert.equal(sent.status, 302);
    assert.equal(sent.headers.get('location'), '/alice-match/compare/bob-match');
    const duplicate = await app.request('/matches/request', {
      ...form({ actionToken: bobToken }),
      headers: { ...form({}).headers, cookie: aliceCookie },
    });
    assert.equal(duplicate.status, 302);
    assert.equal(registry.matchingInboxFor(alice).sent.length, 1);
    const sentComparison = await app.request('/alice-match/compare/bob-match', {
      headers: { cookie: aliceCookie },
    });
    assert.equal(sentComparison.status, 200, 'sending a request keeps comparison available');
    const sentComparisonHtml = await sentComparison.text();
    assert.match(sentComparisonHtml, /You want to meet/);
    assert.match(sentComparisonHtml, /Deeper data stays locked until both people choose to meet/);

    const chinesePending = await (await app.request('/alice-match/compare/bob-match?lang=zh', {
      headers: { cookie: aliceCookie },
    })).text();
    assert.doesNotMatch(chinesePending, /預設私密|只看近 90 天|雙向同意才解鎖/);
    assert.match(chinesePending, /打開或喜歡這份比較都不會送出私人細節/);

    const request = registry.matchingInboxFor(bob).incoming[0];
    assert.ok(request);
    const beforeAlice = await (await app.request('/matches', { headers: { cookie: aliceCookie } })).text();
    const beforeBob = await (await app.request('/matches', { headers: { cookie: bobCookie } })).text();
    assert.match(beforeBob, /Alice/);
    assert.match(beforeAlice, /You want to meet/);
    assert.match(beforeBob, /Wants to meet you/);
    assert.doesNotMatch(beforeAlice, /@bob-private/);
    assert.doesNotMatch(beforeBob, /@alice-private/);

    assert.match(beforeBob, /href="\/bob-match\/compare\/alice-match"/);
    const incomingComparison = await (await app.request('/bob-match/compare/alice-match', {
      headers: { cookie: bobCookie },
    })).text();
    const aliceToken = tokenIn(incomingComparison);
    assert.match(incomingComparison, /Want to meet too/);
    assert.doesNotMatch(incomingComparison, /@alice-private|Alice likes making things/);

    const forged = await app.request('/matches/respond', {
      ...form({ requestToken: request.requestToken, response: 'accept' }),
      headers: { ...form({}).headers, cookie: carolCookie },
    });
    assert.equal(forged.status, 400);
    assert.equal(registry.matchingInboxFor(alice).connections.length, 0);

    const accepted = await app.request('/matches/respond', {
      ...form({ actionToken: aliceToken, requestToken: request.requestToken, response: 'accept' }),
      headers: { ...form({}).headers, cookie: bobCookie },
    });
    assert.equal(accepted.status, 302);
    assert.equal(accepted.headers.get('location'), '/bob-match/compare/alice-match');
    const afterAlice = await (await app.request('/matches', { headers: { cookie: aliceCookie } })).text();
    const afterBob = await (await app.request('/matches', { headers: { cookie: bobCookie } })).text();
    const afterCarol = await (await app.request('/matches', { headers: { cookie: carolCookie } })).text();
    assert.match(afterAlice, /Bob/);
    assert.match(afterBob, /Alice/);
    assert.match(afterAlice, /Deeper comparison unlocked/);
    assert.match(afterBob, /Deeper comparison unlocked/);
    const unlocked = await (await app.request('/bob-match/compare/alice-match', {
      headers: { cookie: bobCookie },
    })).text();
    const unlockedToken = tokenIn(unlocked);
    assert.match(unlocked, /More shared interests unlocked/);
    assert.match(unlocked, /Both people chose to meet\. Either person can revoke this deeper comparison at any time/);
    assert.match(unlocked, /action="\/matches\/withdraw"/);
    assert.doesNotMatch(unlocked, /@alice-private|Alice likes making things/);
    assert.doesNotMatch(afterCarol, /@alice-private|@bob-private/);
    assert.doesNotMatch(afterAlice, /@bob-private|Bob likes live music|candidateUserId|watchEvents|exact score/);

    const connectionToken = registry.matchingInboxFor(alice).connections[0]?.requestToken;
    assert.ok(connectionToken);
    const disconnected = await app.request('/matches/withdraw', {
      ...form({ actionToken: unlockedToken, requestToken: connectionToken }),
      headers: { ...form({}).headers, cookie: bobCookie },
    });
    assert.equal(disconnected.status, 302);
    assert.equal(registry.matchingInboxFor(alice).connections.length, 0);
    const afterDisconnect = await (await app.request('/matches', { headers: { cookie: aliceCookie } })).text();
    assert.match(afterDisconnect, /Bob/);
    assert.match(afterDisconnect, /Open comparison/);
    assert.doesNotMatch(afterDisconnect, /@bob-private/);
  } finally {
    registry.close();
  }
});

test('decline and withdrawal keep people comparable but revoke stale action access', () => {
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
    assert.ok(registry.listMatchingCandidatesFor(alice).some(({ userId }) => userId === bob.id));
    assert.ok(registry.listMatchingCandidatesFor(bob).some(({ userId }) => userId === alice.id));
    assert.equal(registry.matchingCandidateForAction(bob, bobToAlice), null);
    const refreshedBobToAlice = registry.issueMatchActionToken(bob, alice.id, ['Music']);
    assert.ok(registry.matchingCandidateForAction(bob, refreshedBobToAlice));

    const aliceToCarol = registry.issueMatchActionToken(alice, carol.id, ['Music']);
    registry.createMatchRequest(alice, aliceToCarol);
    const outgoing = registry.matchingInboxFor(alice).sent[0];
    registry.withdrawMatchRequest(alice, outgoing.requestToken);
    assert.equal(registry.matchingInboxFor(carol).incoming.length, 0);
    assert.equal(registry.matchingCandidateForAction(alice, aliceToCarol), null);
    assert.throws(() => registry.createMatchRequest(alice, aliceToCarol), /no longer valid/);
    const refreshedAliceToCarol = registry.issueMatchActionToken(alice, carol.id, ['Music']);
    assert.ok(registry.matchingCandidateForAction(alice, refreshedAliceToCarol));

    const aliceToDave = registry.issueMatchActionToken(alice, dave.id, ['Music']);
    registry.createMatchRequest(alice, aliceToDave);
    registry.respondToMatchRequest(dave, registry.matchingInboxFor(dave).incoming[0].requestToken, 'accept');
    assert.equal(registry.matchingInboxFor(alice).connections.length, 1);
    // Per-topic exclusions were retired with the single matching switch, so
    // stored choices no longer strip agreed topics from a connection.
    registry.setMatchingDimensions(
      dave.handle,
      MATCHING_TAXONOMY.version,
      ['gaming'],
      ['music'],
    );
    assert.deepEqual(registry.matchingInboxFor(alice).connections[0]?.topics, ['Music']);
    registry.setMatchingPreferences(dave.handle, false, 'topics_and_channel');
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
    for (const legacyPath of [`/matches/profile/${token}`, `/matches/compare/${token}`]) {
      const legacy = await app.request(legacyPath, { headers: { cookie } });
      assert.equal(legacy.status, 302);
      assert.equal(legacy.headers.get('location'), '/expiry-alice/compare/expiry-bob');
    }

    const direct = new DatabaseSync(path);
    direct.prepare("UPDATE match_action_tokens SET expires_at='2000-01-01T00:00:00.000Z'").run();
    direct.close();

    assert.equal((await app.request(`/matches/profile/${token}`, { headers: { cookie } })).status, 404);
    assert.equal((await app.request(`/matches/compare/${token}`, { headers: { cookie } })).status, 404);
    // The stable address keeps working; only the token-based forms expire.
    assert.equal((await app.request('/expiry-alice/compare/expiry-bob', { headers: { cookie } })).status, 200);
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
