import { createHash } from 'node:crypto';
import { z } from 'zod';
import { encryptPrivateValue } from './crypto.js';
import {
  MAX_YOUTUBE_DURATION_SECONDS,
  type YoutubeParsedArchive,
  type YoutubeSearchInput,
  type YoutubeWatchInput,
} from './types.js';

const videoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const timestamp = z.string().datetime({ offset: true });

const watchEvent = z.object({
  kind: z.literal('watch'),
  occurredAt: timestamp,
  videoId: videoId.nullable(),
  title: z.string().trim().min(1).max(500),
  url: z.string().url().max(2000),
  channelId: z.string().trim().min(1).max(200).nullable().optional(),
  channelTitle: z.string().trim().min(1).max(200).nullable().optional(),
  durationSeconds: z.number().int().min(1).max(MAX_YOUTUBE_DURATION_SECONDS).nullable().optional(),
  activityType: z.enum(['video', 'post', 'other']),
}).strict();

const searchEvent = z.object({
  kind: z.literal('search'),
  occurredAt: timestamp,
  query: z.string().trim().min(1).max(500),
  activityType: z.enum(['search', 'visit', 'other']).default('search'),
}).strict();

const batchSchema = z.object({
  syncId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  observedAt: timestamp,
  events: z.array(z.discriminatedUnion('kind', [watchEvent, searchEvent])).max(250),
}).strict();

function stableId(kind: string, identity: string, time: string): string {
  return createHash('sha256')
    .update(`${kind}\u001f${identity}\u001f${time}`)
    .digest('hex');
}

function canonicalYoutubeUrl(raw: string, expectedVideoId: string | null): string {
  const url = new URL(raw);
  const hostname = url.hostname.toLocaleLowerCase('en-US');
  if (hostname !== 'youtube.com' && hostname !== 'www.youtube.com' && hostname !== 'm.youtube.com') {
    throw new Error('History URL must use youtube.com');
  }
  if (expectedVideoId) {
    if (url.pathname !== '/watch' || url.searchParams.get('v') !== expectedVideoId) {
      throw new Error('History URL video does not match videoId');
    }
    return `https://www.youtube.com/watch?v=${encodeURIComponent(expectedVideoId)}`;
  }
  if (!/^\/post\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
    throw new Error('Non-video history URL must be a YouTube post');
  }
  return `https://www.youtube.com${url.pathname}`;
}

function validEventTime(value: string, now: Date): string {
  const date = new Date(value);
  if (date.getTime() > now.getTime() + 5 * 60_000) {
    throw new Error('History event time is too far in the future');
  }
  if (date.getTime() < now.getTime() - 90 * 86_400_000) {
    throw new Error('History event time is older than 90 days');
  }
  return date.toISOString();
}

export function normalizeYoutubeHistoryBatch(
  value: unknown,
  secret: string,
  now = new Date(),
): YoutubeParsedArchive {
  if (secret.length < 32) {
    throw new Error('YOUTUBE_PRIVATE_DATA_KEY must contain at least 32 characters');
  }
  const parsed = batchSchema.parse(value);
  const observedAt = new Date(parsed.observedAt);
  if (observedAt.getTime() > now.getTime() + 5 * 60_000) {
    throw new Error('History observation time is too far in the future');
  }
  if (observedAt.getTime() < now.getTime() - 24 * 60 * 60_000) {
    throw new Error('History observation time is older than 24 hours');
  }

  const watches: YoutubeWatchInput[] = [];
  const searches: YoutubeSearchInput[] = [];
  for (const event of parsed.events) {
    const occurredAt = validEventTime(event.occurredAt, now);
    if (event.kind === 'search') {
      searches.push({
        eventId: stableId('search', event.query, occurredAt),
        searchedAt: occurredAt,
        queryCiphertext: encryptPrivateValue(event.query, secret),
        activityType: event.activityType,
      });
      continue;
    }
    const url = canonicalYoutubeUrl(event.url, event.videoId);
    watches.push({
      eventId: stableId('watch', event.videoId ?? url, occurredAt),
      videoId: event.videoId,
      title: event.title,
      url,
      channelId: event.channelId ?? null,
      channelTitle: event.channelTitle ?? null,
      channelUrl: event.channelId
        ? `https://www.youtube.com/channel/${encodeURIComponent(event.channelId)}`
        : null,
      watchedAt: occurredAt,
      actualWatchedSeconds: null,
      durationSeconds: event.durationSeconds ?? null,
      activityType: event.activityType,
    });
  }
  const eventIds = [...watches.map((event) => event.eventId), ...searches.map((event) => event.eventId)]
    .sort();
  return {
    archiveHash: createHash('sha256')
      .update(`extension\u001f${parsed.syncId}\u001f${eventIds.join('\u001f')}`)
      .digest('hex'),
    source: 'extension',
    watches,
    searches,
  };
}
