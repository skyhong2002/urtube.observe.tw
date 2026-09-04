import type { MatchableCrystal } from '../users.js';
import { matchingCandidateSimilarity } from './dimensions.js';
import { MATCHING_TAXONOMY, MATCHING_TOPIC_MIN_COVERAGE } from './matching.js';
import type { TagLists } from './taglists.js';
import type { YoutubeChannelSummary } from './types.js';

export const COHORT_NEIGHBOR_LIMIT = 10;
export const COHORT_MIN_CONTRIBUTORS = 3;
export const COHORT_RECOMMENDATION_LIMIT = 5;

export interface CohortRecommendations {
  topics: string[];
  channels: string[];
}

export interface CohortChannelPolicy {
  blockedChannelKeys: ReadonlySet<string>;
  viewerSeenChannelKeys: ReadonlySet<string>;
}

export function cohortChannelPolicy(
  tagLists: TagLists,
  viewerChannels: YoutubeChannelSummary[],
): CohortChannelPolicy {
  return {
    blockedChannelKeys: new Set(
      Object.values(tagLists).flatMap((channels) => [...channels]),
    ),
    viewerSeenChannelKeys: new Set(viewerChannels.flatMap((channel) =>
      channel.channelId || channel.name ? [channel.channelId ?? channel.name] : [])),
  };
}

interface Neighbor {
  profile: MatchableCrystal;
  similarity: number;
}

interface AggregateItem {
  key: string;
  name: string;
  score: number;
  contributors: number;
}

const TOPIC_NAMES = new Map(MATCHING_TAXONOMY.topics.map((topic) => [topic.key, topic.name]));
const STABLE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

function rankedNeighbors(viewer: MatchableCrystal, pool: MatchableCrystal[]): Neighbor[] {
  return pool.flatMap((profile) => {
    if (profile.userId === viewer.userId) return [];
    const similarity = matchingCandidateSimilarity(viewer, profile);
    return similarity.mode === 'none' || similarity.score <= 0
      ? []
      : [{ profile, similarity: similarity.score }];
  }).sort((left, right) =>
    right.similarity - left.similarity || left.profile.userId - right.profile.userId)
    .slice(0, COHORT_NEIGHBOR_LIMIT);
}

function uniquePositiveItems(items: Array<{ key: string; name: string; share: number }>) {
  const unique = new Map<string, { key: string; name: string; share: number }>();
  for (const item of items) {
    if (item.share <= 0) continue;
    const previous = unique.get(item.key);
    if (!previous || item.share > previous.share) unique.set(item.key, item);
  }
  return [...unique.values()];
}

function aggregate(
  neighbors: Neighbor[],
  itemsFor: (profile: MatchableCrystal) => Array<{ key: string; name: string; share: number }>,
  hiddenKeys: ReadonlySet<string>,
  canonicalNames?: ReadonlyMap<string, string>,
): string[] {
  const items = new Map<string, AggregateItem>();
  for (const neighbor of neighbors) {
    for (const item of uniquePositiveItems(itemsFor(neighbor.profile))) {
      if (hiddenKeys.has(item.key)) continue;
      // A taxonomy version alone does not make an arbitrary stored key
      // canonical. Never fall back to a free-form topic name.
      const name = canonicalNames ? canonicalNames.get(item.key) : item.name;
      if (!name) continue;
      const previous = items.get(item.key) ?? {
        key: item.key,
        name,
        score: 0,
        contributors: 0,
      };
      previous.score += neighbor.similarity * item.share;
      previous.contributors += 1;
      items.set(item.key, previous);
    }
  }
  return [...items.values()]
    .filter((item) => item.contributors >= COHORT_MIN_CONTRIBUTORS)
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key))
    .slice(0, COHORT_RECOMMENDATION_LIMIT)
    .map((item) => item.name);
}

export function cohortRecommendations(
  viewer: MatchableCrystal,
  pool: MatchableCrystal[],
  channelPolicy?: CohortChannelPolicy,
): CohortRecommendations {
  const neighbors = rankedNeighbors(viewer, pool);
  if (neighbors.length < COHORT_MIN_CONTRIBUTORS) return { topics: [], channels: [] };

  const seenTopics = new Set([
    ...viewer.crystal.topics.filter((topic) => topic.share > 0).map((topic) => topic.key),
    ...viewer.dimensions.excludedTopicKeys,
  ]);
  const seenChannels = new Set(
    viewer.crystal.channels.filter((channel) => channel.share > 0).map((channel) => channel.key),
  );
  const topics = viewer.crystal.data.topicCoverage >= MATCHING_TOPIC_MIN_COVERAGE
    && viewer.dimensions.status !== 'stale' ? aggregate(
      neighbors,
      (profile) => profile.crystal.taxonomyVersion === MATCHING_TAXONOMY.version
        && profile.crystal.data.topicCoverage >= MATCHING_TOPIC_MIN_COVERAGE
        && profile.dimensions.status !== 'stale'
        ? profile.crystal.topics.filter((topic) =>
          !profile.dimensions.excludedTopicKeys.includes(topic.key))
        : [],
      seenTopics,
      TOPIC_NAMES,
    ) : [];
  const blockedChannels = new Set([
    ...seenChannels,
    ...(channelPolicy?.viewerSeenChannelKeys ?? []),
    ...(channelPolicy?.blockedChannelKeys ?? []),
  ]);
  const channels = channelPolicy ? aggregate(
    neighbors,
    (profile) => profile.disclosureLevel === 'topics_and_channel'
      // Governance lists use stable YouTube channel ids. A name-only key
      // cannot be checked against them, so it must fail closed.
      ? profile.crystal.channels.filter((channel) => STABLE_CHANNEL_ID.test(channel.key))
      : [],
    blockedChannels,
  ) : [];
  return { topics, channels };
}
