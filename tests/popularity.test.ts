import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { load } from 'cheerio';
import { Repository } from '../src/data/database.js';
import { createApp } from '../src/index.js';
import { popularitySection } from '../src/output/popularity.js';
import { UserRegistry } from '../src/users.js';
import {
  enrichYoutubeMetadata,
  enrichYoutubeVideoStatistics,
  fetchYoutubeMetadata,
  fetchYoutubeVideoStatistics,
} from '../src/youtube/metadata.js';
import { runYoutubeWorkerCycle, youtubeWorkerFailedUsers, type YoutubeWorkerSteps } from '../src/youtube-worker.js';
import { YOUTUBE_POPULARITY_BOUNDS, YOUTUBE_POPULARITY_VERSION } from '../src/youtube/popularity.js';
import type { YoutubeChannelMetadata, YoutubeVideoMetadata } from '../src/youtube/types.js';

const DAY = 86400_000;
const now = new Date();
const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();

function watch(repository: Repository, entries: Array<{ videoId: string; days: number }>, archive = 'popularity') {
  repository.ingestYoutubeArchive({ archiveHash: archive, source: 'takeout', searches: [],
    watches: entries.map(({ videoId, days }, index) => ({ eventId: `${archive}-${index}`, videoId, title: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`, channelId: null, channelTitle: null,
      channelUrl: '', watchedAt: ago(days), actualWatchedSeconds: 60, activityType: 'video' as const })) });
}

function video(videoId: string, channelId: string | null, viewCount?: number | null, statisticsFetchedAt?: string): YoutubeVideoMetadata {
  return { videoId, title: `Title ${videoId}`, channelId, channelTitle: channelId, description: '', tags: [],
    thumbnailUrl: '', durationSeconds: 300, publishedAt: null, categoryId: '27', availability: 'available',
    isLivestream: false, metadataHash: `hash-${videoId}`, viewCount, statisticsFetchedAt };
}

function channel(channelId: string, subscriberCount: number | null, hiddenSubscriberCount = false): YoutubeChannelMetadata {
  return { channelId, name: channelId, thumbnailUrl: '', statistics: { subscriberCount, hiddenSubscriberCount,
    videoCount: null, viewCount: null, publishedAt: null, topicCategories: [] } };
}

test('video metadata asks for statistics in the same batched request and keeps the metadata hash stable', async () => {
  const requests: URL[] = [];
  const item = (id: string, statistics?: { viewCount?: string }) => ({ id, snippet: { title: id, channelId: 'UCfixture', tags: ['a'] },
    contentDetails: { duration: 'PT5M' }, ...(statistics ? { statistics } : {}) });
  const ids = Array.from({ length: 60 }, (_, index) => `VIDEO${String(index).padStart(6, '0')}`);
  const withStatistics = await fetchYoutubeMetadata(ids, 'fixture', (async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    const batch = url.searchParams.get('id')!.split(',');
    return Response.json({ items: batch.filter((id) => id !== ids[3]).map((id, index) =>
      item(id, index === 0 ? { viewCount: '0' } : index === 1 ? {} : index === 2 ? { viewCount: 'n/a' } : { viewCount: '1234' })) });
  }) as typeof fetch);
  // 60 videos: two requests, not one per video; statistics shares the call.
  assert.equal(requests.length, 2);
  for (const url of requests) assert.deepEqual(url.searchParams.get('part')!.split(',').sort(),
    ['contentDetails', 'liveStreamingDetails', 'snippet', 'statistics', 'status']);
  const byId = new Map(withStatistics.map((value) => [value.videoId, value]));
  assert.equal(byId.get(ids[0])!.viewCount, 0, 'a real zero stays zero');
  assert.equal(byId.get(ids[1])!.viewCount, null, 'a missing count is unknown');
  assert.equal(byId.get(ids[2])!.viewCount, null, 'a malformed count is unknown');
  assert.equal(byId.get(ids[3])!.availability, 'unavailable');
  assert.equal(byId.get(ids[3])!.viewCount, null);
  assert.equal(byId.get(ids[4])!.viewCount, 1234);

  // Same snippet without statistics (the pre-#50 request) hashes identically,
  // and a different count does not move the hash either.
  const without = await fetchYoutubeMetadata([ids[4], ids[5]], 'fixture', (async () => Response.json({ items: [
    item(ids[4]), item(ids[5], { viewCount: '99999999' }),
  ] })) as typeof fetch);
  assert.equal(without[0].metadataHash, byId.get(ids[4])!.metadataHash);
  assert.equal(without[1].metadataHash, byId.get(ids[5])!.metadataHash);
});

test('statistics-only refresh batches 50 videos per request and treats missing videos as unknown', async () => {
  const requests: URL[] = [];
  const ids = Array.from({ length: 120 }, (_, index) => `REFRESH${String(index).padStart(4, '0')}`);
  const result = await fetchYoutubeVideoStatistics(ids, 'fixture', (async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    return Response.json({ items: url.searchParams.get('id')!.split(',').slice(1).map((id) => ({ id, statistics: { viewCount: '7' } })) });
  }) as typeof fetch);
  assert.deepEqual(requests.map((url) => url.searchParams.get('id')!.split(',').length), [50, 50, 20]);
  assert.ok(requests.every((url) => url.searchParams.get('part') === 'statistics'));
  assert.equal(result.length, 120);
  assert.equal(result.find((value) => value.videoId === ids[0])!.viewCount, null);
  assert.equal(result.find((value) => value.videoId === ids[1])!.viewCount, 7);
});

test('distributions count each watched video once, keep bucket boundaries and separate every unknown reason', () => {
  const repository = new Repository(':memory:');
  try {
    const counts = [0, 999, 1000, 9999, 10000, 99999, 100000, 999999, 1000000, 2500000];
    const known = counts.map((_, index) => `KNOWN${String(index).padStart(6, '0')}`);
    watch(repository, [
      // Repeated watches of one video still count once.
      ...known.map((videoId) => ({ videoId, days: 2 })), { videoId: known[0], days: 3 }, { videoId: known[0], days: 4 },
      { videoId: 'HIDDENCH001', days: 2 }, { videoId: 'NOCHANNEL01', days: 2 }, { videoId: 'UNFETCHEDCH', days: 2 },
      { videoId: 'MISSINGVIEW', days: 2 }, { videoId: 'UNAVAILABLE', days: 2 }, { videoId: 'PENDINGMETA', days: 2 },
      { videoId: 'OLDWATCH001', days: 200 },
    ]);
    const fetchedAt = ago(1);
    repository.upsertYoutubeVideoMetadata([
      ...known.map((videoId, index) => video(videoId, `UC${index}`, counts[index], fetchedAt)),
      video('HIDDENCH001', 'UChidden', 50), video('NOCHANNEL01', null, 50), video('UNFETCHEDCH', 'UCunfetched', 50),
      video('MISSINGVIEW', 'UC0', null), video('OLDWATCH001', 'UC0', 5),
      { ...video('UNAVAILABLE', null, null), availability: 'unavailable' },
    ], fetchedAt);
    repository.upsertYoutubeChannelMetadata([
      ...counts.map((count, index) => channel(`UC${index}`, count)),
      // Hidden wins even if a stale count is present.
      channel('UChidden', 123456, true),
    ], fetchedAt);

    const week = repository.youtubePopularity('7d', now);
    assert.equal(week.version, YOUTUBE_POPULARITY_VERSION);
    assert.equal(week.totalVideos, known.length + 6);
    // <1K, 1K–10K, 10K–100K, 100K–1M, ≥1M with exact boundaries.
    // The three 50-view videos join 0 and 999 in < 1K.
    assert.deepEqual(week.videos.buckets, [5, 2, 2, 2, 2]);
    assert.deepEqual(week.videos.unknown, { pending: 1, hidden: 0, unavailable: 1, missing: 1 });
    assert.equal(week.videos.known, 13);
    assert.deepEqual(week.channels.buckets, [3, 2, 2, 2, 2], 'MISSINGVIEW belongs to the 0-subscriber channel');
    assert.deepEqual(week.channels.unknown, { pending: 2, hidden: 1, unavailable: 1, missing: 1 });
    for (const series of [week.videos, week.channels]) {
      const unknown = Object.values(series.unknown).reduce((sum, count) => sum + count, 0);
      assert.equal(series.known + unknown, week.totalVideos, 'unknown data stays in the coverage denominator');
      assert.equal(series.buckets.reduce((sum, count) => sum + count, 0), series.known);
    }
    assert.equal(week.videos.oldestFetchedAt, fetchedAt);
    assert.equal(YOUTUBE_POPULARITY_BOUNDS.length, week.videos.buckets.length);

    // Switching the range changes the watched sample, not the snapshot meaning.
    const all = repository.youtubePopularity('all', now);
    assert.equal(all.totalVideos, week.totalVideos + 1);
    assert.equal(all.videos.buckets[0], 6);
    assert.equal(repository.youtubePopularity('7d', new Date(now.getTime() + 30 * DAY)).totalVideos, 0);
  } finally { repository.close(); }
});

test('statistics refresh is daily for recent watches, quarterly for old ones, shared across accounts, and never touches metadata hashes', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const first = registry.createUser('stats-first', 'First');
    const second = registry.createUser('stats-second', 'Second');
    const cache = registry.youtubeMetadataCache();
    const repositories = [first, second].map((user) => registry.repositoryFor(user));
    for (const [index, repository] of repositories.entries()) {
      watch(repository, [{ videoId: 'RECENTVIDEO', days: 2 }, { videoId: 'DORMANTVIDE', days: 200 },
        { videoId: 'FRESHVIDEO1', days: 2 }, { videoId: 'NEVERFETCHD', days: 300 }], `stats-${index}`);
      repository.upsertYoutubeVideoMetadata([
        video('RECENTVIDEO', 'UC1', 10, ago(2)), video('DORMANTVIDE', 'UC1', 10, ago(30)),
        video('FRESHVIDEO1', 'UC1', 10, ago(0.5)), video('NEVERFETCHD', 'UC1'),
      ], ago(2));
    }
    // A completed matching classification is keyed by metadata_hash.
    repositories[0].saveYoutubeVideoMatchingTopic({ videoId: 'RECENTVIDEO', taxonomyVersion: 1, topicKey: null, metadataHash: 'hash-RECENTVIDEO' });
    const hashes = () => JSON.stringify([repositories[0].youtubeVideosForMatchingClassification(1).map((value) => [value.videoId, value.metadataHash]),
      repositories[0].matchingV3Source(100).fingerprint]);
    const before = hashes();
    assert.doesNotMatch(before, /RECENTVIDEO/);
    assert.deepEqual(repositories[0].youtubeVideosNeedingStatistics(), ['NEVERFETCHD', 'RECENTVIDEO']);

    const requested: string[][] = [];
    const fetchStatistics = async (ids: string[]) => { requested.push(ids); return ids.map((videoId) => ({ videoId, viewCount: 4321 })); };
    assert.equal(await enrichYoutubeVideoStatistics(repositories[0], 500, cache, fetchStatistics), 2);
    assert.equal(await enrichYoutubeVideoStatistics(repositories[1], 500, cache, fetchStatistics), 2);
    assert.deepEqual(requested, [['NEVERFETCHD', 'RECENTVIDEO']], 'the second account reuses the same-day lookup');
    assert.deepEqual(repositories[0].youtubeVideosNeedingStatistics(), [], 'at most one refresh per day');
    assert.equal(hashes(), before, 'refreshing counters leaves classification inputs unchanged');
    assert.deepEqual(repositories[0].youtubeVideosNeedingMetadata(), []);
    assert.equal(repositories[1].youtubePopularity('all', now).videos.buckets[1], 2);

    // Once its snapshot is ninety days old the dormant video is due; the
    // others are no longer recent watches and wait for their own quarter.
    assert.deepEqual(repositories[0].youtubeVideosNeedingStatistics(500, new Date(now.getTime() + 61 * DAY)), ['DORMANTVIDE']);
  } finally { registry.close(); }
});

test('a cached metadata hit keeps the original statistics time and never overwrites a newer snapshot', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('stats-cache', 'Cache');
    const repository = registry.repositoryFor(user);
    const cache = registry.youtubeMetadataCache();
    watch(repository, [{ videoId: 'CACHEDVIDEO', days: 1 }]);
    const cachedAt = ago(3);
    cache.putVideos([video('CACHEDVIDEO', 'UC1', 777)], cachedAt);
    assert.equal(await enrichYoutubeMetadata(repository, 500, cache, async () => { throw new Error('no request expected'); }), 1);
    const popularity = repository.youtubePopularity('all', now);
    assert.equal(popularity.videos.oldestFetchedAt, cachedAt);
    assert.deepEqual(repository.youtubeVideosNeedingStatistics(), ['CACHEDVIDEO']);

    repository.saveYoutubeVideoStatistics([{ videoId: 'CACHEDVIDEO', viewCount: 5000, fetchedAt: ago(0) }]);
    repository.upsertYoutubeVideoMetadata([video('CACHEDVIDEO', 'UC1', 1, ago(10))]);
    repository.saveYoutubeVideoStatistics([{ videoId: 'CACHEDVIDEO', viewCount: 2, fetchedAt: ago(20) }]);
    assert.equal(repository.youtubePopularity('all', now).videos.buckets[1], 1, 'older snapshots never replace newer ones');
  } finally { registry.close(); }
});

test('a failing statistics refresh is logged without failing the account or blocking classification', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('stats-worker', 'Worker');
    const calls: string[] = [];
    const step = (name: string) => async () => { calls.push(name); return 0; };
    const steps: YoutubeWorkerSteps = {
      portability: async () => 'idle', metadata: step('metadata'), channelMetadata: step('channels'),
      matchingClassification: step('matching'), classification: step('classification'),
      statistics: async () => { calls.push('statistics'); throw new Error('quota exhausted'); },
    };
    const [result] = await runYoutubeWorkerCycle(registry, steps);
    assert.deepEqual(calls, ['metadata', 'channels', 'matching', 'classification', 'statistics']);
    assert.match(result.error ?? '', /quota exhausted/);
    assert.equal(youtubeWorkerFailedUsers(registry), 0);
    const repository = registry.repositoryFor(user);
    assert.equal(repository.youtubeSyncState('worker_retry_at'), '0');
    assert.equal(repository.youtubeSyncState('last_error'), '');
  } finally { registry.close(); }
});

test('version 13 archives gain empty statistics columns without losing history or metadata hashes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'urtube-popularity-migration-'));
  const path = join(directory, 'archive.sqlite');
  try {
    const initial = new Repository(path);
    watch(initial, [{ videoId: 'LEGACYVIEWS', days: 1 }]);
    initial.upsertYoutubeVideoMetadata([video('LEGACYVIEWS', 'UC1')]);
    initial.close();
    const legacy = new DatabaseSync(path);
    legacy.exec('ALTER TABLE youtube_videos DROP COLUMN view_count; ALTER TABLE youtube_videos DROP COLUMN statistics_fetched_at; PRAGMA user_version=13;');
    legacy.close();
    const upgraded = new Repository(path);
    try {
      assert.deepEqual(upgraded.youtubeVideosNeedingMetadata(), []);
      assert.deepEqual(upgraded.youtubeVideosNeedingStatistics(), ['LEGACYVIEWS']);
      assert.deepEqual(upgraded.youtubePopularity('all').videos.unknown.pending, 1);
    } finally { upgraded.close(); }
    const migrated = new DatabaseSync(path);
    assert.equal(migrated.prepare('PRAGMA user_version').get()?.user_version, 14);
    assert.deepEqual({ ...migrated.prepare('SELECT metadata_hash, view_count, statistics_fetched_at FROM youtube_videos').get() },
      { metadata_hash: 'hash-LEGACYVIEWS', view_count: null, statistics_fetched_at: null });
    assert.equal(migrated.prepare('SELECT COUNT(*) count FROM youtube_watch_events').get()?.count, 1);
    migrated.close();
    // Reopening a migrated archive is a no-op.
    new Repository(path).close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('popularity section renders coverage, unknown reasons and snapshot dates in both languages', () => {
  const series = (known: number[], unknown: Partial<Record<'pending' | 'hidden' | 'unavailable' | 'missing', number>>) => ({
    buckets: known, known: known.reduce((sum, value) => sum + value, 0),
    unknown: { pending: 0, hidden: 0, unavailable: 0, missing: 0, ...unknown },
    oldestFetchedAt: known.some(Boolean) ? '2026-10-20T20:00:00.000Z' : null,
    newestFetchedAt: known.some(Boolean) ? '2026-10-21T01:00:00.000Z' : null,
  });
  const data = { version: YOUTUBE_POPULARITY_VERSION, totalVideos: 10,
    channels: series([1, 2, 3, 0, 1], { hidden: 2, pending: 1 }), videos: series([0, 0, 0, 0, 0], { pending: 10 }) };
  const zh = load(popularitySection(data, 'zh'));
  assert.equal(zh('h2').text(), '看過的影片：頻道規模與熱門程度');
  const channels = zh('[data-popularity-series=channels]');
  assert.match(channels.text(), /有效資料 7 \/ 10 支（70%）/);
  assert.match(channels.text(), /未知 3 支：尚未取得 1 · 訂閱數隱藏 2/);
  assert.deepEqual(channels.find('li > span:first-child').map((_, el) => zh(el).text()).get(),
    ['< 1 千', '1 千–1 萬', '1 萬–10 萬', '10 萬–100 萬', '≥ 100 萬']);
  assert.equal(channels.find('li i').eq(2).attr('style'), 'width:30.00%');
  // 2026-10-20T20:00Z is already 10-21 in Taiwan.
  assert.match(channels.text(), /公開統計快照：2026-10-21（台灣日期）/);
  // No known view counts: no bars, no 0% preference, an explicit statement.
  const videos = zh('[data-popularity-series=videos]');
  assert.equal(videos.find('li').length, 0);
  assert.match(videos.text(), /尚無可用的公開統計/);
  assert.match(videos.text(), /尚未取得公開統計快照/);
  assert.match(zh('details').text(), /不是你當時觀看時的熱門程度/);
  assert.match(zh('details').text(), /三位有效數字/);

  const en = load(popularitySection(data, 'en'));
  assert.match(en('[data-popularity-series=channels]').text(), /Known for 7 of 10 videos \(70%\)/);
  assert.match(en('[data-popularity-series=channels]').text(), /3 unknown: not fetched yet 1 · subscribers hidden 2/);
  assert.match(en('details').text(), /not how popular a video was when you watched it/);
  assert.match(en.html(), /≥ 1M/);

  const empty = load(popularitySection({ ...data, totalVideos: 0,
    channels: series([0, 0, 0, 0, 0], {}), videos: series([0, 0, 0, 0, 0], {}) }, 'en'));
  assert.equal(empty('ul').length, 0);
  assert.match(empty.text(), /No identifiable watched videos in this period/);
});

test('Insights shows the distribution for the requested range beside the unchanged length mix', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const user = registry.createUser('popular-insights', 'Insights');
    const repository = registry.repositoryFor(user);
    watch(repository, [{ videoId: 'RECENTPOP01', days: 1 }, { videoId: 'RECENTPOP01', days: 2 }, { videoId: 'OLDPOPULAR1', days: 120 }]);
    repository.upsertYoutubeVideoMetadata([video('RECENTPOP01', 'UCpop', 2_000_000, ago(0)), video('OLDPOPULAR1', 'UCpop', 50, ago(0))]);
    repository.upsertYoutubeChannelMetadata([channel('UCpop', 0)]);
    const page = async (query: string) => load(await (await app.request(`/${user.handle}/insights?key=${user.dashboardToken}&${query}`)).text());
    const week = await page('range=7d&lang=zh');
    assert.match(week('.yt-popularity .section-head').text(), /1 支不同影片/);
    assert.match(week('[data-popularity-series=channels]').text(), /有效資料 1 \/ 1 支/);
    assert.match(week('[data-popularity-series=videos] li').last().text(), /1 支/);
    const all = await page('range=all&lang=en');
    assert.match(all('.yt-popularity .section-head').text(), /2 distinct videos/);
    // A real zero-subscriber channel is known and lands in < 1K.
    assert.match(all('[data-popularity-series=channels] li').first().text(), /2 videos/);
    assert.equal(all('.yt-mix-row').length > 0, true, 'length mix still renders');
    // Overview does not carry the Insights-only section.
    const overview = load(await (await app.request(`/${user.handle}?key=${user.dashboardToken}`)).text());
    assert.equal(overview('.yt-popularity').length, 0);
  } finally { registry.close(); }
});
