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

export interface YoutubeProgressBatchInput {
  scanId: string;
  observedAt: string;
  complete: boolean;
  items: YoutubeProgressInput[];
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

export interface YoutubeLengthBucket {
  label: string;
  videos: number;
}

export interface YoutubeKeyword {
  term: string;
  videos: number;
  score: number;
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
    topicCoverage: number;
  };
  daily: YoutubeDailySummary[];
  hourly: YoutubeHourlySummary[];
  shortFormDaily: YoutubeShortFormDailySummary[];
  lengthBuckets: YoutubeLengthBucket[];
  topChannels: YoutubeChannelSummary[];
  topVideos: YoutubeVideoSummary[];
  channelRace: YoutubeChannelRace;
  topics: YoutubeTopicSummary[];
  keywords: YoutubeKeyword[];
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
