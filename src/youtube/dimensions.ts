import {
  MATCHING_TAXONOMY,
  MATCHING_TOPIC_MIN_COVERAGE,
  matchingDataEligible,
} from './matching.js';
import type { RegistryMatchingCrystal } from './registry-crystal.js';

const CANONICAL_KEYS = new Set(MATCHING_TAXONOMY.topics.map((topic) => topic.key));

export interface StoredMatchingDimensions {
  taxonomyVersion: number | null;
  selectedTopicKeysJson: string;
  excludedTopicKeysJson: string;
  confirmed: boolean;
}

export interface MatchingDimensions {
  status: 'pending' | 'suggested' | 'confirmed' | 'stale';
  taxonomyVersion: number;
  selectedTopicKeys: string[];
  excludedTopicKeys: string[];
  suggestedTopicKeys: string[];
}

function parsedKeys(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length > CANONICAL_KEYS.size) return null;
    if (!parsed.every((key) => typeof key === 'string' && CANONICAL_KEYS.has(key))) return null;
    if (new Set(parsed).size !== parsed.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function suggestedMatchingTopicKeys(crystal: RegistryMatchingCrystal | null): string[] {
  if (!crystal
    || crystal.taxonomyVersion !== MATCHING_TAXONOMY.version
    || !matchingDataEligible(crystal.data)
    || crystal.data.topicCoverage < MATCHING_TOPIC_MIN_COVERAGE) return [];
  return crystal.topics
    .filter((topic) => topic.share > 0 && CANONICAL_KEYS.has(topic.key))
    .sort((left, right) => right.share - left.share)
    .slice(0, 5)
    .map((topic) => topic.key);
}

export function resolveMatchingDimensions(
  crystal: RegistryMatchingCrystal | null,
  stored: StoredMatchingDimensions | null,
): MatchingDimensions {
  const suggestions = suggestedMatchingTopicKeys(crystal);
  if (stored?.confirmed) {
    const selected = parsedKeys(stored.selectedTopicKeysJson);
    const excluded = parsedKeys(stored.excludedTopicKeysJson);
    if (stored.taxonomyVersion === MATCHING_TAXONOMY.version && selected && excluded
      && !selected.some((key) => excluded.includes(key))) {
      return {
        status: 'confirmed',
        taxonomyVersion: MATCHING_TAXONOMY.version,
        selectedTopicKeys: selected,
        excludedTopicKeys: excluded,
        suggestedTopicKeys: suggestions,
      };
    }
    // Never reinterpret an old or malformed key set under the current
    // taxonomy. Suggestions may be displayed, but topic matching stays off
    // until the person explicitly confirms the new version.
    return {
      status: 'stale',
      taxonomyVersion: MATCHING_TAXONOMY.version,
      selectedTopicKeys: [],
      excludedTopicKeys: [],
      suggestedTopicKeys: suggestions,
    };
  }
  return {
    status: suggestions.length ? 'suggested' : 'pending',
    taxonomyVersion: MATCHING_TAXONOMY.version,
    selectedTopicKeys: suggestions,
    excludedTopicKeys: [],
    suggestedTopicKeys: suggestions,
  };
}

export function validateMatchingDimensions(
  taxonomyVersion: number,
  selectedTopicKeys: string[],
  excludedTopicKeys: string[],
): { selectedTopicKeys: string[]; excludedTopicKeys: string[] } {
  if (taxonomyVersion !== MATCHING_TAXONOMY.version) {
    throw new Error('Matching taxonomy changed; reload and confirm the current topics');
  }
  const selected = [...new Set(selectedTopicKeys)];
  const excluded = [...new Set(excludedTopicKeys)];
  if (selected.length !== selectedTopicKeys.length || excluded.length !== excludedTopicKeys.length
    || !selected.every((key) => CANONICAL_KEYS.has(key))
    || !excluded.every((key) => CANONICAL_KEYS.has(key))) {
    throw new Error('Matching dimensions contain an unknown or duplicate topic');
  }
  if (selected.some((key) => excluded.includes(key))) {
    throw new Error('A matching dimension cannot be both used and excluded');
  }
  return { selectedTopicKeys: selected, excludedTopicKeys: excluded };
}

export interface DimensionedMatchingProfile {
  crystal: RegistryMatchingCrystal;
  dimensions: MatchingDimensions;
}

export interface MatchingCandidateSimilarity {
  score: number;
  mode: 'combined' | 'topics' | 'channels' | 'none';
  topicSimilarity: number | null;
  channelSimilarity: number | null;
  allowedTopicKeys: string[];
}

function cosine(
  left: Array<{ key: string; share: number }>,
  right: Array<{ key: string; share: number }>,
): number | null {
  const rightByKey = new Map(right.map((item) => [item.key, item.share]));
  const dot = left.reduce((sum, item) => sum + item.share * (rightByKey.get(item.key) ?? 0), 0);
  const norm = (items: Array<{ share: number }>) =>
    Math.sqrt(items.reduce((sum, item) => sum + item.share ** 2, 0));
  const denominator = norm(left) * norm(right);
  return denominator > 0 ? dot / denominator : null;
}

export function matchingCandidateSimilarity(
  requester: DimensionedMatchingProfile,
  candidate: DimensionedMatchingProfile,
): MatchingCandidateSimilarity {
  const eligibleActivity = matchingDataEligible(requester.crystal.data)
    && matchingDataEligible(candidate.crystal.data);
  const comparableTaxonomy = eligibleActivity
    && requester.crystal.taxonomyVersion === candidate.crystal.taxonomyVersion
    && requester.crystal.taxonomyVersion === MATCHING_TAXONOMY.version
    && requester.dimensions.status !== 'stale'
    && candidate.dimensions.status !== 'stale'
    && requester.crystal.data.topicCoverage >= MATCHING_TOPIC_MIN_COVERAGE
    && candidate.crystal.data.topicCoverage >= MATCHING_TOPIC_MIN_COVERAGE;
  const blocked = new Set(candidate.dimensions.excludedTopicKeys);
  const allowedTopicKeys = comparableTaxonomy
    ? requester.dimensions.selectedTopicKeys.filter((key) => !blocked.has(key))
    : [];
  const allowed = new Set(allowedTopicKeys);
  const topicSimilarity = allowed.size
    ? cosine(
      requester.crystal.topics.filter((topic) => allowed.has(topic.key)),
      candidate.crystal.topics.filter((topic) => allowed.has(topic.key)),
    )
    : null;
  const channelSimilarity = eligibleActivity
    ? cosine(requester.crystal.channels, candidate.crystal.channels)
    : null;
  if (topicSimilarity !== null && channelSimilarity !== null) {
    return {
      score: (topicSimilarity + channelSimilarity) / 2,
      mode: 'combined',
      topicSimilarity,
      channelSimilarity,
      allowedTopicKeys,
    };
  }
  if (topicSimilarity !== null) {
    return { score: topicSimilarity, mode: 'topics', topicSimilarity, channelSimilarity: null, allowedTopicKeys };
  }
  if (channelSimilarity !== null) {
    return { score: channelSimilarity, mode: 'channels', topicSimilarity: null, channelSimilarity, allowedTopicKeys };
  }
  return { score: 0, mode: 'none', topicSimilarity: null, channelSimilarity: null, allowedTopicKeys };
}
