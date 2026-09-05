import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Repository } from '../src/data/database.js';
import { UserRegistry } from '../src/users.js';
import { youtubeInitialTopicsPending, runYoutubeWorkerCycle, type YoutubeWorkerSteps } from '../src/youtube-worker.js';
import { personalTaxonomyAuditPage } from '../src/output/taxonomy-audit.js';
import { ensureYoutubeTaxonomyWithClient, classifyYoutubeVideosWithClient, activateInitialTopicsIfReady, type YoutubeAiClient } from '../src/youtube/ai.js';
import {
  PERSONAL_TAXONOMY_CONFIDENCE_MIN,
  PERSONAL_TAXONOMY_DEFINITION_VERSION,
  PERSONAL_TAXONOMY_MAX_CHANNEL_SHARE,
  PERSONAL_TAXONOMY_METADATA_MIN_COVERAGE,
  PERSONAL_TAXONOMY_PROMPT_VERSION,
  PERSONAL_TOPICS,
  assessPersonalTaxonomyQuality,
  decidePersonalClassification,
  personalTaxonomyReadiness,
  samplePersonalTaxonomy,
  type PersonalTaxonomySampleCandidate,
} from '../src/youtube/personal-taxonomy.js';
import type { YoutubeVideoMetadata } from '../src/youtube/types.js';

function candidate(index: number, overrides: Partial<PersonalTaxonomySampleCandidate> = {}): PersonalTaxonomySampleCandidate {
  const month = String(index % 12 + 1).padStart(2, '0');
  return {
    videoId: `sample-${String(index).padStart(4, '0')}`,
    title: `Science lesson ${index}`,
    channelId: `channel-${index % 20}`,
    channelTitle: `Channel ${index % 20}`,
    channelKey: `channel-${index % 20}`,
    description: `A science explanation for lesson ${index}`,
    tags: ['science', `lesson-${index}`],
    thumbnailUrl: '',
    durationSeconds: 300,
    publishedAt: null,
    categoryId: null,
    availability: 'available',
    metadataHash: `hash-${index}`,
    firstWatchedAt: `2024-${month}-01T00:00:00.000Z`,
    lastWatchedAt: `2025-${month}-01T00:00:00.000Z`,
    watches: index % 6 + 1,
    ...overrides,
  };
}

test('personal taxonomy waits for a stable and useful metadata corpus', () => {
  assert.equal(personalTaxonomyReadiness(1000, 979, 979).ready, false);
  assert.equal(personalTaxonomyReadiness(1000, 980, 23).reason, 'available-videos');
  const ready = personalTaxonomyReadiness(1000, 980, 900);
  assert.equal(ready.ready, true);
  assert.equal(ready.metadataCoverage, PERSONAL_TAXONOMY_METADATA_MIN_COVERAGE);
});

test('governed topics are unique, broad, and include explicit abstention', () => {
  assert.equal(PERSONAL_TOPICS.length, 14);
  assert.equal(new Set(PERSONAL_TOPICS.map((topic) => topic.slug)).size, PERSONAL_TOPICS.length);
  assert.ok(PERSONAL_TOPICS.some((topic) => topic.slug === 'other'));
  assert.ok(PERSONAL_TOPICS.some((topic) => topic.slug === 'unknown'));
  assert.ok(PERSONAL_TOPICS.every((topic) => topic.name && topic.nameZh && topic.description));
});

test('repository rejects a forged topic list for the governed definition', () => {
  const repository = new Repository(':memory:');
  try {
    assert.throws(() => repository.createPersonalTaxonomyRun({
      definitionVersion: PERSONAL_TAXONOMY_DEFINITION_VERSION,
      model: 'fixture-model',
      promptVersion: PERSONAL_TAXONOMY_PROMPT_VERSION,
      topics: [{ slug: 'private-profile', name: 'Private profile', description: 'Too specific' }],
      sample: samplePersonalTaxonomy(Array.from({ length: 24 }, (_, index) => candidate(index))),
    }), /governed topic definitions/);
    assert.deepEqual(repository.youtubeTaxonomyRuns(), []);
  } finally {
    repository.close();
  }
});

test('taxonomy sampling spans time and frequency without enrichment-order bias', () => {
  const candidates = Array.from({ length: 720 }, (_, index) => candidate(index));
  const first = samplePersonalTaxonomy(candidates, 240);
  const reversed = samplePersonalTaxonomy([...candidates].reverse(), 240);
  assert.deepEqual(reversed, first);
  assert.equal(first.sampledVideos, 240);
  assert.equal(first.periods.length, 12);
  assert.ok(first.frequencyBuckets.once > 0);
  assert.ok(first.frequencyBuckets.repeat > 0);
  assert.ok(first.frequencyBuckets.frequent > 0);
  assert.ok(first.channels >= 19);
  assert.equal(first.maxVideosPerChannel, Math.ceil(240 * PERSONAL_TAXONOMY_MAX_CHANNEL_SHARE));
  const counts = new Map<string, number>();
  for (const id of first.videoIds) {
    const item = candidates.find((entry) => entry.videoId === id)!;
    counts.set(item.channelKey, (counts.get(item.channelKey) ?? 0) + 1);
  }
  assert.ok(Math.max(...counts.values()) <= first.maxVideosPerChannel);
});

test('known classifications require positive source evidence and low confidence abstains', () => {
  const video = candidate(1);
  const accepted = decidePersonalClassification(video, {
    slug: 'technology',
    confidence: 0.88,
    alternativeSlug: 'learning',
    alternativeConfidence: 0.3,
    evidence: [{ text: 'Science lesson', source: 'title', score: 0.9 }],
  });
  assert.equal(accepted.decision, 'accepted');
  const low = decidePersonalClassification(video, {
    slug: 'technology',
    confidence: PERSONAL_TAXONOMY_CONFIDENCE_MIN - 0.01,
    alternativeSlug: null,
    alternativeConfidence: null,
    evidence: [{ text: 'science', source: 'tag', score: 0.5 }],
  });
  assert.equal(low.slug, 'unknown');
  assert.equal(low.decision, 'low-confidence');
  assert.deepEqual(low.evidence, []);
  assert.throws(() => decidePersonalClassification(video, {
    slug: 'technology', confidence: 0.9, alternativeSlug: null, alternativeConfidence: null,
    evidence: [{ text: 'not in metadata', source: 'title', score: 1 }],
  }), /occur/);
  assert.throws(() => decidePersonalClassification(video, {
    slug: 'technology', confidence: 0.9, alternativeSlug: null, alternativeConfidence: null,
    evidence: [{ text: 'Science', source: 'title', score: 0 }],
  }), /positive score/);
});

test('run quality reports every failed activation gate', () => {
  const good = assessPersonalTaxonomyQuality({
    total: 100, processed: 98, accepted: 80, unknown: 18,
    lowConfidence: 10, ambiguous: 12, acceptedConfidenceTotal: 68,
  });
  assert.equal(good.passed, true);
  const bad = assessPersonalTaxonomyQuality({
    total: 100, processed: 90, accepted: 20, unknown: 70,
    lowConfidence: 50, ambiguous: 15, acceptedConfidenceTotal: 10,
  });
  assert.equal(bad.passed, false);
  assert.deepEqual(bad.failures, ['coverage', 'unknown', 'low-confidence', 'ambiguity', 'cohesion']);
});

function seedWatchedVideos(repository: Repository, count = 24): YoutubeVideoMetadata[] {
  const videos = Array.from({ length: count }, (_, index): YoutubeVideoMetadata => ({
    videoId: `PERSVID${String(index).padStart(4, '0')}`,
    title: `Software lesson ${index}`,
    channelId: `channel-${index}`,
    channelTitle: `Channel ${index}`,
    description: 'Public software lesson',
    tags: ['software'],
    thumbnailUrl: '',
    durationSeconds: 600,
    publishedAt: null,
    categoryId: null,
    availability: 'available',
    metadataHash: `metadata-${index}`,
  }));
  repository.ingestYoutubeArchive({
    archiveHash: `personal-taxonomy-${count}`,
    source: 'takeout',
    searches: [],
    watches: videos.map((video, index) => ({
      eventId: `personal-event-${index}`,
      videoId: video.videoId,
      title: video.title,
      url: `https://www.youtube.com/watch?v=${video.videoId}`,
      channelId: video.channelId,
      channelTitle: video.channelTitle,
      channelUrl: null,
      watchedAt: `2026-07-${String(index % 24 + 1).padStart(2, '0')}T00:00:00.000Z`,
      actualWatchedSeconds: 120,
      activityType: 'video',
    })),
  });
  repository.upsertYoutubeVideoMetadata(videos, '2026-07-29T00:00:00.000Z');
  return videos;
}

test('candidate assignments survive a worker restart without creating another run', () => {
  const directory = mkdtempSync(join(tmpdir(), 'urtube-taxonomy-restart-'));
  const databasePath = join(directory, 'archive.sqlite');
  try {
    const first = new Repository(databasePath);
    const videos = seedWatchedVideos(first);
    const sample = samplePersonalTaxonomy(first.youtubePersonalTaxonomyCandidates());
    const run = first.createPersonalTaxonomyRun({
      definitionVersion: PERSONAL_TAXONOMY_DEFINITION_VERSION,
      model: 'fixture-model',
      promptVersion: PERSONAL_TAXONOMY_PROMPT_VERSION,
      topics: PERSONAL_TOPICS.map(({ slug, name, description }) => ({ slug, name, description })),
      sample,
    });
    first.savePersonalYoutubeVideoTopic(run, videos[0], decidePersonalClassification(videos[0], {
      slug: 'technology', confidence: 0.9,
      alternativeSlug: null, alternativeConfidence: null,
      evidence: [{ text: 'Software lesson', source: 'title', score: 0.9 }],
    }));
    first.close();

    const restarted = new Repository(databasePath);
    try {
      const resumed = restarted.youtubeTaxonomyRunForContract(
        PERSONAL_TAXONOMY_DEFINITION_VERSION,
        'fixture-model',
        PERSONAL_TAXONOMY_PROMPT_VERSION,
      );
      assert.equal(resumed?.taxonomyVersion, run.taxonomyVersion);
      assert.equal(resumed?.status, 'candidate');
      assert.equal(restarted.youtubeTaxonomyRuns().length, 1);
      assert.equal(restarted.youtubeVideosForPersonalClassification(resumed!, 100).length, 23);
    } finally {
      restarted.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a migrated v1 archive needs an explicit v2 candidate start', async () => {
  const repository = new Repository(':memory:');
  try {
    seedWatchedVideos(repository);
    repository.replaceYoutubeTaxonomy([{
      version: 1, slug: 'legacy', name: 'Legacy', description: 'Legacy personal taxonomy',
    }]);
    const client: YoutubeAiClient = {
      baseUrl: 'https://ai.example.test/v1',
      apiKey: 'fixture-key',
      model: 'fixture-model',
      fetchImpl: (async () => { throw new Error('fixed taxonomy creation must not call AI'); }) as typeof fetch,
    };

    const unchanged = await ensureYoutubeTaxonomyWithClient(repository, false, client);
    assert.equal(unchanged[0]?.slug, 'legacy');
    assert.equal(repository.youtubeTaxonomyRuns().length, 1);

    const candidateTopics = await ensureYoutubeTaxonomyWithClient(repository, true, client);
    assert.equal(candidateTopics.length, PERSONAL_TOPICS.length);
    assert.equal(repository.youtubeTaxonomyRuns().find((run) =>
      run.definitionVersion === PERSONAL_TAXONOMY_DEFINITION_VERSION)?.status, 'candidate');
  } finally {
    repository.close();
  }
});

test('activation reopens a ready candidate when metadata changed after review', () => {
  const repository = new Repository(':memory:');
  try {
    const videos = seedWatchedVideos(repository);
    repository.replaceYoutubeTaxonomy([{
      version: 1, slug: 'legacy', name: 'Legacy', description: 'Rollback baseline',
    }]);
    const run = repository.createPersonalTaxonomyRun({
      definitionVersion: PERSONAL_TAXONOMY_DEFINITION_VERSION,
      model: 'fixture-model',
      promptVersion: PERSONAL_TAXONOMY_PROMPT_VERSION,
      topics: PERSONAL_TOPICS.map(({ slug, name, description }) => ({ slug, name, description })),
      sample: samplePersonalTaxonomy(repository.youtubePersonalTaxonomyCandidates()),
    });
    for (const video of videos) {
      repository.savePersonalYoutubeVideoTopic(run, video, decidePersonalClassification(video, {
        slug: 'technology', confidence: 0.9, alternativeSlug: null,
        alternativeConfidence: null,
        evidence: [{ text: 'Software lesson', source: 'title', score: 0.9 }],
      }));
    }
    assert.equal(repository.refreshPersonalTaxonomyRunQuality(run.taxonomyVersion).status, 'ready');

    repository.upsertYoutubeVideoMetadata(videos.slice(0, 2).map((video, index) => ({
      ...video,
      description: `Changed public metadata ${index}`,
      metadataHash: `changed-${index}`,
    })));
    assert.throws(
      () => repository.activatePersonalTaxonomy(run.taxonomyVersion),
      /has not passed activation gates/,
    );
    assert.equal(repository.youtubeTaxonomyRun(run.taxonomyVersion)?.status, 'candidate');
    assert.equal(repository.youtubeVideosForPersonalClassification(
      repository.youtubeTaxonomyRun(run.taxonomyVersion)!, 100,
    ).length, 2);
    assert.equal(repository.youtubeTaxonomyRuns().find((item) => item.status === 'active')?.taxonomyVersion, 1);
  } finally {
    repository.close();
  }
});

test('low-confidence and Unknown assignments stay out of personal crystal topics', () => {
  const repository = new Repository(':memory:');
  try {
    const videos = seedWatchedVideos(repository);
    repository.replaceYoutubeTaxonomy([{
      version: 1, slug: 'legacy', name: 'Legacy', description: 'Rollback baseline',
    }]);
    const run = repository.createPersonalTaxonomyRun({
      definitionVersion: PERSONAL_TAXONOMY_DEFINITION_VERSION,
      model: 'fixture-model',
      promptVersion: PERSONAL_TAXONOMY_PROMPT_VERSION,
      topics: PERSONAL_TOPICS.map(({ slug, name, description }) => ({ slug, name, description })),
      sample: samplePersonalTaxonomy(repository.youtubePersonalTaxonomyCandidates()),
    });
    for (const [index, video] of videos.entries()) {
      repository.savePersonalYoutubeVideoTopic(run, video, index < 22
        ? decidePersonalClassification(video, {
            slug: 'technology', confidence: 0.9, alternativeSlug: null,
            alternativeConfidence: null,
            evidence: [{ text: 'Software lesson', source: 'title', score: 0.9 }],
          })
        : decidePersonalClassification(video, {
            slug: 'technology', confidence: 0.4, alternativeSlug: null,
            alternativeConfidence: null,
            evidence: [{ text: 'Software lesson', source: 'title', score: 0.8 }],
          }));
    }
    assert.equal(repository.refreshPersonalTaxonomyRunQuality(run.taxonomyVersion).status, 'ready');
    repository.activatePersonalTaxonomy(run.taxonomyVersion);

    const window = repository.youtubeCrystalWindow(null, null);
    assert.deepEqual(window.topics.map(({ slug, watches }) => ({ slug, watches })), [
      { slug: 'technology', watches: 22 },
    ]);
    const stats = repository.youtubeDashboard('all').stats;
    assert.equal(stats.topicProcessedCoverage, 1);
    assert.equal(stats.topicCoverage, 22 / 24);
    assert.equal(stats.topicUnknownCoverage, 2 / 24);
  } finally {
    repository.close();
  }
});

test('migration 11 keeps the newest legacy taxonomy active for rollback', () => {
  const directory = mkdtempSync(join(tmpdir(), 'urtube-taxonomy-migration-'));
  const databasePath = join(directory, 'archive.sqlite');
  try {
    const current = new Repository(databasePath);
    const [topic] = current.replaceYoutubeTaxonomy([{
      version: 7, slug: 'legacy', name: 'Legacy', description: 'Legacy taxonomy',
    }], '2026-07-29T00:00:00.000Z');
    current.close();

    const downgrade = new DatabaseSync(databasePath);
    downgrade.exec(`
      DROP TABLE youtube_taxonomy_activations;
      DROP TABLE youtube_taxonomy_runs;
      ALTER TABLE youtube_video_topics DROP COLUMN evidence_json;
      ALTER TABLE youtube_video_topics DROP COLUMN alternative_confidence;
      ALTER TABLE youtube_video_topics DROP COLUMN alternative_slug;
      ALTER TABLE youtube_video_topics DROP COLUMN decision;
      PRAGMA user_version = 10;
    `);
    downgrade.close();

    const migrated = new Repository(databasePath);
    try {
      const run = migrated.youtubeTaxonomyRun(7);
      assert.equal(run?.definitionVersion, 'personal-generated-v1');
      assert.equal(run?.status, 'active');
      assert.equal(migrated.youtubeTopics()[0]?.id, topic.id);
      assert.deepEqual(migrated.youtubeTaxonomyActivations(), []);
    } finally {
      migrated.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('owner audit stays bounded and requires explicit review before activation', () => {
  const readiness = personalTaxonomyReadiness(24, 24, 24);
  const run = {
    taxonomyVersion: 2,
    definitionVersion: PERSONAL_TAXONOMY_DEFINITION_VERSION,
    status: 'ready' as const,
    model: 'fixture-model',
    promptVersion: PERSONAL_TAXONOMY_PROMPT_VERSION,
    createdAt: '2026-07-29T00:00:00.000Z',
    activatedAt: null,
    reviewedAt: null,
    dataStartAt: '2026-01-01T00:00:00.000Z',
    dataEndAt: '2026-07-29T00:00:00.000Z',
    inputVideos: 24,
    categoryCount: 14,
    sample: samplePersonalTaxonomy(Array.from({ length: 24 }, (_, index) => candidate(index)), 24),
    quality: assessPersonalTaxonomyQuality({
      total: 24, processed: 24, accepted: 24, unknown: 0,
      lowConfidence: 0, ambiguous: 0, acceptedConfidenceTotal: 22,
    }),
  };
  const output = personalTaxonomyAuditPage({
    readiness,
    canPrepare: false,
    runs: [{
      run,
      distribution: {
        taxonomyVersion: 2, totalWatchSeconds: 100, effectiveWatchSeconds: 90,
        unknownWatchSeconds: 10, effectiveCoverage: 0.9, unknownShare: 0.1,
        topics: [{ slug: 'technology', name: 'Technology & Science', watchSeconds: 90, share: 1 }],
      },
      evidence: [{
        topicSlug: 'technology', topicName: 'Technology & Science', videoId: 'PERSVID0000',
        title: 'Software lesson', channelTitle: 'Channel', confidence: 0.9,
        evidence: [{ text: 'Software lesson', source: 'title', score: 0.9 }],
      }],
    }],
    activations: [],
  }, 'en');
  assert.match(output, /OWNER ONLY/);
  assert.match(output, /name="reviewed" value="1" required/);
  assert.match(output, /Broad distribution/);
  assert.match(output, /Sample evidence/);
  assert.match(output, /title 90% · “Software lesson”/);
  assert.doesNotMatch(output, /actualWatchedSeconds|queryCiphertext/);
});

test('owner audit offers an explicit candidate start only when allowed', () => {
  const output = personalTaxonomyAuditPage({
    readiness: personalTaxonomyReadiness(24, 24, 24),
    canPrepare: true,
    runs: [],
    activations: [],
  }, 'en');
  assert.match(output, /action="\/account\/taxonomy\/prepare"/);
  assert.match(output, /name="confirmed" value="1" required/);
  assert.match(output, /bounded background AI classification/);
});


test('a new imported account automatically classifies and activates its first quality-approved topics', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('auto-topics-fixture', 'Automatic topics');
    const repository = registry.repositoryFor(user);
    assert.equal(user.autoActivateInitialTopics, true);
    assert.equal(youtubeInitialTopicsPending(repository, user.autoActivateInitialTopics), false);
    seedWatchedVideos(repository);
    assert.equal(youtubeInitialTopicsPending(repository, user.autoActivateInitialTopics), true, 'complete metadata still schedules initial classification');
    let calls = 0;
    const client: YoutubeAiClient = { baseUrl: 'https://example.test', apiKey: 'fixture', model: 'fixture-model',
      fetchImpl: async (_url, options) => {
        calls++;
        const body = JSON.parse(String(options?.body));
        const request = JSON.parse(body.messages[1].content);
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          videos: request.videos.map((video: { videoId: string }) => ({ videoId: video.videoId,
            slug: 'technology', confidence: 0.95, alternativeSlug: null, alternativeConfidence: null,
            evidence: [{ text: 'Software lesson', source: 'title', score: 0.95 }] })),
        }) } }] }), { status: 200 });
      } };
    const steps: YoutubeWorkerSteps = { portability: async () => 'idle', metadata: async () => 0,
      channelMetadata: async () => 0, matchingClassification: async () => 0,
      classification: (repo, member) => classifyYoutubeVideosWithClient(repo, 1000, client, member.autoActivateInitialTopics) };
    await runYoutubeWorkerCycle(registry, steps);
    assert.equal(repository.youtubeTaxonomyRuns()[0]?.status, 'active');
    assert.equal(repository.youtubeTopicProcessingProgress().processed, 24);
    assert.equal(repository.youtubeDashboard('all').topicTrend.some(frame => frame.topics.length > 0), true);
    assert.equal(repository.youtubeSyncState('worker_stage'), 'idle');
    assert.equal(youtubeInitialTopicsPending(repository, user.autoActivateInitialTopics), false);
    const completedCalls = calls;
    await runYoutubeWorkerCycle(registry, steps);
    assert.equal(calls, completedCalls, 'completed classifications are reused on the next worker cycle');
    assert.equal(repository.youtubeTaxonomyActivations().length, 1);
  } finally { registry.close(); }
});

test('existing accounts keep first-topic auto-activation disabled after migration', () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-auto-topics-upgrade-'));
  const file = join(root, 'users.sqlite');
  try {
    const before = new UserRegistry(file, join(root, 'users'));
    before.createUser('existing-topics', 'Existing'); before.close();
    const db = new DatabaseSync(file); db.exec('ALTER TABLE users DROP COLUMN auto_activate_initial_topics'); db.close();
    const after = new UserRegistry(file, join(root, 'users'));
    try {
      assert.equal(after.userByHandle('existing-topics')?.autoActivateInitialTopics, false);
      assert.equal(after.createUser('new-topics', 'New').autoActivateInitialTopics, true);
    } finally { after.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('first-topic automatic activation preserves quality gates and prior active versions', () => {
  for (const legacy of [false, true]) {
    const repository = new Repository(':memory:');
    try {
      const videos = seedWatchedVideos(repository);
      if (legacy) repository.replaceYoutubeTaxonomy([{ version: 1, slug: 'existing', name: 'Existing', description: '' }]);
      const run = repository.createPersonalTaxonomyRun({
        definitionVersion: PERSONAL_TAXONOMY_DEFINITION_VERSION, model: 'fixture-model',
        promptVersion: PERSONAL_TAXONOMY_PROMPT_VERSION,
        topics: PERSONAL_TOPICS.map(({ slug, name, description }) => ({ slug, name, description })),
        sample: samplePersonalTaxonomy(repository.youtubePersonalTaxonomyCandidates()),
      });
      for (const video of videos) repository.savePersonalYoutubeVideoTopic(run, video,
        decidePersonalClassification(video, { slug: 'technology', confidence: legacy ? 0.95 : 0.1,
          alternativeSlug: null, alternativeConfidence: null,
          evidence: [{ text: 'Software lesson', source: 'title', score: 0.95 }] }));
      const result = repository.refreshPersonalTaxonomyRunQuality(run.taxonomyVersion);
      assert.equal(result.status, legacy ? 'ready' : 'blocked');
      assert.equal(activateInitialTopicsIfReady(repository), false);
      assert.equal(repository.youtubeTaxonomyRuns().find(value => value.status === 'active')?.definitionVersion,
        legacy ? 'personal-generated-v1' : undefined);
    } finally { repository.close(); }
  }
});
