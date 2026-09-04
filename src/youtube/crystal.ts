// A "crystal" is a compressed, comparable unit of one person's YouTube
// attention: share-weighted channels, topics, and keywords over aligned time
// windows, plus the shifts between the recent and prior window. It contains
// aggregates only — no timestamps, no searches, no per-event history — so it
// is safe to exchange for cross-person comparison.
import type { Repository } from '../data/database.js';
import { matchingTopicProfile } from './matching.js';

export interface CrystalItem {
  key: string;
  name: string;
  watches: number;
  estimatedWatchSeconds: number;
  // Share of the window's total estimated watch time, 0..1.
  share: number;
}

export interface CrystalWindow {
  start: string | null;
  end: string | null;
  watchEvents: number;
  uniqueVideos: number;
  estimatedWatchSeconds: number;
  activeDays: number;
  channels: CrystalItem[];
  topics: CrystalItem[];
  keywords: Array<{ term: string; videos: number; score: number }>;
}

export interface CrystalShift {
  key: string;
  name: string;
  kind: 'channel' | 'topic';
  recentShare: number;
  priorShare: number;
  delta: number;
  status: 'new' | 'rising' | 'falling' | 'gone';
}

export interface YoutubeCrystal {
  version: 2;
  generatedAt: string;
  handle: string;
  displayName: string;
  windowDays: number;
  recent: CrystalWindow;
  prior: CrystalWindow;
  allTime: CrystalWindow;
  matching: {
    taxonomyVersion: number;
    windowDays: number;
    watchEvents: number;
    uniqueVideos: number;
    estimatedWatchSeconds: number;
    activeDays: number;
    topicCoverage: number;
    channels: CrystalItem[];
    topics: CrystalItem[];
  };
  shifts: CrystalShift[];
  volumeChange: number | null; // recent vs prior estimated seconds, e.g. +0.25
}

function withShares(
  items: Array<{ key?: string; slug?: string; name: string; watches: number; estimatedWatchSeconds: number }>,
  totalSeconds: number,
  totalWatches: number,
): CrystalItem[] {
  return items.map((item) => ({
    key: item.key ?? item.slug ?? item.name,
    name: item.name,
    watches: item.watches,
    estimatedWatchSeconds: item.estimatedWatchSeconds,
    // Fall back to watch share when a window has no measurable time.
    share: totalSeconds > 0
      ? item.estimatedWatchSeconds / totalSeconds
      : totalWatches > 0 ? item.watches / totalWatches : 0,
  }));
}

function crystalWindow(repository: Repository, start: string | null, end: string | null): CrystalWindow {
  const window = repository.youtubeCrystalWindow(start, end);
  return {
    start,
    end,
    watchEvents: window.watchEvents,
    uniqueVideos: window.uniqueVideos,
    estimatedWatchSeconds: window.estimatedWatchSeconds,
    activeDays: window.activeDays,
    channels: withShares(window.channels, window.estimatedWatchSeconds, window.watchEvents),
    topics: withShares(window.topics, window.estimatedWatchSeconds, window.watchEvents),
    keywords: window.keywords,
  };
}

// A shift is reportable when a channel/topic enters, leaves, or moves by at
// least two share-points between the prior and recent window.
const SHIFT_MIN_DELTA = 0.02;
const TOPIC_SHIFT_MIN_COVERAGE = 0.8;

function topicCoverage(window: CrystalWindow): number {
  return window.topics.reduce((sum, topic) => sum + topic.share, 0);
}

function shiftsBetween(recent: CrystalItem[], prior: CrystalItem[], kind: CrystalShift['kind']): CrystalShift[] {
  const priorByKey = new Map(prior.map((item) => [item.key, item]));
  const recentByKey = new Map(recent.map((item) => [item.key, item]));
  const shifts: CrystalShift[] = [];
  for (const item of recent) {
    const before = priorByKey.get(item.key);
    const priorShare = before?.share ?? 0;
    const delta = item.share - priorShare;
    if (Math.abs(delta) < SHIFT_MIN_DELTA) continue;
    shifts.push({
      key: item.key, name: item.name, kind,
      recentShare: item.share, priorShare, delta,
      status: before ? (delta > 0 ? 'rising' : 'falling') : 'new',
    });
  }
  for (const item of prior) {
    if (recentByKey.has(item.key) || item.share < SHIFT_MIN_DELTA) continue;
    shifts.push({
      key: item.key, name: item.name, kind,
      recentShare: 0, priorShare: item.share, delta: -item.share,
      status: 'gone',
    });
  }
  return shifts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export function buildYoutubeCrystal(
  repository: Repository,
  identity: { handle: string; displayName: string },
  now = new Date(),
  windowDays = 28,
): YoutubeCrystal {
  const end = now.toISOString();
  const mid = new Date(now.getTime() - windowDays * 86_400_000).toISOString();
  const start = new Date(now.getTime() - 2 * windowDays * 86_400_000).toISOString();
  const recent = crystalWindow(repository, mid, end);
  const prior = crystalWindow(repository, start, mid);
  const allTime = crystalWindow(repository, null, null);
  const matchingWindowDays = 90;
  const matchingStart = new Date(now.getTime() - matchingWindowDays * 86_400_000).toISOString();
  const matchingSource = crystalWindow(repository, matchingStart, end);
  const matchingProfile = matchingTopicProfile(repository, matchingStart, end);
  // Topic rows are filled asynchronously. Comparing a mostly classified
  // recent window with an unclassified prior window manufactures "new"
  // interests, so channel shifts remain live while topic shifts wait until
  // both samples have enough estimated-time coverage.
  const topicShifts = topicCoverage(recent) >= TOPIC_SHIFT_MIN_COVERAGE
    && topicCoverage(prior) >= TOPIC_SHIFT_MIN_COVERAGE
    ? shiftsBetween(recent.topics, prior.topics, 'topic')
    : [];
  const shifts = [
    ...topicShifts,
    ...shiftsBetween(recent.channels, prior.channels, 'channel'),
  ].slice(0, 24);
  return {
    version: 2,
    generatedAt: end,
    handle: identity.handle,
    displayName: identity.displayName,
    windowDays,
    recent,
    prior,
    allTime,
    matching: {
      taxonomyVersion: matchingProfile.taxonomyVersion,
      windowDays: matchingWindowDays,
      watchEvents: matchingSource.watchEvents,
      uniqueVideos: matchingSource.uniqueVideos,
      estimatedWatchSeconds: matchingSource.estimatedWatchSeconds,
      activeDays: matchingSource.activeDays,
      topicCoverage: matchingProfile.coverage,
      channels: matchingSource.channels,
      topics: matchingProfile.topics,
    },
    shifts,
    volumeChange: prior.estimatedWatchSeconds > 0
      ? (recent.estimatedWatchSeconds - prior.estimatedWatchSeconds) / prior.estimatedWatchSeconds
      : null,
  };
}

export interface CrystalComparison {
  a: { handle: string; displayName: string };
  b: { handle: string; displayName: string };
  // Channel cosine currently uses the all-time aggregate. Topic cosine uses
  // the versioned 90-day matching profile and is unavailable while unsafe.
  channelSimilarity: number;
  topicSimilarity: number | null;
  topicFallback: 'taxonomy-version-mismatch' | 'insufficient-coverage' | 'no-shareable-topics' | null;
  sharedChannels: Array<{ name: string; aShare: number; bShare: number }>;
  sharedTopics: Array<{ name: string; aShare: number; bShare: number }>;
  // Strong in A's diet, entirely absent from B's — and vice versa. The
  // "you should watch / you somehow missed this" seed list.
  onlyA: Array<{ name: string; kind: 'channel' | 'topic'; share: number }>;
  onlyB: Array<{ name: string; kind: 'channel' | 'topic'; share: number }>;
}

function cosine(a: CrystalItem[], b: CrystalItem[]): number {
  const bByKey = new Map(b.map((item) => [item.key, item.share]));
  let dot = 0;
  for (const item of a) dot += item.share * (bByKey.get(item.key) ?? 0);
  const norm = (items: CrystalItem[]) => Math.sqrt(items.reduce((sum, item) => sum + item.share ** 2, 0));
  const denominator = norm(a) * norm(b);
  return denominator > 0 ? dot / denominator : 0;
}

function onlyIn(mine: CrystalItem[], theirs: CrystalItem[], kind: 'channel' | 'topic', limit: number) {
  const theirKeys = new Set(theirs.map((item) => item.key));
  return mine
    .filter((item) => !theirKeys.has(item.key) && item.share >= 0.01)
    .slice(0, limit)
    .map((item) => ({ name: item.name, kind, share: item.share }));
}

export function compareCrystals(a: YoutubeCrystal, b: YoutubeCrystal): CrystalComparison {
  const shared = (mine: CrystalItem[], theirs: CrystalItem[], limit: number) => {
    const theirsByKey = new Map(theirs.map((item) => [item.key, item]));
    return mine
      .filter((item) => theirsByKey.has(item.key))
      .map((item) => ({
        name: item.name,
        aShare: item.share,
        bShare: theirsByKey.get(item.key)!.share,
      }))
      .sort((x, y) => Math.min(y.aShare, y.bShare) - Math.min(x.aShare, x.bShare))
      .slice(0, limit);
  };
  const sameTaxonomy = a.matching.taxonomyVersion === b.matching.taxonomyVersion;
  const enoughCoverage = a.matching.topicCoverage >= TOPIC_SHIFT_MIN_COVERAGE
    && b.matching.topicCoverage >= TOPIC_SHIFT_MIN_COVERAGE;
  const hasShareableTopics = a.matching.topics.length > 0 && b.matching.topics.length > 0;
  const useTopics = sameTaxonomy && enoughCoverage && hasShareableTopics;
  const aTopics = useTopics ? a.matching.topics : [];
  const bTopics = useTopics ? b.matching.topics : [];
  return {
    a: { handle: a.handle, displayName: a.displayName },
    b: { handle: b.handle, displayName: b.displayName },
    channelSimilarity: cosine(a.allTime.channels, b.allTime.channels),
    topicSimilarity: useTopics ? cosine(aTopics, bTopics) : null,
    topicFallback: !sameTaxonomy
      ? 'taxonomy-version-mismatch'
      : !enoughCoverage
        ? 'insufficient-coverage'
        : !hasShareableTopics ? 'no-shareable-topics' : null,
    sharedChannels: shared(a.allTime.channels, b.allTime.channels, 12),
    sharedTopics: shared(aTopics, bTopics, 12),
    onlyA: [
      ...onlyIn(aTopics, bTopics, 'topic', 6),
      ...onlyIn(a.allTime.channels, b.allTime.channels, 'channel', 10),
    ],
    onlyB: [
      ...onlyIn(bTopics, aTopics, 'topic', 6),
      ...onlyIn(b.allTime.channels, a.allTime.channels, 'channel', 10),
    ],
  };
}
