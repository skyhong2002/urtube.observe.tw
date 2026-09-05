// Two-person watch comparison, stats.fm style: the same sections for every
// pair, with the amount of detail decided by consent. This module is the
// only place that turns two private comparison profiles into something the
// other person may see, so every field below is deliberate.
import { MATCHING_TAXONOMY } from './matching.js';
import type {
  YoutubeComparisonProfile,
  YoutubeRange,
} from './types.js';

export const COMPARISON_RANGES = ['28d', '90d', '365d', 'all'] as const satisfies readonly YoutubeRange[];
export type ComparisonRange = typeof COMPARISON_RANGES[number];
export const DEFAULT_COMPARISON_RANGE: ComparisonRange = '28d';

export function comparisonRange(value: string | undefined): ComparisonRange {
  return (COMPARISON_RANGES as readonly string[]).includes(value ?? '')
    ? value as ComparisonRange
    : DEFAULT_COMPARISON_RANGE;
}

// How many rows of each list cross to the other person once unlocked.
export const COMPARISON_LIST_LIMIT = 50;
// Before mutual consent only a few broad topics are named, ranks only.
export const COMPARISON_LOCKED_TOPIC_LIMIT = 5;

export interface ComparisonAccess {
  // Both people chose to meet: unlocks stats, channels, videos, absolute
  // clock/weekday values, and first/last watch.
  connected: boolean;
  // Both people allow channel disclosure. One restrictive setting wins and
  // hides channels and videos even when connected.
  channelsAllowed: boolean;
  // Union of both people's excluded matching topics; never named.
  hiddenTopicKeys: ReadonlySet<string>;
  // Both people allow rhythm shares before consent. Irrelevant once
  // connected, when absolute rhythm is part of the unlocked comparison.
  rhythmAllowed: boolean;
}

export interface ComparisonPair<T> {
  a: T;
  b: T;
}

export type ComparisonStatKey =
  | 'watchEvents' | 'minutes' | 'hours' | 'uniqueVideos' | 'uniqueChannels' | 'activeDays';

export interface ComparisonStatRow extends ComparisonPair<number> {
  key: ComparisonStatKey;
}

export interface CommonTopic {
  key: string;
  name: string;
  rank: ComparisonPair<number>;
  // Absent before mutual consent.
  watches: ComparisonPair<number> | null;
}

export interface CommonChannel {
  name: string;
  thumbnailUrl: string;
  rank: ComparisonPair<number>;
  watches: ComparisonPair<number>;
}

export interface CommonVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  rank: ComparisonPair<number>;
  watches: ComparisonPair<number>;
}

export type ComparisonListState = 'unlocked' | 'locked' | 'hidden';

export interface ComparisonList<T> {
  state: ComparisonListState;
  items: T[];
  // Full intersection size; equals items.length while locked so the
  // locked page never becomes a counting oracle.
  total: number;
}

// 'share': each value is that person's fraction of their own total (0..1),
// so rhythm is comparable without revealing volume. 'absolute': raw counts
// and estimated seconds.
export type ComparisonValueMode = 'share' | 'absolute';

export interface ComparisonClockSide {
  reliable: boolean;
  watches: number[];
  seconds: number[];
}

export interface ComparisonWeekdayRow {
  weekday: number;
  watches: ComparisonPair<number>;
  seconds: ComparisonPair<number>;
}

export interface ComparisonWatchEdge {
  title: string;
  watchedAt: string;
}

export interface WatchComparison {
  range: ComparisonRange;
  connected: boolean;
  channelsAllowed: boolean;
  // Clock and weekday sections are withheld (locked pair, one person opted out).
  rhythmHidden: boolean;
  empty: ComparisonPair<boolean>;
  stats: ComparisonStatRow[] | null;
  topics: ComparisonList<CommonTopic>;
  channels: ComparisonList<CommonChannel>;
  videos: ComparisonList<CommonVideo>;
  clock: { mode: ComparisonValueMode } & ComparisonPair<ComparisonClockSide>;
  weekdays: { mode: ComparisonValueMode; rows: ComparisonWeekdayRow[] };
  firstWatch: ComparisonPair<ComparisonWatchEdge | null> | null;
  lastWatch: ComparisonPair<ComparisonWatchEdge | null> | null;
}

const TOPIC_NAMES = new Map(MATCHING_TAXONOMY.topics.map((topic) => [topic.key, topic.name]));

function statRows(a: YoutubeComparisonProfile, b: YoutubeComparisonProfile): ComparisonStatRow[] {
  const minutes = (profile: YoutubeComparisonProfile) => Math.round(profile.stats.estimatedWatchSeconds / 60);
  const hours = (profile: YoutubeComparisonProfile) => Math.round(profile.stats.estimatedWatchSeconds / 3600);
  return [
    { key: 'watchEvents', a: a.stats.watchEvents, b: b.stats.watchEvents },
    { key: 'minutes', a: minutes(a), b: minutes(b) },
    { key: 'hours', a: hours(a), b: hours(b) },
    { key: 'uniqueVideos', a: a.stats.uniqueVideos, b: b.stats.uniqueVideos },
    { key: 'uniqueChannels', a: a.stats.uniqueChannels, b: b.stats.uniqueChannels },
    { key: 'activeDays', a: a.stats.activeDays, b: b.stats.activeDays },
  ];
}

function byRank<T extends { rank: ComparisonPair<number> }>(items: T[]): T[] {
  return items.sort((x, y) => x.rank.a - y.rank.a || x.rank.b - y.rank.b);
}

function commonTopics(
  a: YoutubeComparisonProfile,
  b: YoutubeComparisonProfile,
  access: ComparisonAccess,
): ComparisonList<CommonTopic> {
  const bByKey = new Map(b.topics.map((topic) => [topic.key, topic]));
  const items = byRank(a.topics.flatMap((topic) => {
    const other = bByKey.get(topic.key);
    const name = TOPIC_NAMES.get(topic.key);
    if (!other || !name || access.hiddenTopicKeys.has(topic.key)) return [];
    return [{
      key: topic.key,
      name,
      rank: { a: topic.rank, b: other.rank },
      watches: access.connected ? { a: topic.watches, b: other.watches } : null,
    }];
  }));
  if (access.connected) return { state: 'unlocked', items, total: items.length };
  const visible = items.slice(0, COMPARISON_LOCKED_TOPIC_LIMIT);
  return { state: 'locked', items: visible, total: visible.length };
}

function listState(access: ComparisonAccess): ComparisonListState {
  if (!access.connected) return 'locked';
  return access.channelsAllowed ? 'unlocked' : 'hidden';
}

function commonChannels(
  a: YoutubeComparisonProfile,
  b: YoutubeComparisonProfile,
  access: ComparisonAccess,
): ComparisonList<CommonChannel> {
  const state = listState(access);
  if (state !== 'unlocked') return { state, items: [], total: 0 };
  const bByKey = new Map(b.channels.map((channel) => [channel.key, channel]));
  const items = byRank(a.channels.flatMap((channel) => {
    const other = bByKey.get(channel.key);
    if (!other) return [];
    return [{
      name: channel.name,
      thumbnailUrl: channel.thumbnailUrl || other.thumbnailUrl,
      rank: { a: channel.rank, b: other.rank },
      watches: { a: channel.watches, b: other.watches },
    }];
  }));
  return { state, items: items.slice(0, COMPARISON_LIST_LIMIT), total: items.length };
}

function commonVideos(
  a: YoutubeComparisonProfile,
  b: YoutubeComparisonProfile,
  access: ComparisonAccess,
): ComparisonList<CommonVideo> {
  const state = listState(access);
  if (state !== 'unlocked') return { state, items: [], total: 0 };
  const bById = new Map(b.videos.map((video) => [video.videoId, video]));
  const items = byRank(a.videos.flatMap((video) => {
    const other = bById.get(video.videoId);
    if (!other) return [];
    return [{
      videoId: video.videoId,
      title: video.title,
      channelTitle: video.channelTitle || other.channelTitle,
      thumbnailUrl: video.thumbnailUrl || other.thumbnailUrl,
      rank: { a: video.rank, b: other.rank },
      watches: { a: video.watches, b: other.watches },
    }];
  }));
  return { state, items: items.slice(0, COMPARISON_LIST_LIMIT), total: items.length };
}

function normalized(values: number[], mode: ComparisonValueMode): number[] {
  if (mode === 'absolute') return values;
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => (total > 0 ? value / total : 0));
}

function clockSide(profile: YoutubeComparisonProfile, mode: ComparisonValueMode): ComparisonClockSide {
  const { exactWatches, dateOnlyWatches } = profile.rhythmCoverage;
  // A date-only backfill row sits at local noon for a stable calendar date;
  // it must never read as a midday habit. Same guard as the dashboard.
  const reliable = exactWatches > 0 && !(dateOnlyWatches > 0 && dateOnlyWatches >= exactWatches);
  const byHour = new Map(profile.hourly.map((entry) => [entry.hour, entry]));
  const watches = Array.from({ length: 24 }, (_, hour) => byHour.get(hour)?.watches ?? 0);
  const seconds = Array.from({ length: 24 }, (_, hour) => byHour.get(hour)?.estimatedWatchSeconds ?? 0);
  return {
    reliable,
    watches: reliable ? normalized(watches, mode) : [],
    seconds: reliable ? normalized(seconds, mode) : [],
  };
}

function weekdayRows(
  a: YoutubeComparisonProfile,
  b: YoutubeComparisonProfile,
  mode: ComparisonValueMode,
): ComparisonWeekdayRow[] {
  const series = (profile: YoutubeComparisonProfile) => {
    const byDay = new Map(profile.weekdays.map((entry) => [entry.weekday, entry]));
    return {
      watches: normalized(Array.from({ length: 7 }, (_, day) => byDay.get(day)?.watches ?? 0), mode),
      seconds: normalized(Array.from({ length: 7 }, (_, day) => byDay.get(day)?.estimatedWatchSeconds ?? 0), mode),
    };
  };
  const left = series(a);
  const right = series(b);
  // Monday first, Sunday last, as people read a week.
  return [1, 2, 3, 4, 5, 6, 0].map((weekday) => ({
    weekday,
    watches: { a: left.watches[weekday]!, b: right.watches[weekday]! },
    seconds: { a: left.seconds[weekday]!, b: right.seconds[weekday]! },
  }));
}

export function compareWatchProfiles(
  a: YoutubeComparisonProfile,
  b: YoutubeComparisonProfile,
  range: ComparisonRange,
  access: ComparisonAccess,
): WatchComparison {
  const mode: ComparisonValueMode = access.connected ? 'absolute' : 'share';
  return {
    range,
    connected: access.connected,
    channelsAllowed: access.channelsAllowed,
    rhythmHidden: !access.connected && !access.rhythmAllowed,
    empty: { a: a.stats.watchEvents === 0, b: b.stats.watchEvents === 0 },
    stats: access.connected ? statRows(a, b) : null,
    topics: commonTopics(a, b, access),
    channels: commonChannels(a, b, access),
    videos: commonVideos(a, b, access),
    clock: { mode, a: clockSide(a, mode), b: clockSide(b, mode) },
    weekdays: { mode, rows: weekdayRows(a, b, mode) },
    // Edges name a video, so they follow the same rule as the video list.
    firstWatch: access.connected && access.channelsAllowed ? { a: a.firstWatch, b: b.firstWatch } : null,
    lastWatch: access.connected && access.channelsAllowed ? { a: a.lastWatch, b: b.lastWatch } : null,
  };
}
