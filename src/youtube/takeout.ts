import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { unzipSync, type UnzipFileInfo } from 'fflate';
import { encryptPrivateValue } from './crypto.js';
import type { YoutubeParsedArchive, YoutubeSearchInput, YoutubeWatchInput } from './types.js';

export const MAX_YOUTUBE_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;
const WATCH_JSON_SUFFIX = '/history/watch-history.json';
const SEARCH_JSON_SUFFIX = '/history/search-history.json';
const WATCH_HTML_SUFFIX = '/history/watch-history.html';
const SEARCH_HTML_SUFFIX = '/history/search-history.html';
const HTML_MONTHS = new Map([
  ['Jan', 0], ['Feb', 1], ['Mar', 2], ['Apr', 3], ['May', 4], ['Jun', 5],
  ['Jul', 6], ['Aug', 7], ['Sep', 8], ['Oct', 9], ['Nov', 10], ['Dec', 11],
]);
const HTML_TIMEZONE_OFFSETS = new Map([
  ['UTC', 0], ['GMT', 0],
  // Google labels Asia/Taipei exports as CST, meaning China Standard Time.
  ['CST', 8 * 60], ['JST', 9 * 60], ['KST', 9 * 60],
  ['PST', -8 * 60], ['PDT', -7 * 60],
  ['MST', -7 * 60], ['MDT', -6 * 60],
  ['EST', -5 * 60], ['EDT', -4 * 60],
  ['CET', 60], ['CEST', 2 * 60], ['BST', 60],
]);

export interface YoutubeArchiveLimits {
  maxArchiveBytes?: number;
  maxUncompressedBytes?: number;
}

interface TakeoutSubtitle { name?: unknown; url?: unknown }
interface TakeoutActivity {
  header?: unknown;
  title?: unknown;
  titleUrl?: unknown;
  subtitles?: unknown;
  time?: unknown;
  products?: unknown;
  activityControls?: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validTime(value: unknown): string | null {
  const raw = text(value);
  const date = new Date(raw);
  return raw && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function htmlTime(value: string): string | null {
  const match = value.match(
    /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}):(\d{2}) (AM|PM) ([A-Z]{2,5}|GMT[+-]\d{1,2}(?::?\d{2})?)$/,
  );
  if (!match) return null;
  const month = HTML_MONTHS.get(match[1]);
  if (month === undefined) return null;
  const zone = match[8];
  let offsetMinutes = HTML_TIMEZONE_OFFSETS.get(zone);
  if (offsetMinutes === undefined && zone.startsWith('GMT')) {
    const offset = zone.slice(3).match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (offset) {
      offsetMinutes = (Number(offset[2]) * 60 + Number(offset[3] ?? 0))
        * (offset[1] === '+' ? 1 : -1);
    }
  }
  if (offsetMinutes === undefined) return null;
  const hour = Number(match[4]) % 12 + (match[7] === 'PM' ? 12 : 0);
  const timestamp = Date.UTC(
    Number(match[3]), month, Number(match[2]), hour,
    Number(match[5]), Number(match[6]),
  ) - offsetMinutes * 60_000;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function videoIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be') return url.pathname.slice(1) || null;
    if (url.hostname.endsWith('youtube.com')) return url.searchParams.get('v');
  } catch {
    return null;
  }
  return null;
}

function channelIdFromUrl(value: string): string | null {
  try {
    const match = new URL(value).pathname.match(/^\/channel\/([^/]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function stableId(kind: string, identity: string, time: string): string {
  return createHash('sha256').update(`${kind}\u001f${identity}\u001f${time}`).digest('hex');
}

function subtitles(value: unknown): TakeoutSubtitle[] {
  return Array.isArray(value) ? value.filter((item): item is TakeoutSubtitle => Boolean(item && typeof item === 'object')) : [];
}

export function parseWatchActivities(items: unknown[]): YoutubeWatchInput[] {
  const watches: YoutubeWatchInput[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as TakeoutActivity;
    const watchedAt = validTime(item.time);
    const rawTitle = text(item.title);
    const controls = Array.isArray(item.activityControls) ? item.activityControls.map(text) : [];
    const activityType = /^Watched\s+/i.test(rawTitle)
      ? 'video'
      : /^Viewed\s+/i.test(rawTitle) || /\/post\//.test(text(item.titleUrl))
      ? 'post'
      : 'other';
    if (!watchedAt || (!controls.includes('YouTube watch history') && activityType === 'other')) continue;
    const url = text(item.titleUrl);
    const videoId = activityType === 'video' ? videoIdFromUrl(url) : null;
    const subtitle = subtitles(item.subtitles)[0];
    const channelTitle = text(subtitle?.name) || null;
    const channelUrl = text(subtitle?.url) || null;
    const title = rawTitle.replace(/^(Watched|Viewed)\s+/i, '').trim()
      || (activityType === 'video' ? 'Unavailable video' : 'YouTube activity');
    watches.push({
      eventId: stableId('watch', videoId ?? (url || title), watchedAt),
      videoId,
      title,
      url,
      channelId: channelUrl ? channelIdFromUrl(channelUrl) : null,
      channelTitle,
      channelUrl,
      watchedAt,
      actualWatchedSeconds: null,
      activityType,
    });
  }
  return watches;
}

export function parseSearchActivities(items: unknown[], secret: string): YoutubeSearchInput[] {
  const searches: YoutubeSearchInput[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as TakeoutActivity;
    const searchedAt = validTime(item.time);
    const rawTitle = text(item.title);
    const controls = Array.isArray(item.activityControls) ? item.activityControls.map(text) : [];
    const activityType = /^Searched for\s+/i.test(rawTitle)
      ? 'search'
      : /^Visited\s+/i.test(rawTitle)
      ? 'visit'
      : 'other';
    if (!searchedAt || (!controls.includes('YouTube search history') && activityType === 'other')) continue;
    const query = rawTitle.replace(/^Searched for\s+/i, '').trim();
    if (!query) continue;
    searches.push({
      eventId: stableId('search', query, searchedAt),
      searchedAt,
      queryCiphertext: encryptPrivateValue(query, secret),
      activityType,
    });
  }
  return searches;
}

function parseJson(bytes: Uint8Array, name: string): unknown[] {
  const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${name} must contain a JSON array`);
  return parsed;
}

function parseHtml(bytes: Uint8Array, name: string): TakeoutActivity[] {
  const $ = cheerio.load(Buffer.from(bytes).toString('utf8'));
  const items: TakeoutActivity[] = [];
  $('.outer-cell').each((_, element) => {
    const content = $(element).find('.content-cell');
    if (!content.length) return;
    const directText = content.contents()
      .filter((__, node) => node.type === 'text')
      .map((__, node) => $(node).text().replace(/\s+/g, ' ').trim())
      .get()
      .filter(Boolean);
    const action = directText[0] ?? '';
    const time = directText.map(htmlTime).find((value): value is string => Boolean(value));
    if (!action || !time) return;
    const anchors = content.find('a').map((__, anchor) => ({
      name: $(anchor).text().replace(/\s+/g, ' ').trim(),
      url: $(anchor).attr('href')?.trim() ?? '',
    })).get();
    const activityLinks = anchors.filter(({ url }) => {
      try {
        return new URL(url).hostname !== 'myaccount.google.com';
      } catch {
        return false;
      }
    });
    const target = activityLinks[0];
    const channel = activityLinks.slice(1).find(({ url }) => {
      try {
        return /^\/(?:channel\/|@)/.test(new URL(url).pathname);
      } catch {
        return false;
      }
    });
    const fullText = content.text();
    const activityControls = [
      ...(fullText.includes('YouTube watch history') ? ['YouTube watch history'] : []),
      ...(fullText.includes('YouTube search history') ? ['YouTube search history'] : []),
    ];
    const title = `${action}${target?.name ? ` ${target.name}` : ''}`.trim();
    items.push({
      header: 'YouTube',
      title,
      titleUrl: target?.url ?? '',
      subtitles: channel ? [{ name: channel.name, url: channel.url }] : [],
      time,
      products: ['YouTube'],
      activityControls,
    });
  });
  if (!items.length) throw new Error(`${name} contains no recognized activity records`);
  return items;
}

function safeArchiveEntry(name: string): boolean {
  if (name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
    throw new Error(`Unsafe archive entry: ${name}`);
  }
  const lower = `/${name.toLocaleLowerCase('en-US')}`;
  return lower.endsWith(WATCH_JSON_SUFFIX)
    || lower.endsWith(SEARCH_JSON_SUFFIX)
    || lower.endsWith(WATCH_HTML_SUFFIX)
    || lower.endsWith(SEARCH_HTML_SUFFIX)
    || (lower.includes('/my activity/youtube/') && (lower.endsWith('.json') || lower.endsWith('.html')));
}

export function parseYoutubeArchive(
  archive: Uint8Array,
  secret: string,
  source: YoutubeParsedArchive['source'] = 'takeout',
  limits: YoutubeArchiveLimits = {},
): YoutubeParsedArchive {
  if (secret.length < 32) throw new Error('YOUTUBE_PRIVATE_DATA_KEY must contain at least 32 characters');
  const maxArchiveBytes = limits.maxArchiveBytes ?? MAX_YOUTUBE_ARCHIVE_BYTES;
  const maxUncompressedBytes = limits.maxUncompressedBytes ?? MAX_UNCOMPRESSED_BYTES;
  if (archive.byteLength > maxArchiveBytes) throw new Error('YouTube archive exceeds compressed size limit');
  let declaredBytes = 0;
  const files = unzipSync(archive, {
    filter(file: UnzipFileInfo) {
      if (!safeArchiveEntry(file.name)) return false;
      declaredBytes += file.originalSize;
      if (declaredBytes > maxUncompressedBytes) throw new Error('YouTube archive exceeds uncompressed size limit');
      return true;
    },
  });
  let watches: YoutubeWatchInput[] = [];
  let searches: YoutubeSearchInput[] = [];
  for (const [name, bytes] of Object.entries(files)) {
    const lower = `/${name.toLocaleLowerCase('en-US')}`;
    const items = lower.endsWith('.html') ? parseHtml(bytes, name) : parseJson(bytes, name);
    if (lower.endsWith(WATCH_JSON_SUFFIX) || lower.endsWith(WATCH_HTML_SUFFIX)) {
      watches = watches.concat(parseWatchActivities(items));
    } else if (lower.endsWith(SEARCH_JSON_SUFFIX) || lower.endsWith(SEARCH_HTML_SUFFIX)) {
      searches = searches.concat(parseSearchActivities(items, secret));
    }
    else {
      watches = watches.concat(parseWatchActivities(items));
      searches = searches.concat(parseSearchActivities(items, secret));
    }
  }
  if (!watches.length && !searches.length) {
    throw new Error('Archive contains no recognized YouTube watch or search history');
  }
  return {
    archiveHash: createHash('sha256').update(archive).digest('hex'),
    source,
    watches,
    searches,
  };
}
