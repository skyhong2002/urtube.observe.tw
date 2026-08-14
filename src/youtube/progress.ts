import { z } from 'zod';
import {
  MAX_YOUTUBE_DURATION_SECONDS,
  type YoutubeProgressBatchInput,
  type YoutubeProgressInput,
} from './types.js';

const itemSchema = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  progressPercent: z.number().min(0).max(100).nullable(),
  resumeSeconds: z.number().int().min(0).max(MAX_YOUTUBE_DURATION_SECONDS).nullable(),
  durationSeconds: z.number().int().min(1).max(MAX_YOUTUBE_DURATION_SECONDS).nullable(),
}).strict().refine(
  (item) => item.progressPercent !== null || item.resumeSeconds !== null,
  'A progress percentage or resume position is required',
);

const batchSchema = z.object({
  scanId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  observedAt: z.string().datetime({ offset: true }),
  complete: z.boolean(),
  items: z.array(itemSchema).max(250),
}).strict();

export function normalizeYoutubeProgressBatch(
  value: unknown,
  now = new Date(),
): YoutubeProgressBatchInput {
  const parsed = batchSchema.parse(value);
  const observedAt = new Date(parsed.observedAt);
  if (observedAt.getTime() > now.getTime() + 5 * 60_000) {
    throw new Error('Progress observation time is too far in the future');
  }
  if (observedAt.getTime() < now.getTime() - 24 * 60 * 60_000) {
    throw new Error('Progress observation time is older than 24 hours');
  }
  const items = [...new Map(parsed.items.map((item) => [item.videoId, item])).values()]
    .map((item) => ({
      ...item,
      resumeSeconds: item.resumeSeconds === null || item.durationSeconds === null
        ? item.resumeSeconds
        : Math.min(item.resumeSeconds, item.durationSeconds),
    }));
  return {
    scanId: parsed.scanId,
    observedAt: observedAt.toISOString(),
    complete: parsed.complete,
    items,
  };
}

export function progressSeconds(item: YoutubeProgressInput): number | null {
  if (item.resumeSeconds !== null && item.resumeSeconds > 0) return item.resumeSeconds;
  if (item.progressPercent === null || item.durationSeconds === null) return null;
  return Math.min(
    item.durationSeconds,
    Math.max(0, Math.round(item.durationSeconds * item.progressPercent / 100)),
  );
}
