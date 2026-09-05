export const MAX_YOUTUBE_DURATION_SECONDS = 366 * 24 * 60 * 60;

export const YOUTUBE_RANGES = ['7d', '28d', '90d', '365d', 'all'] as const;
export type YoutubeRange = typeof YOUTUBE_RANGES[number];

export interface YoutubeWatchInput {
  eventId: string;
  videoId: string | null;
  title: string;
  url: string;
  channelId: string | null;
  channelTitle: string | null;
  channelUrl: string | null;
  watchedAt: string;
  actualWatchedSeconds: number | null;
  durationSeconds?: number | null;
  activityType: 'video' | 'post' | 'other';
  // 'day' marks backfilled events whose true time-of-day is unknown (history
  // page date groups); they dedupe per-day and yield to exact events.
  precision?: 'exact' | 'day';
}

export interface YoutubeSearchInput {
  eventId: string;
  searchedAt: string;
  queryCiphertext: string;
  activityType: 'search' | 'visit' | 'other';
}

export interface YoutubeParsedArchive {
  archiveHash: string;
  source: 'takeout' | 'dataportability' | 'extension' | 'history-page';
  watches: YoutubeWatchInput[];
  searches: YoutubeSearchInput[];
}

export interface YoutubeImportResult {
  archiveHash: string;
  watchesSeen: number;
  watchesInserted: number;
  searchesSeen: number;
  searchesInserted: number;
}

export interface YoutubeCaptureInput {
  sessionId: string;
  videoId: string;
  title: string;
  url: string;
  channelTitle: string | null;
  watchedAt: string;
  actualWatchedSeconds: number;
  durationSeconds: number | null;
}

export interface YoutubeCapturedWatch extends Omit<
  YoutubeWatchInput,
  'videoId' | 'actualWatchedSeconds'
> {
  videoId: string;
  actualWatchedSeconds: number;
  durationSeconds: number | null;
}

export interface YoutubeCaptureResult {
  eventId: string;
  inserted: boolean;
  updated: boolean;
  actualWatchedSeconds: number;
}

export interface YoutubeProgressInput {
  videoId: string;
  progressPercent: number | null;
  resumeSeconds: number | null;
  durationSeconds: number | null;
}

// How a history-page scan ended. 'history-start' is the only proof that a
// scan reached the account's oldest entry; 'covered' may extend that verified
// continuous interval. Legacy idle-only 'end-of-history', 'time-limit', and
// 'stalled' scans describe what was observed but never establish coverage.
export type YoutubeScanEndReason =
  | 'history-start'
  | 'end-of-history'
  | 'covered'
  | 'time-limit'
  | 'stalled'
  | 'segment-limit'
  | 'history-paused'
  | 'signed-out'
  | 'no-content'
  | 'cancelled'
  | 'error'
  | 'no-receiver';

export const YOUTUBE_SCAN_COVERING_REASONS: ReadonlySet<YoutubeScanEndReason> = new Set([
  'history-start', 'covered',
]);

export interface YoutubeScanSummary {
  mode: 'full' | 'incremental';
  videos: number;
  passes: number;
  endReason: YoutubeScanEndReason;
  oldestWatchedAt: string | null;
  newestWatchedAt: string | null;
  error: string | null;
  landedUrl: string | null;
}

export interface YoutubeProgressBatchInput {
  scanId: string;
  observedAt: string;
  complete: boolean;
  items: YoutubeProgressInput[];
  summary?: YoutubeScanSummary;
}

// What the extension needs to decide how deep the next scan must go: the
// observation time of the latest covering scan (everything watched before it
// is already known) and the oldest day any covering scan reached.
export interface YoutubeHistoryCoverage {
  scanId: string;
  coveredSince: string;
  oldestWatchedAt: string | null;
  endReason: YoutubeScanEndReason;
  completedAt: string;
}

export interface YoutubeProgressImportRow {
  scanId: string;
  observedAt: string;
  startedAt: string;
  completedAt: string | null;
  mode: 'full' | 'incremental' | null;
  videos: number | null;
  passes: number | null;
  endReason: YoutubeScanEndReason | null;
  oldestWatchedAt: string | null;
  newestWatchedAt: string | null;
  error: string | null;
  landedUrl: string | null;
}

export interface YoutubeProgressImportResult {
  scanId: string;
  accepted: number;
  stored: number;
  totalStored: number;
  completed: boolean;
}

export interface YoutubeHistoryStatus {
  latestEventAt: string | null;
  latestWatchAt: string | null;
  latestSearchAt: string | null;
  watches: number;
  searches: number;
  coverage: YoutubeHistoryCoverage | null;
}

export interface YoutubeVideoMetadata {
  videoId: string;
  title: string;
  channelId: string | null;
  channelTitle: string | null;
  description: string;
  tags: string[];
  thumbnailUrl: string;
  durationSeconds: number | null;
  publishedAt: string | null;
  categoryId: string | null;
  availability: 'available' | 'unavailable';
  metadataHash: string;
}

export interface YoutubeChannelMetadata {
  channelId: string;
  name: string;
  thumbnailUrl: string;
}

export interface YoutubeRecentVideo {
  videoId: string | null;
  title: string;
  url: string;
  channelId: string | null;
  channelTitle: string;
  thumbnailUrl: string;
  durationSeconds: number | null;
  actualWatchedSeconds: number | null;
  watchedAt: string;
  watchCount: number;
}

export interface YoutubeChannelSummary {
  channelId: string | null;
  name: string;
  thumbnailUrl: string;
  watches: number;
  estimatedWatchSeconds: number;
}

export interface YoutubeVideoSummary {
  videoId: string | null;
  title: string;
  url: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationSeconds: number | null;
  watches: number;
  estimatedWatchSeconds: number;
}

export interface YoutubeShortFormDailySummary {
  day: string;
  shortWatchSeconds: number;
  knownDurationWatchSeconds: number;
}

export interface YoutubeChannelRaceChannel {
  channelId: string | null;
  name: string;
  thumbnailUrl: string;
}

// One race frame per calendar week; entries are [channel index, decayed
// estimated seconds] pairs sorted by score so the payload stays compact when
// the full history is inlined into the dashboard HTML.
export interface YoutubeChannelRaceFrame {
  period: string;
  entries: Array<[number, number]>;
}

export interface YoutubeChannelRace {
  halfLifeDays: number;
  channels: YoutubeChannelRaceChannel[];
  frames: YoutubeChannelRaceFrame[];
}

export interface YoutubeTopicSummary {
  slug: string;
  name: string;
  watches: number;
  estimatedWatchSeconds: number;
}

export interface YoutubeTopicTrendTopic {
  slug: string;
  name: string;
  estimatedWatchSeconds: number;
  share: number;
  movingAverageShare: number;
}

export interface YoutubeTopicTrendMonth {
  month: string;
  classifiableWatchEvents: number;
  processedWatchEvents: number;
  classifiedWatchEvents: number;
  unknownWatchEvents: number;
  classificationCoverage: number;
  processedCoverage: number;
  unknownShare: number;
  classifiedWatchSeconds: number;
  topics: YoutubeTopicTrendTopic[];
}

export interface YoutubeDailySummary {
  day: string;
  watches: number;
  estimatedWatchSeconds: number;
}

export interface YoutubeHourlySummary {
  hour: number;
  watches: number;
  estimatedWatchSeconds: number;
}

// One person's side of a two-person comparison: aggregate stats plus fully
// ranked channel/video/topic lists so a peer's rank can be looked up, and
// clock/weekday histograms. Built from the private repository; the
// comparison layer decides what crosses to the other person.
export interface YoutubeComparisonRankedChannel {
  key: string;
  name: string;
  thumbnailUrl: string;
  // Position by estimated watch time and by watch count, 1-based.
  rank: number;
  watchRank: number;
  watches: number;
  estimatedWatchSeconds: number;
}

export interface YoutubeComparisonRankedVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  rank: number;
  watchRank: number;
  watches: number;
  estimatedWatchSeconds: number;
}

export interface YoutubeComparisonRankedTopic {
  key: string;
  rank: number;
  watchRank: number;
  watches: number;
  estimatedWatchSeconds: number;
}

export interface YoutubeWeekdaySummary {
  // 0 = Sunday … 6 = Saturday, Taipei local time.
  weekday: number;
  watches: number;
  estimatedWatchSeconds: number;
}

export interface YoutubeComparisonWatch {
  title: string;
  watchedAt: string;
}

// One person's view of one channel, for the /channel/<id> page.
export interface YoutubeChannelDetail {
  range: YoutubeRange;
  channel: { channelId: string; name: string; thumbnailUrl: string } | null;
  stats: {
    watches: number;
    estimatedWatchSeconds: number;
    uniqueVideos: number;
    firstWatchedAt: string | null;
    lastWatchedAt: string | null;
    // Fraction of this person's watch time in the range, 0..1.
    share: number;
  };
  // 1-based position among this person's channels in the range; null when
  // the channel does not appear.
  rank: { time: number | null; watches: number | null; channels: number };
  videos: Array<{
    videoId: string;
    title: string;
    thumbnailUrl: string;
    watches: number;
    estimatedWatchSeconds: number;
  }>;
  monthly: Array<{ month: string; watches: number; estimatedWatchSeconds: number }>;
}

export interface YoutubeComparisonProfile {
  range: YoutubeRange;
  stats: {
    watchEvents: number;
    estimatedWatchSeconds: number;
    uniqueVideos: number;
    uniqueChannels: number;
    activeDays: number;
  };
  channels: YoutubeComparisonRankedChannel[];
  // Channels ranked by short-form viewing only (videos of at most three
  // minutes, the codebase's Shorts proxy).
  shortsChannels: YoutubeComparisonRankedChannel[];
  videos: YoutubeComparisonRankedVideo[];
  topics: YoutubeComparisonRankedTopic[];
  hourly: YoutubeHourlySummary[];
  weekdays: YoutubeWeekdaySummary[];
  rhythmCoverage: YoutubeRhythmCoverage;
  firstWatch: YoutubeComparisonWatch | null;
  lastWatch: YoutubeComparisonWatch | null;
}

export interface YoutubeRhythmCoverage {
  // Only exact timestamps are safe to place on a 24-hour clock. Extension
  // history backfills can know the calendar day without knowing the time.
  exactWatches: number;
  dateOnlyWatches: number;
}

export interface YoutubeLengthBucket {
  label: string;
  videos: number;
}

export interface YoutubeKeyword {
  // Display label (most common spelling) and the canonical key that merged
  // safe format variants (`foo bar` / `foo-bar` / `#foobar`).
  term: string;
  key: string;
  // Distinct sampled videos and distinct known channels the term appears in.
  videos: number;
  channels: number;
  // Source-weighted support × channel-diversity factor, normalized by the
  // sampled video count. A "commonness" measure, not a trend.
  score: number;
  sources: { title: number; tag: number; description: number };
  aliases: string[];
}

export interface YoutubeKeywordCoverage {
  // Large archives are sampled evenly across the range; both numbers are
  // shown so the keyword list never poses as the whole period.
  sampledVideos: number;
  eligibleVideos: number;
  algorithmVersion: number;
  lexiconVersion: number;
}

export interface YoutubeDashboardData {
  range: YoutubeRange;
  generatedAt: string;
  stats: {
    watchEvents: number;
    uniqueVideos: number;
    uniqueChannels: number;
    openedDurationSeconds: number;
    catalogDurationSeconds: number;
    estimatedWatchSeconds: number;
    inferredWatchSeconds: number;
    contentCoveredSeconds: number;
    progressCoverage: number;
    actualWatchedSeconds: number | null;
    metadataCoverage: number;
    topicProcessedCoverage: number;
    topicCoverage: number;
    topicUnknownCoverage: number;
  };
  daily: YoutubeDailySummary[];
  hourly: YoutubeHourlySummary[];
  rhythmCoverage: YoutubeRhythmCoverage;
  shortFormDaily: YoutubeShortFormDailySummary[];
  lengthBuckets: YoutubeLengthBucket[];
  topChannels: YoutubeChannelSummary[];
  topVideos: YoutubeVideoSummary[];
  channelRace: YoutubeChannelRace;
  topics: YoutubeTopicSummary[];
  topicTrend: YoutubeTopicTrendMonth[];
  keywords: YoutubeKeyword[];
  keywordCoverage: YoutubeKeywordCoverage;
  recent: YoutubeRecentVideo[];
}

export interface YoutubeTopic {
  id: number;
  version: number;
  slug: string;
  name: string;
  description: string;
}

export interface YoutubeOAuthCredential {
  encryptedRefreshToken: string;
  expiresAt: string | null;
  scope: string;
  updatedAt: string;
}
