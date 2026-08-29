import { config } from '../config.js';
import type { YoutubeChannelSummary, YoutubeRange } from './types.js';

// Audience tag lists from the shared channels_list API. Two independent axes:
// content type (news / editorial, where "editorial shows" is the tagid=1,9
// intersection — channels carrying both tags) and political leaning. A channel
// can sit on both axes at once, so shares are computed per axis, never summed
// across them.
export const CONTENT_KEYS = ['news', 'editorial', 'editorialShows'] as const;
export const POLITICAL_KEYS = ['blue', 'green', 'white', 'red'] as const;
export type TagGroupKey = typeof CONTENT_KEYS[number] | typeof POLITICAL_KEYS[number];

export const TAG_GROUP_TAGIDS: Record<TagGroupKey, string> = {
  news: '13',
  editorial: '1',
  editorialShows: '1,9',
  blue: '3',
  green: '4',
  white: '6',
  red: '5',
};

export type TagLists = Record<TagGroupKey, Set<string>>;

const ALL_KEYS = [...CONTENT_KEYS, ...POLITICAL_KEYS] as TagGroupKey[];

// The lists change rarely (channel curation), so a fetched copy is reused for
// hours and kept as a stale fallback when the upstream API is unreachable —
// the leanings page should not go down with analysis.tw.
const TAG_LISTS_TTL_MS = 6 * 3600_000;
let cached: { at: number; lists: TagLists } | null = null;
let pending: Promise<TagLists> | null = null;

async function fetchList(tagids: string): Promise<Set<string>> {
  const response = await fetch(`${config.tagListsUrl}?tagid=${encodeURIComponent(tagids)}`, {
    headers: { 'User-Agent': config.userAgent },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`tag list ${tagids}: HTTP ${response.status}`);
  const body = await response.json() as { result?: Array<{ youtube_id?: string }> };
  if (!Array.isArray(body.result)) throw new Error(`tag list ${tagids}: unexpected payload`);
  return new Set(body.result
    .map((channel) => String(channel.youtube_id ?? ''))
    .filter((id) => id.startsWith('UC')));
}

export async function fetchTagLists(now = Date.now()): Promise<TagLists> {
  if (cached && now - cached.at < TAG_LISTS_TTL_MS) return cached.lists;
  if (!pending) {
    pending = (async () => {
      const sets = await Promise.all(ALL_KEYS.map((key) => fetchList(TAG_GROUP_TAGIDS[key])));
      const lists = Object.fromEntries(ALL_KEYS.map((key, index) => [key, sets[index]])) as TagLists;
      cached = { at: Date.now(), lists };
      return lists;
    })().finally(() => { pending = null; });
  }
  try {
    return await pending;
  } catch (error) {
    if (cached) return cached.lists; // stale beats down
    throw error;
  }
}

export function resetTagListsCache(): void {
  cached = null;
}

export interface TagLeanGroup {
  key: TagGroupKey;
  listSize: number;
  watchedChannels: number;
  watches: number;
  estimatedWatchSeconds: number;
  topChannels: YoutubeChannelSummary[];
}

export interface TagLeanData {
  range: YoutubeRange;
  generatedAt: string;
  totals: { watches: number; estimatedWatchSeconds: number; channels: number };
  matched: { watches: number; estimatedWatchSeconds: number; channels: number };
  content: TagLeanGroup[];
  political: TagLeanGroup[];
}

const TOP_CHANNELS_PER_GROUP = 5;

// Pure join of per-channel watch totals against the tag lists. Only rows with
// a channel_id can match; id-less rows still count toward the totals so the
// coverage share is honest about them.
export function computeTagLean(
  range: YoutubeRange,
  channels: YoutubeChannelSummary[],
  lists: TagLists,
  now = new Date(),
): TagLeanData {
  const totals = { watches: 0, estimatedWatchSeconds: 0, channels: channels.length };
  const matched = { watches: 0, estimatedWatchSeconds: 0, channels: 0 };
  for (const channel of channels) {
    totals.watches += channel.watches;
    totals.estimatedWatchSeconds += channel.estimatedWatchSeconds;
    if (channel.channelId && ALL_KEYS.some((key) => lists[key].has(channel.channelId!))) {
      matched.watches += channel.watches;
      matched.estimatedWatchSeconds += channel.estimatedWatchSeconds;
      matched.channels += 1;
    }
  }
  const group = (key: TagGroupKey): TagLeanGroup => {
    const rows = channels
      .filter((channel) => channel.channelId && lists[key].has(channel.channelId))
      .sort((a, b) => b.estimatedWatchSeconds - a.estimatedWatchSeconds || b.watches - a.watches);
    return {
      key,
      listSize: lists[key].size,
      watchedChannels: rows.length,
      watches: rows.reduce((sum, row) => sum + row.watches, 0),
      estimatedWatchSeconds: rows.reduce((sum, row) => sum + row.estimatedWatchSeconds, 0),
      topChannels: rows.slice(0, TOP_CHANNELS_PER_GROUP),
    };
  };
  return {
    range,
    generatedAt: now.toISOString(),
    totals,
    matched,
    content: CONTENT_KEYS.map(group),
    political: POLITICAL_KEYS.map(group),
  };
}
