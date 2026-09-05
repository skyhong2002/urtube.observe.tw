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
export const DEFAULT_COMPARISON_RANGE: ComparisonRange = '365d';

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
  // clock/weekday values, and first/last watch. Joining matching is the
  // only other switch, so there is no finer per-section gating.
  connected: boolean;
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

// Every common item carries both people's numbers under both metrics and a
// symmetric "blend" score per metric: the geometric mean of the two shares
// (sqrt(shareA * shareB)). Ordering by blend puts what both people watch a
// lot at the top and gives the two people the identical list, only mirrored.
export interface CommonMeasure {
  rank: ComparisonPair<number>;
  value: ComparisonPair<number>;
  blend: number;
}

export interface CommonItemMeasures {
  seconds: CommonMeasure;
  watches: CommonMeasure;
}

export interface CommonTopic extends CommonItemMeasures {
  key: string;
  name: string;
  // Locked comparisons keep ranks only; values are zeroed.
  valuesVisible: boolean;
}

export interface CommonChannel extends CommonItemMeasures {
  key: string;
  name: string;
  thumbnailUrl: string;
}

export interface CommonVideo extends CommonItemMeasures {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
}

export type ComparisonListState = 'unlocked' | 'locked';

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
  empty: ComparisonPair<boolean>;
  stats: ComparisonStatRow[] | null;
  topics: ComparisonList<CommonTopic>;
  channels: ComparisonList<CommonChannel>;
  shortsChannels: ComparisonList<CommonChannel>;
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

interface RankedSource {
  rank: number;
  watchRank: number;
  watches: number;
  estimatedWatchSeconds: number;
}

function measures(
  left: RankedSource,
  right: RankedSource,
  a: YoutubeComparisonProfile,
  b: YoutubeComparisonProfile,
): CommonItemMeasures {
  const share = (value: number, total: number) => (total > 0 ? value / total : 0);
  const blend = (x: number, y: number) => Math.sqrt(x * y);
  return {
    seconds: {
      rank: { a: left.rank, b: right.rank },
      value: { a: left.estimatedWatchSeconds, b: right.estimatedWatchSeconds },
      blend: blend(
        share(left.estimatedWatchSeconds, a.stats.estimatedWatchSeconds),
        share(right.estimatedWatchSeconds, b.stats.estimatedWatchSeconds),
      ),
    },
    watches: {
      rank: { a: left.watchRank, b: right.watchRank },
      value: { a: left.watches, b: right.watches },
      blend: blend(share(left.watches, a.stats.watchEvents), share(right.watches, b.stats.watchEvents)),
    },
  };
}

// Lists are delivered in watch-time blend order; the page re-sorts for the
// watch-count metric client-side using the same blend field.
function byBlend<T extends CommonItemMeasures>(items: T[]): T[] {
  return items.sort((x, y) => y.seconds.blend - x.seconds.blend
    || (x.seconds.rank.a + x.seconds.rank.b) - (y.seconds.rank.a + y.seconds.rank.b));
}

function commonTopics(
  a: YoutubeComparisonProfile,
  b: YoutubeComparisonProfile,
  access: ComparisonAccess,
): ComparisonList<CommonTopic> {
  const bByKey = new Map(b.topics.map((topic) => [topic.key, topic]));
  const items = byBlend(a.topics.flatMap((topic) => {
    const other = bByKey.get(topic.key);
    const name = TOPIC_NAMES.get(topic.key);
    if (!other || !name) return [];
    const item = { key: topic.key, name, valuesVisible: access.connected, ...measures(topic, other, a, b) };
    if (!access.connected) {
      item.seconds.value = { a: 0, b: 0 };
      item.watches.value = { a: 0, b: 0 };
    }
    return [item];
  }));
  if (access.connected) return { state: 'unlocked', items, total: items.length };
  const visible = items.slice(0, COMPARISON_LOCKED_TOPIC_LIMIT);
  return { state: 'locked', items: visible, total: visible.length };
}

function listState(access: ComparisonAccess): ComparisonListState {
  return access.connected ? 'unlocked' : 'locked';
}

function commonChannelList(
  left: YoutubeComparisonProfile['channels'],
  right: YoutubeComparisonProfile['channels'],
  a: YoutubeComparisonProfile,
  b: YoutubeComparisonProfile,
  access: ComparisonAccess,
): ComparisonList<CommonChannel> {
  const state = listState(access);
  if (state !== 'unlocked') return { state, items: [], total: 0 };
  const rightByKey = new Map(right.map((channel) => [channel.key, channel]));
  const items = byBlend(left.flatMap((channel) => {
    const other = rightByKey.get(channel.key);
    if (!other) return [];
    return [{
      key: channel.key,
      name: channel.name,
      thumbnailUrl: channel.thumbnailUrl || other.thumbnailUrl,
      ...measures(channel, other, a, b),
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
  const items = byBlend(a.videos.flatMap((video) => {
    const other = bById.get(video.videoId);
    if (!other) return [];
    return [{
      videoId: video.videoId,
      title: video.title,
      channelTitle: video.channelTitle || other.channelTitle,
      thumbnailUrl: video.thumbnailUrl || other.thumbnailUrl,
      ...measures(video, other, a, b),
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
    const values = (key: 'watches' | 'estimatedWatchSeconds') => {
      const totals = Array.from({ length: 7 }, (_, day) => byDay.get(day)?.[key] ?? 0);
      // Locked comparisons keep shares only; denominators never cross the
      // consent boundary. Unlocked values are average daily volume.
      return mode === 'share' ? normalized(totals, mode)
        : totals.map((total, day) => profile.weekdayDays[day]! > 0 ? total / profile.weekdayDays[day]! : 0);
    };
    return { watches: values('watches'), seconds: values('estimatedWatchSeconds') };
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
    empty: { a: a.stats.watchEvents === 0, b: b.stats.watchEvents === 0 },
    stats: access.connected ? statRows(a, b) : null,
    topics: commonTopics(a, b, access),
    channels: commonChannelList(a.channels, b.channels, a, b, access),
    shortsChannels: commonChannelList(a.shortsChannels, b.shortsChannels, a, b, access),
    videos: commonVideos(a, b, access),
    clock: { mode, a: clockSide(a, mode), b: clockSide(b, mode) },
    weekdays: { mode, rows: weekdayRows(a, b, mode) },
    firstWatch: access.connected ? { a: a.firstWatch, b: b.firstWatch } : null,
    lastWatch: access.connected ? { a: a.lastWatch, b: b.lastWatch } : null,
  };
}
