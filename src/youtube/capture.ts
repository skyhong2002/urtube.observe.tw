import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  MAX_YOUTUBE_DURATION_SECONDS,
  type YoutubeCapturedWatch,
} from './types.js';

const captureSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  title: z.string().trim().min(1).max(500),
  url: z.string().url().max(2000),
  channelTitle: z.string().trim().min(1).max(200).nullable().optional(),
  watchedAt: z.string().datetime({ offset: true }),
  actualWatchedSeconds: z.number().int().min(5).max(86_400),
  durationSeconds: z.number().int().min(1).max(MAX_YOUTUBE_DURATION_SECONDS).nullable().optional(),
}).strict();

function canonicalYoutubeUrl(raw: string, videoId: string): string {
  const url = new URL(raw);
  const host = url.hostname.toLocaleLowerCase('en-US');
  if (host !== 'youtube.com' && host !== 'www.youtube.com' && host !== 'm.youtube.com') {
    throw new Error('Capture URL must use youtube.com');
  }
  if (url.pathname !== '/watch' || url.searchParams.get('v') !== videoId) {
    throw new Error('Capture URL video does not match videoId');
  }
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

export function normalizeYoutubeCapture(
  value: unknown,
  now = new Date(),
): YoutubeCapturedWatch {
  const parsed = captureSchema.parse(value);
  const watchedAt = new Date(parsed.watchedAt);
  if (watchedAt.getTime() > now.getTime() + 5 * 60_000) {
    throw new Error('Capture time is too far in the future');
  }
  if (watchedAt.getTime() < now.getTime() - 90 * 86_400_000) {
    throw new Error('Capture time is older than 90 days');
  }
  const eventId = createHash('sha256')
    .update(`extension\u001f${parsed.sessionId}`)
    .digest('hex');
  return {
    eventId,
    videoId: parsed.videoId,
    title: parsed.title,
    url: canonicalYoutubeUrl(parsed.url, parsed.videoId),
    channelId: null,
    channelTitle: parsed.channelTitle ?? null,
    channelUrl: null,
    watchedAt: watchedAt.toISOString(),
    actualWatchedSeconds: parsed.actualWatchedSeconds,
    activityType: 'video',
    durationSeconds: parsed.durationSeconds ?? null,
  };
}
