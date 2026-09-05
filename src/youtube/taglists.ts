import { createHash } from 'node:crypto';
import { config } from '../config.js';
import type { YoutubeChannelSummary, YoutubeRange } from './types.js';

export const TAG_POLICY = {
  version: '2026-09-05',
  url: 'https://github.com/skyhong2002/urtube.observe.tw/blob/main/docs/channel-tag-policy.md',
  reportUrl: 'https://github.com/skyhong2002/urtube.observe.tw/issues/new',
} as const;

interface TagGroupDefinition {
  names: { en: string; zh: string };
  axis: 'content' | 'political';
  query: string;
  description: string;
  policyVersion: string;
  source: string;
}

// Keys and queries are governed definitions, never inferred from viewing data.
// Commas mean intersection; `not` excludes any of the listed upstream tags.
export const TAG_GROUPS = {
  news: {
    names: { en: 'News', zh: '新聞' }, axis: 'content', query: 'tagid=13',
    description: 'Channels carrying upstream news tag 13.',
    policyVersion: TAG_POLICY.version, source: 'analysis.tw channels_list: news tag',
  },
  editorial: {
    names: { en: 'Personal commentary', zh: '個人社論' }, axis: 'content',
    query: 'tagid=1&not=2,9,10,12,13,33,36,81',
    description: 'Tag 1 excluding shows, news, simplified-Chinese and curator-selected non-personal categories.',
    policyVersion: TAG_POLICY.version, source: 'analysis.tw maintainer: personal editorial definition',
  },
  editorialShows: {
    names: { en: 'Commentary shows', zh: '社論節目' }, axis: 'content', query: 'tagid=1,9',
    description: 'Channels carrying both upstream commentary tag 1 and show tag 9.',
    policyVersion: TAG_POLICY.version, source: 'analysis.tw channels_list: commentary/show intersection',
  },
  blue: {
    names: { en: 'Pan-Blue', zh: '泛藍' }, axis: 'political', query: 'tagid=3',
    description: 'Channels carrying upstream political tag 3.',
    policyVersion: TAG_POLICY.version, source: 'analysis.tw channels_list: political labels',
  },
  green: {
    names: { en: 'Pan-Green', zh: '泛綠' }, axis: 'political', query: 'tagid=4',
    description: 'Channels carrying upstream political tag 4.',
    policyVersion: TAG_POLICY.version, source: 'analysis.tw channels_list: political labels',
  },
  white: {
    names: { en: 'Pan-White', zh: '泛白' }, axis: 'political', query: 'tagid=6',
    description: 'Channels carrying upstream political tag 6.',
    policyVersion: TAG_POLICY.version, source: 'analysis.tw channels_list: political labels',
  },
  red: {
    names: { en: 'Pan-Red', zh: '泛紅' }, axis: 'political', query: 'tagid=5',
    description: 'Channels carrying upstream political tag 5.',
    policyVersion: TAG_POLICY.version, source: 'analysis.tw channels_list: political labels',
  },
} as const satisfies Record<string, TagGroupDefinition>;

export type TagGroupKey = keyof typeof TAG_GROUPS;
export type TagLists = Record<TagGroupKey, Set<string>>;
const ALL_KEYS = Object.keys(TAG_GROUPS) as TagGroupKey[];
export const CONTENT_KEYS = ALL_KEYS.filter((key) => TAG_GROUPS[key].axis === 'content');
export const POLITICAL_KEYS = ALL_KEYS.filter((key) => TAG_GROUPS[key].axis === 'political');

export interface TagListProvenance {
  sourceUrl: string;
  sourceUpdatedAt: string;
  fetchedAt: string;
  membershipVersion: string;
  policyVersion: string;
  policyUrl: string;
  reportUrl: string;
}

export interface TagListSnapshot {
  lists: TagLists;
  provenance: TagListProvenance;
}

// A verified fetched copy can be reused briefly. Once it expires, failure to
// refresh fails closed so an old political classification is never presented
// as current.
const TAG_LISTS_TTL_MS = 6 * 3600_000;
let cached: { at: number; snapshot: TagListSnapshot } | null = null;
let pending: Promise<TagListSnapshot> | null = null;

function isSourceTime(value: unknown): value is string {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return false;
  const iso = `${value.replace(' ', 'T')}Z`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === iso.slice(0, 19);
}

function isChannelRow(value: unknown): value is { youtube_id: string } {
  return typeof value === 'object'
    && value !== null
    && 'youtube_id' in value
    && typeof value.youtube_id === 'string'
    && /^UC[A-Za-z0-9_-]{22}$/.test(value.youtube_id);
}

async function fetchList(definition: TagGroupDefinition): Promise<{ ids: Set<string>; sourceUpdatedAt: string }> {
  if ([definition.query, definition.description, definition.source, definition.policyVersion,
    definition.names.en, definition.names.zh].some((value) => !value.trim())) {
    throw new Error('tag list: missing governed definition');
  }
  const { query } = definition;
  const response = await fetch(`${config.tagListsUrl}?${query}`, {
    headers: { 'User-Agent': config.userAgent },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`tag list ${query}: HTTP ${response.status}`);
  const body = await response.json() as { result?: unknown; time?: unknown };
  if (!Array.isArray(body.result)
    || !body.result.every(isChannelRow)
    || !isSourceTime(body.time)) {
    throw new Error(`tag list ${query}: unexpected payload`);
  }
  return {
    ids: new Set(body.result.map((channel) => channel.youtube_id)),
    sourceUpdatedAt: body.time,
  };
}

function membershipVersion(lists: TagLists): string {
  const rows = ALL_KEYS.flatMap((key) =>
    [...lists[key]].sort().map((channelId) => `${key}:${channelId}`));
  return `sha256:${createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 12)}`;
}

export async function fetchTagLists(now = Date.now()): Promise<TagListSnapshot> {
  if (cached && now - cached.at < TAG_LISTS_TTL_MS) return cached.snapshot;
  if (!pending) {
    pending = (async () => {
      const responses = await Promise.all(ALL_KEYS.map((key) => fetchList(TAG_GROUPS[key])));
      const lists = Object.fromEntries(
        ALL_KEYS.map((key, index) => [key, responses[index].ids]),
      ) as TagLists;
      const snapshot = {
        lists,
        provenance: {
          sourceUrl: config.tagListsUrl,
          sourceUpdatedAt: responses
            .map((response) => response.sourceUpdatedAt)
            .sort()
            .at(-1)!,
          fetchedAt: new Date(now).toISOString(),
          membershipVersion: membershipVersion(lists),
          policyVersion: TAG_POLICY.version,
          policyUrl: TAG_POLICY.url,
          reportUrl: TAG_POLICY.reportUrl,
        },
      };
      cached = { at: now, snapshot };
      return snapshot;
    })().finally(() => { pending = null; });
  }
  return pending;
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
  provenance: TagListProvenance;
  totals: { watches: number; estimatedWatchSeconds: number; channels: number };
  matched: { watches: number; estimatedWatchSeconds: number; channels: number };
  unmatched: { estimatedWatchSeconds: number; channels: number; topChannels: YoutubeChannelSummary[] };
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
  snapshot: TagListSnapshot,
  now = new Date(),
): TagLeanData {
  const { lists } = snapshot;
  const totals = { watches: 0, estimatedWatchSeconds: 0, channels: channels.length };
  const matched = { watches: 0, estimatedWatchSeconds: 0, channels: 0 };
  const unmatched: YoutubeChannelSummary[] = [];
  for (const channel of channels) {
    totals.watches += channel.watches;
    totals.estimatedWatchSeconds += channel.estimatedWatchSeconds;
    if (channel.channelId && ALL_KEYS.some((key) => lists[key].has(channel.channelId!))) {
      matched.watches += channel.watches;
      matched.estimatedWatchSeconds += channel.estimatedWatchSeconds;
      matched.channels += 1;
    } else {
      unmatched.push(channel);
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
    provenance: snapshot.provenance,
    totals,
    matched,
    unmatched: {
      estimatedWatchSeconds: totals.estimatedWatchSeconds - matched.estimatedWatchSeconds,
      channels: unmatched.length,
      topChannels: unmatched.sort((a, b) => b.estimatedWatchSeconds - a.estimatedWatchSeconds
        || b.watches - a.watches
        || (a.channelId ?? a.name).localeCompare(b.channelId ?? b.name, 'en')).slice(0, 10),
    },
    content: CONTENT_KEYS.map(group),
    political: POLITICAL_KEYS.map(group),
  };
}
