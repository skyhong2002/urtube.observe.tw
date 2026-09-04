import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { UserRegistry, type User } from '../src/users.js';
import {
  matchingCandidateSimilarity,
  resolveMatchingDimensions,
  type MatchingDimensions,
} from '../src/youtube/dimensions.js';
import { MATCHING_TAXONOMY } from '../src/youtube/matching.js';
import {
  REGISTRY_CRYSTAL_VERSION,
  type RegistryMatchingCrystal,
} from '../src/youtube/registry-crystal.js';

const topic = (key: string, share: number) => ({
  key,
  name: MATCHING_TAXONOMY.topics.find((item) => item.key === key)?.name ?? key,
  share,
});

function readyCrystal(
  topics: RegistryMatchingCrystal['topics'] = [topic('music', 0.45), topic('gaming', 0.3), topic('learning', 0.15)],
  channels: RegistryMatchingCrystal['channels'] = [{ key: 'channel-a', name: 'Anonymous A', share: 1 }],
): RegistryMatchingCrystal {
  return {
    kind: 'matching',
    version: REGISTRY_CRYSTAL_VERSION,
    taxonomyVersion: MATCHING_TAXONOMY.version,
    generatedAt: '2026-09-05T12:00:00.000Z',
    windowDays: 90,
    data: {
      watchEvents: 240,
      uniqueVideos: 90,
      estimatedWatchSeconds: 140_000,
      activeDays: 20,
      topicCoverage: 0.95,
    },
    topics,
    channels,
  };
}

function publish(registry: UserRegistry, user: User, crystal = readyCrystal()): void {
  registry.upsertMatchingCrystal(user, crystal);
}

test('interest choices stay hidden before eligibility and suggest the top five safe canonical topics', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const user = registry.createUser('dimension-user', 'Dimension User');
    const cookie = `urtube_session=${registry.createSession(user)}`;
    const pending = await (await app.request('/account', { headers: { cookie } })).text();
    assert.match(pending, /will appear here after your recent 90-day history/);
    assert.doesNotMatch(pending, /name="selectedTopicKeys"/);

    publish(registry, user, readyCrystal([
      topic('gaming', 0.1), topic('music', 0.4), topic('learning', 0.2),
      topic('comedy', 0.15), topic('science-technology', 0.12), topic('travel-events', 0.03),
    ]));
    const dimensions = registry.matchingDimensionsFor(user);
    assert.equal(dimensions.status, 'suggested');
    assert.deepEqual(dimensions.suggestedTopicKeys, [
      'music', 'learning', 'comedy', 'science-technology', 'gaming',
    ]);
    const ready = await (await app.request('/account', { headers: { cookie } })).text();
    assert.equal((ready.match(/name="selectedTopicKeys"/g) ?? []).length, MATCHING_TAXONOMY.topics.length);
    assert.match(ready, /value="music" checked/);
    assert.doesNotMatch(ready, /politic|taglean/i);
  } finally {
    registry.close();
  }
});

test('dimension settings are session-only, versioned, durable, and reject unsafe input atomically', async () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-matching-dimensions-'));
  const registryPath = join(root, 'users.sqlite');
  const registry = new UserRegistry(registryPath, join(root, 'data'));
  const app = createApp(registry);
  try {
    const user = registry.createUser('dimension-save', 'Dimension Save');
    publish(registry, user);
    const cookie = `urtube_session=${registry.createSession(user)}`;
    assert.equal((await app.request('/account/matching-dimensions', { method: 'POST' })).status, 302);

    const saved = await app.request('/account/matching-dimensions', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: `taxonomyVersion=${MATCHING_TAXONOMY.version}&selectedTopicKeys=music&selectedTopicKeys=gaming&excludedTopicKeys=learning`,
    });
    assert.equal(saved.status, 302);
    assert.deepEqual(registry.matchingDimensionsFor(user), {
      status: 'confirmed',
      taxonomyVersion: MATCHING_TAXONOMY.version,
      selectedTopicKeys: ['music', 'gaming'],
      excludedTopicKeys: ['learning'],
      suggestedTopicKeys: ['music', 'gaming', 'learning'],
    });
    assert.equal(registry.userByHandle(user.handle)?.matchingDisclosure, 'topics_only');

    const invalidBodies = [
      `taxonomyVersion=${MATCHING_TAXONOMY.version}&selectedTopicKeys=unknown`,
      `taxonomyVersion=${MATCHING_TAXONOMY.version}&selectedTopicKeys=music&selectedTopicKeys=music`,
      `taxonomyVersion=${MATCHING_TAXONOMY.version}&selectedTopicKeys=music&excludedTopicKeys=music`,
      'taxonomyVersion=999&selectedTopicKeys=music',
    ];
    for (const body of invalidBodies) {
      const response = await app.request('/account/matching-dimensions', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      assert.equal(response.status, 400);
      assert.match(await response.text(), /Matching dimensions|taxonomy|both used and excluded/i);
      assert.deepEqual(registry.matchingDimensionsFor(user).selectedTopicKeys, ['music', 'gaming']);
    }

    registry.close();
    const db = new DatabaseSync(registryPath);
    const stored = db.prepare(`
      SELECT dimension_taxonomy_version version, selected_topic_keys selected,
        excluded_topic_keys excluded, dimensions_confirmed confirmed
      FROM matching_profiles
    `).get() as Record<string, unknown>;
    assert.deepEqual({ ...stored }, {
      version: MATCHING_TAXONOMY.version,
      selected: '["music","gaming"]',
      excluded: '["learning"]',
      confirmed: 1,
    });
    db.close();
  } finally {
    try { registry.close(); } catch { /* closed above after persistence check */ }
    rmSync(root, { recursive: true, force: true });
  }
});

test('a crafted request cannot create choices before recent data is ready', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const user = registry.createUser('not-ready', 'Not Ready');
    const cookie = `urtube_session=${registry.createSession(user)}`;
    const response = await app.request('/account/matching-dimensions', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: `taxonomyVersion=${MATCHING_TAXONOMY.version}&selectedTopicKeys=music`,
    });
    assert.equal(response.status, 400);
    assert.match(await response.text(), /not ready/);
    assert.equal(registry.matchingDimensionsFor(user).status, 'pending');
  } finally {
    registry.close();
  }
});

test('taxonomy changes never silently reinterpret confirmed choices', () => {
  const crystal = readyCrystal();
  const dimensions = resolveMatchingDimensions(crystal, {
    taxonomyVersion: MATCHING_TAXONOMY.version + 1,
    selectedTopicKeysJson: '["music"]',
    excludedTopicKeysJson: '["learning"]',
    confirmed: true,
  });
  assert.equal(dimensions.status, 'stale');
  assert.deepEqual(dimensions.selectedTopicKeys, []);
  assert.deepEqual(dimensions.excludedTopicKeys, []);
  assert.deepEqual(dimensions.suggestedTopicKeys, ['music', 'gaming', 'learning']);
});

test('matching uses only A selections not excluded by B and falls back without leaking exclusions', () => {
  const confirmed = (selectedTopicKeys: string[], excludedTopicKeys: string[]): MatchingDimensions => ({
    status: 'confirmed',
    taxonomyVersion: MATCHING_TAXONOMY.version,
    selectedTopicKeys,
    excludedTopicKeys,
    suggestedTopicKeys: [],
  });
  const requesterCrystal = readyCrystal(
    [topic('music', 0.6), topic('gaming', 0.4), topic('learning', 0)],
    [{ key: 'shared', name: 'Shared aggregate channel', share: 1 }],
  );
  const candidateCrystal = readyCrystal(
    [topic('music', 0.2), topic('gaming', 0.2), topic('learning', 0.6)],
    [{ key: 'shared', name: 'Shared aggregate channel', share: 1 }],
  );
  const requester = { crystal: requesterCrystal, dimensions: confirmed(['music', 'gaming'], ['learning']) };
  const oneAllowed = matchingCandidateSimilarity(requester, {
    crystal: candidateCrystal,
    dimensions: confirmed(['learning'], ['music']),
  });
  assert.equal(oneAllowed.mode, 'combined');
  assert.deepEqual(oneAllowed.allowedTopicKeys, ['gaming']);

  const noTopics = matchingCandidateSimilarity(requester, {
    crystal: candidateCrystal,
    dimensions: confirmed([], ['music', 'gaming']),
  });
  assert.equal(noTopics.mode, 'channels');
  assert.equal(noTopics.score, 1);
  assert.deepEqual(noTopics.allowedTopicKeys, []);

  const noComparableData = matchingCandidateSimilarity(
    { crystal: { ...requesterCrystal, channels: [] }, dimensions: confirmed([], ['learning']) },
    { crystal: { ...candidateCrystal, channels: [] }, dimensions: confirmed([], ['music', 'gaming']) },
  );
  assert.equal(noComparableData.mode, 'none');
  assert.equal(noComparableData.score, 0);
  assert.deepEqual(noComparableData.allowedTopicKeys, []);

  const belowActivityFloor = matchingCandidateSimilarity(
    {
      crystal: { ...requesterCrystal, data: { ...requesterCrystal.data, watchEvents: 199 } },
      dimensions: confirmed(['music'], []),
    },
    { crystal: candidateCrystal, dimensions: confirmed(['music'], []) },
  );
  assert.equal(belowActivityFloor.mode, 'none');
  assert.equal(belowActivityFloor.score, 0);
});

test('registry migration adds dimension columns without changing an existing opt-in', () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-dimension-upgrade-'));
  const registryPath = join(root, 'users.sqlite');
  try {
    const current = new UserRegistry(registryPath, join(root, 'data'));
    current.createUser('legacy-dimensions', 'Legacy Dimensions');
    current.setMatchingOptIn('legacy-dimensions', true);
    current.close();
    const old = new DatabaseSync(registryPath);
    old.exec(`
      ALTER TABLE matching_profiles DROP COLUMN dimension_taxonomy_version;
      ALTER TABLE matching_profiles DROP COLUMN selected_topic_keys;
      ALTER TABLE matching_profiles DROP COLUMN excluded_topic_keys;
      ALTER TABLE matching_profiles DROP COLUMN dimensions_confirmed;
    `);
    old.close();

    const upgraded = new UserRegistry(registryPath, join(root, 'data'));
    const user = upgraded.userByHandle('legacy-dimensions')!;
    assert.equal(user.matchingOptIn, true);
    assert.equal(upgraded.matchingDimensionsFor(user).status, 'pending');
    upgraded.close();
    const db = new DatabaseSync(registryPath);
    const columns = db.prepare("SELECT name FROM pragma_table_info('matching_profiles')")
      .all() as Array<{ name: string }>;
    assert.deepEqual(
      ['dimension_taxonomy_version', 'selected_topic_keys', 'excluded_topic_keys', 'dimensions_confirmed']
        .every((name) => columns.some((column) => column.name === name)),
      true,
    );
    db.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
