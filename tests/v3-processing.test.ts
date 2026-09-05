import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Repository } from '../src/data/database.js';
import { MatchingStore } from '../src/matching-v3/store.js';
import { GENRES, type Genre, type Profile } from '../src/matching-v3/model.js';
import { describeV3Processing, type V3JobStatus } from '../src/youtube/v3-processing.js';
import { v3ProcessingNotice } from '../src/output/v3-processing.js';

const profile: Profile = { version: 'current', sourceFingerprint: 'fixture', builtAt: '2026-09-06T00:00:00Z',
  complete: true, processedVideos: 2000, totalVideos: 2000,
  genres: Object.fromEntries(GENRES.map(genre => [genre,
    { status: 'empty', clusters: [], totalMass: 0, retainedCoverage: 0, videoCount: 0 }])) };
const job: V3JobStatus = { state: 'done', version: 'current', attempts: 0, retryAt: 0, progress: null };
const input = { metadata: { videos: 19000, videosPendingMetadata: 0, channelsPendingMetadata: 0 },
  metadataEnabled: true, enabled: true, profileVersion: 'current', backfillVideoLimit: 2000, profile, job, now: 1000 };

test('v3 processing distinguishes queued, failed, retry, missing, disabled and stale work from completed profiles', () => {
  assert.equal(describeV3Processing(input).state, 'done');
  assert.equal(describeV3Processing({ ...input, enabled: false }).state, 'disabled');
  assert.equal(describeV3Processing({ ...input, job: null, profile: null }).state, 'missing');
  assert.equal(describeV3Processing({ ...input, profile: { ...profile, complete: false } }).state, 'provisional');
  assert.equal(describeV3Processing({ ...input, profile: { ...profile, genres: { Sport: profile.genres.Sport! } } }).state, 'provisional');
  assert.equal(describeV3Processing({ ...input, job: null }).state, 'provisional');
  assert.equal(describeV3Processing({ ...input, profile: { ...profile, version: 'old' } }).state, 'stale');
  for (const [state, expected] of [['running', 'running'], ['queued', 'queued'], ['failed', 'failed']] as const) {
    assert.equal(describeV3Processing({ ...input, job: { ...job, state } }).state, expected);
  }
  const retry = describeV3Processing({ ...input, job: { ...job, state: 'queued', attempts: 1, retryAt: 2000 } });
  assert.equal(retry.state, 'retry');
  assert.equal(retry.retryAt, 2000);
  assert.equal(retry.profile?.provisional, true);
  const stale = describeV3Processing({ ...input, job: { ...job, state: 'running', version: 'old',
    progress: { phase: 'classification', processed: 3, total: 10 } } });
  assert.equal(stale.state, 'stale');
  assert.equal(stale.progress, null, 'old-version phase must not describe current work');
});

test('v3 notice separates archive metadata, bounded video classification, withholds internal tag batches and channel source counts', () => {
  const render = (progress: V3JobStatus['progress']) => v3ProcessingNotice(describeV3Processing({ ...input,
    job: { ...job, state: 'running', progress } }), 'en', { ownerDetails: true }).replace(/<script>[\s\S]*?<\/script>/g, '');
  const classification = render({ phase: 'classification', processed: 125, total: 2000 });
  assert.match(classification, /19,000 \/ 19,000 videos checked/);
  assert.match(classification, /125 \/ 2,000 videos/);
  assert.doesNotMatch(classification, /125 \/ 19,000|\bETA\b|estimated|120 minutes|taxonomy/i);
  const embedding = render({ phase: 'embedding', processed: 64, total: 64 });
  assert.doesNotMatch(embedding, /current batch/);
  assert.doesNotMatch(embedding, /64 \/ 64 tags/);
  assert.doesNotMatch(embedding, /not completion across all videos/);
  const genre = render({ phase: 'embedding', genre: 'Sport', processed: 30, total: 80 });
  assert.doesNotMatch(genre, /Sport tag embeddings/);
  const channels = render({ phase: 'channels', processed: 0, total: 2000 });
  assert.match(channels, /Interest analysis in progress/);
  assert.doesNotMatch(channels, /2,000 source videos/);
  assert.doesNotMatch(channels, /analysis: 0 \/ 2,000|<progress/);
});

test('v3 notice is bilingual, hides private details and optional completed notices, and escapes phase labels', () => {
  const status = describeV3Processing({ ...input, job: { ...job, state: 'running',
    progress: { phase: 'embedding', genre: '<script>bad</script>' as Genre, processed: 2, total: 5 } } });
  const owner = v3ProcessingNotice(status, 'zh', { ownerDetails: true });
  assert.match(owner, /興趣分析進行中/);
  assert.doesNotMatch(owner, /v3 興趣分析/);
  assert.match(owner, /分析更新於/);
  assert.doesNotMatch(owner, /目前分析階段/);
  assert.doesNotMatch(owner, /&lt;script&gt;/);
  assert.doesNotMatch(owner, /<script>bad|120 分鐘|分類審核/);
  const visitor = v3ProcessingNotice(status, 'en');
  assert.match(visitor, /Interest analysis in progress/);
  assert.doesNotMatch(visitor, /19,000|2,000|bad|tags|<progress/);
  assert.equal(v3ProcessingNotice(describeV3Processing(input)), '');
  assert.match(v3ProcessingNotice(describeV3Processing(input), 'en', { ownerDetails: true }), /data-processing-monitor/, 'owners can still monitor completed jobs');
  assert.doesNotMatch(visitor, /data-processing-monitor|api\/matching-v3/);
  assert.match(v3ProcessingNotice(describeV3Processing(input), 'en', { alwaysShow: true }), /Interest analysis ready/);
  assert.equal(v3ProcessingNotice(describeV3Processing({ ...input, enabled: false })), '');
  const metadata = describeV3Processing({ ...input, metadata: { ...input.metadata, videosPendingMetadata: 4 } });
  assert.match(v3ProcessingNotice(metadata, 'en'), /Video information or interest analysis/);
  const previous = describeV3Processing({ ...input, profile: { ...profile, version: 'previous' } });
  assert.doesNotMatch(v3ProcessingNotice(previous, 'zh', { ownerDetails: true }), /前次 v3 輪廓/);
  const invalidDate = describeV3Processing({ ...input, profile: { ...profile, builtAt: 'invalid' } });
  assert.doesNotMatch(v3ProcessingNotice(invalidDate, 'en', { alwaysShow: true, ownerDetails: true }), /Invalid Date|Analysis updated/);
});

test('metadata display counts remain available without legacy taxonomy tables and do not migrate or update data', () => {
  const repository = new Repository(':memory:');
  try {
    const db = (repository as unknown as { db: DatabaseSync }).db;
    db.exec("PRAGMA foreign_keys=OFF; DROP TABLE youtube_taxonomy_runs; DROP TABLE youtube_video_topics;");
    db.prepare('INSERT INTO youtube_videos(video_id,title,channel_id,metadata_fetched_at) VALUES (?,?,?,?)')
      .run('fixture-a', 'Video A', 'fixture-channel', null);
    db.prepare('INSERT INTO youtube_videos(video_id,title,channel_id,metadata_fetched_at) VALUES (?,?,?,?)')
      .run('fixture-b', 'Video B', 'fixture-channel', '2026-09-06T00:00:00Z');
    const before = db.prepare('SELECT total_changes() changes').get()!.changes;
    assert.deepEqual(repository.youtubeMetadataProcessingCounts(), { videos: 2, videosPendingMetadata: 1, channelsPendingMetadata: 1 });
    assert.equal(db.prepare('SELECT total_changes() changes').get()!.changes, before);
  } finally { repository.close(); }
});

test('metadata progress follows active, dormant and missing channel refresh work', () => {
  const repository = new Repository(':memory:');
  const now = new Date('2026-10-20T00:00:00Z');
  const channels = [
    { id: 'active', watched: '2026-10-15T00:00:00Z', fetched: '2026-10-01T00:00:00Z' },
    { id: 'dormant', watched: '2026-09-01T00:00:00Z', fetched: '2026-10-01T00:00:00Z' },
    { id: 'expired', watched: '2026-06-01T00:00:00Z', fetched: '2026-07-01T00:00:00Z' },
    { id: 'missing', watched: '2026-06-01T00:00:00Z', fetched: null },
  ];
  try {
    repository.ingestYoutubeArchive({ archiveHash: 'metadata-cadence', source: 'takeout', searches: [],
      watches: channels.map(({ id, watched }) => ({ eventId: id, videoId: `video-${id}`,
        title: id, url: `https://www.youtube.com/watch?v=video-${id}`,
        channelId: id, channelTitle: id, channelUrl: '', watchedAt: watched,
        actualWatchedSeconds: 600, activityType: 'video' as const })) });
    const db = (repository as unknown as { db: DatabaseSync }).db;
    db.prepare('UPDATE youtube_videos SET metadata_fetched_at=?').run(now.toISOString());
    const insert = db.prepare(`INSERT INTO youtube_channels
      (channel_id,name,thumbnail_url,metadata_fetched_at,statistics_fetched_at) VALUES (?,?,'',?,?)`);
    for (const channel of channels) {
      if (channel.fetched) insert.run(channel.id, channel.id, channel.fetched, channel.fetched);
    }
    const before = db.prepare('SELECT total_changes() changes').get()!.changes;
    assert.deepEqual(repository.youtubeChannelsNeedingMetadata(10, now), ['active', 'expired', 'missing']);
    assert.deepEqual(repository.youtubeMetadataProcessingCounts(now), {
      videos: 4, videosPendingMetadata: 0, channelsPendingMetadata: 3,
    }, 'dormant channels with statistics younger than 90 days are not pending');
    assert.equal(repository.youtubeProcessingCounts(now).channelsPendingMetadata, 3);
    assert.equal(db.prepare('SELECT total_changes() changes').get()!.changes, before);
  } finally { repository.close(); }
});

test('v3 display job read includes the actual version and phase without exposing stored errors or altering work', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1)');
    const store = new MatchingStore(db);
    store.schedule(1, 'fixture-source', 'current');
    const claimed = store.claim()!;
    store.progress(claimed, { phase: 'embedding', genre: 'Sport', processed: 12, total: 15 });
    store.defer(claimed, 'sensitive-provider-error', false, 2000);
    const before = store.status(1);
    assert.deepEqual(store.processingStatus(1), { state: 'queued', version: 'current', attempts: 1, retryAt: 2000,
      progress: { phase: 'embedding', genre: 'Sport', processed: 12, total: 15 } });
    assert.doesNotMatch(JSON.stringify(store.processingStatus(1)), /sensitive-provider-error/);
    assert.deepEqual(store.status(1), before);
    assert.equal(store.processingStatus(2), null);
  } finally { db.close(); }
});
