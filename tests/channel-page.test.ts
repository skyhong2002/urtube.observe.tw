import assert from 'node:assert/strict';
import { load } from 'cheerio';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Repository } from '../src/data/database.js';
import { createApp } from '../src/index.js';
import { UserRegistry, type User } from '../src/users.js';
import { MATCHING_TAXONOMY } from '../src/youtube/matching.js';
import { REGISTRY_CRYSTAL_VERSION, type RegistryMatchingCrystal } from '../src/youtube/registry-crystal.js';
import type { YoutubeParsedArchive, YoutubeVideoMetadata } from '../src/youtube/types.js';

const NOW = new Date('2026-09-05T08:00:00.000Z');
const CHANNEL_A = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const CHANNEL_B = 'UCbbbbbbbbbbbbbbbbbbbbbb';

function watch(id: string, videoId: string, channelId: string, watchedAt: string, seconds: number): YoutubeParsedArchive['watches'][number] {
  return {
    eventId: id, videoId, title: `Video ${videoId}`, url: `https://www.youtube.com/watch?v=${videoId}`,
    channelId, channelTitle: channelId === CHANNEL_A ? 'Channel A' : 'Channel B',
    channelUrl: '', watchedAt, actualWatchedSeconds: seconds, activityType: 'video',
  };
}

function seed(repository: Repository, label: string, events: YoutubeParsedArchive['watches']): void {
  repository.ingestYoutubeArchive({ archiveHash: `channel-fixture-${label}`, source: 'takeout', watches: events, searches: [] });
}

const ALICE = [
  watch('a1', 'AAAAAAAAAA1', CHANNEL_A, '2026-07-01T01:00:00Z', 1800),
  watch('a2', 'AAAAAAAAAA1', CHANNEL_A, '2026-08-02T01:00:00Z', 1800),
  watch('a3', 'AAAAAAAAAA2', CHANNEL_A, '2026-09-03T01:00:00Z', 600),
  watch('a4', 'BBBBBBBBBB1', CHANNEL_B, '2026-09-04T01:00:00Z', 900),
];
const BOB = [
  watch('b1', 'AAAAAAAAAA2', CHANNEL_A, '2026-08-30T01:00:00Z', 2400),
  watch('b2', 'BBBBBBBBBB1', CHANNEL_B, '2026-08-31T01:00:00Z', 1200),
];

function crystal(): RegistryMatchingCrystal {
  return {
    kind: 'matching', version: REGISTRY_CRYSTAL_VERSION, taxonomyVersion: MATCHING_TAXONOMY.version,
    generatedAt: '2026-09-05T12:00:00.000Z', windowDays: 90,
    data: { watchEvents: 240, uniqueVideos: 90, estimatedWatchSeconds: 140_000, activeDays: 20, topicCoverage: 1 },
    topics: [{ key: 'music', name: 'Music', share: 1 }],
    channels: [{ key: CHANNEL_A, name: 'Channel A', share: 1 }],
  };
}

function join_(registry: UserRegistry, user: User): void {
  registry.upsertMatchingCrystal(user, crystal());
  registry.setMatchingPreferences(user.handle, true, 'topics_and_channel');
}

test('channel detail ranks the channel, its videos, and months through one history', () => {
  const repository = new Repository(':memory:');
  try {
    seed(repository, 'alice', ALICE);
    const detail = repository.youtubeChannelDetail(CHANNEL_A, '365d', NOW);
    assert.equal(detail.channel?.name, 'Channel A');
    assert.equal(detail.stats.watches, 3);
    assert.equal(detail.stats.estimatedWatchSeconds, 4200);
    assert.equal(detail.stats.uniqueVideos, 2);
    assert.equal(detail.stats.firstWatchedAt, '2026-07-01T01:00:00Z');
    assert.equal(detail.stats.lastWatchedAt, '2026-09-03T01:00:00Z');
    assert.ok(Math.abs(detail.stats.share - 4200 / 5100) < 1e-12);
    assert.deepEqual(detail.rank, { time: 1, watches: 1, channels: 2 });
    assert.deepEqual(detail.videos.map((video) => [video.videoId, video.watches, video.estimatedWatchSeconds]),
      [['AAAAAAAAAA1', 2, 3600], ['AAAAAAAAAA2', 1, 600]]);
    assert.deepEqual(detail.monthly.map((entry) => [entry.month, entry.watches]), [['2026-07', 1], ['2026-08', 1], ['2026-09', 1]]);
    const b = repository.youtubeChannelDetail(CHANNEL_B, '365d', NOW);
    assert.deepEqual(b.rank, { time: 2, watches: 2, channels: 2 });
    const none = repository.youtubeChannelDetail('UCcccccccccccccccccccccc', '365d', NOW);
    assert.equal(none.channel, null);
    assert.equal(none.stats.watches, 0);
    assert.deepEqual(none.rank, { time: null, watches: null, channels: 2 });
    const narrow = repository.youtubeChannelDetail(CHANNEL_A, '28d', NOW);
    assert.equal(narrow.stats.watches, 1);
  } finally {
    repository.close();
  }
});

test('the channel page shows your history and reciprocal member rankings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-channel-page-'));
  const registry = new UserRegistry(join(root, 'users.sqlite'), join(root, 'users'));
  const app = createApp(registry);
  try {
    const alice = registry.createUser('alice-ch', 'Alice');
    const bob = registry.createUser('bob-ch', 'Bob');
    const loner = registry.createUser('loner-ch', 'Loner');
    join_(registry, alice);
    join_(registry, bob);
    registry.setMatchingPreferences(loner.handle, false, 'topics_and_channel');
    seed(registry.repositoryFor(alice), 'alice', ALICE);
    seed(registry.repositoryFor(bob), 'bob', BOB);
    seed(registry.repositoryFor(loner), 'loner', [watch('l1', 'AAAAAAAAAA1', CHANNEL_A, '2026-09-01T01:00:00Z', 9000)]);
    const metadata: YoutubeVideoMetadata = {
      videoId: 'AAAAAAAAAA1', title: 'Video AAAAAAAAAA1', channelId: CHANNEL_A, channelTitle: 'Channel A', description: '',
      tags: [], thumbnailUrl: 'https://i.ytimg.com/vi/AAAAAAAAAA1/hqdefault.jpg', durationSeconds: 1800, publishedAt: null,
      categoryId: '10', availability: 'available', metadataHash: 'h1',
    };
    registry.repositoryFor(alice).upsertYoutubeVideoMetadata([metadata]);
    const aliceCookie = `urtube_session=${registry.createSession(alice)}`;
    const lonerCookie = `urtube_session=${registry.createSession(loner)}`;

    assert.equal((await app.request(`/channel/${CHANNEL_A}`)).status, 302, 'anonymous visitors sign in first');
    assert.equal((await app.request('/channel/not-a-channel-id', { headers: { cookie: aliceCookie } })).status, 404);
    assert.equal((await app.request('/channel/UCzzzzzzzzzzzzzzzzzzzzzz', { headers: { cookie: aliceCookie } })).status, 404, 'unknown everywhere');

    const page = await app.request(`/channel/${CHANNEL_A}`, { headers: { cookie: aliceCookie } });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('x-robots-tag'), 'noindex');
    const htmlText = await page.text();
    assert.match(htmlText, /<h1>Channel A<\/h1>/);
    assert.match(htmlText, new RegExp(`https://www\\.youtube\\.com/channel/${CHANNEL_A}`));
    assert.match(htmlText, /\?range=365d&sort=duration" aria-current="page"/);
    assert.match(htmlText, /Rank of 2 channels/);
    assert.match(htmlText, /Your top videos from this channel/);
    assert.match(htmlText, /watch\?v=AAAAAAAAAA1/);
    assert.match(htmlText, /Your watch time by month/);
    // Members: Alice (4200 s) above Bob (2400 s); the non-member never appears.
    const viewers = load(htmlText)('.ch-rows[aria-label="Top viewers on urtube"]').closest('section').html()!;
    assert.match(viewers, /2 members watch this channel/);
    assert.ok(viewers.indexOf('Alice') < viewers.indexOf('Bob'));
    assert.match(viewers, /href="\/bob-ch"/);
    assert.match(viewers, /src="\/avatar\/member\/bob-ch"/);
    assert.doesNotMatch(viewers, /Loner|loner-ch/);
    assert.match(viewers, /#1 among their channels/);
    // Community videos: AAAAAAAAAA1 (Alice 3600 s) and AAAAAAAAAA2 (Alice 600 + Bob 2400 = 3000 s, 2 viewers).
    const community = htmlText.slice(htmlText.indexOf('Most watched by members'));
    assert.ok(community.indexOf('AAAAAAAAAA1') < community.indexOf('AAAAAAAAAA2'));
    assert.match(community, /2 viewers/);
    assert.doesNotMatch(community, /Loner/);

    // A non-member sees only their own history and an invitation to join.
    const lonerPage = await (await app.request(`/channel/${CHANNEL_A}`, { headers: { cookie: lonerCookie } })).text();
    assert.match(lonerPage, /Turn on friend discovery to see who else enjoys/);
    assert.doesNotMatch(lonerPage, /Alice|Bob|Most watched by members/);

    // Common channels remain gated by mutual consent on the comparison.
    registry.createMatchRequest(alice, registry.issueMatchActionToken(alice, bob.id, ['Music']));
    const request = registry.matchingInboxFor(bob).incoming[0]!;
    registry.respondToMatchRequest(bob, request.requestToken, 'accept');
    // Channel links progressively enhance to a drawer while retaining native links.
    const compare = await (await app.request('/alice-ch/compare/bob-ch', { headers: { cookie: aliceCookie } })).text();
    assert.match(compare, new RegExp(`href="/channel/${CHANNEL_A}"`));
    const comparisonHtml = load(compare);
    assert.equal(comparisonHtml(`a[href="/channel/${CHANNEL_A}"]:not([aria-hidden])`).first().attr('aria-haspopup'), 'dialog');
    assert.equal(comparisonHtml('dialog.cp-drawer').length, 1);
    assert.equal(page.headers.get('cache-control'), 'private, no-store');
    registry.setMatchingPreferences(bob.handle, false, 'topics_and_channel');
    const after = await (await app.request(`/channel/${CHANNEL_A}`, { headers: { cookie: aliceCookie } })).text();
    assert.doesNotMatch(after, /Bob|bob-ch|2 viewers/);
    assert.match(after, /1 member watches this channel/);
    registry.setMatchingPreferences(alice.handle, false, 'topics_and_channel');
    const left = await (await app.request(`/channel/${CHANNEL_A}`, { headers: { cookie: aliceCookie } })).text();
    assert.doesNotMatch(left, /Most watched by members/);
  } finally {
    registry.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('community rankings aggregate beyond each member’s top 50 and switch metrics', async () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-channel-ranking-'));
  const registry = new UserRegistry(join(root, 'users.sqlite'), join(root, 'users'));
  try {
    const alice = registry.createUser('alice-ranking', 'Alice');
    const bob = registry.createUser('bob-ranking', 'Bob');
    for (const user of [alice, bob]) join_(registry, user);
    for (const [prefix, user] of [['a', alice], ['b', bob]] as const) {
      const events = Array.from({ length: 50 }, (_, i) => watch(`${prefix}${i}`, `${prefix}${String(i).padStart(10, '0')}`, CHANNEL_A, '2026-09-01T01:00:00Z', 900));
      events.push(watch(`${prefix}-shared`, 'shared00001', CHANNEL_A, '2026-09-02T01:00:00Z', 600));
      if (prefix === 'a') {
        events.push(watch('a-repeat1', 'a0000000000', CHANNEL_A, '2026-09-03T01:00:00Z', 1));
        events.push(watch('a-repeat2', 'a0000000000', CHANNEL_A, '2026-09-04T01:00:00Z', 1));
      } else events.push(watch('b-extra', 'b0000000001', CHANNEL_A, '2026-09-03T01:00:00Z', 100));
      seed(registry.repositoryFor(user), user.handle, events);
    }
    const app = createApp(registry);
    const headers = { cookie: `urtube_session=${registry.createSession(alice)}` };
    const duration = await (await app.request(`/channel/${CHANNEL_A}?range=all`, { headers })).text();
    const community = duration.slice(duration.indexOf('Most watched by members'));
    assert.match(community, /watch\?v=shared00001/);
    assert.ok(community.indexOf('shared00001') < community.indexOf('a0000000000'), 'combined shared video leads even though neither person ranks it in their top 50');
    assert.match(community, /2 viewers/);
    const members = load(duration)('.ch-rows[aria-label="Top viewers on urtube"]').closest('section').html()!;
    assert.ok(members.indexOf('Bob') < members.indexOf('Alice'), 'Bob leads by time');
    const counts = await (await app.request(`/channel/${CHANNEL_A}?range=all&sort=watches`, { headers })).text();
    const countVideos = counts.slice(counts.indexOf('Most watched by members'));
    assert.ok(countVideos.indexOf('a0000000000') < countVideos.indexOf('shared00001'), 'repeated video leads by count');
    const countMembers = load(counts)('.ch-rows[aria-label="Top viewers on urtube"]').closest('section').html()!;
    assert.ok(countMembers.indexOf('Alice') < countMembers.indexOf('Bob'), 'Alice leads by count');
    assert.match(counts, /range=28d&sort=watches/);
    assert.match(counts, /Your watches by month/);
    const chinese = await (await app.request(`/channel/${CHANNEL_A}?range=all&sort=watches&lang=zh`, { headers })).text();
    assert.match(chinese, /成員最常看的影片/);
    assert.match(chinese, /你的逐月觀看次數/);
  } finally {
    registry.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('channel identity survives an empty range before metadata enrichment', () => {
  const repository = new Repository(':memory:');
  try {
    seed(repository, 'old', [watch('old', 'AAAAAAAAAA1', CHANNEL_A, '2020-01-01T01:00:00Z', 600)]);
    const detail = repository.youtubeChannelDetail(CHANNEL_A, '28d', NOW);
    assert.equal(detail.channel?.name, 'Channel A');
    assert.equal(detail.stats.watches, 0);
    assert.equal(detail.rank.time, null);
  } finally {
    repository.close();
  }
});

test('channel directory supports discovery, search, sorting and immediate membership withdrawal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-channel-directory-'));
  const registry = new UserRegistry(join(root, 'users.sqlite'), join(root, 'users'));
  try {
    const alice = registry.createUser('alice-directory', 'Alice');
    const bob = registry.createUser('bob-directory', 'Bob');
    const privateUser = registry.createUser('private-directory', 'Private');
    for (const user of [alice, bob]) join_(registry, user);
    registry.setMatchingPreferences(privateUser.handle, false, 'topics_and_channel');
    seed(registry.repositoryFor(alice), 'directory-alice', [
      watch('da1', 'AAAAAAAAAA1', CHANNEL_A, '2026-09-01T00:00:00Z', 900),
      watch('da2', 'BBBBBBBBBB1', CHANNEL_B, '2026-09-02T00:00:00Z', 100),
      watch('da3', 'BBBBBBBBBB1', CHANNEL_B, '2026-09-03T00:00:00Z', 100),
    ]);
    seed(registry.repositoryFor(bob), 'directory-bob', [watch('db1', 'BBBBBBBBBB1', CHANNEL_B, '2026-09-02T00:00:00Z', 3000)]);
    const hiddenChannel = 'UCcccccccccccccccccccccc';
    seed(registry.repositoryFor(privateUser), 'directory-private', [{
      ...watch('dp1', 'CCCCCCCCCC1', hiddenChannel, '2026-09-02T00:00:00Z', 9999), channelTitle: 'Private channel',
    }]);
    const app = createApp(registry);
    const headers = { cookie: `urtube_session=${registry.createSession(alice)}` };
    const response = await app.request('/channel/?range=all', { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
    const markup = await response.text();
    const $ = load(markup);
    assert.ok(markup.indexOf('<h2>Popular channels among members') < markup.indexOf('<h2>Your most watched channels'), 'community discovery precedes personal rankings');
    const names = (label: string) => $(`.ch-rows[aria-label="${label}"] .ch-main strong a`).map((_, el) => $(el).text()).get();
    assert.deepEqual(names('Your most watched channels'), ['Channel A', 'Channel B']);
    assert.deepEqual(names('Popular channels among members'), ['Channel B', 'Channel A']);
    assert.doesNotMatch(markup, /Private channel|UCcccccccccccccccccccccc/);
    assert.equal($('.site-nav a[aria-current="page"]').attr('href'), '/channel/');
    const href = $('.ch-main strong a').first().attr('href')!;
    assert.equal((await app.request(href, { headers })).status, 200, 'directory opens working detail links');
    const counts = load(await (await app.request('/channel/?range=all&sort=watches', { headers })).text());
    assert.equal(counts('.ch-rows[aria-label="Your most watched channels"] .ch-main strong a').first().text(), 'Channel B');
    const filtered = await (await app.request('/channel/?range=all&q=Channel%20B', { headers })).text();
    assert.doesNotMatch(filtered, />Channel A</);
    assert.match(filtered, />Channel B</);
    const byId = await (await app.request(`/channel/?range=all&q=${CHANNEL_A}`, { headers })).text();
    assert.match(byId, />Channel A</);
    assert.doesNotMatch(byId, />Channel B</);
    const empty = await (await app.request('/channel/?q=%22%3E%3Cscript%3E', { headers })).text();
    assert.match(empty, /No channels found/);
    assert.match(empty, /value="&quot;&gt;&lt;script&gt;"/);
    const redirect = await app.request('/channel?range=all&sort=watches', { headers });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get('location'), '/channel/?range=all&sort=watches');
    const anonymous = await app.request('/channel/?range=all&q=Channel');
    assert.equal(anonymous.status, 302);
    assert.equal(anonymous.headers.get('location'), '/auth/google?next=%2Fchannel%2F%3Frange%3Dall%26q%3DChannel');

    registry.setMatchingPreferences(bob.handle, false, 'topics_and_channel');
    const after = load(await (await app.request('/channel/?range=all', { headers })).text());
    assert.equal(after('.ch-rows[aria-label="Popular channels among members"] .ch-main strong a').first().text(), 'Channel A', 'cached totals stop contributing when a member leaves');
    assert.doesNotMatch(after.html(), /2 viewers/);
    registry.setMatchingPreferences(alice.handle, false, 'topics_and_channel');
    const optedOut = load(await (await app.request('/channel/?range=all', { headers })).text());
    assert.equal(optedOut('.ch-rows[aria-label="Popular channels among members"]').length, 0);
    assert.equal(optedOut('.ch-rows[aria-label="Your most watched channels"] .ch-row').length, 2);
  } finally {
    registry.close();
    rmSync(root, { recursive: true, force: true });
  }
});
