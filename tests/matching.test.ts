import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Repository } from '../src/data/database.js';
import { buildYoutubeCrystal, compareCrystals } from '../src/youtube/crystal.js';
import {
  MATCHING_TAXONOMY,
  classifyYoutubeVideosForMatching,
  matchingTopicForYoutubeCategory,
  matchingTopicProfile,
  youtubeMatchingWorkPending,
} from '../src/youtube/matching.js';
import type { YoutubeParsedArchive, YoutubeVideoMetadata } from '../src/youtube/types.js';

const NOW = new Date('2026-09-05T12:00:00.000Z');

function seedVideo(
  repository: Repository,
  videoId: string,
  title: string,
  channel: string,
  categoryId = '28',
): YoutubeVideoMetadata {
  const watch: YoutubeParsedArchive['watches'][number] = {
    eventId: `${videoId}-${channel}`,
    videoId,
    title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    channelId: `channel-${channel}`,
    channelTitle: channel,
    channelUrl: `https://www.youtube.com/channel/channel-${channel}`,
    watchedAt: '2026-09-01T12:00:00.000Z',
    actualWatchedSeconds: 600,
    activityType: 'video',
  };
  repository.ingestYoutubeArchive({
    archiveHash: `matching-${videoId}-${channel}`,
    source: 'takeout',
    watches: [watch],
    searches: [],
  });
  const metadata: YoutubeVideoMetadata = {
    videoId,
    title,
    channelId: `channel-${channel}`,
    channelTitle: channel,
    description: 'Public metadata fixture',
    tags: [],
    thumbnailUrl: '',
    durationSeconds: 600,
    publishedAt: '2026-08-01T00:00:00.000Z',
    categoryId,
    availability: 'available',
    metadataHash: `${videoId}-${categoryId}-v1`,
  };
  repository.upsertYoutubeVideoMetadata([metadata]);
  return metadata;
}

test('matching taxonomy is stable, versioned, and excludes sensitive YouTube categories', () => {
  assert.equal(MATCHING_TAXONOMY.version, 1);
  assert.ok(MATCHING_TAXONOMY.topics.length >= 12 && MATCHING_TAXONOMY.topics.length <= 20);
  const keys = MATCHING_TAXONOMY.topics.map((topic) => topic.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(MATCHING_TAXONOMY.topics.every((topic) => topic.name && topic.description));
  assert.equal(matchingTopicForYoutubeCategory('27')?.key, 'learning');
  assert.equal(matchingTopicForYoutubeCategory('28')?.key, 'science-technology');
  assert.equal(matchingTopicForYoutubeCategory('25'), null);
  assert.equal(matchingTopicForYoutubeCategory('29'), null);
});

test('matching profiles use the common taxonomy instead of per-user topic slugs', () => {
  const left = new Repository(':memory:');
  const right = new Repository(':memory:');
  try {
    const leftVideo = seedVideo(left, 'LEFTTECH001', 'TypeScript systems', 'Left Lab');
    const rightVideo = seedVideo(right, 'RIGHTTECH01', 'Robotics explained', 'Right Lab');

    const [leftLocal] = left.replaceYoutubeTaxonomy([
      { version: 1, slug: 'left-private-axis', name: 'Left axis', description: 'Personal only' },
    ]);
    const [rightLocal] = right.replaceYoutubeTaxonomy([
      { version: 1, slug: 'right-private-axis', name: 'Right axis', description: 'Personal only' },
    ]);
    left.saveYoutubeVideoTopics(
      leftVideo.videoId,
      [{ topicId: leftLocal.id, rank: 1, confidence: 1 }],
      'fixture', 'personal-v1', leftVideo.metadataHash,
    );
    right.saveYoutubeVideoTopics(
      rightVideo.videoId,
      [{ topicId: rightLocal.id, rank: 1, confidence: 1 }],
      'fixture', 'personal-v1', rightVideo.metadataHash,
    );

    assert.equal(youtubeMatchingWorkPending(left), true);
    assert.equal(classifyYoutubeVideosForMatching(left), 1);
    assert.equal(classifyYoutubeVideosForMatching(right), 1);
    assert.equal(classifyYoutubeVideosForMatching(left), 0);
    assert.equal(youtubeMatchingWorkPending(left), false);
    const leftProfile = matchingTopicProfile(left, '2026-06-07T12:00:00.000Z', NOW.toISOString());
    const rightProfile = matchingTopicProfile(right, '2026-06-07T12:00:00.000Z', NOW.toISOString());
    assert.equal(leftProfile.taxonomyVersion, MATCHING_TAXONOMY.version);
    assert.equal(leftProfile.coverage, 1);
    assert.deepEqual(leftProfile.topics.map((topic) => topic.key), ['science-technology']);
    assert.deepEqual(rightProfile.topics.map((topic) => topic.key), ['science-technology']);
    assert.doesNotMatch(JSON.stringify([leftProfile, rightProfile]), /private-axis/);

    const comparison = compareCrystals(
      buildYoutubeCrystal(left, { handle: 'left', displayName: 'Left' }, NOW),
      buildYoutubeCrystal(right, { handle: 'right', displayName: 'Right' }, NOW),
    );
    assert.equal(comparison.topicSimilarity, 1);
    assert.equal(comparison.topicFallback, null);
    assert.deepEqual(comparison.sharedTopics.map((topic) => topic.name), ['Science & Technology']);
  } finally {
    left.close();
    right.close();
  }
});

test('matching comparison falls back to channels across taxonomy versions or low coverage', () => {
  const left = new Repository(':memory:');
  const right = new Repository(':memory:');
  try {
    seedVideo(left, 'SAMEVIDEO01', 'Shared public video', 'Shared Channel');
    seedVideo(right, 'SAMEVIDEO01', 'Shared public video', 'Shared Channel');
    classifyYoutubeVideosForMatching(left);
    classifyYoutubeVideosForMatching(right);
    const a = buildYoutubeCrystal(left, { handle: 'left', displayName: 'Left' }, NOW);
    const b = buildYoutubeCrystal(right, { handle: 'right', displayName: 'Right' }, NOW);
    const mismatch = compareCrystals(a, {
      ...b,
      matching: { ...b.matching, taxonomyVersion: b.matching.taxonomyVersion + 1 },
    });
    assert.equal(mismatch.topicSimilarity, null);
    assert.equal(mismatch.topicFallback, 'taxonomy-version-mismatch');
    assert.equal(mismatch.channelSimilarity, 1);
    assert.deepEqual(mismatch.sharedTopics, []);

    const unclassified = new Repository(':memory:');
    try {
      seedVideo(unclassified, 'UNCLASSIFIED', 'Pending metadata mapping', 'Shared Channel');
      const pending = compareCrystals(
        a,
        buildYoutubeCrystal(unclassified, { handle: 'pending', displayName: 'Pending' }, NOW),
      );
      assert.equal(pending.topicSimilarity, null);
      assert.equal(pending.topicFallback, 'insufficient-coverage');
      assert.ok(pending.channelSimilarity > 0);
    } finally {
      unclassified.close();
    }
  } finally {
    left.close();
    right.close();
  }
});

test('sensitive-only categories are processed without creating a comparable topic signal', () => {
  const left = new Repository(':memory:');
  const right = new Repository(':memory:');
  try {
    seedVideo(left, 'SENSITIVE01', 'Excluded category fixture', 'Shared Channel', '25');
    seedVideo(right, 'SENSITIVE02', 'Another excluded fixture', 'Shared Channel', '29');
    assert.equal(classifyYoutubeVideosForMatching(left), 1);
    assert.equal(classifyYoutubeVideosForMatching(right), 1);
    const a = buildYoutubeCrystal(left, { handle: 'left', displayName: 'Left' }, NOW);
    const b = buildYoutubeCrystal(right, { handle: 'right', displayName: 'Right' }, NOW);
    assert.equal(a.matching.topicCoverage, 1);
    assert.deepEqual(a.matching.topics, []);
    const comparison = compareCrystals(a, b);
    assert.equal(comparison.topicSimilarity, null);
    assert.equal(comparison.topicFallback, 'no-shareable-topics');
    assert.equal(comparison.channelSimilarity, 1);
  } finally {
    left.close();
    right.close();
  }
});

test('matching rows are recomputed after metadata changes without overwriting old versions', () => {
  const repository = new Repository(':memory:');
  try {
    const metadata = seedVideo(repository, 'CHANGING001', 'Changing category', 'Fixture');
    assert.equal(classifyYoutubeVideosForMatching(repository), 1);
    repository.upsertYoutubeVideoMetadata([{
      ...metadata,
      categoryId: '27',
      metadataHash: 'changed-to-learning-v2',
    }]);
    assert.equal(classifyYoutubeVideosForMatching(repository), 1);
    const profile = matchingTopicProfile(repository, null, null);
    assert.deepEqual(profile.topics.map((topic) => topic.key), ['learning']);

    assert.equal(repository.youtubeVideosForMatchingClassification(2).length, 1);
    repository.saveYoutubeVideoMatchingTopic({
      videoId: metadata.videoId,
      taxonomyVersion: 2,
      topicKey: 'learning',
      metadataHash: 'changed-to-learning-v2',
    });
    assert.equal(repository.youtubeVideosForMatchingClassification(2).length, 0);
    assert.deepEqual(matchingTopicProfile(repository, null, null).topics.map((topic) => topic.key), ['learning']);
  } finally {
    repository.close();
  }
});

test('matching schema migration upgrades a version-9 archive without losing data', () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-matching-migration-'));
  const path = join(root, 'archive.sqlite');
  try {
    const initial = new Repository(path);
    seedVideo(initial, 'MIGRATION01', 'Migration fixture', 'Fixture');
    initial.close();
    const old = new DatabaseSync(path);
    old.exec('DROP TABLE youtube_video_matching_topics; PRAGMA user_version = 9;');
    old.close();

    const upgraded = new Repository(path);
    assert.equal(upgraded.youtubeCounts().watches, 1);
    assert.equal(classifyYoutubeVideosForMatching(upgraded), 1);
    upgraded.close();

    const reopened = new Repository(path);
    assert.equal(classifyYoutubeVideosForMatching(reopened), 0);
    assert.deepEqual(
      matchingTopicProfile(reopened, null, null).topics.map((topic) => topic.key),
      ['science-technology'],
    );
    reopened.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
