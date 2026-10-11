import assert from 'node:assert/strict';
import test from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import { UserRegistry, type User } from '../src/users.js';
import { enrichYoutubeChannelMetadata, enrichYoutubeMetadata } from '../src/youtube/metadata.js';
import { youtubeWorkerSteps } from '../src/youtube-worker.js';
import type { YoutubeChannelMetadata, YoutubeVideoMetadata } from '../src/youtube/types.js';

function watch(registry: UserRegistry, user: User, videoIds: string[]) {
  registry.repositoryFor(user).ingestYoutubeArchive({ archiveHash: `shared-cache-${user.id}`, source: 'takeout', searches: [],
    watches: videoIds.map((videoId, index) => ({ eventId: `${user.id}-${index}`, videoId, title: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`, channelId: `channel-${videoId}`, channelTitle: videoId,
      channelUrl: '', watchedAt: new Date().toISOString(), actualWatchedSeconds: 600, activityType: 'video' as const })) });
}

function video(videoId: string): YoutubeVideoMetadata {
  return { videoId, title: `Title ${videoId}`, channelId: `channel-${videoId}`, channelTitle: videoId, description: '',
    tags: ['tag'], thumbnailUrl: '', durationSeconds: 600, publishedAt: null, categoryId: '27',
    availability: 'available', isLivestream: false, metadataHash: `hash-${videoId}` };
}

function channel(channelId: string): YoutubeChannelMetadata {
  return { channelId, name: `Name ${channelId}`, thumbnailUrl: '', statistics: { subscriberCount: 10, hiddenSubscriberCount: false,
    videoCount: 1, viewCount: 1, publishedAt: null, topicCategories: [] } };
}

function fixture() {
  const registry = new UserRegistry(':memory:');
  const first = registry.createUser('first-viewer', 'First');
  const second = registry.createUser('second-viewer', 'Second');
  return { registry, first, second, cache: registry.youtubeMetadataCache() };
}

test('accounts that watched the same videos and channels share one YouTube lookup', async () => {
  const { registry, first, second, cache } = fixture();
  const videoRequests: string[][] = [];
  const channelRequests: string[][] = [];
  const fetchVideos = async (ids: string[]) => { videoRequests.push([...ids].sort()); return ids.map(video); };
  const fetchChannels = async (ids: string[]) => { channelRequests.push([...ids].sort()); return ids.map(channel); };
  try {
    watch(registry, first, ['shared', 'first-only']);
    watch(registry, second, ['shared', 'second-only']);
    for (const user of [first, second]) {
      const repository = registry.repositoryFor(user);
      assert.equal(await enrichYoutubeMetadata(repository, 500, cache, fetchVideos), 2);
      assert.equal(await enrichYoutubeChannelMetadata(repository, 500, cache, fetchChannels), 2);
      assert.deepEqual(repository.youtubeVideosNeedingMetadata(), []);
      assert.deepEqual(repository.youtubeChannelsNeedingMetadata(), []);
    }
    assert.deepEqual(videoRequests, [['first-only', 'shared'], ['second-only']]);
    assert.deepEqual(channelRequests, [['channel-first-only', 'channel-shared'], ['channel-second-only']]);
    const stored = registry.repositoryFor(second).youtubeChannelMetadata('channel-shared');
    assert.equal(stored?.name, 'Name channel-shared');
    assert.equal(stored?.statistics?.subscriberCount, 10);
  } finally { registry.close(); }
});

test('the shared cache holds no account identity and purges expired rows', async () => {
  const { registry, first, cache } = fixture();
  const db = (registry as unknown as { db: DatabaseSync }).db;
  try {
    watch(registry, first, ['old', 'fresh']);
    cache.putVideos([video('old')], new Date(Date.now() - 31 * 86400_000).toISOString());
    cache.putChannels([channel('channel-old')], new Date(Date.now() - 8 * 86400_000).toISOString());
    assert.equal(cache.videos(['old']).size, 0, 'expired videos are refetched');
    assert.equal(cache.channels(['channel-old']).size, 0, 'channel statistics follow the active refresh window');
    const requested: string[] = [];
    await enrichYoutubeMetadata(registry.repositoryFor(first), 500, cache, async ids => { requested.push(...ids); return ids.map(video); });
    assert.deepEqual(requested.sort(), ['fresh', 'old']);
    assert.deepEqual(db.prepare('SELECT video_id FROM youtube_video_metadata_cache ORDER BY video_id').all().map(row => row.video_id),
      ['fresh', 'old'], 'writing purges the expired copy');
    const columns = (table: string) => db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
    for (const table of ['youtube_video_metadata_cache', 'youtube_channel_metadata_cache']) {
      assert.deepEqual(columns(table).filter(name => /user|handle|watch/.test(String(name))), []);
    }
  } finally { registry.close(); }
});

test('cached channel statistics keep their original fetch time on each account', async () => {
  const { registry, first, cache } = fixture();
  const db = (registry.repositoryFor(first) as unknown as { db: DatabaseSync }).db;
  try {
    watch(registry, first, ['video']);
    const fetchedAt = new Date(Date.now() - 2 * 86400_000).toISOString();
    cache.putChannels([channel('channel-video')], fetchedAt);
    assert.equal(await enrichYoutubeChannelMetadata(registry.repositoryFor(first), 500, cache, async () => {
      throw new Error('a cache hit must not call YouTube');
    }), 1);
    assert.equal(db.prepare('SELECT statistics_fetched_at FROM youtube_channels').get()!.statistics_fetched_at, fetchedAt);
  } finally { registry.close(); }
});

test('without a YouTube key, cached metadata still fills an archive', async () => {
  const { registry, first, cache } = fixture();
  try {
    watch(registry, first, ['cached', 'unknown']);
    cache.putVideos([video('cached')]);
    assert.equal(await enrichYoutubeMetadata(registry.repositoryFor(first), 500, cache, null), 1);
    assert.deepEqual(registry.repositoryFor(first).youtubeVideosNeedingMetadata(), ['unknown']);
    assert.equal(typeof youtubeWorkerSteps(registry).metadata, 'function');
  } finally { registry.close(); }
});
