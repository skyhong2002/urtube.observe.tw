import { createHash } from 'node:crypto';
import type { YoutubeVideoMetadata } from './types.js';

export const PERSONAL_TAXONOMY_DEFINITION_VERSION = 'personal-fixed-v2';
export const PERSONAL_TAXONOMY_PROMPT_VERSION = 'youtube-topics-v2';
export const PERSONAL_TAXONOMY_METADATA_MIN_COVERAGE = 0.98;
export const PERSONAL_TAXONOMY_MIN_AVAILABLE_VIDEOS = 24;
export const PERSONAL_TAXONOMY_SAMPLE_LIMIT = 480;
export const PERSONAL_TAXONOMY_MAX_CHANNEL_SHARE = 0.05;
export const PERSONAL_TAXONOMY_CONFIDENCE_MIN = 0.65;
export const PERSONAL_TAXONOMY_TRUSTED_COVERAGE = 0.8;
export const PERSONAL_TAXONOMY_RUN_COVERAGE_MIN = 0.95;
export const PERSONAL_TAXONOMY_UNKNOWN_MAX = 0.4;
export const PERSONAL_TAXONOMY_LOW_CONFIDENCE_MAX = 0.3;
export const PERSONAL_TAXONOMY_AMBIGUITY_MAX = 0.3;
export const PERSONAL_TAXONOMY_COHESION_MIN = 0.75;

export interface PersonalTopicDefinition {
  slug: string;
  name: string;
  nameZh: string;
  description: string;
}

export const PERSONAL_TOPICS: readonly PersonalTopicDefinition[] = [
  { slug: 'learning', name: 'Knowledge & Education', nameZh: '知識與教育', description: 'Teaching, study, history, and practical explanation' },
  { slug: 'technology', name: 'Technology & Science', nameZh: '科技與科學', description: 'Computing, engineering, products, and scientific subjects' },
  { slug: 'gaming', name: 'Games', nameZh: '遊戲', description: 'Video games, tabletop games, and competitive play' },
  { slug: 'music', name: 'Music', nameZh: '音樂', description: 'Songs, performance, composition, and music production' },
  { slug: 'screen', name: 'Film, TV & Animation', nameZh: '影視與動畫', description: 'Movies, television, animation, and screen storytelling' },
  { slug: 'news', name: 'News & Public Affairs', nameZh: '新聞與公共議題', description: 'Reported current events, policy, and civic affairs' },
  { slug: 'sports', name: 'Sports', nameZh: '運動', description: 'Athletic competition, training, and sports commentary' },
  { slug: 'lifestyle', name: 'Health & Personal Life', nameZh: '健康與生活', description: 'Health, relationships, home, fashion, and personal routines' },
  { slug: 'food', name: 'Food & Cooking', nameZh: '飲食與料理', description: 'Cooking, restaurants, ingredients, and food culture' },
  { slug: 'travel', name: 'Travel & Places', nameZh: '旅行與地方', description: 'Destinations, transport, geography, and local exploration' },
  { slug: 'arts', name: 'Arts & Creative Practice', nameZh: '藝術與創作', description: 'Visual art, design, writing, craft, and creative technique' },
  { slug: 'business', name: 'Business & Careers', nameZh: '商業與職涯', description: 'Companies, markets, work, entrepreneurship, and careers' },
  { slug: 'other', name: 'Other', nameZh: '其他', description: 'Clear content outside the governed top-level subjects' },
  { slug: 'unknown', name: 'Unknown', nameZh: '無法判斷', description: 'Metadata or model evidence is not sufficient to classify' },
];

export interface PersonalTaxonomyReadiness {
  totalVideos: number;
  metadataReadyVideos: number;
  availableVideos: number;
  metadataCoverage: number;
  ready: boolean;
  reason: 'ready' | 'metadata-coverage' | 'available-videos';
}

export interface PersonalTaxonomySampleCandidate extends YoutubeVideoMetadata {
  channelKey: string;
  firstWatchedAt: string;
  lastWatchedAt: string;
  watches: number;
}

export interface PersonalTaxonomySampleManifest {
  algorithmVersion: string;
  eligibleVideos: number;
  sampledVideos: number;
  firstWatchedAt: string | null;
  lastWatchedAt: string | null;
  periods: string[];
  channels: number;
  maxVideosPerChannel: number;
  frequencyBuckets: Record<'once' | 'repeat' | 'frequent', number>;
  videoIds: string[];
}

export interface PersonalClassificationEvidence {
  text: string;
  source: 'title' | 'channel' | 'tag' | 'description';
  score: number;
}

export interface PersonalClassificationInput {
  slug: string;
  confidence: number;
  alternativeSlug: string | null;
  alternativeConfidence: number | null;
  evidence: PersonalClassificationEvidence[];
}

export interface PersonalClassificationDecision extends PersonalClassificationInput {
  decision: 'accepted' | 'unknown' | 'low-confidence';
}

export interface PersonalTaxonomyQualityInput {
  total: number;
  processed: number;
  accepted: number;
  unknown: number;
  lowConfidence: number;
  ambiguous: number;
  acceptedConfidenceTotal: number;
}

export interface PersonalTaxonomyQuality {
  passed: boolean;
  processedCoverage: number;
  unknownShare: number;
  lowConfidenceShare: number;
  ambiguityShare: number;
  cohesionScore: number;
  failures: Array<'coverage' | 'unknown' | 'low-confidence' | 'ambiguity' | 'cohesion'>;
}

export type PersonalTaxonomyRunStatus = 'candidate' | 'ready' | 'blocked' | 'active' | 'retired';

export interface PersonalTaxonomyRun {
  taxonomyVersion: number;
  definitionVersion: string;
  status: PersonalTaxonomyRunStatus;
  model: string;
  promptVersion: string;
  createdAt: string;
  activatedAt: string | null;
  reviewedAt: string | null;
  dataStartAt: string | null;
  dataEndAt: string | null;
  inputVideos: number;
  categoryCount: number;
  sample: PersonalTaxonomySampleManifest | null;
  quality: PersonalTaxonomyQuality | null;
}

export interface PersonalTaxonomyEvidenceRow {
  topicSlug: string;
  topicName: string;
  videoId: string;
  title: string;
  channelTitle: string;
  confidence: number;
  evidence: PersonalClassificationEvidence[];
}

export interface PersonalTaxonomyDistribution {
  taxonomyVersion: number;
  totalWatchSeconds: number;
  effectiveWatchSeconds: number;
  unknownWatchSeconds: number;
  effectiveCoverage: number;
  unknownShare: number;
  topics: Array<{
    slug: string;
    name: string;
    watchSeconds: number;
    share: number;
  }>;
}

export function personalTaxonomyReadiness(
  totalVideos: number,
  metadataReadyVideos: number,
  availableVideos: number,
): PersonalTaxonomyReadiness {
  const safeTotal = Math.max(0, Math.floor(totalVideos));
  const safeReady = Math.max(0, Math.min(safeTotal, Math.floor(metadataReadyVideos)));
  const safeAvailable = Math.max(0, Math.min(safeReady, Math.floor(availableVideos)));
  const metadataCoverage = safeTotal > 0 ? safeReady / safeTotal : 0;
  const reason = safeAvailable < PERSONAL_TAXONOMY_MIN_AVAILABLE_VIDEOS
    ? 'available-videos'
    : metadataCoverage < PERSONAL_TAXONOMY_METADATA_MIN_COVERAGE
      ? 'metadata-coverage'
      : 'ready';
  return {
    totalVideos: safeTotal,
    metadataReadyVideos: safeReady,
    availableVideos: safeAvailable,
    metadataCoverage,
    ready: reason === 'ready',
    reason,
  };
}

type FrequencyBucket = keyof PersonalTaxonomySampleManifest['frequencyBuckets'];

function frequencyBucket(watches: number): FrequencyBucket {
  return watches >= 5 ? 'frequent' : watches >= 2 ? 'repeat' : 'once';
}

function stableOrder(videoId: string): string {
  return createHash('sha256')
    .update(`${PERSONAL_TAXONOMY_DEFINITION_VERSION}:${videoId}`)
    .digest('hex');
}

function interleavedPeriods(periods: string[]): string[] {
  const result: string[] = [];
  let left = 0;
  let right = periods.length - 1;
  while (left <= right) {
    result.push(periods[left]);
    if (left !== right) result.push(periods[right]);
    left += 1;
    right -= 1;
  }
  return result;
}

export function samplePersonalTaxonomy(
  candidates: PersonalTaxonomySampleCandidate[],
  limit = PERSONAL_TAXONOMY_SAMPLE_LIMIT,
): PersonalTaxonomySampleManifest {
  const boundedLimit = Math.max(1, Math.min(PERSONAL_TAXONOMY_SAMPLE_LIMIT, Math.floor(limit)));
  const target = Math.min(boundedLimit, candidates.length);
  const maxVideosPerChannel = Math.max(1, Math.ceil(target * PERSONAL_TAXONOMY_MAX_CHANNEL_SHARE));
  const periods = [...new Set(candidates.map((candidate) => candidate.lastWatchedAt.slice(0, 7)))]
    .sort();
  const periodOrder = interleavedPeriods(periods);
  const bucketOrder: FrequencyBucket[] = ['once', 'repeat', 'frequent'];
  const strata = new Map<string, PersonalTaxonomySampleCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.lastWatchedAt.slice(0, 7)}:${frequencyBucket(candidate.watches)}`;
    const entries = strata.get(key) ?? [];
    entries.push(candidate);
    strata.set(key, entries);
  }
  for (const entries of strata.values()) {
    entries.sort((left, right) => stableOrder(left.videoId).localeCompare(stableOrder(right.videoId)));
  }
  const keys = periodOrder.flatMap((period) =>
    bucketOrder.map((bucket) => `${period}:${bucket}`).filter((key) => strata.has(key)));
  const cursors = new Map(keys.map((key) => [key, 0]));
  const channelCounts = new Map<string, number>();
  const selected: PersonalTaxonomySampleCandidate[] = [];
  let progressed = true;
  while (selected.length < target && progressed) {
    progressed = false;
    for (const key of keys) {
      const entries = strata.get(key)!;
      let cursor = cursors.get(key)!;
      while (cursor < entries.length) {
        const candidate = entries[cursor];
        cursor += 1;
        cursors.set(key, cursor);
        if ((channelCounts.get(candidate.channelKey) ?? 0) >= maxVideosPerChannel) continue;
        selected.push(candidate);
        channelCounts.set(candidate.channelKey, (channelCounts.get(candidate.channelKey) ?? 0) + 1);
        progressed = true;
        break;
      }
      if (selected.length >= target) break;
    }
  }
  const selectedPeriods = [...new Set(selected.map((candidate) => candidate.lastWatchedAt.slice(0, 7)))].sort();
  const watched = selected.flatMap((candidate) => [candidate.firstWatchedAt, candidate.lastWatchedAt]).sort();
  const frequencyBuckets = { once: 0, repeat: 0, frequent: 0 };
  for (const candidate of selected) frequencyBuckets[frequencyBucket(candidate.watches)] += 1;
  return {
    algorithmVersion: 'time-frequency-channel-v1',
    eligibleVideos: candidates.length,
    sampledVideos: selected.length,
    firstWatchedAt: watched.at(0) ?? null,
    lastWatchedAt: watched.at(-1) ?? null,
    periods: selectedPeriods,
    channels: channelCounts.size,
    maxVideosPerChannel,
    frequencyBuckets,
    videoIds: selected.map((candidate) => candidate.videoId),
  };
}

function evidenceSource(video: YoutubeVideoMetadata, source: PersonalClassificationEvidence['source']): string[] {
  if (source === 'title') return [video.title];
  if (source === 'channel') return [video.channelTitle ?? ''];
  if (source === 'tag') return video.tags;
  return [video.description];
}

function normalizeEvidence(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

export function decidePersonalClassification(
  video: YoutubeVideoMetadata,
  input: PersonalClassificationInput,
): PersonalClassificationDecision {
  const slugs = new Set(PERSONAL_TOPICS.map((topic) => topic.slug));
  if (!slugs.has(input.slug)) throw new Error('Personal classification returned an unknown topic');
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new Error('Personal classification confidence must be between 0 and 1');
  }
  if (input.alternativeSlug !== null) {
    if (!slugs.has(input.alternativeSlug) || input.alternativeSlug === input.slug) {
      throw new Error('Personal classification alternative must be a different known topic');
    }
    if (input.alternativeConfidence === null
      || !Number.isFinite(input.alternativeConfidence)
      || input.alternativeConfidence < 0
      || input.alternativeConfidence > input.confidence) {
      throw new Error('Personal classification alternative confidence is invalid');
    }
  } else if (input.alternativeConfidence !== null) {
    throw new Error('Personal classification alternative confidence needs a topic');
  }
  if (input.evidence.length > 3) throw new Error('Personal classification evidence is limited to three items');
  const evidence = input.evidence.map((item) => {
    const text = item.text.trim();
    if (!['title', 'channel', 'tag', 'description'].includes(item.source)
      || !text || text.length > 80
      || !Number.isFinite(item.score) || item.score <= 0 || item.score > 1) {
      throw new Error('Personal classification evidence must have bounded text and a positive score');
    }
    const needle = normalizeEvidence(text);
    if (!evidenceSource(video, item.source).some((value) => normalizeEvidence(value).includes(needle))) {
      throw new Error('Personal classification evidence must occur in its declared metadata source');
    }
    return { ...item, text };
  });
  if (input.slug === 'unknown') {
    return { ...input, slug: 'unknown', evidence: [], decision: 'unknown' };
  }
  if (input.confidence < PERSONAL_TAXONOMY_CONFIDENCE_MIN) {
    return { ...input, slug: 'unknown', evidence: [], decision: 'low-confidence' };
  }
  if (!evidence.length) throw new Error('Known personal classifications require metadata evidence');
  return { ...input, evidence, decision: 'accepted' };
}

export function assessPersonalTaxonomyQuality(
  input: PersonalTaxonomyQualityInput,
): PersonalTaxonomyQuality {
  const processedCoverage = input.total > 0 ? input.processed / input.total : 0;
  const unknownShare = input.processed > 0 ? input.unknown / input.processed : 0;
  const lowConfidenceShare = input.processed > 0 ? input.lowConfidence / input.processed : 0;
  const ambiguityShare = input.accepted > 0 ? input.ambiguous / input.accepted : 0;
  const cohesionScore = input.accepted > 0 ? input.acceptedConfidenceTotal / input.accepted : 0;
  const failures: PersonalTaxonomyQuality['failures'] = [];
  if (processedCoverage < PERSONAL_TAXONOMY_RUN_COVERAGE_MIN) failures.push('coverage');
  if (unknownShare > PERSONAL_TAXONOMY_UNKNOWN_MAX) failures.push('unknown');
  if (lowConfidenceShare > PERSONAL_TAXONOMY_LOW_CONFIDENCE_MAX) failures.push('low-confidence');
  if (ambiguityShare > PERSONAL_TAXONOMY_AMBIGUITY_MAX) failures.push('ambiguity');
  if (cohesionScore < PERSONAL_TAXONOMY_COHESION_MIN) failures.push('cohesion');
  return {
    passed: failures.length === 0,
    processedCoverage,
    unknownShare,
    lowConfidenceShare,
    ambiguityShare,
    cohesionScore,
    failures,
  };
}
