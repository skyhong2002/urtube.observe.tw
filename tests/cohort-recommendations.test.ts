import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { matchesPage } from '../src/output/matches.js';
import { UserRegistry, type MatchableCrystal, type User } from '../src/users.js';
import {
  cohortRecommendations,
  COHORT_RECOMMENDATION_LIMIT,
} from '../src/youtube/cohort-recommendations.js';
import type { MatchingDimensions } from '../src/youtube/dimensions.js';
import { MATCHING_TAXONOMY } from '../src/youtube/matching.js';
import {
  REGISTRY_CRYSTAL_VERSION,
  type RegistryMatchingCrystal,
} from '../src/youtube/registry-crystal.js';
import type { TagListSnapshot } from '../src/youtube/taglists.js';

const topic = (key: string, share: number) => ({
  key,
  name: MATCHING_TAXONOMY.topics.find((item) => item.key === key)?.name ?? key,
  share,
});

const ANCHOR_CHANNEL_ID = `UC${'a'.repeat(22)}`;
const DISCOVERY_CHANNEL_ID = `UC${'b'.repeat(22)}`;
const BLOCKED_CHANNEL_ID = `UC${'c'.repeat(22)}`;
const numberedChannelId = (index: number) => `UC${String(index).padStart(22, '0')}`;

function crystal(
  topics: RegistryMatchingCrystal['topics'],
  channels: RegistryMatchingCrystal['channels'],
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
      topicCoverage: 1,
    },
    topics,
    channels,
  };
}

function dimensions(excludedTopicKeys: string[] = []): MatchingDimensions {
  return {
    status: 'confirmed',
    taxonomyVersion: MATCHING_TAXONOMY.version,
    selectedTopicKeys: ['music'],
    excludedTopicKeys,
    suggestedTopicKeys: [],
  };
}

function profile(
  userId: number,
  value: RegistryMatchingCrystal,
  disclosureLevel: MatchableCrystal['disclosureLevel'] = 'topics_and_channel',
  matchingDimensions = dimensions(),
): MatchableCrystal {
  return {
    userId,
    handle: `private-${userId}`,
    displayName: `Neighbor ${userId}`,
    disclosureLevel,
    crystal: value,
    dimensions: matchingDimensions,
  };
}

const viewerCrystal = () => crystal(
  [topic('music', 1)],
  [{ key: ANCHOR_CHANNEL_ID, name: 'Anchor Channel', share: 1 }],
);

const neighborCrystal = () => crystal(
  [topic('music', 0.6), topic('gaming', 0.4)],
  [
    { key: ANCHOR_CHANNEL_ID, name: 'Anchor Channel', share: 0.6 },
    { key: DISCOVERY_CHANNEL_ID, name: 'Discovery Channel', share: 0.4 },
  ],
);

function emptyTagLists(blocked: string[] = []): TagListSnapshot {
  return {
    lists: {
      news: new Set(blocked),
      editorial: new Set(),
      editorialShows: new Set(),
      blue: new Set(),
      green: new Set(),
      white: new Set(),
      red: new Set(),
    },
    provenance: {
      sourceUrl: 'https://labels.example.test',
      sourceUpdatedAt: '2026-09-05 12:00:00',
      fetchedAt: '2026-09-05T12:00:00.000Z',
      membershipVersion: 'sha256:test',
      policyVersion: 'test',
      policyUrl: 'https://example.test/policy',
      reportUrl: 'https://example.test/report',
    },
  };
}

test('cohort recommendations require three contributors and reveal group labels only', () => {
  const viewer = profile(1, viewerCrystal());
  const neighbors = [2, 3, 4].map((id) => profile(id, neighborCrystal()));
  assert.deepEqual(cohortRecommendations(viewer, neighbors, {
    blockedChannelKeys: new Set(),
    viewerSeenChannelKeys: new Set(),
  }), {
    topics: ['Gaming'],
    channels: ['Discovery Channel'],
  });

  const output = cohortRecommendations(viewer, neighbors.slice(0, 2), {
    blockedChannelKeys: new Set(),
    viewerSeenChannelKeys: new Set(),
  });
  assert.deepEqual(output, { topics: [], channels: [] });
  assert.deepEqual(Object.keys(cohortRecommendations(viewer, neighbors)).sort(), ['channels', 'topics']);
  assert.deepEqual(cohortRecommendations(viewer, neighbors), {
    topics: ['Gaming'],
    channels: [],
  }, 'channels fail closed until the governed tag lists are verified');
});

test('cohort recommendation order weights each contribution by neighbor similarity', () => {
  const viewer = profile(1, viewerCrystal());
  const close = [2, 3, 4].map((id) => profile(id, crystal(
    [topic('music', 0.7), topic('gaming', 0.3)],
    [{ key: ANCHOR_CHANNEL_ID, name: 'Anchor Channel', share: 1 }],
  )));
  const distant = [5, 6, 7].map((id) => profile(id, crystal(
    [topic('music', 0.5), topic('learning', 0.5)],
    [{ key: `distant-${id}`, name: `Distant ${id}`, share: 1 }],
  )));
  assert.deepEqual(cohortRecommendations(viewer, [...close, ...distant]).topics, [
    'Gaming',
    'Learning',
  ]);
});

test('incomplete viewer classification cannot manufacture an unseen topic', () => {
  const incompleteViewer = profile(1, viewerCrystal());
  incompleteViewer.crystal.data.topicCoverage = 0.5;
  const neighbors = [2, 3, 4].map((id) => profile(id, neighborCrystal()));
  assert.deepEqual(cohortRecommendations(incompleteViewer, neighbors).topics, []);
});

test('unknown topics and channels without stable ids fail closed', () => {
  const viewer = profile(1, viewerCrystal());
  const unsafe = crystal(
    [topic('music', 0.6), { key: 'political-belief', name: 'Sensitive inference', share: 0.4 }],
    [
      { key: ANCHOR_CHANNEL_ID, name: 'Anchor Channel', share: 0.6 },
      { key: 'name-only-channel', name: 'Unverifiable Channel', share: 0.4 },
    ],
  );
  assert.deepEqual(cohortRecommendations(
    viewer,
    [2, 3, 4].map((id) => profile(id, unsafe)),
    { blockedChannelKeys: new Set(), viewerSeenChannelKeys: new Set() },
  ), { topics: [], channels: [] });
});

test('cohort recommendations honor exclusions, disclosure, neighbor bounds, and output caps', () => {
  const viewer = profile(1, viewerCrystal());
  const restricted = [
    profile(2, neighborCrystal()),
    profile(3, neighborCrystal()),
    profile(4, neighborCrystal(), 'topics_only'),
  ];
  assert.deepEqual(cohortRecommendations(viewer, restricted, {
    blockedChannelKeys: new Set(),
    viewerSeenChannelKeys: new Set(),
  }), {
    topics: ['Gaming'],
    channels: [],
  });
  assert.deepEqual(cohortRecommendations(
    viewer,
    [restricted[0]!, restricted[1]!, profile(4, neighborCrystal(), 'topics_and_channel', dimensions(['gaming']))],
  ).topics, []);
  assert.deepEqual(cohortRecommendations(
    profile(1, viewerCrystal(), 'topics_and_channel', dimensions(['gaming'])),
    restricted,
  ).topics, []);

  const ordinary = Array.from({ length: 8 }, (_, index) => profile(index + 2, viewerCrystal()));
  const supporters = [10, 11, 12].map((id) => profile(id, neighborCrystal()));
  assert.deepEqual(cohortRecommendations(viewer, [...ordinary, ...supporters]).topics, [],
    'the eleventh neighbor cannot satisfy the three-person privacy threshold');

  const extraTopicKeys = MATCHING_TAXONOMY.topics
    .map((item) => item.key)
    .filter((key) => key !== 'music')
    .slice(0, 6);
  const manyItems = crystal(
    [topic('music', 0.4), ...extraTopicKeys.map((key, index) => topic(key, 0.12 - index * 0.01))],
    [
      { key: ANCHOR_CHANNEL_ID, name: 'Anchor Channel', share: 0.4 },
      ...Array.from({ length: 7 }, (_, index) => ({
        key: numberedChannelId(index),
        name: `New Channel ${index}`,
        share: 0.12 - index * 0.01,
      })),
    ],
  );
  const capped = cohortRecommendations(
    viewer,
    [2, 3, 4].map((id) => profile(id, manyItems)),
    {
      blockedChannelKeys: new Set([numberedChannelId(0)]),
      viewerSeenChannelKeys: new Set([numberedChannelId(1)]),
    },
  );
  assert.equal(capped.topics.length, COHORT_RECOMMENDATION_LIMIT);
  assert.equal(capped.channels.length, COHORT_RECOMMENDATION_LIMIT);
  assert.doesNotMatch(capped.channels.join(' '), /New Channel [01]/);
});

function publish(registry: UserRegistry, user: User, value: RegistryMatchingCrystal): void {
  registry.upsertMatchingCrystal(user, value);
  registry.setMatchingPreferences(user.handle, true, 'topics_and_channel');
}

test('/matches removes governed channels and recomputes an anonymous cohort after opt-out', async () => {
  const registry = new UserRegistry(':memory:');
  let tagListsAvailable = true;
  const app = createApp(registry, {
    loadTagLists: async () => {
      if (!tagListsAvailable) throw new Error('governance source unavailable');
      return emptyTagLists([BLOCKED_CHANNEL_ID]);
    },
  });
  try {
    const viewer = registry.createUser('cohort-viewer', 'Cohort Viewer');
    publish(registry, viewer, viewerCrystal());
    registry.repositoryFor(viewer).ingestYoutubeArchive({
      archiveHash: 'cohort-viewer-seen-channel',
      source: 'takeout',
      watches: [{
        eventId: 'cohort-viewer-seen-channel',
        videoId: 'COHORT00001',
        title: 'Already watched',
        url: 'https://www.youtube.com/watch?v=COHORT00001',
        channelId: 'UC0000000000000000000001',
        channelTitle: 'Seen Outside Projection',
        channelUrl: 'https://www.youtube.com/channel/UC0000000000000000000001',
        watchedAt: new Date().toISOString(),
        actualWatchedSeconds: null,
        activityType: 'video',
      }],
      searches: [],
    });
    const neighbors = [1, 2, 3].map((index) => {
      const user = registry.createUser(`cohort-neighbor-${index}`, `Neighbor ${index}`);
      const value = neighborCrystal();
      value.channels = [
        { key: ANCHOR_CHANNEL_ID, name: 'Anchor Channel', share: 0.4 },
        { key: DISCOVERY_CHANNEL_ID, name: 'Discovery Channel', share: 0.25 },
        { key: BLOCKED_CHANNEL_ID, name: 'Blocked Politics Channel', share: 0.2 },
        { key: 'UC0000000000000000000001', name: 'Seen Outside Projection', share: 0.15 },
      ];
      publish(registry, user, value);
      return user;
    });
    const cookie = `urtube_session=${registry.createSession(viewer)}`;
    const first = await (await app.request('/matches', { headers: { cookie } })).text();
    const section = first.match(/<section class="mt-cohort">[\s\S]*?<\/section>/)?.[0] ?? '';
    assert.match(section, /Popular around your circle/);
    assert.match(section, /Gaming/);
    assert.match(section, /Discovery Channel/);
    assert.doesNotMatch(section, /Blocked Politics Channel/);
    assert.doesNotMatch(section, /Seen Outside Projection/);
    assert.doesNotMatch(section, /Neighbor|private-|contributors|similarity|share/);

    tagListsAvailable = false;
    const degradedResponse = await app.request('/matches', { headers: { cookie } });
    const degraded = await degradedResponse.text();
    assert.equal(degradedResponse.status, 200);
    assert.match(degraded, />Gaming</);
    assert.doesNotMatch(degraded, /Discovery Channel|Blocked Politics Channel/);

    registry.setMatchingPreferences(neighbors[0]!.handle, false, 'topics_only');
    const afterOptOut = await (await app.request('/matches', { headers: { cookie } })).text();
    assert.doesNotMatch(afterOptOut, /Popular around your circle|Discovery Channel|>Gaming</);

    assert.match(matchesPage(
      'Viewer',
      '/viewer',
      { kind: 'empty' },
      'zh',
      undefined,
      false,
      { topics: ['Gaming'], channels: [] },
    ), /同溫層最近常看/);
  } finally {
    registry.close();
  }
});
