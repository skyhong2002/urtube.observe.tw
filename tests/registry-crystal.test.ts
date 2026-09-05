import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { buildYoutubeCrystal } from '../src/youtube/crystal.js';
import { MATCHING_TAXONOMY, classifyYoutubeVideosForMatching } from '../src/youtube/matching.js';
import {
  parseRegistryMatchingCrystal,
  REGISTRY_CRYSTAL_VERSION,
  registryCrystalEligible,
  registryMatchingCrystal,
  type RegistryMatchingCrystal,
} from '../src/youtube/registry-crystal.js';
import { runYoutubeWorkerCycle, type YoutubeWorkerSteps } from '../src/youtube-worker.js';
import { UserRegistry, type User } from '../src/users.js';

const NOW = new Date('2026-09-05T12:00:00.000Z');

test('opening an existing registry adds crystal tables without losing users', () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-registry-upgrade-'));
  const registryPath = join(root, 'users.sqlite');
  try {
    const before = new UserRegistry(registryPath, join(root, 'users'));
    before.createUser('preserved', 'Preserved User');
    before.close();
    const oldRegistry = new DatabaseSync(registryPath);
    oldRegistry.exec(`
      DROP TABLE crystal_refresh_queue;
      DROP TABLE crystals;
      DROP TABLE matching_profiles;
    `);
    oldRegistry.close();

    const upgraded = new UserRegistry(registryPath, join(root, 'users'));
    assert.equal(upgraded.userByHandle('preserved')?.displayName, 'Preserved User');
    assert.equal(upgraded.crystalRefreshPending(), false);
    assert.deepEqual(upgraded.listMatchableCrystals(), []);
    upgraded.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function seedReadyCrystal(registry: UserRegistry, user: User): void {
  const repository = registry.repositoryFor(user);
  const videoId = `REGISTRY${String(user.id).padStart(3, '0')}`;
  repository.ingestYoutubeArchive({
    archiveHash: `registry-crystal-${user.id}`,
    source: 'takeout',
    searches: [],
    watches: Array.from({ length: 200 }, (_, index) => ({
      eventId: `event-${user.id}-${index}`,
      videoId,
      title: 'Anonymous learning fixture',
      url: `https://www.youtube.com/watch?v=${videoId}`,
      channelId: 'anonymous-learning-channel',
      channelTitle: 'Anonymous Learning Channel',
      channelUrl: 'https://www.youtube.com/channel/anonymous-learning-channel',
      watchedAt: new Date(Date.UTC(
        2026, 7, 20 + (index % 14), 12, Math.floor(index / 14),
      )).toISOString(),
      actualWatchedSeconds: 900,
      activityType: 'video',
    })),
  });
  assert.deepEqual(repository.youtubeVideosNeedingMetadata(1), [videoId]);
  repository.upsertYoutubeVideoMetadata([{
    videoId,
    title: 'Anonymous learning fixture',
    channelId: 'anonymous-learning-channel',
    channelTitle: 'Anonymous Learning Channel',
    description: '', tags: [], thumbnailUrl: '', durationSeconds: 900,
    publishedAt: null, categoryId: '27', availability: 'available', metadataHash: 'learning-v1',
  }]);
  classifyYoutubeVideosForMatching(repository);
}

test('registry stores only an opt-in matching projection and joins current identity', () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('archive', 'Anonymous Archive');
    // Matching starts on; this test covers the opted-out projection first.
    registry.setMatchingOptIn(user.handle, false);
    seedReadyCrystal(registry, user);
    registry.markCrystalDirty(user, '2026-09-05T10:00:00.000Z');
    registry.upsertMatchingCrystal(
      user,
      registryMatchingCrystal(buildYoutubeCrystal(registry.repositoryFor(user), user, NOW)),
    );
    assert.equal(registry.crystalRefreshPending(), false);
    assert.equal(registry.listMatchableCrystals().length, 0);

    const empty = registry.createUser('empty', 'Empty Archive');
    registry.setMatchingOptIn(empty.handle, true);
    registry.upsertMatchingCrystal(
      empty,
      registryMatchingCrystal(buildYoutubeCrystal(registry.repositoryFor(empty), empty, NOW)),
    );
    assert.equal(registry.listMatchableCrystals().length, 0);
    assert.throws(() => registry.upsertMatchingCrystal(user, {
      ...registryMatchingCrystal(buildYoutubeCrystal(registry.repositoryFor(user), user, NOW)),
      taxonomyVersion: 999,
    }), /unsupported taxonomy version/);
    const unsafe = {
      ...registryMatchingCrystal(buildYoutubeCrystal(registry.repositoryFor(user), user, NOW)),
      searches: ['private fixture query'],
    };
    assert.equal(parseRegistryMatchingCrystal(JSON.stringify(unsafe)), null);
    assert.throws(
      () => registry.upsertMatchingCrystal(user, unsafe),
      /Matching crystal is invalid/,
    );

    registry.setMatchingOptIn(user.handle, true);
    const [matchable] = registry.listMatchableCrystals();
    assert.equal(matchable.userId, user.id);
    assert.equal(matchable.handle, 'archive');
    assert.equal(matchable.displayName, 'Anonymous Archive');
    assert.equal(matchable.crystal.kind, 'matching');
    assert.equal(matchable.crystal.data.watchEvents, 200);
    assert.deepEqual(matchable.crystal.topics.map((topic) => topic.key), ['learning']);
    const serialized = JSON.stringify(matchable.crystal);
    assert.doesNotMatch(
      serialized,
      /eventId|videoId|watchedAt|searchedAt|query|keywords|recent|allTime|progress/i,
    );

    registry.setDisplayName(user.handle, 'Renamed Display');
    const renamed = registry.renameUser(user.handle, 'renamed');
    assert.equal(registry.listMatchableCrystals()[0].handle, 'renamed');
    assert.equal(registry.listMatchableCrystals()[0].displayName, 'Renamed Display');
    assert.ok(registry.matchingCrystalFor('renamed'));

    registry.deleteUser(renamed.handle);
    assert.deepEqual(registry.listMatchableCrystals(), []);
    assert.equal(registry.matchingCrystalFor(renamed.handle), null);
  } finally {
    registry.close();
  }
});

test('registry eligibility enforces the centralized activity boundaries', () => {
  const ready: RegistryMatchingCrystal = {
    kind: 'matching',
    version: REGISTRY_CRYSTAL_VERSION,
    taxonomyVersion: MATCHING_TAXONOMY.version,
    generatedAt: NOW.toISOString(),
    windowDays: 90,
    data: {
      watchEvents: 200,
      uniqueVideos: 1,
      estimatedWatchSeconds: 60_000,
      activeDays: 14,
      topicCoverage: 0,
    },
    topics: [],
    channels: [{ key: 'anonymous', name: 'Anonymous channel', share: 1 }],
  };
  assert.equal(registryCrystalEligible(ready), true);
  assert.equal(registryCrystalEligible({
    ...ready, data: { ...ready.data, watchEvents: 199 },
  }), false);
  assert.equal(registryCrystalEligible({
    ...ready, data: { ...ready.data, activeDays: 13 },
  }), false);
  assert.equal(registryCrystalEligible({ ...ready, channels: [] }), false);
});

test('crystal refresh queue preserves an import that races a worker projection', () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('racing', 'Racing Archive');
    seedReadyCrystal(registry, user);
    const oldProjection = registryMatchingCrystal(buildYoutubeCrystal(
      registry.repositoryFor(user), user, new Date('2026-09-05T09:00:00.000Z'),
    ));
    registry.markCrystalDirty(user, '2026-09-05T10:00:00.000Z');
    registry.upsertMatchingCrystal(user, oldProjection);
    assert.equal(registry.crystalRefreshPending(), true);

    const currentProjection = registryMatchingCrystal(buildYoutubeCrystal(
      registry.repositoryFor(user), user, new Date('2026-09-05T11:00:00.000Z'),
    ));
    registry.upsertMatchingCrystal(user, currentProjection);
    assert.equal(registry.crystalRefreshPending(), false);
  } finally {
    registry.close();
  }
});

test('worker publishes the queued matching crystal after successful processing', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('worker-user', 'Worker User');
    seedReadyCrystal(registry, user);
    registry.markCrystalDirty(user, '2026-09-05T10:00:00.000Z');
    const steps: YoutubeWorkerSteps = {
      portability: async () => 'idle',
      metadata: async () => 0,
      channelMetadata: async () => 0,
      matchingClassification: async () => 0,
      classification: async () => 0,
    };
    await runYoutubeWorkerCycle(
      registry,
      steps,
      () => new Date('2026-09-05T12:00:00.000Z'),
    );
    assert.equal(registry.crystalRefreshPending(), false);
    assert.ok(registry.matchingCrystalFor(user.handle));
    registry.setMatchingOptIn(user.handle, true);
    assert.equal(registry.listMatchableCrystals().length, 1);
  } finally {
    registry.close();
  }
});
