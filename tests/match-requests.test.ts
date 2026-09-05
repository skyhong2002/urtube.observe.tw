import assert from 'node:assert/strict';
import { load } from 'cheerio';
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

test('private candidates become friends before Overview, Insights and Blend are available', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const alice = registry.createUser('alice-match', 'Alice');
    const bob = registry.createUser('bob-match', 'Bob');
    const carol = registry.createUser('carol-match', 'Carol');
    for (const user of [alice, bob, carol]) publish(registry, user);
    const headers = (user: User) => ({ cookie: `urtube_session=${registry.createSession(user)}` });
    const aliceHeaders = headers(alice), bobHeaders = headers(bob), carolHeaders = headers(carol);
    registry.setMatchingProfile(bob.handle, 'Legacy private biography', '@bob-private');
    const directory = load(await (await app.request('/matches', { headers: aliceHeaders })).text());
    const bobCard = directory('.mt-card').filter((_, el) => directory(el).find('h2').text() === 'Bob');
    const bobToken = bobCard.find('[name=actionToken]').attr('value')!;
    assert.ok(bobToken);
    assert.equal(bobCard.find('.mt-person-link').attr('href'), '/bob-match');
    assert.equal(bobCard.find('[data-friendship-tools] form').attr('action'), '/matches/request');
    assert.equal(bobCard.find('a[href*="/compare/"]').length, 0);
    assert.equal(bobCard.find('.mt-percent').text(), '100%match');
    assert.doesNotMatch(directory.html(), /@bob-private|Legacy private biography/);
    const locked = await app.request('/alice-match/compare/bob-match', { headers: aliceHeaders });
    assert.equal(locked.status, 302);
    assert.equal(locked.headers.get('location'), '/bob-match');
    assert.equal((await app.request('/alice-match/compare/bob-match', { headers: carolHeaders })).status, 404);
    assert.equal((await app.request('/alice-match/compare/bob-match')).status, 302);
    const legacyToken = bobToken;
    for (const path of [`/matches/profile/${legacyToken}?lang=zh`, `/matches/compare/${legacyToken}?lang=zh`]) {
      assert.equal((await app.request(path, { headers: aliceHeaders })).headers.get('location'), '/alice-match/compare/bob-match?lang=zh');
    }
    const post = (path: string, values: Record<string, string>, auth: Record<string, string>) =>
      app.request(path, { ...form(values), headers: { ...form({}).headers, ...auth } });
    assert.equal((await post('/matches/request', { actionToken: bobToken }, carolHeaders)).status, 400);
    assert.equal((await post('/matches/request', { actionToken: 'invalid' }, aliceHeaders)).status, 400);
    const sent = await post('/matches/request', { actionToken: bobToken, returnTo: '/matches' }, aliceHeaders);
    assert.equal(sent.headers.get('location'), '/matches');
    await post('/matches/request', { actionToken: bobToken, returnTo: '/matches' }, aliceHeaders);
    assert.equal(registry.matchingInboxFor(alice).sent.length, 1);
    const pending = load(await (await app.request('/bob-match', { headers: aliceHeaders })).text());
    assert.equal(pending('.mt-state.sent').length, 1);
    assert.equal(pending('a[href*="/compare/"]').length, 0);
    const incoming = load(await (await app.request('/alice-match', { headers: bobHeaders })).text());
    const aliceToken = incoming('[name=actionToken]').attr('value')!;
    const requestToken = registry.matchingInboxFor(bob).incoming[0]!.requestToken;
    assert.equal(incoming('form').attr('action'), '/matches/respond');
    assert.equal((await post('/matches/respond', { actionToken: aliceToken, requestToken, response: 'accept' }, carolHeaders)).status, 400);
    assert.equal((await post('/matches/withdraw', { actionToken: bobToken, requestToken }, carolHeaders)).status, 400);
    const accepted = await post('/matches/respond', { actionToken: aliceToken, requestToken, response: 'accept', returnTo: '/matches' }, bobHeaders);
    assert.equal(accepted.headers.get('location'), '/matches');
    assert.equal(registry.matchingRelationshipFor(alice, bob.id).status, 'connected');
    for (const path of ['/bob-match', '/bob-match/insights', '/alice-match/compare/bob-match']) {
      assert.equal((await app.request(path, { headers: aliceHeaders })).status, 200, path);
    }
    const connected = load(await (await app.request('/matches', { headers: aliceHeaders })).text());
    const connectedCard = connected('.mt-card').filter((_, el) => connected(el).find('h2').text() === 'Bob');
    assert.equal(connectedCard.find('.mt-actions a').attr('href'), '/alice-match/compare/bob-match');
    assert.equal(connectedCard.find('.mt-percent').length, 1);
    const disconnected = await post('/matches/withdraw', { actionToken: connectedCard.find('[name=actionToken]').attr('value')!, requestToken, returnTo: '/matches' }, aliceHeaders);
    assert.equal(disconnected.headers.get('location'), '/matches');
    assert.equal(registry.matchingRelationshipFor(alice, bob.id).status, 'none');
    assert.equal((await app.request('/bob-match/insights', { headers: aliceHeaders })).status, 404);
    assert.equal((await app.request('/alice-match/compare/bob-match', { headers: aliceHeaders })).status, 302);
    const refreshed = load(await (await app.request('/bob-match', { headers: aliceHeaders })).text());
    const safeRedirect = await post('/matches/request', { actionToken: refreshed('[name=actionToken]').attr('value')!, returnTo: 'https://evil.example/' }, aliceHeaders);
    assert.equal(safeRedirect.headers.get('location'), '/alice-match/compare/bob-match');
  } finally { registry.close(); }
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
    // The stable address still resolves to the private member's friendship page.
    assert.equal((await app.request('/expiry-alice/compare/expiry-bob', { headers: { cookie } })).status, 302);
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
