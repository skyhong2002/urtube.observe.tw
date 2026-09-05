import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Repository } from '../src/data/database.js';
import { createApp } from '../src/index.js';
import { UserRegistry, type User } from '../src/users.js';
import {
  compareWatchProfiles,
  comparisonRange,
  type ComparisonAccess,
} from '../src/youtube/comparison.js';
import { MATCHING_TAXONOMY } from '../src/youtube/matching.js';
import {
  REGISTRY_CRYSTAL_VERSION,
  type RegistryMatchingCrystal,
} from '../src/youtube/registry-crystal.js';
import type { YoutubeComparisonProfile, YoutubeParsedArchive, YoutubeVideoMetadata } from '../src/youtube/types.js';

const NOW = new Date('2026-09-05T08:00:00.000Z');

function watch(
  id: string,
  videoId: string,
  channel: string,
  watchedAt: string,
  seconds: number,
): YoutubeParsedArchive['watches'][number] {
  return {
    eventId: id,
    videoId,
    title: `Video ${videoId}`,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    channelId: `channel-${channel}`,
    channelTitle: `Channel ${channel.toUpperCase()}`,
    channelUrl: `https://www.youtube.com/channel/channel-${channel}`,
    watchedAt,
    actualWatchedSeconds: seconds,
    activityType: 'video',
  };
}

function seed(repository: Repository, label: string, events: YoutubeParsedArchive['watches']): void {
  repository.ingestYoutubeArchive({
    archiveHash: `comparison-fixture-${label}`,
    source: 'takeout',
    watches: events,
    searches: [],
  });
}

// Alice: channel A dominates, then B. Bob: B dominates, A second, plus one
// video only he watched. Video AAAAAAAAAA1 is common; AAAAAAAAAA2 is not.
const ALICE_EVENTS = [
  watch('a1', 'AAAAAAAAAA1', 'a', '2026-09-01T01:00:00Z', 1800), // Tue 09:00 Taipei
  watch('a2', 'AAAAAAAAAA1', 'a', '2026-09-02T01:00:00Z', 1800), // Wed 09:00
  watch('a3', 'AAAAAAAAAA2', 'a', '2026-09-03T14:00:00Z', 600), // Thu 22:00
  watch('a4', 'BBBBBBBBBB1', 'b', '2026-09-04T14:00:00Z', 900), // Fri 22:00
];
const BOB_EVENTS = [
  watch('b1', 'BBBBBBBBBB1', 'b', '2026-08-30T14:00:00Z', 2400), // Sat 22:00
  watch('b2', 'BBBBBBBBBB2', 'b', '2026-08-31T14:00:00Z', 1200), // Sun 22:00
  watch('b3', 'AAAAAAAAAA1', 'a', '2026-09-01T14:00:00Z', 600), // Tue 22:00
];

function profile(overrides: Partial<YoutubeComparisonProfile> = {}): YoutubeComparisonProfile {
  return {
    range: '28d',
    stats: { watchEvents: 10, estimatedWatchSeconds: 7200, uniqueVideos: 8, uniqueChannels: 3, activeDays: 4 },
    channels: [],
    shortsChannels: [],
    videos: [],
    topics: [],
    hourly: [],
    weekdays: [],
    weekdayDays: [4, 4, 4, 4, 4, 4, 4],
    rhythmCoverage: { exactWatches: 10, dateOnlyWatches: 0 },
    firstWatch: null,
    lastWatch: null,
    ...overrides,
  };
}

const OPEN: ComparisonAccess = { connected: true };
const LOCKED: ComparisonAccess = { connected: false };

test('comparison profile ranks channels, videos, and rhythm from one repository', () => {
  const repository = new Repository(':memory:');
  try {
    seed(repository, 'alice', ALICE_EVENTS);
    const result = repository.youtubeComparisonProfile(MATCHING_TAXONOMY.version, '28d', NOW);
    assert.equal(result.stats.watchEvents, 4);
    assert.equal(result.stats.uniqueVideos, 3);
    assert.equal(result.stats.uniqueChannels, 2);
    assert.equal(result.stats.activeDays, 4);
    assert.equal(result.stats.estimatedWatchSeconds, 5100);
    assert.deepEqual(result.channels.map((channel) => [channel.name, channel.rank, channel.watches]),
      [['Channel A', 1, 3], ['Channel B', 2, 1]]);
    assert.deepEqual(result.videos.map((video) => [video.videoId, video.rank, video.watches]),
      [['AAAAAAAAAA1', 1, 2], ['BBBBBBBBBB1', 2, 1], ['AAAAAAAAAA2', 3, 1]]);
    assert.deepEqual(result.hourly.map((entry) => [entry.hour, entry.watches]), [[9, 2], [22, 2]]);
    // Tue=2, Wed=3, Thu=4, Fri=5 in Taipei time.
    assert.deepEqual(result.weekdays.map((entry) => [entry.weekday, entry.watches]),
      [[2, 1], [3, 1], [4, 1], [5, 1]]);
    assert.equal(result.rhythmCoverage.exactWatches, 4);
    assert.equal(result.firstWatch?.watchedAt, '2026-09-01T01:00:00Z');
    assert.equal(result.lastWatch?.title, 'Video BBBBBBBBBB1');
    // Range cutoffs apply to every section.
    const narrow = repository.youtubeComparisonProfile(MATCHING_TAXONOMY.version, '28d', new Date('2026-10-15T00:00:00Z'));
    assert.equal(narrow.stats.watchEvents, 0);
    assert.equal(narrow.firstWatch, null);
    assert.equal(narrow.channels.length, 0);
  } finally {
    repository.close();
  }
});

test('compareWatchProfiles keeps volume private until both people choose to meet', () => {
  const alice = profile({
    topics: [
      { key: 'music', rank: 1, watchRank: 1, watches: 6, estimatedWatchSeconds: 5000 },
      { key: 'gaming', rank: 2, watchRank: 2, watches: 3, estimatedWatchSeconds: 1500 },
      { key: 'comedy', rank: 3, watchRank: 3, watches: 1, estimatedWatchSeconds: 700 },
    ],
    channels: [{ key: 'c1', name: 'Shared', thumbnailUrl: '', rank: 1, watchRank: 1, watches: 5, estimatedWatchSeconds: 3000 }],
    videos: [{ videoId: 'v1', title: 'Shared video', channelTitle: 'Shared', thumbnailUrl: '', rank: 1, watchRank: 1, watches: 2, estimatedWatchSeconds: 1200 }],
    hourly: [{ hour: 9, watches: 3, estimatedWatchSeconds: 900 }, { hour: 21, watches: 1, estimatedWatchSeconds: 300 }],
    weekdays: [{ weekday: 1, watches: 3, estimatedWatchSeconds: 900 }, { weekday: 6, watches: 1, estimatedWatchSeconds: 300 }],
    firstWatch: { title: 'Shared video', watchedAt: '2026-08-01T00:00:00Z' },
  });
  const bob = profile({
    topics: [
      { key: 'gaming', rank: 1, watchRank: 1, watches: 9, estimatedWatchSeconds: 6000 },
      { key: 'music', rank: 2, watchRank: 2, watches: 2, estimatedWatchSeconds: 900 },
      { key: 'comedy', rank: 3, watchRank: 3, watches: 1, estimatedWatchSeconds: 100 },
    ],
    channels: [{ key: 'c1', name: 'Shared', thumbnailUrl: 'https://img/shared.jpg', rank: 4, watchRank: 5, watches: 1, estimatedWatchSeconds: 300 }],
    videos: [{ videoId: 'v1', title: 'Shared video', channelTitle: 'Shared', thumbnailUrl: '', rank: 7, watchRank: 9, watches: 1, estimatedWatchSeconds: 300 }],
    hourly: [{ hour: 9, watches: 1, estimatedWatchSeconds: 100 }],
    rhythmCoverage: { exactWatches: 1, dateOnlyWatches: 5 },
  });

  const locked = compareWatchProfiles(alice, bob, '28d', LOCKED);
  assert.equal(locked.stats, null);
  assert.equal(locked.topics.state, 'locked');
  // Blend order (geometric mean of shares) is symmetric: gaming is big for
  // both, music big for Alice only, comedy small for both.
  assert.deepEqual(locked.topics.items.map((topic) => [topic.name, topic.seconds.rank.a, topic.seconds.rank.b, topic.valuesVisible]),
    [['Gaming', 2, 1, false], ['Music', 1, 2, false], ['Comedy', 3, 3, false]]);
  assert.deepEqual(locked.topics.items[0]?.seconds.value, { a: 0, b: 0 }, 'locked topics carry no volume');
  const mirrored = compareWatchProfiles(bob, alice, '28d', LOCKED);
  assert.deepEqual(mirrored.topics.items.map((topic) => topic.name), ['Gaming', 'Music', 'Comedy'], 'the other person sees the same order');
  assert.deepEqual(mirrored.topics.items[0]?.seconds.rank, { a: 1, b: 2 });
  assert.equal(locked.channels.state, 'locked');
  assert.equal(locked.channels.items.length, 0);
  assert.equal(locked.videos.state, 'locked');
  assert.equal(locked.clock.mode, 'share');
  assert.equal(locked.clock.a.watches[9], 0.75);
  assert.equal(locked.clock.a.watches[21], 0.25);
  assert.equal(locked.clock.b.reliable, false, 'date-only rows dominate Bob, so no clock');
  assert.equal(locked.weekdays.mode, 'share');
  assert.deepEqual(locked.weekdays.rows[0], { weekday: 1, watches: { a: 0.75, b: 0 }, seconds: { a: 0.75, b: 0 } });
  assert.equal(locked.weekdays.rows[6]?.weekday, 0, 'Sunday closes the week');
  assert.equal(locked.firstWatch, null);
  assert.equal(locked.lastWatch, null);

  const unlocked = compareWatchProfiles(alice, bob, 'all', OPEN);
  assert.equal(unlocked.stats?.[0]?.key, 'watchEvents');
  assert.deepEqual(unlocked.stats?.find((row) => row.key === 'hours'), { key: 'hours', a: 2, b: 2 });
  assert.equal(unlocked.topics.state, 'unlocked');
  assert.equal(unlocked.topics.total, 3);
  assert.deepEqual(unlocked.topics.items[0]?.watches.value, { a: 3, b: 9 });
  assert.equal(unlocked.topics.items[0]?.valuesVisible, true);
  const channel = unlocked.channels.items[0]!;
  assert.equal(unlocked.channels.items.length, 1);
  assert.equal(channel.name, 'Shared');
  assert.equal(channel.thumbnailUrl, 'https://img/shared.jpg');
  assert.deepEqual(channel.seconds.rank, { a: 1, b: 4 });
  assert.deepEqual(channel.seconds.value, { a: 3000, b: 300 });
  assert.deepEqual(channel.watches.rank, { a: 1, b: 5 });
  assert.deepEqual(channel.watches.value, { a: 5, b: 1 });
  assert.ok(Math.abs(channel.seconds.blend - Math.sqrt((3000 / 7200) * (300 / 7200))) < 1e-12);
  assert.equal(unlocked.shortsChannels.state, 'unlocked');
  assert.deepEqual(unlocked.shortsChannels.items, []);
  assert.equal(unlocked.videos.items[0]?.seconds.rank.b, 7);
  assert.equal(unlocked.videos.items[0]?.watches.rank.b, 9);
  assert.equal(unlocked.clock.mode, 'absolute');
  assert.equal(unlocked.clock.a.watches[9], 3);
  assert.equal(unlocked.firstWatch?.a?.title, 'Shared video');

  assert.equal(comparisonRange('365d'), '365d');
  assert.equal(comparisonRange('7d'), '365d', 'unsupported ranges fall back to the default');
  assert.equal(comparisonRange(undefined), '365d');
});

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
    data: { watchEvents: 240, uniqueVideos: 90, estimatedWatchSeconds: 140_000, activeDays: 20, topicCoverage: 1 },
    topics: [topic('music', 0.7), topic('gaming', 0.3)],
    channels: [{ key: 'channel-a', name: 'Channel A', share: 1 }],
  };
}

function publish(registry: UserRegistry, user: User): void {
  registry.upsertMatchingCrystal(user, crystal());
  registry.setMatchingPreferences(user.handle, true, 'topics_and_channel');
}

function form(values: Record<string, string>, cookie: string): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(values).toString(),
  };
}

test('the compare page is a stats.fm style side-by-side that unlocks on mutual consent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-compare-'));
  const registry = new UserRegistry(join(root, 'users.sqlite'), join(root, 'users'));
  const app = createApp(registry);
  try {
    const alice = registry.createUser('alice-cmp', 'Alice');
    const bob = registry.createUser('bob-cmp', 'Bob');
    publish(registry, alice);
    publish(registry, bob);
    seed(registry.repositoryFor(alice), 'alice', ALICE_EVENTS);
    seed(registry.repositoryFor(bob), 'bob', BOB_EVENTS);
    // AAAAAAAAAA1 is a Short (two minutes) for both people.
    for (const user of [alice, bob]) {
      registry.repositoryFor(user).upsertYoutubeVideoMetadata([
        { ...metadata('AAAAAAAAAA1', 'channel-a', 'Channel A'), durationSeconds: 120 },
      ]);
    }
    const aliceCookie = `urtube_session=${registry.createSession(alice)}`;
    const bobCookie = `urtube_session=${registry.createSession(bob)}`;

    const directory = await (await app.request('/matches', { headers: { cookie: aliceCookie } })).text();
    assert.match(directory, /action="\/matches\/request"/);
    const comparePath = '/alice-cmp/compare/bob-cmp';
    const actionTokenIn = (html: string) => {
      const match = html.match(/name="actionToken" value="([A-Za-z0-9_-]+)"/);
      assert.ok(match, 'comparison page mints an action token for its forms');
      return match[1]!;
    };

    const locked = await app.request(`${comparePath}?range=all`, { headers: { cookie: aliceCookie } });
    assert.equal(locked.status, 302);
    assert.equal(locked.headers.get('location'), '/bob-cmp?range=all');
    const lockedHtml = await (await app.request('/bob-cmp', { headers: { cookie: aliceCookie } })).text();
    assert.match(lockedHtml, /Add friend/);
    assert.doesNotMatch(lockedHtml, /class="mt-stat-row"|youtube\.com\/watch/);

    await app.request('/matches/request', form({ actionToken: actionTokenIn(lockedHtml) }, aliceCookie));
    const request = registry.matchingInboxFor(bob).incoming[0];
    assert.ok(request);
    const bobView = await (await app.request('/alice-cmp', { headers: { cookie: bobCookie } })).text();
    await app.request('/matches/respond', form({
      actionToken: actionTokenIn(bobView), requestToken: request.requestToken, response: 'accept',
    }, bobCookie));

    const unlockedHtml = await (await app.request(`${comparePath}?range=all`, {
      headers: { cookie: aliceCookie },
    })).text();
    assert.doesNotMatch(unlockedHtml, /You are friends|More shared interests unlocked/);
    assert.match(unlockedHtml, /Remove friend/);
    // Stats block: Alice 4 events, Bob 3; distinct channels 2 and 2.
    assert.match(unlockedHtml, /<div class="mt-stat-row"><strong>4<\/strong><span>Watch events<\/span><strong>3<\/strong><\/div>/);
    assert.match(unlockedHtml, /<strong>2<\/strong><span>Distinct channels<\/span><strong>2<\/strong>/);
    // Common channels with each person's rank: A is #1 for Alice, #2 for Bob.
    assert.match(unlockedHtml, /2 in common with Bob/);
    assert.match(unlockedHtml, /<b>#1<\/b><small>3×<\/small><\/span><div class="mt-row-main">(?:(?!<\/div>).)*Channel A(?:(?!<\/div>).)*<\/div><span class="mt-rank"[^>]*><b>#2<\/b><small>1×<\/small>/);
    // Common videos: AAAAAAAAAA1 is #1 for Alice and #3 for Bob; BBBBBBBBBB1 #2 / #1.
    assert.match(unlockedHtml, /Video AAAAAAAAAA1/);
    assert.match(unlockedHtml, /Video BBBBBBBBBB1/);
    // Every channel and video links out; name-keyed channels fall back to a search.
    assert.match(unlockedHtml, /href="https:\/\/www\.youtube\.com\/results\?search_query=Channel%20A"/);
    assert.match(unlockedHtml, /href="https:\/\/www\.youtube\.com\/watch\?v=AAAAAAAAAA1"/);
    // Both metric panels are rendered; the Shorts list only has Channel A.
    assert.equal((unlockedHtml.match(/data-metric-panel="seconds"/g) ?? []).length, (unlockedHtml.match(/data-metric-panel="watches" hidden/g) ?? []).length);
    const shorts = unlockedHtml.slice(unlockedHtml.indexOf('Shorts channels in common'), unlockedHtml.indexOf('Videos in common'));
    assert.match(shorts, /1 in common with Bob/);
    assert.match(shorts, /Channel A/);
    assert.doesNotMatch(shorts, /Channel B/);
    assert.doesNotMatch(unlockedHtml, /Video AAAAAAAAAA2|Video BBBBBBBBBB2/, 'videos only one person watched never cross');
    assert.match(unlockedHtml, /First watch/);
    assert.match(unlockedHtml, /Last watch/);
    assert.match(unlockedHtml, /Sep 1, 2026/);
    assert.doesNotMatch(unlockedHtml, /T01:00:00|01:00:00Z/, 'edges are calendar days, never exact timestamps');
    assert.doesNotMatch(unlockedHtml, /own watches/, 'absolute rhythm once connected');
    assert.doesNotMatch(unlockedHtml, /candidateUserId/);

    // Range switch narrows every section; the page always stays available.
    const narrow = await (await app.request(`${comparePath}?range=28d`, {
      headers: { cookie: aliceCookie },
    })).text();
    assert.match(narrow, /\?range=28d" aria-current="page"/);
    assert.match(narrow, /Video AAAAAAAAAA1/);

    seed(registry.repositoryFor(bob), 'bob-day-only', Array.from({ length: 5 }, (_, i) => ({
      ...watch(`day-${i}`, 'BBBBBBBBBB1', 'b', `2026-08-${20 + i}T00:00:00Z`, 600), precision: 'day' as const,
    })));
    const clockHtml = await (await app.request(`${comparePath}?range=all`, { headers: { cookie: aliceCookie } })).text();
    assert.match(clockHtml, /They need to import their YouTube history from Google Takeout/);
    assert.doesNotMatch(clockHtml, /href="\/account\?lang=en#account-takeout"/);
    const bobComparison = await (await app.request('/bob-cmp/compare/alice-cmp?range=all&lang=zh', {
      headers: { cookie: bobCookie },
    })).text();
    assert.match(bobComparison, /href="\/account\?lang=zh#account-takeout"/);
    assert.match(bobComparison, /請匯入 Google Takeout/);
    const importPage = await (await app.request('/account?lang=zh', { headers: { cookie: bobCookie } })).text();
    assert.match(importPage, /<section id="account-takeout"/);

    // Leaving matching revokes Blend and returns to the basic identity page.
    registry.setMatchingPreferences(bob.handle, false, 'topics_and_channel');
    assert.equal((await app.request(`${comparePath}?range=all`, {
      headers: { cookie: aliceCookie },
    })).status, 302);
  } finally {
    registry.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function metadata(videoId: string, channelId: string, channelTitle: string): YoutubeVideoMetadata {
  return {
    videoId, title: `Video ${videoId}`, channelId, channelTitle, description: '', tags: [],
    thumbnailUrl: '', durationSeconds: 600, publishedAt: null, categoryId: '10',
    availability: 'available', metadataHash: `hash-${videoId}`,
  };
}

test('channel ids backfill onto capture events so channels key the same way for everyone', () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-channel-backfill-'));
  const path = join(root, 'archive.sqlite');
  try {
    let repository = new Repository(path);
    // One Takeout-style event with the id, two extension-style events that
    // only know the title, one with no channel at all.
    seed(repository, 'mixed', [
      watch('t1', 'AAAAAAAAAA1', 'a', '2026-09-01T01:00:00Z', 600),
      { ...watch('x1', 'AAAAAAAAAA1', 'a', '2026-09-02T01:00:00Z', 600), channelId: null, channelUrl: '' },
      { ...watch('x2', 'AAAAAAAAAA2', 'a', '2026-09-03T01:00:00Z', 600), channelId: null, channelUrl: '' },
      { ...watch('x3', 'CCCCCCCCCC1', 'c', '2026-09-04T01:00:00Z', 600), channelId: null, channelTitle: null, channelUrl: '' },
    ]);
    const before = repository.youtubeComparisonProfile(MATCHING_TAXONOMY.version, 'all', NOW);
    assert.equal(before.stats.uniqueChannels, 2, 'title-only events already collapse onto the id via the video row where possible');

    repository.upsertYoutubeVideoMetadata([
      metadata('AAAAAAAAAA2', 'channel-a', 'Channel A'),
      metadata('CCCCCCCCCC1', 'channel-c', 'Channel C'),
    ]);
    const db = new DatabaseSync(path, { readOnly: true });
    const rows = (db.prepare('SELECT event_id, channel_id, channel_title FROM youtube_watch_events ORDER BY event_id').all() as Array<Record<string, unknown>>).map((row) => ({ ...row }));
    db.close();
    assert.deepEqual(rows, [
      { event_id: 't1', channel_id: 'channel-a', channel_title: 'Channel A' },
      { event_id: 'x1', channel_id: 'channel-a', channel_title: 'Channel A' },
      { event_id: 'x2', channel_id: 'channel-a', channel_title: 'Channel A' },
      { event_id: 'x3', channel_id: 'channel-c', channel_title: 'Channel C' },
    ]);
    const after = repository.youtubeComparisonProfile(MATCHING_TAXONOMY.version, 'all', NOW);
    assert.deepEqual(after.channels.map((channel) => [channel.key, channel.watches]), [['channel-a', 3], ['channel-c', 1]]);
    repository.close();

    // Rows that predate the backfill are repaired when the archive is opened.
    const direct = new DatabaseSync(path);
    direct.prepare("UPDATE youtube_watch_events SET channel_id=NULL WHERE event_id IN ('x1', 'x3')").run();
    direct.close();
    repository = new Repository(path);
    const reopened = new DatabaseSync(path, { readOnly: true });
    assert.equal(reopened.prepare('SELECT COUNT(*) n FROM youtube_watch_events WHERE channel_id IS NULL').get()!.n, 0);
    reopened.close();
    repository.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
