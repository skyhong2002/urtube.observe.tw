import { createHash } from 'node:crypto';
import { z } from 'zod';

export const GENRES = ['Politic', 'Music', 'Sport', 'Education', 'Video gaming', 'Streaming', 'News', 'Podcast', 'channel type'] as const;
export type Genre = typeof GENRES[number];
export const CONTENT_GENRES = GENRES.slice(0, -1) as Exclude<Genre, 'channel type'>[];
export const CHANNEL_TYPES = ['personal creator', 'media team', 'educational institution', 'official brand', 'curated compilation'] as const;
export const genreSchema = z.enum(GENRES);
export const selectionSchema = z.array(genreSchema).min(1).max(9).refine(v => new Set(v).size === v.length);
export const normalizeTag = (text: string): string => text.normalize('NFKC').trim().replace(/^#+/, '').replace(/\s+/g, ' ').toLowerCase();
export const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type Settings = ReturnType<typeof settings>;
export function settings(env = process.env) {
  const baseUrl = (env.MATCHING_V3_BASE_URL || env.AI_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const apiKey = env.MATCHING_V3_API_KEY || env.AI_API_KEY || env.OPENAI_API_KEY || '';
  const embeddingBaseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  // Gemini has its own credential. Never reuse a GPT/gateway key here.
  const embeddingApiKey = env.GEMINI_API_KEY || '';
  const embeddingApiKeys = [...new Set((env.GEMINI_API_KEYS || embeddingApiKey).split(/[\s,]+/).map(key => key.trim()).filter(Boolean))];
  const number = (key: string, fallback: number, min: number, max: number) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
    return value;
  };
  return {
    enabled: env.MATCHING_V3_ENABLED === 'true',
    adminHandles: (env.MATCHING_V3_ADMIN_HANDLES ?? '').split(',').map(v => v.trim()).filter(Boolean),
    baseUrl, apiKey, embeddingBaseUrl, embeddingApiKey, embeddingApiKeys,
    classificationCacheNamespace: env.MATCHING_V3_CLASSIFICATION_CACHE_NAMESPACE || baseUrl,
    classificationModel: env.MATCHING_V3_CLASSIFICATION_MODEL || 'gpt-5.6-luna',
    embeddingModel: env.MATCHING_V3_EMBEDDING_MODEL || 'gemini-embedding-001',
    dimensions: Math.trunc(number('MATCHING_V3_DIMENSIONS', 768, 128, 3072)),
    task: 'SEMANTIC_SIMILARITY',
    eps: number('MATCHING_V3_EPS', 0.2, 0.001, 1),
    minSamples: Math.trunc(number('MATCHING_V3_MIN_SAMPLES', 5, 1, 1000)),
    minShare: number('MATCHING_V3_MIN_SHARE', 0.05, 0, 1),
    similarityFloor: number('MATCHING_V3_SIMILARITY_FLOOR', 0.7, 0, 0.999),
    computeUrl: env.MATCHING_V3_COMPUTE_URL ?? 'http://matching-compute:8090',
    computeToken: env.MATCHING_V3_COMPUTE_TOKEN ?? '',
    backfillVideoLimit: (() => { const n = number('MATCHING_V3_BACKFILL_VIDEO_LIMIT', 2000, 1, 1000000); if (!Number.isInteger(n)) throw new Error('Invalid MATCHING_V3_BACKFILL_VIDEO_LIMIT'); return n; })(),
    concurrency: Math.trunc(number('MATCHING_V3_CONCURRENCY', 4, 1, 10000)),
    callsPerCycle: number('MATCHING_V3_CALLS_PER_CYCLE', 20, 0, 100000),
    dailyApiCalls: Math.trunc(number('MATCHING_V3_DAILY_API_CALLS', 200, 0, 100000)),
    classificationBatchSize: Math.trunc(number('MATCHING_V3_CLASSIFICATION_BATCH_SIZE', 5, 1, 20)),
  };
}
export function version(s: Settings) {
  return digest(['matching-v3.3-gpt-gemini', 'classification-3-openai-text-only', s.classificationCacheNamespace, s.classificationModel,
    s.backfillVideoLimit, s.embeddingBaseUrl, s.embeddingModel, s.dimensions, s.task, s.eps, s.minSamples, s.minShare, s.similarityFloor]);
}
export interface VideoInput { id: string; title: string; tags: string[]; channelId: string | null; channelTitle: string | null }
export interface SourceSnapshot { videos: VideoInput[]; complete: boolean; fingerprint: string }
export interface Classification {
  tagSource: 'original' | 'generated';
  tags: string[];
  assignments: { genre: Exclude<Genre, 'channel type'>; tags: string[] }[];
}
export interface Cluster {
  centroid: number[];
  mass: number;
  share: number;
  tags: { text: string; count: number; generatedCount: number }[];
}
export interface GenreProfile {
  status: 'ready' | 'empty' | 'insufficient';
  clusters: Cluster[];
  totalMass: number;
  retainedCoverage: number;
  videoCount: number;
}
export interface Profile {
  version: string;
  sourceFingerprint: string;
  builtAt: string;
  complete: boolean;
  processedVideos: number;
  totalVideos: number;
  genres: Partial<Record<Genre, GenreProfile>>;
}
export interface TagPoint { text: string; vector: number[]; count: number; generatedCount: number }
export interface Transport { left: number; right: number; mass: number; similarity: number; contribution: number }
export interface Comparison { score: number; transport: Transport[] }
