import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { Repository } from '../src/data/database.js';
import { processingNotice } from '../src/output/processing.js';
import { youtubeDashboardPage } from '../src/output/youtube.js';
import { accountPage } from '../src/output/onboarding.js';
import { describeYoutubeProcessing, type YoutubeProcessingCounts } from '../src/youtube/processing.js';
import { parseYoutubeArchive } from '../src/youtube/takeout.js';
import { runYoutubeWorkerCycle, youtubeWorkPending, type YoutubeWorkerSteps } from '../src/youtube-worker.js';
import { UserRegistry } from '../src/users.js';
import type { YoutubeVideoMetadata } from '../src/youtube/types.js';

const SECRET = 'test-private-data-key-with-at-least-32-characters';
const BOTH = { metadata: true, topics: true };

function counts(overrides: Partial<YoutubeProcessingCounts> = {}): YoutubeProcessingCounts {
  return {
    videos: 0, videosPendingMetadata: 0, channelsPendingMetadata: 0,
    videosClassifiable: 0, videosPendingTopics: 0,
    lastImportAt: null, lastCycleAt: null, lastError: null,
    ...overrides,
  };
}

function archiveJson(videoIds: string[]): Uint8Array {
  const entries = videoIds.map((videoId, index) => ({
    header: 'YouTube', title: `Watched Video ${videoId}`,
    titleUrl: `https://www.youtube.com/watch?v=${videoId}`,
    subtitles: [{ name: 'Channel One', url: 'https://www.youtube.com/channel/channel-one' }],
    time: `2026-07-28T0${index}:00:00Z`, products: ['YouTube'],
    activityControls: ['YouTube watch history'],
  }));
  return zipSync({
    'Takeout/YouTube and YouTube Music/history/watch-history.json': strToU8(JSON.stringify(entries)),
  });
}

test('processing status follows the worker through metadata and topics', () => {
  const repository = new Repository(':memory:');
  try {
    assert.equal(describeYoutubeProcessing(repository.youtubeProcessingCounts(), BOTH).stage, 'done');

    repository.ingestYoutubeArchive(parseYoutubeArchive(archiveJson(['video-one', 'video-two']), SECRET, 'takeout'));
    const fresh = repository.youtubeProcessingCounts();
    assert.equal(fresh.videos, 2);
    assert.equal(fresh.videosPendingMetadata, 2);
    assert.equal(fresh.videosPendingTopics, 0);
    assert.ok(fresh.lastImportAt);
    const afterImport = describeYoutubeProcessing(fresh, BOTH);
    assert.equal(afterImport.stage, 'metadata');
    // Two videos plus the one channel they share still need public details.
    assert.deepEqual(afterImport.metadata, { done: 0, total: 2, pending: 3 });
    // Unfetched videos still count toward the topic total so the bar never
    // moves backwards once metadata lands.
    assert.deepEqual(afterImport.topics, { done: 0, total: 2, pending: 2 });
    assert.equal(afterImport.pending, 3);
    assert.equal(afterImport.estimatedMinutes, 10);

    const metadata = (videoId: string, availability: 'available' | 'unavailable'): YoutubeVideoMetadata => ({
      videoId, title: `Video ${videoId}`, channelId: 'channel-one', channelTitle: 'Channel One',
      description: '', tags: [], thumbnailUrl: '', durationSeconds: 600,
      publishedAt: '2026-07-20T00:00:00Z', categoryId: '28', availability, metadataHash: `${videoId}-v1`,
    });
    repository.upsertYoutubeVideoMetadata([metadata('video-one', 'available'), metadata('video-two', 'unavailable')]);
    const enriched = repository.youtubeProcessingCounts();
    assert.equal(enriched.videosPendingMetadata, 0);
    assert.equal(enriched.channelsPendingMetadata, 1);
    assert.equal(enriched.videosClassifiable, 1);
    assert.equal(enriched.videosPendingTopics, 1);
    const afterMetadata = describeYoutubeProcessing(enriched, BOTH);
    assert.equal(afterMetadata.stage, 'topics');
    assert.deepEqual(afterMetadata.topics, { done: 0, total: 1, pending: 1 });
    assert.equal(afterMetadata.pending, 2);

    repository.upsertYoutubeChannelMetadata([{ channelId: 'channel-one', name: 'Channel One', thumbnailUrl: '' }]);
    repository.replaceYoutubeTaxonomy([...Array(12)].map((_, index) => ({
      version: 1, slug: `topic-${index}`, name: `Topic ${index}`, description: `About ${index}`,
    })));
    const topic = repository.youtubeTopics()[0]!;
    repository.saveYoutubeVideoTopics('video-one', [{ topicId: topic.id, rank: 1, confidence: 0.9 }], 'test', 'v1', 'video-one-v1');
    const settled = describeYoutubeProcessing(repository.youtubeProcessingCounts(), BOTH);
    assert.equal(settled.stage, 'done');
    assert.equal(settled.pending, 0);
    assert.equal(settled.estimatedMinutes, null);
  } finally {
    repository.close();
  }
});

test('stages this deployment cannot run never count as pending', () => {
  const pendingEverything = counts({ videos: 10, videosPendingMetadata: 10, channelsPendingMetadata: 2 });
  assert.equal(describeYoutubeProcessing(pendingEverything, { metadata: false, topics: false }).pending, 0);
  assert.equal(describeYoutubeProcessing(pendingEverything, { metadata: false, topics: true }).pending, 0);
  const metadataOnly = describeYoutubeProcessing(pendingEverything, { metadata: true, topics: false });
  assert.equal(metadataOnly.pending, 12);
  assert.equal(metadataOnly.topics, null);
  assert.equal(metadataOnly.estimatedMinutes, 5);
  const largeImport = describeYoutubeProcessing(counts({ videos: 30_000, videosPendingMetadata: 30_000 }), BOTH);
  assert.equal(largeImport.estimatedMinutes, (6 + 30) * 5);
});

test('processing notice renders progress and disappears when nothing is pending', () => {
  const now = Date.parse('2026-09-04T10:00:00Z');
  const status = describeYoutubeProcessing(counts({
    videos: 1000, videosPendingMetadata: 400, videosClassifiable: 600, videosPendingTopics: 600,
    lastCycleAt: '2026-09-04T09:57:00Z', lastError: 'YouTube API: HTTP 403',
  }), BOTH);
  const en = processingNotice(status, 'en', { dashboardHref: '/sky', now });
  assert.match(en, /role="status"/);
  assert.match(en, /Still organizing this archive/);
  assert.match(en, /Video details<em>600 \/ 1,000<\/em>/);
  assert.match(en, /AI topics<em>not started<\/em>/);
  assert.match(en, /style="width:60%"/);
  assert.match(en, /about 10 min to go/);
  assert.match(en, /last processed/);
  assert.match(en, /retries automatically/);
  assert.match(en, /href="\/sky"/);
  const zh = processingNotice(status, 'zh');
  assert.match(zh, /資料還在整理中/);
  assert.match(zh, /預計還需約 10 分鐘/);
  assert.doesNotMatch(zh, /href=/);
  assert.equal(processingNotice(describeYoutubeProcessing(counts(), BOTH), 'en'), '');
  assert.equal(processingNotice(undefined, 'en'), '');
});

test('dashboard and account pages carry the notice while work is pending', () => {
  const repository = new Repository(':memory:');
  const registry = new UserRegistry(':memory:');
  try {
    repository.ingestYoutubeArchive(parseYoutubeArchive(archiveJson(['video-one']), SECRET, 'takeout'));
    const status = describeYoutubeProcessing(repository.youtubeProcessingCounts(), BOTH);
    const notice = processingNotice(status, 'en');
    const data = repository.youtubeDashboard('all');
    const withNotice = youtubeDashboardPage('Fixture', data, 'duration', { processingHtml: notice, page: 'insights' });
    assert.match(withNotice, /class="yt-processing"/);
    const overview = youtubeDashboardPage('Fixture', data, 'duration', { processingHtml: notice });
    assert.match(overview, /class="yt-provisional">provisional</);
    const settled = youtubeDashboardPage('Fixture', data, 'duration', {});
    assert.doesNotMatch(settled, /class="yt-processing"|class="yt-provisional"/);

    const user = registry.createUser('sky', 'Sky');
    const afterUpload = accountPage(user, {
      takeoutResult: { archiveHash: 'x', watchesSeen: 1, watchesInserted: 1, searchesSeen: 0, searchesInserted: 0 },
      processing: status,
    }, 'zh');
    assert.match(afterUpload, /紀錄已經存好/);
    assert.equal(afterUpload.match(/class="yt-processing"/g)?.length, 1);
    const laterVisit = accountPage(user, { processing: status }, 'en');
    assert.equal(laterVisit.match(/class="yt-processing"/g)?.length, 1);
    assert.doesNotMatch(laterVisit, /Your records are saved/);
    assert.doesNotMatch(accountPage(user, {}, 'en'), /yt-processing"/);
  } finally {
    repository.close();
    registry.close();
  }
});

test('worker stamps each archive and reports pending work only for configured stages', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    registry.ensureDefaultUser();
    const alice = registry.createUser('alice', 'Alice');
    const repository = registry.repositoryFor(alice);
    repository.ingestYoutubeArchive(parseYoutubeArchive(archiveJson(['video-one']), SECRET, 'takeout'));
    assert.equal(youtubeWorkPending(registry, { metadata: false, topics: false }), false);
    assert.equal(youtubeWorkPending(registry, { metadata: false, topics: true }), false);
    assert.equal(youtubeWorkPending(registry, { metadata: true, topics: false }), true);

    const steps: YoutubeWorkerSteps = {
      portability: async () => 'idle',
      metadata: async () => 0,
      channelMetadata: async () => 0,
      classification: async () => { throw new Error('boom'); },
    };
    await runYoutubeWorkerCycle(registry, steps, () => new Date('2026-09-04T10:00:00Z'));
    assert.equal(repository.youtubeSyncState('worker_cycle_at'), '2026-09-04T10:00:00.000Z');
    assert.equal(repository.youtubeProcessingCounts().lastCycleAt, '2026-09-04T10:00:00.000Z');
    assert.match(repository.youtubeProcessingCounts().lastError ?? '', /boom/);
  } finally {
    registry.close();
  }
});
