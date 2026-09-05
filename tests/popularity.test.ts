import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { load } from 'cheerio';
import { Repository } from '../src/data/database.js';
import { createApp } from '../src/index.js';
import { UserRegistry } from '../src/users.js';
import { popularitySection } from '../src/output/popularity.js';
import { enrichYoutubeVideoStatistics, fetchYoutubeMetadata } from '../src/youtube/metadata.js';
import type { YoutubeVideoMetadata, YoutubeWatchInput } from '../src/youtube/types.js';

const now = new Date('2026-09-05T12:00:00.000Z');
const metadata = (videoId: string): YoutubeVideoMetadata => ({
  videoId, title: 'Public fixture', channelId: `channel-${videoId}`, channelTitle: 'Fixture',
  description: '', tags: [], thumbnailUrl: '', durationSeconds: 60, publishedAt: null,
  categoryId: '27', availability: 'available', metadataHash: 'stable', isLivestream: false,
});
const watch = (videoId: string | null, eventId = videoId!, watchedAt = now.toISOString()): YoutubeWatchInput => ({
  videoId, eventId, watchedAt, title: 'Fixture', url: '', channelId: null,
  channelTitle: null, channelUrl: null, actualWatchedSeconds: null, activityType: 'video',
});
function ingest(repository: Repository, watches: YoutubeWatchInput[]) {
  repository.ingestYoutubeArchive({ archiveHash: watches[0].eventId, source: 'takeout', searches: [], watches });
}

test('popularity deduplicates watched videos, handles exact bucket boundaries and keeps unknown coverage', () => {
  const repository = new Repository(':memory:');
  try {
    const counts = [0, 999, 1000, 9999, 10000, 99999, 100000, 999999, 1000000];
    const videos = counts.map((viewCount, index) => ({ ...metadata(`v${index}`), viewCount }));
    repository.upsertYoutubeVideoMetadata(videos, now.toISOString());
    repository.upsertYoutubeChannelMetadata(videos.map((video, index) => ({
      channelId: video.channelId!, name: 'Fixture', thumbnailUrl: '',
      statistics: { subscriberCount: counts[index], hiddenSubscriberCount: false, videoCount: null, viewCount: null, publishedAt: null, topicCategories: [] },
    })), now.toISOString());
    repository.upsertYoutubeVideoMetadata([{ ...metadata('hidden'), viewCount: null }], now.toISOString());
    repository.upsertYoutubeChannelMetadata([{
      channelId: 'channel-hidden', name: '', thumbnailUrl: '',
      statistics: { subscriberCount: 123456, hiddenSubscriberCount: true, videoCount: null, viewCount: null, publishedAt: null, topicCategories: [] },
    }], now.toISOString());
    ingest(repository, [...videos.map(video => watch(video.videoId)), watch('v0', 'repeat', '2026-09-05T11:00:00.000Z'),
      watch('hidden'), watch('missing'), watch(null, 'no-id'), watch('old', 'old', '2026-01-01T00:00:00.000Z'),
      watch('future', 'future', '2027-01-01T00:00:00.000Z'), { ...watch('post'), activityType: 'post' }]);
    const result = repository.youtubePopularity('7d', now);
    assert.equal(result.totalVideos, 11);
    assert.equal(result.unidentifiedEvents, 1);
    for (const series of [result.channels, result.videos]) {
      assert.deepEqual(series.buckets, [2, 2, 2, 2, 1]);
      assert.equal(series.known, 9);
      assert.equal(series.unknown, 2);
      assert.equal(series.oldestFetchedAt, now.toISOString());
    }
    assert.equal(repository.youtubePopularity('all', now).totalVideos, 12);
    for (const lang of ['en', 'zh'] as const) {
      const $ = load(popularitySection(result, lang));
      assert.equal($('.yt-popularity-bars li').length, 10);
      assert.match($('.yt-popularity-bars li').first().text(), /18.2%/);
      assert.match($('.yt-popularity-date').text(), /UTC\+8/);
      assert.equal($('details summary').length, 1);
    }
  } finally { repository.close(); }
});

test('video statistics refresh in batches, preserve semantic hashes and wait a day after success', async () => {
  const repository = new Repository(':memory:');
  try {
    const ids = Array.from({ length: 51 }, (_, index) => `VIDEO${String(index).padStart(6, '0')}`);
    ingest(repository, ids.map(id => watch(id)));
    repository.upsertYoutubeVideoMetadata([...ids, 'unwatched'].map(metadata));
    const sizes: number[] = [];
    const fetchImpl = (async (input) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get('part'), 'statistics');
      const batch = url.searchParams.get('id')!.split(',');
      sizes.push(batch.length);
      assert.ok(!batch.includes('unwatched'));
      return new Response(JSON.stringify({ items: batch.map(id => ({ id, statistics: { viewCount: '0' } })) }));
    }) as typeof fetch;
    assert.equal(await enrichYoutubeVideoStatistics(repository, 500, 'fixture', fetchImpl, () => now), 51);
    assert.deepEqual(sizes, [50, 1]);
    assert.equal(await enrichYoutubeVideoStatistics(repository, 500, 'fixture', fetchImpl, () => new Date(now.getTime() + 86400_000)), 0);
    assert.equal(repository.youtubePopularity('all', now).videos.known, 51);
    assert.ok(repository.youtubePersonalTaxonomyCandidates().every(video => video.metadataHash === 'stable'));
    const tomorrow = new Date(now.getTime() + 86400_001);
    const failure = (async () => new Response('', { status: 503 })) as typeof fetch;
    await assert.rejects(enrichYoutubeVideoStatistics(repository, 500, 'fixture', failure, () => tomorrow), /HTTP 503/);
    assert.equal(repository.youtubeVideosNeedingStatistics(500, tomorrow).length, 51);
    assert.equal(repository.youtubePopularity('all', tomorrow).videos.known, 51, 'failure retains the last snapshot');
    const unavailable = (async () => new Response(JSON.stringify({ items: [] }))) as typeof fetch;
    assert.equal(await enrichYoutubeVideoStatistics(repository, 500, 'fixture', unavailable, () => tomorrow), 51);
    assert.equal(repository.youtubePopularity('all', tomorrow).videos.unknown, 51);
    assert.equal(repository.youtubePopularity('all', tomorrow).videos.newestFetchedAt, tomorrow.toISOString());
  } finally { repository.close(); }
});

test('metadata statistics distinguish missing, unavailable, invalid and real zero without changing the classification hash', async () => {
  const fetchWith = (viewCount?: string) => (async () => new Response(JSON.stringify({ items: [{
    id: 'fixture', snippet: { title: 'Same title' }, statistics: { viewCount },
  }] }))) as typeof fetch;
  const [zero, unavailable] = await fetchYoutubeMetadata(['fixture', 'gone'], 'key', fetchWith('0'));
  assert.equal(zero.viewCount, 0);
  assert.equal(unavailable.viewCount, null);
  assert.equal(unavailable.availability, 'unavailable');
  for (const value of [undefined, '-1', '1.5', '9007199254740992', '1000']) {
    const [video] = await fetchYoutubeMetadata(['fixture'], 'key', fetchWith(value));
    assert.equal(video.metadataHash, zero.metadataHash);
    assert.equal(video.viewCount, value === '1000' ? 1000 : null);
  }
});

test('schema 13 upgrade retains history and queues old video statistics', () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-popularity-'));
  const path = join(root, 'archive.sqlite');
  try {
    const initial = new Repository(path);
    ingest(initial, [watch('legacy')]);
    initial.close();
    const legacy = new DatabaseSync(path);
    legacy.exec('ALTER TABLE youtube_videos DROP COLUMN view_count; ALTER TABLE youtube_videos DROP COLUMN statistics_fetched_at; PRAGMA user_version=13;');
    legacy.close();
    const upgraded = new Repository(path);
    try {
      assert.equal(upgraded.youtubeCounts().watches, 1);
      assert.deepEqual(upgraded.youtubeVideosNeedingStatistics(), ['legacy']);
      assert.equal(upgraded.youtubePopularity('all', now).videos.unknown, 1);
    } finally { upgraded.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('empty and unknown-only distributions render no false zero-percent preference', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('popularity', 'Fixture');
    const repository = registry.repositoryFor(user);
    const app = createApp(registry, { loadTagLists: async () => { throw new Error('offline fixture'); } });
    const headers = { cookie: `urtube_session=${registry.createSession(user)}` };
    for (const lang of ['en', 'zh'] as const) {
      const response = await app.request(`/${user.handle}/insights?range=all&lang=${lang}`, { headers });
      assert.equal(response.status, 200);
      const $ = load(await response.text());
      assert.equal($('.yt-popularity').length, 1);
      assert.equal($('.yt-popularity-bars').length, 0);
      assert.doesNotMatch($('.yt-popularity').text(), /0%|NaN|Infinity/);
    }
    ingest(repository, [watch('unknown')]);
    const unknown = load(popularitySection(repository.youtubePopularity('all', now), 'en'));
    assert.equal(unknown('.yt-popularity-bars').length, 0);
    assert.match(unknown('.yt-popularity-grid').text(), /1 unknown/);
    assert.equal((await app.request(`/${user.handle}/insights`)).status, 404, 'private archive remains protected');
  } finally { registry.close(); }
});
