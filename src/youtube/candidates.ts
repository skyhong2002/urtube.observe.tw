import type { MatchableCrystal } from '../users.js';
import { matchingCardDisclosure, type MatchingCardDisclosure } from './disclosure.js';
import { matchingCandidateSimilarity } from './dimensions.js';
import { MATCHING_TAXONOMY } from './matching.js';

// Keep a normal hackathon-sized pool on one page while retaining a hard DOM
// bound and pagination for larger deployments.
export const MATCHING_CANDIDATE_PAGE_SIZE = 20;
export const MATCHING_CANDIDATE_POOL_LIMIT = 250;
export const MATCHING_PERCENTAGE_VERSION = 'calibrated-v2' as const;

export function matchingPercentage(score: number): number {
  return Math.round(Math.min(1, Math.max(0, Number.isFinite(score) ? score : 0)) * 100);
}

// Raw cosines cluster: 14 broad topics keep topic cosine in roughly 0.4–0.95
// for everyone, while thousands of channels keep channel cosine under ~0.1
// even for people who share dozens of channels. These fixed curves stretch
// each dimension to the full 0–100 range without a reference population, so
// a person's percentage does not move when the pool changes.
export const MATCHING_TOPIC_COSINE_FLOOR = 0.4;
export const MATCHING_TOPIC_COSINE_SPAN = 0.55;
export const MATCHING_CHANNEL_COSINE_GAIN = 25;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function calibratedTopicSimilarity(cosine: number): number {
  return clamp01((cosine - MATCHING_TOPIC_COSINE_FLOOR) / MATCHING_TOPIC_COSINE_SPAN);
}

export function calibratedChannelSimilarity(cosine: number): number {
  return clamp01(1 - Math.exp(-MATCHING_CHANNEL_COSINE_GAIN * clamp01(cosine)));
}

export function calibratedMatchScore(
  topicSimilarity: number | null,
  channelSimilarity: number | null,
): number {
  const parts = [
    topicSimilarity === null ? null : calibratedTopicSimilarity(topicSimilarity),
    channelSimilarity === null ? null : calibratedChannelSimilarity(channelSimilarity),
  ].filter((value): value is number => value !== null);
  return parts.length ? parts.reduce((sum, value) => sum + value, 0) / parts.length : 0;
}

export interface MatchingCandidateCard {
  // Kept inside the server for #13. The #8 renderer deliberately does not
  // serialize it before the request flow supplies an opaque action token.
  candidateUserId: number;
  // Members address each other by handle in comparison URLs; the dashboard
  // behind a handle still follows its own visibility setting.
  handle: string;
  displayName: string;
  matchPercent: number;
  topicPercent: number | null;
  channelPercent: number | null;
  method: 'combined' | 'topics' | 'channels';
  percentageVersion: typeof MATCHING_PERCENTAGE_VERSION;
  viewerInterests: string[];
  interests: string[];
  sharedInterests: string[];
  disclosure: MatchingCardDisclosure;
}

export interface MatchingCandidateBatch {
  cards: MatchingCandidateCard[];
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

const TOPIC_NAMES = new Map(MATCHING_TAXONOMY.topics.map((topic) => [topic.key, topic.name]));

function commonItems(
  left: Array<{ key: string; name: string; share: number }>,
  right: Array<{ key: string; name: string; share: number }>,
  allowedKeys?: ReadonlySet<string>,
): Array<{ key: string; name: string; affinity: number }> {
  const rightByKey = new Map(right.map((item) => [item.key, item]));
  return left.flatMap((item) => {
    const other = rightByKey.get(item.key);
    if (!other || item.share <= 0 || other.share <= 0 || (allowedKeys && !allowedKeys.has(item.key))) {
      return [];
    }
    return [{ key: item.key, name: item.name, affinity: item.share * other.share }];
  }).sort((a, b) => b.affinity - a.affinity || a.key.localeCompare(b.key));
}

export function rankedMatchingCandidateCards(
  viewer: MatchableCrystal,
  candidates: MatchableCrystal[],
): MatchingCandidateCard[] {
  return candidates.flatMap((candidate) => {
    const similarity = matchingCandidateSimilarity(viewer, candidate);
    // A valid 0% comparison is still a person the viewer can inspect. Only
    // profiles with no usable dimension at all are omitted.
    if (similarity.mode === 'none') return [];
    const allowedKeys = new Set(similarity.allowedTopicKeys);
    const sharedTopics = commonItems(viewer.crystal.topics, candidate.crystal.topics, allowedKeys)
      .map((item) => TOPIC_NAMES.get(item.key))
      .filter((name): name is string => Boolean(name));
    const sharedChannels = commonItems(viewer.crystal.channels, candidate.crystal.channels)
      .map((item) => item.name);
    const viewerExcluded = new Set(viewer.dimensions.excludedTopicKeys);
    const candidateExcluded = new Set(candidate.dimensions.excludedTopicKeys);
    const viewerAllowed = new Set(viewer.dimensions.selectedTopicKeys);
    const candidateAllowed = new Set(candidate.dimensions.selectedTopicKeys);
    const viewerInterests = viewer.crystal.topics
      .filter((topic) => topic.share > 0 && viewerAllowed.has(topic.key)
        && !candidateExcluded.has(topic.key))
      .sort((left, right) => right.share - left.share || left.key.localeCompare(right.key))
      .slice(0, 5)
      .map((topic) => TOPIC_NAMES.get(topic.key))
      .filter((name): name is string => Boolean(name));
    const interests = candidate.crystal.topics
      .filter((topic) => topic.share > 0 && candidateAllowed.has(topic.key)
        && !viewerExcluded.has(topic.key))
      .sort((left, right) => right.share - left.share || left.key.localeCompare(right.key))
      .slice(0, 5)
      .map((topic) => TOPIC_NAMES.get(topic.key))
      .filter((name): name is string => Boolean(name));
    const score = calibratedMatchScore(similarity.topicSimilarity, similarity.channelSimilarity);
    return [{
      candidateUserId: candidate.userId,
      handle: candidate.handle,
      displayName: candidate.displayName,
      matchPercent: matchingPercentage(score),
      topicPercent: similarity.topicSimilarity === null
        ? null : matchingPercentage(calibratedTopicSimilarity(similarity.topicSimilarity)),
      channelPercent: similarity.channelSimilarity === null
        ? null : matchingPercentage(calibratedChannelSimilarity(similarity.channelSimilarity)),
      method: similarity.mode,
      percentageVersion: MATCHING_PERCENTAGE_VERSION,
      viewerInterests,
      interests,
      sharedInterests: sharedTopics.slice(0, 5),
      disclosure: matchingCardDisclosure(
        viewer.disclosureLevel,
        candidate.disclosureLevel,
        sharedTopics,
        sharedChannels,
      ),
      score,
    }];
  }).sort((a, b) => b.score - a.score || a.candidateUserId - b.candidateUserId)
    // Raw floating-point scores never cross the service-to-presentation
    // boundary. The product contract is a clamped, whole 0–100 percentage.
    .map(({ score: _score, ...card }) => card);
}

export function matchingCandidateBatch(
  cards: MatchingCandidateCard[],
  requestedPage: number,
): MatchingCandidateBatch {
  const pages = Math.max(1, Math.ceil(cards.length / MATCHING_CANDIDATE_PAGE_SIZE));
  const page = Math.min(Math.max(Number.isInteger(requestedPage) ? requestedPage : 1, 1), pages);
  const start = (page - 1) * MATCHING_CANDIDATE_PAGE_SIZE;
  return {
    cards: cards.slice(start, start + MATCHING_CANDIDATE_PAGE_SIZE),
    page,
    hasPrevious: page > 1,
    hasNext: page < pages,
  };
}
