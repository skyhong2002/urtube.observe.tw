import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { UserRegistry, type MatchableCrystal, type User } from '../src/users.js';
import {
  MATCHING_PERCENTAGE_VERSION,
  calibratedMatchScore,
  calibratedTopicSimilarity,
  matchingPercentage,
  matchingCandidateBatch,
  rankedMatchingCandidateCards,
} from '../src/youtube/candidates.js';
import { matchingCandidateSimilarity, type MatchingDimensions } from '../src/youtube/dimensions.js';
import { MATCHING_TAXONOMY } from '../src/youtube/matching.js';
import {
  REGISTRY_CRYSTAL_VERSION,
  type RegistryMatchingCrystal,
} from '../src/youtube/registry-crystal.js';
import type { TagListSnapshot } from '../src/youtube/taglists.js';

const noTaggedChannels = async (): Promise<TagListSnapshot> => ({
  lists: {
    news: new Set(),
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
});

const topic = (key: string, share: number) => ({
  key,
  name: MATCHING_TAXONOMY.topics.find((item) => item.key === key)?.name ?? key,
  share,
});

function crystal(
  topics: RegistryMatchingCrystal['topics'] = [topic('music', 0.6), topic('gaming', 0.4)],
  channels: RegistryMatchingCrystal['channels'] = [{ key: 'shared', name: 'Shared Channel', share: 1 }],
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

function confirmed(selectedTopicKeys: string[], excludedTopicKeys: string[] = []): MatchingDimensions {
  return {
    status: 'confirmed',
    taxonomyVersion: MATCHING_TAXONOMY.version,
    selectedTopicKeys,
    excludedTopicKeys,
    suggestedTopicKeys: [],
  };
}

function profile(
  userId: number,
  displayName: string,
  value: RegistryMatchingCrystal,
  dimensions = confirmed(['music', 'gaming']),
  disclosureLevel: MatchableCrystal['disclosureLevel'] = 'topics_and_channel',
): MatchableCrystal {
  return {
    userId,
    handle: `private-handle-${userId}`,
    displayName,
    disclosureLevel,
    crystal: value,
    dimensions,
  };
}

function publish(registry: UserRegistry, user: User, value = crystal()): void {
  registry.upsertMatchingCrystal(user, value);
  registry.setMatchingPreferences(user.handle, true, 'topics_and_channel');
}

test('candidate score gives topics and channels equal internal weight', () => {
  const viewer = profile(1, 'Viewer', crystal(
    [topic('music', 0.8), topic('gaming', 0.2)],
    [{ key: 'shared', name: 'Shared', share: 1 }],
  ));
  const candidate = profile(2, 'Candidate', crystal(
    [topic('music', 0.2), topic('gaming', 0.8)],
    [{ key: 'shared', name: 'Shared', share: 1 }],
  ));
  const result = matchingCandidateSimilarity(viewer, candidate);
  assert.equal(result.mode, 'combined');
  assert.ok(result.topicSimilarity !== null && result.channelSimilarity !== null);
  assert.equal(result.channelSimilarity, 1);
  assert.ok(Math.abs(result.score - (result.topicSimilarity + result.channelSimilarity) / 2) < 1e-12);
  const card = rankedMatchingCandidateCards(viewer, [candidate])[0]!;
  assert.equal(card.matchPercent, matchingPercentage(calibratedMatchScore(result.topicSimilarity, result.channelSimilarity)));
  assert.equal(card.topicPercent, matchingPercentage(calibratedTopicSimilarity(result.topicSimilarity)));
  assert.equal(calibratedTopicSimilarity(0.4), 0);
  assert.ok(Math.abs(calibratedTopicSimilarity(0.95) - 1) < 1e-9);
  assert.ok(calibratedMatchScore(null, 0.1) > 0.9, 'a 0.1 channel cosine is already a strong overlap');
  assert.equal(card.channelPercent, 100);
  assert.equal(card.percentageVersion, MATCHING_PERCENTAGE_VERSION);
  assert.equal(matchingPercentage(-1), 0);
  assert.equal(matchingPercentage(Number.NaN), 0);
  assert.equal(matchingPercentage(0.504), 50);
  assert.equal(matchingPercentage(0.505), 51);
  assert.equal(matchingPercentage(2), 100);
});

test('display percentages use the same fallback as ranking when topic coverage is low', () => {
  const viewer = profile(1, 'Viewer', crystal(
    [topic('music', 1)], [{ key: 'shared', name: 'Shared', share: 1 }],
  ));
  const lowCoverage = crystal(
    [topic('gaming', 1)], [{ key: 'shared', name: 'Shared', share: 1 }],
  );
  lowCoverage.data.topicCoverage = 0.79;
  const card = rankedMatchingCandidateCards(viewer, [profile(2, 'Fallback', lowCoverage)])[0]!;
  assert.equal(card.method, 'channels');
  assert.equal(card.matchPercent, 100);
  assert.equal(card.topicPercent, null);
  assert.equal(card.channelPercent, 100);
});

test('an eligible zero-percent person remains in the comparison directory', () => {
  const viewer = profile(1, 'Viewer', crystal(
    [topic('music', 1)], [{ key: 'left', name: 'Left Channel', share: 1 }],
  ));
  const candidate = profile(2, 'Different', crystal(
    [topic('gaming', 1)], [{ key: 'right', name: 'Right Channel', share: 1 }],
  ));
  const card = rankedMatchingCandidateCards(viewer, [candidate])[0];
  assert.ok(card);
  assert.equal(card.matchPercent, 0);
  assert.deepEqual(card.sharedInterests, []);
});

test('candidate cards remove excluded dimensions and enforce mutual disclosure', () => {
  const viewer = profile(1, 'Viewer', crystal(
    [topic('music', 0.6), topic('gaming', 0.3), topic('learning', 0.1)],
    [{ key: 'shared', name: 'Allowed Shared Channel', share: 1 }],
  ), confirmed(['music', 'gaming'], ['learning']));
  const restricted = profile(2, 'Restricted', crystal(
    [topic('music', 0.2), topic('gaming', 0.7), topic('learning', 0.1)],
    [{ key: 'shared', name: 'Allowed Shared Channel', share: 1 }],
  ), confirmed([], ['gaming']), 'topics_only');
  const mutual = profile(3, 'Mutual', crystal(), confirmed([]), 'topics_and_channel');

  const cards = rankedMatchingCandidateCards(viewer, [restricted, mutual]);
  const restrictedCard = cards.find((card) => card.displayName === 'Restricted')!;
  assert.deepEqual(restrictedCard.disclosure, { topics: ['Music'] });
  assert.deepEqual(Object.keys(restrictedCard).sort(), [
    'candidateUserId', 'channelPercent', 'disclosure', 'displayName', 'handle', 'interests',
    'matchPercent', 'method', 'percentageVersion', 'sharedInterests', 'topicPercent',
    'viewerInterests',
  ]);
  assert.equal(restrictedCard.topicPercent, 100);
  assert.deepEqual(restrictedCard.sharedInterests, ['Music']);
  const mutualCard = cards.find((card) => card.displayName === 'Mutual')!;
  assert.equal(mutualCard.disclosure.channel, 'Allowed Shared Channel');
  assert.equal(JSON.stringify(cards).includes('learning'), false);
  assert.equal(JSON.stringify(cards).includes('"score"'), false);
});

test('/matches requires a session and explicit matching opt-in', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry, { loadTagLists: noTaggedChannels });
  try {
    const user = registry.createUser('viewer-gate', 'Viewer Gate');
    const cookie = `urtube_session=${registry.createSession(user)}`;
    const anonymous = await app.request('/matches');
    assert.equal(anonymous.status, 302);
    assert.equal(anonymous.headers.get('location'), '/auth/google?next=%2Fmatches');
    registry.setMatchingPreferences(user.handle, false, 'topics_only');
    const optedOut = await app.request('/matches', { headers: { cookie } });
    assert.equal(optedOut.status, 403);
    assert.match(await optedOut.text(), /Matching is off/);

    registry.setMatchingPreferences(user.handle, true, 'topics_only');
    const pending = await app.request('/matches', { headers: { cookie } });
    assert.equal(pending.status, 200);
    assert.match(await pending.text(), /recent signal is not ready/);
  } finally {
    registry.close();
  }
});

test('/matches renders twenty bounded people, a finite next page, and no private profile payload', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry, { loadTagLists: noTaggedChannels });
  try {
    const viewer = registry.createUser('viewer-list', 'Viewer List');
    publish(registry, viewer, crystal(
      [topic('music', 0.6), topic('gaming', 0.4)],
      [{ key: 'shared', name: 'Shared Channel', share: 1 }],
    ));
    const candidates: User[] = [];
    for (let index = 1; index <= 21; index += 1) {
      const candidate = registry.createUser(`hidden-candidate-${index}`, `Candidate ${index}`);
      publish(registry, candidate, crystal(
        [topic('music', 0.6), topic('gaming', 0.4)],
        [
          { key: 'shared', name: 'Shared Channel', share: 0.8 },
          { key: `private-${index}`, name: `Private Channel ${index}`, share: 0.2 },
        ],
      ));
      candidates.push(candidate);
    }
    const cookie = `urtube_session=${registry.createSession(viewer)}`;
    const firstResponse = await app.request('/matches', { headers: { cookie } });
    assert.equal(firstResponse.status, 200);
    assert.equal(firstResponse.headers.get('cache-control'), 'no-store');
    assert.equal(firstResponse.headers.get('x-robots-tag'), 'noindex');
    const first = await firstResponse.text();
    assert.equal((first.match(/<article class="mt-card">/g) ?? []).length, 20);
    assert.match(first, /Candidate 1/);
    assert.match(first, /Candidate 20/);
    assert.doesNotMatch(first, /Candidate 21/);
    assert.match(first, /href="\/matches\?page=2"/);
    assert.doesNotMatch(first, /href="\/matches\/profile\//);
    assert.equal((first.match(/class="mt-person-link" href="\/viewer-list\/compare\/[a-z0-9.-]+"/g) ?? []).length, 20);
    assert.doesNotMatch(first, /action="\/matches\/request"/);
    assert.match(first, />\d{1,3}%<small>match<\/small>/);
    assert.match(first, /Private by default/);
    assert.match(first, /Recent 90 days/);
    assert.match(first, /Mutual consent gates details/);
    assert.match(first, /\.trust-signals\{display:flex;flex-wrap:wrap/);
    assert.match(first, /@media\(max-width:560px\)[\s\S]*?\.trust-signals\{gap:6px\}/);
    // Member handles are part of comparison addresses now; dashboards stay private.
    assert.doesNotMatch(first, /Private Channel|\/compare\?|\/u\/|href="\/hidden-candidate-\d+"/);
    assert.doesNotMatch(first, /watchEvents|estimatedWatchSeconds|topicCoverage|candidateUserId/);

    const second = await (await app.request('/matches?page=2', { headers: { cookie } })).text();
    assert.equal((second.match(/<article class="mt-card">/g) ?? []).length, 1);
    assert.match(second, /Candidate 21/);
    assert.match(second, /href="\/matches\?page=1"/);

    assert.equal(registry.listMatchingCandidatesFor(viewer, 3).length, 3);
    registry.setMatchingPreferences(candidates[0]!.handle, false, 'topics_only');
    const afterOptOut = await (await app.request('/matches', { headers: { cookie } })).text();
    assert.doesNotMatch(afterOptOut, />Candidate 1<\/h2>/);
    assert.match(afterOptOut, />Candidate 21<\/h2>/);
  } finally {
    registry.close();
  }
});

test('/matches keeps quality thresholds and shows a clear no-candidate state', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const viewer = registry.createUser('viewer-empty', 'Viewer Empty');
    publish(registry, viewer);
    const cookie = `urtube_session=${registry.createSession(viewer)}`;
    const empty = await app.request('/matches?page=999999', { headers: { cookie } });
    assert.equal(empty.status, 200);
    const body = await empty.text();
    assert.match(body, /No eligible candidates right now/);
    assert.doesNotMatch(body, /<article class="mt-card">/);

    assert.deepEqual(matchingCandidateBatch([], Number.POSITIVE_INFINITY), {
      cards: [], page: 1, hasPrevious: false, hasNext: false,
    });
  } finally {
    registry.close();
  }
});
