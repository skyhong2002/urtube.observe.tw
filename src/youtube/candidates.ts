import type { MatchableCrystal } from '../users.js';
import { matchingCardDisclosure, type MatchingCardDisclosure } from './disclosure.js';
import { matchingCandidateSimilarity } from './dimensions.js';
import {
  MATCHING_TAXONOMY,
  matchingSimilarityBand,
  type MatchingSimilarityBand,
} from './matching.js';

export const MATCHING_CANDIDATE_PAGE_SIZE = 5;
export const MATCHING_CANDIDATE_POOL_LIMIT = 250;

export interface MatchingCandidateCard {
  // Kept inside the server for #13. The #8 renderer deliberately does not
  // serialize it before the request flow supplies an opaque action token.
  candidateUserId: number;
  displayName: string;
  similarity: MatchingSimilarityBand;
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
    if (similarity.mode === 'none' || similarity.score <= 0) return [];
    const allowedKeys = new Set(similarity.allowedTopicKeys);
    const sharedTopics = commonItems(viewer.crystal.topics, candidate.crystal.topics, allowedKeys)
      .map((item) => TOPIC_NAMES.get(item.key))
      .filter((name): name is string => Boolean(name));
    const sharedChannels = commonItems(viewer.crystal.channels, candidate.crystal.channels)
      .map((item) => item.name);
    return [{
      candidateUserId: candidate.userId,
      displayName: candidate.displayName,
      similarity: matchingSimilarityBand(similarity.score),
      disclosure: matchingCardDisclosure(
        viewer.disclosureLevel,
        candidate.disclosureLevel,
        sharedTopics,
        sharedChannels,
      ),
      score: similarity.score,
    }];
  }).sort((a, b) => b.score - a.score || a.candidateUserId - b.candidateUserId)
    // Exact scores never cross the service-to-presentation boundary.
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
