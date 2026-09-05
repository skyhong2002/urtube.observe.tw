import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { UserRegistry } from '../src/users.js';
import { MATCHING_TAXONOMY } from '../src/youtube/matching.js';
import { REGISTRY_CRYSTAL_VERSION, type RegistryMatchingCrystal } from '../src/youtube/registry-crystal.js';

const crystal: RegistryMatchingCrystal = {
  kind: 'matching', version: REGISTRY_CRYSTAL_VERSION, taxonomyVersion: MATCHING_TAXONOMY.version,
  generatedAt: '2026-09-05T12:00:00Z', windowDays: 90,
  data: { watchEvents: 240, uniqueVideos: 90, estimatedWatchSeconds: 140000, activeDays: 20, topicCoverage: 1 },
  topics: [{ key: 'music', name: 'Music', share: 1 }],
  channels: [{ key: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Music Channel', share: 1 }],
};

test('member links open identity profiles while private history and dashboard keys retain their access rules', async () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-member-profile-'));
  const registry = new UserRegistry(join(root, 'users.sqlite'), join(root, 'users'));
  try {
    const alice = registry.createUser('profile-alice', 'Alice');
    const bob = registry.createUser('profile-bob', 'Bob <script>alert(1)</script>');
    const newcomer = registry.createUser('profile-new', 'New member');
    for (const user of [alice, bob]) {
      registry.upsertMatchingCrystal(user, crystal);
      registry.setMatchingPreferences(user.handle, true, 'topics_and_channel');
    }
    registry.setMatchingProfile(bob.handle, 'Legacy private biography', '@private-contact');
    registry.repositoryFor(bob).ingestYoutubeArchive({ archiveHash: 'profile-private', source: 'takeout', searches: [], watches: [{
      eventId: 'secret-watch', videoId: 'AAAAAAAAAA1', title: 'Private watch title', url: 'https://www.youtube.com/watch?v=AAAAAAAAAA1',
      channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', channelTitle: 'Private watch channel', channelUrl: '', watchedAt: '2026-09-04T01:23:45Z', actualWatchedSeconds: 321, activityType: 'video',
    }] });
    const app = createApp(registry);
    const token = registry.createSession(alice);
    const headers = { cookie: `urtube_session=${token}` };
    const directory = load(await (await app.request('/matches', { headers })).text());
    assert.equal(directory('.mt-person-link').first().attr('href'), '/profile-bob');
    assert.equal(directory('.mt-actions .mt-want').first().attr('href'), '/profile-alice/compare/profile-bob');
    const response = await app.request('/profile-bob?lang=zh', { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
    const markup = await response.text();
    const $ = load(markup);
    assert.equal($('.mp-profile h1').text(), bob.displayName);
    assert.equal($('.mp-profile script').length, 0);
    assert.equal($('.mp-pills').text(), 'Music');
    assert.equal($('.mp-profile img').attr('src'), '/avatar/member/profile-bob');
    const blendHref = $('.mp-blend').attr('href')!;
    assert.equal((await app.request(blendHref, { headers })).status, 200);
    assert.doesNotMatch(markup, /Private watch|2026-09-04T01:23:45|Legacy private biography|@private-contact/);
    assert.ok(!markup.includes(bob.dashboardToken));
    for (const path of ['/profile-bob/history', '/profile-bob/insights', '/profile-bob/recap', '/u/profile-bob/summary.json', '/u/profile-bob/crystal.json']) {
      assert.equal((await app.request(path, { headers })).status, 404, path);
    }
    assert.equal((await app.request('/profile-bob')).status, 404);
    assert.equal((await app.request('/not-a-member', { headers })).status, 404);
    const basic = load(await (await app.request('/profile-new', { headers })).text());
    assert.equal(basic('.mp-profile h1').text(), newcomer.displayName);
    assert.equal(basic('.mp-blend,.mp-interests').length, 0);
    registry.setMatchingPreferences(bob.handle, false, 'topics_and_channel');
    const optedOut = load(await (await app.request('/profile-bob', { headers })).text());
    assert.equal(optedOut('.mp-profile').length, 1);
    assert.equal(optedOut('.mp-blend,.mp-interests,.mp-profile img').length, 0);
    const owner = load(await (await app.request('/profile-bob', { headers: { cookie: `urtube_session=${registry.createSession(bob)}` } })).text());
    assert.equal(owner('.yt-profile').length, 1);
    const keyed = load(await (await app.request(`/profile-bob?key=${bob.dashboardToken}`, { headers })).text());
    assert.equal(keyed('.yt-profile').length, 1);
    registry.setDashboardPublic(bob.handle, true);
    const published = load(await (await app.request('/profile-bob', { headers })).text());
    assert.equal(published('.yt-profile').length, 1);
    assert.equal(published('.mp-profile').length, 0);
    registry.deleteSession(token);
    assert.equal((await app.request('/profile-new', { headers })).status, 404);
  } finally { registry.close(); rmSync(root, { recursive: true, force: true }); }
});

test('friend profiles show only the target side of unlocked Blend and revoke it immediately', async () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-friend-profile-'));
  const registry = new UserRegistry(join(root, 'users.sqlite'), join(root, 'users'));
  try {
    const alice = registry.createUser('friend-alice', 'Alice');
    const bob = registry.createUser('friend-bob', 'Bob');
    const carol = registry.createUser('friend-carol', 'Carol');
    const headersFor = (user: typeof alice) => ({ cookie: `urtube_session=${registry.createSession(user)}` });
    const aliceHeaders = headersFor(alice), bobHeaders = headersFor(bob), carolHeaders = headersFor(carol);
    for (const user of [alice, bob, carol]) {
      registry.upsertMatchingCrystal(user, crystal);
      registry.setMatchingPreferences(user.handle, true, 'topics_and_channel');
    }
    const watch = (id: string, date: string, secret = false) => ({
      eventId: id, videoId: secret ? 'BBBBBBBBBB1' : 'AAAAAAAAAA1', title: secret ? 'Secret middle watch' : 'Shared video',
      url: `https://www.youtube.com/watch?v=${secret ? 'BBBBBBBBBB1' : 'AAAAAAAAAA1'}`,
      channelId: secret ? 'UCbbbbbbbbbbbbbbbbbbbbbb' : 'UCaaaaaaaaaaaaaaaaaaaaaa', channelTitle: secret ? 'Secret unshared channel' : 'Shared channel',
      channelUrl: '', watchedAt: date, actualWatchedSeconds: 600, activityType: 'video' as const,
    });
    for (const user of [alice, bob]) registry.repositoryFor(user).ingestYoutubeArchive({
      archiveHash: user.handle, source: 'takeout', searches: [], watches: [
        watch(`${user.handle}-old`, '2026-06-01T03:00:00Z'),
        ...(user === bob ? [watch('private-middle', '2026-09-03T04:56:00Z', true)] : []),
        watch(`${user.handle}-recent`, '2026-09-04T05:00:00Z'),
      ],
    });
    const app = createApp(registry);
    const path = '/friend-bob?range=all&lang=en';
    const read = async (url: string, headers = aliceHeaders) => load(await (await app.request(url, { headers })).text());
    assert.equal((await read(path))('.fp-profile').length, 0);
    registry.createMatchRequest(alice, registry.issueMatchActionToken(alice, bob.id, ['Music']));
    const request = registry.matchingInboxFor(bob).incoming[0]!;
    assert.equal((await read(path))('.fp-profile').length, 0, 'one-sided interest does not unlock');
    registry.respondToMatchRequest(bob, request.requestToken, 'accept');
    const response = await app.request(path, { headers: aliceHeaders });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
    const markup = await response.text(), $ = load(markup);
    assert.equal($('.mp-profile h1').text(), 'Bob');
    assert.equal($('.fp-profile').length, 1);
    assert.equal($('.fp-stats strong').first().text(), '3');
    assert.equal($('.fp-profile [data-channel-preview]').first().attr('href'), '/channel/UCaaaaaaaaaaaaaaaaaaaaaa');
    assert.match($('.fp-profile').text(), /Shared video|Weekdays|Average watch time/);
    assert.doesNotMatch(markup, /Secret middle watch|Secret unshared channel|2026-09-03T04:56:00Z|statistics are not public/);
    assert.equal($('dialog.cp-drawer').length, 1);
    const blend = await read('/friend-alice/compare/friend-bob?range=all&lang=en');
    assert.equal($('.fp-stats strong').first().text(), blend('.mt-stat-row').first().find('strong').last().text());
    assert.equal((await read('/friend-bob?range=28d'))('.fp-stats strong').first().text(), '2');
    assert.equal((await read('/friend-alice?range=all', bobHeaders))('.fp-stats strong').first().text(), '2', 'reverse visit shows Alice, not Bob');
    assert.equal((await read(path, carolHeaders))('.fp-profile').length, 0);
    for (const url of ['/friend-bob/history', '/u/friend-bob/summary.json', '/u/friend-bob/crystal.json']) assert.equal((await app.request(url, { headers: aliceHeaders })).status, 404);
    registry.withdrawMatchRequest(alice, request.requestToken);
    const revoked = await read(path);
    assert.equal(revoked('.fp-profile').length, 0, 'withdrawal invalidates already cached aggregates');
    assert.match(revoked('.mp-note').text(), /statistics are not public/);
    registry.createMatchRequest(carol, registry.issueMatchActionToken(carol, bob.id, ['Music']));
    registry.respondToMatchRequest(bob, registry.matchingInboxFor(bob).incoming[0]!.requestToken, 'accept');
    assert.equal((await read(path, carolHeaders))('.fp-profile').length, 1);
    registry.setMatchingPreferences(bob.handle, false, 'topics_and_channel');
    assert.equal((await read(path, carolHeaders))('.fp-profile').length, 0, 'opt-out invalidates already cached aggregates');
  } finally { registry.close(); rmSync(root, { recursive: true, force: true }); }
});
