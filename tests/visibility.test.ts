import assert from 'node:assert/strict';
import { load } from 'cheerio';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { UserRegistry, type User } from '../src/users.js';
import { MATCHING_TAXONOMY } from '../src/youtube/matching.js';
import { REGISTRY_CRYSTAL_VERSION } from '../src/youtube/registry-crystal.js';
import type { TagListSnapshot } from '../src/youtube/taglists.js';

const snapshot: TagListSnapshot = {
  lists: { news: new Set(), editorial: new Set(), editorialShows: new Set(), blue: new Set(), green: new Set(), white: new Set(), red: new Set() },
  provenance: { sourceUrl: 'https://example.test', sourceUpdatedAt: '2026-09-05', fetchedAt: '2026-09-05T00:00:00Z', membershipVersion: 'test', policyVersion: 'test', policyUrl: 'https://example.test', reportUrl: 'https://example.test' },
};
function publish(registry: UserRegistry, user: User) {
  registry.upsertMatchingCrystal(user, {
    kind: 'matching', version: REGISTRY_CRYSTAL_VERSION, taxonomyVersion: MATCHING_TAXONOMY.version,
    generatedAt: '2026-09-05T12:00:00Z', windowDays: 90,
    data: { watchEvents: 240, uniqueVideos: 90, estimatedWatchSeconds: 140000, activeDays: 20, topicCoverage: 1 },
    topics: [{ key: 'music', name: 'Music', share: 1 }],
    channels: [{ key: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Music Channel', share: 1 }],
  });
  registry.setMatchingPreferences(user.handle, true, 'topics_and_channel');
}
function seedWatch(registry: UserRegistry, user: User) {
  registry.repositoryFor(user).ingestYoutubeArchive({ archiveHash: `visibility-${user.id}`, source: 'takeout', searches: [], watches: [{
    eventId: 'watch', videoId: 'AAAAAAAAAA1', title: 'Aggregate video', url: 'https://www.youtube.com/watch?v=AAAAAAAAAA1',
    channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', channelTitle: 'Aggregate channel', channelUrl: '', watchedAt: '2026-09-04T01:23:45Z', actualWatchedSeconds: 321, activityType: 'video',
  }] });
}
function connect(registry: UserRegistry, a: User, b: User) {
  registry.createMatchRequest(a, registry.issueMatchActionToken(a, b.id, ['Music']));
  const request = registry.matchingInboxFor(b).incoming[0]!;
  registry.respondToMatchRequest(b, request.requestToken, 'accept');
  return request.requestToken;
}

test('profile visibility distinguishes friends, public guests, owners and key holders', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const alice = registry.createUser('visible-alice', 'Alice'), bob = registry.createUser('visible-bob', 'Bob');
    publish(registry, alice); publish(registry, bob); seedWatch(registry, bob);
    const app = createApp(registry, { loadTagLists: async () => snapshot });
    const headers = { cookie: `urtube_session=${registry.createSession(alice)}` };
    const owner = { cookie: `urtube_session=${registry.createSession(bob)}` };
    assert.equal((await app.request('/visible-bob')).status, 404);
    assert.equal((await app.request('/visible-bob/insights', { headers })).status, 404);
    const basic = load(await (await app.request('/visible-bob?lang=zh', { headers })).text());
    assert.equal(basic('.mp-profile .mt-want').text(), '加好友');
    assert.equal(basic('.yt-profile').length, 0);
    assert.doesNotMatch(basic.html(), /想認識|互相認識/);
    const requestToken = connect(registry, alice, bob);
    for (const suffix of ['', '/insights']) {
      const response = await app.request(`/visible-bob${suffix}?range=all`, { headers });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      const markup = await response.text(), $ = load(markup);
      assert.equal($('.yt-profile').length, 1);
      assert.equal($('.yt-page-nav a').length, 2);
      assert.equal($('a[href^="/blend/visible-bob"]').length, 1);
      assert.doesNotMatch(markup, /2026-09-04T01:23:45|query_ciphertext/);
      assert.ok(!markup.includes(bob.dashboardToken));
    }
    for (const suffix of ['/history', '/recap', '/insights/history']) {
      assert.equal((await app.request(`/visible-bob${suffix}`, { headers })).status, 404);
    }
    for (const suffix of ['summary.json', 'crystal.json']) {
      assert.equal((await app.request(`/u/visible-bob/${suffix}`, { headers })).status, 404);
    }
    for (const suffix of ['', '/insights', '/history', '/recap']) {
      for (const auth of ['owner', 'key']) {
        const response = await app.request(`/visible-bob${suffix}?range=all${auth === 'key' ? `&key=${bob.dashboardToken}` : ''}`, { headers: auth === 'owner' ? owner : headers });
        assert.equal(response.status, 200, `${auth}${suffix}`);
        assert.equal(load(await response.text())('.yt-page-nav a').length, 4);
      }
    }
    registry.withdrawMatchRequest(alice, requestToken);
    assert.equal((await app.request('/visible-bob/insights', { headers })).status, 404);
    assert.equal(load(await (await app.request('/visible-bob', { headers })).text())('.mp-profile').length, 1);
    registry.setDashboardPublic(bob.handle, true);
    for (const suffix of ['', '/insights']) {
      const response = await app.request(`/visible-bob${suffix}`);
      assert.equal(response.status, 200);
      assert.equal(load(await response.text())('.yt-page-nav a').length, 2);
    }
    for (const suffix of ['/history', '/recap']) {
      assert.equal((await app.request(`/visible-bob${suffix}`)).status, 404);
      assert.equal((await app.request(`/visible-bob${suffix}`, { headers })).status, 404);
    }
    const sitemap = await (await app.request('/sitemap.xml')).text();
    assert.match(sitemap, /visible-bob\/insights/);
    assert.doesNotMatch(sitemap, /visible-bob\/(history|recap)/);
    registry.setDashboardPublic(bob.handle, false);
    assert.equal((await app.request('/visible-bob')).status, 404);
  } finally { registry.close(); }
});

test('public profiles support direct Blend independently of friendship, opt-in and discovery eligibility', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const alice = registry.createUser('public-viewer', 'Viewer'), bob = registry.createUser('public-target', 'Public');
    registry.setMatchingPreferences(alice.handle, false, 'topics_and_channel');
    registry.setMatchingPreferences(bob.handle, false, 'topics_and_channel');
    registry.setDashboardPublic(bob.handle, true);
    const app = createApp(registry, { loadTagLists: async () => snapshot });
    const headers = { cookie: `urtube_session=${registry.createSession(alice)}` };
    const directory = load(await (await app.request('/matches', { headers })).text());
    assert.equal(directory('.mt-actions a').attr('href'), '/public-viewer/compare/public-target');
    assert.equal(directory('.mt-actions form').length, 0);
    assert.equal(directory('.mt-percent').text(), '—match');
    const anonymous = await app.request('/blend/public-target?range=all&lang=zh');
    assert.equal(anonymous.status, 302);
    assert.equal(anonymous.headers.get('location'), '/auth/google?next=%2Fblend%2Fpublic-target%3Frange%3Dall%26lang%3Dzh');
    const bridge = await app.request('/blend/public-target?range=all&lang=zh', { headers });
    assert.equal(bridge.headers.get('location'), '/public-viewer/compare/public-target?range=all&lang=zh');
    const response = await app.request('/public-viewer/compare/public-target?lang=zh', { headers });
    assert.equal(response.status, 200);
    const $ = load(await response.text());
    assert.equal($('.mt-locked,form[action^="/matches/"]').length, 0);
    assert.equal($('.mt-vs-score strong').text(), '—');
    assert.equal(registry.matchingRelationshipFor(alice, bob.id).status, 'none');
    assert.doesNotMatch($.html(), /想認識|互相認識/);
    assert.equal((await app.request('/avatar/member/public-target', { headers })).status, 200);
    registry.setDashboardPublic(bob.handle, false);
    assert.equal((await app.request('/public-viewer/compare/public-target', { headers })).status, 302);
  } finally { registry.close(); }
});

for (const revocation of ['public', 'friendship', 'session'] as const) {
  test(`Insights rechecks ${revocation} access after waiting for classifications`, async () => {
    const registry = new UserRegistry(':memory:');
    try {
      const alice = registry.createUser('race-alice', 'Alice'), bob = registry.createUser('race-bob', 'Bob');
      publish(registry, alice); publish(registry, bob); seedWatch(registry, bob);
      const requestToken = connect(registry, alice, bob);
      if (revocation === 'public') registry.setDashboardPublic(bob.handle, true);
      const session = registry.createSession(alice);
      let release!: (value: TagListSnapshot) => void;
      let entered!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const app = createApp(registry, { loadTagLists: () => { entered(); return new Promise(resolve => { release = resolve; }); } });
      const response = app.request('/race-bob/insights', revocation === 'public' ? {} : { headers: { cookie: `urtube_session=${session}` } });
      await started;
      if (revocation === 'public') registry.setDashboardPublic(bob.handle, false);
      if (revocation === 'friendship') registry.withdrawMatchRequest(alice, requestToken);
      if (revocation === 'session') registry.deleteSession(session);
      release(snapshot);
      assert.equal((await response).status, 404);
    } finally { registry.close(); }
  });
}

for (const decision of ['accept', 'decline', 'withdraw'] as const) {
  test(`private recipients can ${decision} invitations from public profiles without gating public Blend`, async () => {
    const registry = new UserRegistry(':memory:');
    try {
      const sender = registry.createUser('invite-public', 'Public Sender');
      const recipient = registry.createUser('invite-private', 'Private Recipient');
      publish(registry, sender); publish(registry, recipient);
      registry.setDashboardPublic(sender.handle, true);
      const app = createApp(registry, { loadTagLists: async () => snapshot });
      const senderHeaders = { cookie: `urtube_session=${registry.createSession(sender)}` };
      const recipientHeaders = { cookie: `urtube_session=${registry.createSession(recipient)}` };
      const privateProfile = load(await (await app.request('/invite-private?lang=zh', { headers: senderHeaders })).text());
      const post = (path: string, values: Record<string, string>, headers: Record<string, string>) => app.request(path, {
        method: 'POST', headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values),
      });
      const sent = await post('/matches/request', { actionToken: privateProfile('[name=actionToken]').attr('value')!, returnTo: '/invite-private' }, senderHeaders);
      assert.equal(sent.status, 302);
      const requestToken = registry.matchingInboxFor(recipient).incoming[0]!.requestToken;
      const directory = load(await (await app.request('/matches?lang=zh', { headers: recipientHeaders })).text());
      const card = directory('.mt-card').filter((_, el) => directory(el).find('h2').text() === 'Public Sender');
      assert.equal(card.find('.mt-actions a').attr('href'), '/invite-private/compare/invite-public');
      assert.equal(card.find('form[action="/matches/respond"] [name=requestToken]').attr('value'), requestToken);
      assert.equal(card.find('button[value=accept]').text(), '接受好友邀請');
      assert.equal(card.find('button[value=decline]').text(), '拒絕');
      assert.equal(card.find('.mt-percent').text(), '100%合拍度');
      const blendResponse = await app.request('/invite-private/compare/invite-public', { headers: recipientHeaders });
      assert.equal(blendResponse.status, 200);
      const blend = load(await blendResponse.text());
      assert.equal(blend('form[action="/matches/respond"]').length, 1);
      assert.equal(blend('.mt-locked').length, 0);
      const profile = load(await (await app.request('/invite-public?lang=zh', { headers: recipientHeaders })).text());
      assert.equal(profile('.yt-profile').length, 1);
      assert.equal(profile('.yt-friendship button[value=accept]').text(), '接受好友邀請');
      assert.equal(profile('.yt-friendship [name=requestToken]').attr('value'), requestToken);
      assert.equal(profile('.yt-page-nav a').length, 2);
      if (decision === 'withdraw') {
        assert.equal((await post('/matches/withdraw', { requestToken, returnTo: '/matches' }, senderHeaders)).status, 302);
      } else {
        const response = await post('/matches/respond', {
          requestToken, actionToken: profile('.yt-friendship [name=actionToken]').attr('value')!, response: decision, returnTo: '/invite-public',
        }, recipientHeaders);
        assert.equal(response.status, 302);
      }
      assert.equal(registry.matchingRelationshipFor(recipient, sender.id).status, decision === 'accept' ? 'connected' : 'none');
      const after = load(await (await app.request('/invite-public', { headers: recipientHeaders })).text());
      assert.equal(after('form[action="/matches/respond"]').length, 0);
      assert.equal(after('form[action="/matches/withdraw"]').length, decision === 'accept' ? 1 : 0);
      assert.equal((await app.request('/invite-private/compare/invite-public', { headers: recipientHeaders })).status, 200);
      assert.equal((await app.request('/invite-private/insights', { headers: senderHeaders })).status, decision === 'accept' ? 200 : 404);
    } finally { registry.close(); }
  });
}
