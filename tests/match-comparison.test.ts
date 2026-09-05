import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
import type { YoutubeComparisonProfile, YoutubeParsedArchive } from '../src/youtube/types.js';

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
    videos: [],
    topics: [],
    hourly: [],
    weekdays: [],
    rhythmCoverage: { exactWatches: 10, dateOnlyWatches: 0 },
    firstWatch: null,
    lastWatch: null,
    ...overrides,
  };
}

const OPEN: ComparisonAccess = { connected: true, channelsAllowed: true, hiddenTopicKeys: new Set(), rhythmAllowed: true };

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
      { key: 'music', rank: 1, watches: 6, estimatedWatchSeconds: 5000 },
      { key: 'gaming', rank: 2, watches: 3, estimatedWatchSeconds: 1500 },
      { key: 'comedy', rank: 3, watches: 1, estimatedWatchSeconds: 700 },
    ],
    channels: [{ key: 'c1', name: 'Shared', thumbnailUrl: '', rank: 1, watches: 5, estimatedWatchSeconds: 3000 }],
    videos: [{ videoId: 'v1', title: 'Shared video', channelTitle: 'Shared', thumbnailUrl: '', rank: 1, watches: 2, estimatedWatchSeconds: 1200 }],
    hourly: [{ hour: 9, watches: 3, estimatedWatchSeconds: 900 }, { hour: 21, watches: 1, estimatedWatchSeconds: 300 }],
    weekdays: [{ weekday: 1, watches: 3, estimatedWatchSeconds: 900 }, { weekday: 6, watches: 1, estimatedWatchSeconds: 300 }],
    firstWatch: { title: 'Shared video', watchedAt: '2026-08-01T00:00:00Z' },
  });
  const bob = profile({
    topics: [
      { key: 'gaming', rank: 1, watches: 9, estimatedWatchSeconds: 6000 },
      { key: 'music', rank: 2, watches: 2, estimatedWatchSeconds: 900 },
      { key: 'comedy', rank: 3, watches: 1, estimatedWatchSeconds: 100 },
    ],
    channels: [{ key: 'c1', name: 'Shared', thumbnailUrl: 'https://img/shared.jpg', rank: 4, watches: 1, estimatedWatchSeconds: 300 }],
    videos: [{ videoId: 'v1', title: 'Shared video', channelTitle: 'Shared', thumbnailUrl: '', rank: 7, watches: 1, estimatedWatchSeconds: 300 }],
    hourly: [{ hour: 9, watches: 1, estimatedWatchSeconds: 100 }],
    rhythmCoverage: { exactWatches: 1, dateOnlyWatches: 5 },
  });

  const locked = compareWatchProfiles(alice, bob, '28d', {
    connected: false, channelsAllowed: true, hiddenTopicKeys: new Set(['comedy']), rhythmAllowed: true,
  });
  assert.equal(locked.stats, null);
  assert.equal(locked.topics.state, 'locked');
  assert.deepEqual(locked.topics.items.map((topic) => [topic.name, topic.rank.a, topic.rank.b, topic.watches]),
    [['Music', 1, 2, null], ['Gaming', 2, 1, null]]);
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
  assert.equal(locked.rhythmHidden, false);
  const rhythmOff = compareWatchProfiles(alice, bob, '28d', {
    connected: false, channelsAllowed: true, hiddenTopicKeys: new Set(), rhythmAllowed: false,
  });
  assert.equal(rhythmOff.rhythmHidden, true);
  assert.equal(compareWatchProfiles(alice, bob, '28d', { ...OPEN, rhythmAllowed: false }).rhythmHidden, false,
    'consent overrides the rhythm switch');

  const unlocked = compareWatchProfiles(alice, bob, 'all', OPEN);
  assert.equal(unlocked.stats?.[0]?.key, 'watchEvents');
  assert.deepEqual(unlocked.stats?.find((row) => row.key === 'hours'), { key: 'hours', a: 2, b: 2 });
  assert.equal(unlocked.topics.state, 'unlocked');
  assert.equal(unlocked.topics.total, 3);
  assert.deepEqual(unlocked.topics.items[0]?.watches, { a: 6, b: 2 });
  assert.deepEqual(unlocked.channels.items, [{
    name: 'Shared', thumbnailUrl: 'https://img/shared.jpg', rank: { a: 1, b: 4 }, watches: { a: 5, b: 1 },
  }]);
  assert.equal(unlocked.videos.items[0]?.rank.b, 7);
  assert.equal(unlocked.clock.mode, 'absolute');
  assert.equal(unlocked.clock.a.watches[9], 3);
  assert.equal(unlocked.firstWatch?.a?.title, 'Shared video');

  const topicsOnly = compareWatchProfiles(alice, bob, '90d', { ...OPEN, channelsAllowed: false });
  assert.equal(topicsOnly.channels.state, 'hidden');
  assert.equal(topicsOnly.videos.state, 'hidden');
  assert.equal(topicsOnly.firstWatch, null);
  assert.equal(topicsOnly.topics.state, 'unlocked');
  assert.ok(topicsOnly.stats);

  assert.equal(comparisonRange('365d'), '365d');
  assert.equal(comparisonRange('7d'), '28d', 'unsupported ranges fall back to the default');
  assert.equal(comparisonRange(undefined), '28d');
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

function publish(registry: UserRegistry, user: User, disclosure: 'topics_only' | 'topics_and_channel'): void {
  registry.upsertMatchingCrystal(user, crystal());
  registry.setMatchingPreferences(user.handle, true, disclosure);
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
    publish(registry, alice, 'topics_and_channel');
    publish(registry, bob, 'topics_and_channel');
    assert.equal(registry.userByHandle(bob.handle)?.matchingRhythm, true, 'rhythm switch starts on');
    seed(registry.repositoryFor(alice), 'alice', ALICE_EVENTS);
    seed(registry.repositoryFor(bob), 'bob', BOB_EVENTS);
    const aliceCookie = `urtube_session=${registry.createSession(alice)}`;
    const bobCookie = `urtube_session=${registry.createSession(bob)}`;

    const directory = await (await app.request('/matches', { headers: { cookie: aliceCookie } })).text();
    const bobCard = directory.match(/<article class="mt-card">[\s\S]*?<h2>Bob<\/h2>[\s\S]*?href="\/matches\/compare\/([A-Za-z0-9_-]+)"/);
    assert.ok(bobCard);
    const token = bobCard[1];

    const locked = await app.request(`/matches/compare/${token}?range=all`, { headers: { cookie: aliceCookie } });
    assert.equal(locked.status, 200);
    assert.equal(locked.headers.get('cache-control'), 'no-store');
    const lockedHtml = await locked.text();
    assert.match(lockedHtml, /Watch stats/);
    assert.match(lockedHtml, /Topics in common/);
    assert.match(lockedHtml, /Channels in common/);
    assert.match(lockedHtml, /Videos in common/);
    assert.match(lockedHtml, /Watch clock/);
    assert.match(lockedHtml, /Weekdays/);
    assert.match(lockedHtml, /Unlocks when you both choose to meet/);
    assert.match(lockedHtml, /href="\/matches\/compare\/[A-Za-z0-9_-]+\?range=28d"/);
    assert.match(lockedHtml, /\?range=all" aria-current="page"/);
    // Rhythm is shown as shares only; nothing names a video, channel, or count.
    assert.match(lockedHtml, /own watches/);
    assert.doesNotMatch(lockedHtml, /Video AAAAAAAAAA1|Channel A|Channel B|First watch|Last watch|class="mt-stat-row"|youtube\.com\/watch/);
    assert.doesNotMatch(lockedHtml, /alice-cmp|bob-cmp|candidateUserId|watchEvents|estimatedWatchSeconds/);

    registry.setMatchingPreferences(bob.handle, true, 'topics_and_channel', false);
    const withheld = await (await app.request(`/matches/compare/${token}?range=all`, {
      headers: { cookie: aliceCookie },
    })).text();
    assert.match(withheld, /keeps viewing rhythm private/);
    assert.doesNotMatch(withheld, /class="yt-rhythm-sector"|class="mt-week-row"/);
    registry.setMatchingPreferences(bob.handle, true, 'topics_and_channel', true);

    await app.request('/matches/request', form({ actionToken: token }, aliceCookie));
    const request = registry.matchingInboxFor(bob).incoming[0];
    assert.ok(request);
    const bobDirectory = await (await app.request('/matches', { headers: { cookie: bobCookie } })).text();
    const aliceCard = bobDirectory.match(/<article class="mt-card">[\s\S]*?<h2>Alice<\/h2>[\s\S]*?href="\/matches\/compare\/([A-Za-z0-9_-]+)"/);
    assert.ok(aliceCard);
    await app.request('/matches/respond', form({
      actionToken: aliceCard[1], requestToken: request.requestToken, response: 'accept',
    }, bobCookie));

    const unlockedHtml = await (await app.request(`/matches/compare/${token}?range=all`, {
      headers: { cookie: aliceCookie },
    })).text();
    assert.match(unlockedHtml, /Deeper comparison unlocked/);
    // Stats block: Alice 4 events, Bob 3; distinct channels 2 and 2.
    assert.match(unlockedHtml, /<div class="mt-stat-row"><strong>4<\/strong><span>Watch events<\/span><strong>3<\/strong><\/div>/);
    assert.match(unlockedHtml, /<strong>2<\/strong><span>Distinct channels<\/span><strong>2<\/strong>/);
    // Common channels with each person's rank: A is #1 for Alice, #2 for Bob.
    assert.match(unlockedHtml, /2 in common with Bob/);
    assert.match(unlockedHtml, /<b>#1<\/b><small>3×<\/small><\/span><div class="mt-row-main">(?:(?!<\/div>).)*Channel A(?:(?!<\/div>).)*<\/div><span class="mt-rank"[^>]*><b>#2<\/b><small>1×<\/small>/);
    // Common videos: AAAAAAAAAA1 is #1 for Alice and #3 for Bob; BBBBBBBBBB1 #2 / #1.
    assert.match(unlockedHtml, /Video AAAAAAAAAA1/);
    assert.match(unlockedHtml, /Video BBBBBBBBBB1/);
    assert.doesNotMatch(unlockedHtml, /Video AAAAAAAAAA2|Video BBBBBBBBBB2/, 'videos only one person watched never cross');
    assert.match(unlockedHtml, /First watch/);
    assert.match(unlockedHtml, /Last watch/);
    assert.match(unlockedHtml, /Sep 1, 2026/);
    assert.doesNotMatch(unlockedHtml, /T01:00:00|01:00:00Z/, 'edges are calendar days, never exact timestamps');
    assert.doesNotMatch(unlockedHtml, /own watches/, 'absolute rhythm once connected');
    assert.doesNotMatch(unlockedHtml, /alice-cmp|bob-cmp|candidateUserId/);

    // Range switch narrows every section; the page always stays available.
    const narrow = await (await app.request(`/matches/compare/${token}?range=28d`, {
      headers: { cookie: aliceCookie },
    })).text();
    assert.match(narrow, /\?range=28d" aria-current="page"/);
    assert.match(narrow, /Video AAAAAAAAAA1/);

    // Rhythm switch: irrelevant once connected.
    registry.setMatchingPreferences(bob.handle, true, 'topics_and_channel', false);
    const rhythmOffHtml = await (await app.request(`/matches/compare/${token}?range=all`, {
      headers: { cookie: aliceCookie },
    })).text();
    assert.match(rhythmOffHtml, /class="yt-rhythm-sector"/);
    assert.doesNotMatch(rhythmOffHtml, /keeps viewing rhythm private/);

    // One restrictive disclosure setting hides channels, videos, and edges
    // even after consent, while stats and topics stay unlocked.
    registry.setMatchingPreferences(bob.handle, true, 'topics_only');
    const restricted = await (await app.request(`/matches/compare/${token}?range=all`, {
      headers: { cookie: aliceCookie },
    })).text();
    assert.match(restricted, /Hidden because one of you shares topics only/);
    assert.match(restricted, /Watch events/);
    assert.doesNotMatch(restricted, /Channel A|Video AAAAAAAAAA1|First watch/);
  } finally {
    registry.close();
    rmSync(root, { recursive: true, force: true });
  }
});
