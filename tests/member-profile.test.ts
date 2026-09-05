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
    assert.equal(directory('[data-friendship-tools] form').first().attr('action'), '/matches/request');
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
    assert.equal($('.mp-blend').length, 0);
    assert.equal($('.mt-actions form').attr('action'), '/matches/request');
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
