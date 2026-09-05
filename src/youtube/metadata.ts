import { createHash } from 'node:crypto';
import { config } from '../config.js';
import type { Repository } from '../data/database.js';
import { createAsyncLimiter } from './concurrency.js';
import type { YoutubeChannelMetadata, YoutubeChannelStatistics, YoutubeVideoMetadata } from './types.js';

// Shared by every account in this worker process. Four concurrent requests
// keeps fresh imports moving in parallel while staying gentle on the YouTube
// Data API and the host's network connection.
const youtubeApiRequest = createAsyncLimiter(4);

interface YoutubeApiItem {
  id?: string;
  snippet?: {
    title?: string;
    channelId?: string;
    channelTitle?: string;
    description?: string;
    tags?: string[];
    thumbnails?: Record<string, { url?: string }>;
    publishedAt?: string;
    categoryId?: string;
    liveBroadcastContent?: string;
  };
  contentDetails?: { duration?: string };
  liveStreamingDetails?: { actualStartTime?: string; actualEndTime?: string; scheduledStartTime?: string };
  statistics?: { viewCount?: string };
}

interface YoutubeChannelApiItem {
  id?: string;
  snippet?: {
    title?: string;
    thumbnails?: Record<string, { url?: string }>;
    publishedAt?: string;
  };
  statistics?: {
    subscriberCount?: string;
    hiddenSubscriberCount?: boolean;
    videoCount?: string;
    viewCount?: string;
  };
  topicDetails?: { topicCategories?: string[] };
}

function publicCount(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function channelStatistics(item: YoutubeChannelApiItem): YoutubeChannelStatistics {
  const hidden = item.statistics?.hiddenSubscriberCount === true;
  return {
    subscriberCount: hidden ? null : publicCount(item.statistics?.subscriberCount),
    hiddenSubscriberCount: hidden,
    videoCount: publicCount(item.statistics?.videoCount),
    viewCount: publicCount(item.statistics?.viewCount),
    publishedAt: item.snippet?.publishedAt && Number.isFinite(Date.parse(item.snippet.publishedAt)) ? item.snippet.publishedAt : null,
    topicCategories: (item.topicDetails?.topicCategories ?? []).filter((value) => typeof value === 'string'),
  };
}

function durationSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!match) return null;
  return Math.round(
    Number(match[1] ?? 0) * 86400
    + Number(match[2] ?? 0) * 3600
    + Number(match[3] ?? 0) * 60
    + Number(match[4] ?? 0)
  );
}

function thumbnail(item: YoutubeApiItem): string {
  const values = item.snippet?.thumbnails ?? {};
  return values.maxres?.url ?? values.standard?.url ?? values.high?.url
    ?? values.medium?.url ?? values.default?.url ?? '';
}

function channelThumbnail(item: YoutubeChannelApiItem): string {
  const values = item.snippet?.thumbnails ?? {};
  return values.high?.url ?? values.medium?.url ?? values.default?.url ?? '';
}

function metadataHash(value: Omit<YoutubeVideoMetadata, 'metadataHash'>): string {
  // Public counters and broadcast identification are not classification inputs.
  const { isLivestream: _broadcast, viewCount: _views, statisticsFetchedAt: _statisticsAt,
    ...classificationMetadata } = value;
  return createHash('sha256').update(JSON.stringify(classificationMetadata)).digest('hex');
}

function normalize(item: YoutubeApiItem): YoutubeVideoMetadata | null {
  if (!item.id || !item.snippet) return null;
  const base: Omit<YoutubeVideoMetadata, 'metadataHash'> = {
    videoId: item.id,
    title: item.snippet.title ?? '',
    channelId: item.snippet.channelId ?? null,
    channelTitle: item.snippet.channelTitle ?? null,
    description: item.snippet.description ?? '',
    tags: Array.isArray(item.snippet.tags) ? item.snippet.tags.filter((tag) => typeof tag === 'string') : [],
    thumbnailUrl: thumbnail(item),
    durationSeconds: durationSeconds(item.contentDetails?.duration),
    publishedAt: item.snippet.publishedAt ?? null,
    categoryId: item.snippet.categoryId ?? null,
    availability: 'available',
    viewCount: publicCount(item.statistics?.viewCount),
    isLivestream: Boolean(item.liveStreamingDetails || item.snippet.liveBroadcastContent === 'live'
      || item.snippet.liveBroadcastContent === 'upcoming'),
  };
  return { ...base, metadataHash: metadataHash(base) };
}

function unavailable(videoId: string): YoutubeVideoMetadata {
  const base: Omit<YoutubeVideoMetadata, 'metadataHash'> = {
    videoId, title: '', channelId: null, channelTitle: null, description: '',
    tags: [], thumbnailUrl: '', durationSeconds: null, publishedAt: null,
    categoryId: null, availability: 'unavailable', viewCount: null,
  };
  return { ...base, metadataHash: metadataHash(base) };
}

export async function fetchYoutubeMetadata(
  videoIds: string[],
  apiKey = config.youtube.apiKey,
  fetchImpl: typeof fetch = fetch,
): Promise<YoutubeVideoMetadata[]> {
  if (!apiKey) throw new Error('YOUTUBE_API_KEY is required for YouTube metadata enrichment');
  const output: YoutubeVideoMetadata[] = [];
  for (let index = 0; index < videoIds.length; index += 50) {
    const batch = videoIds.slice(index, index + 50);
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet,contentDetails,status,liveStreamingDetails,statistics');
    url.searchParams.set('id', batch.join(','));
    url.searchParams.set('key', apiKey);
    const body = await youtubeApiRequest(async () => {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`YouTube Data API: HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
      return response.json() as Promise<{ items?: YoutubeApiItem[] }>;
    });
    const normalized = (body.items ?? []).map(normalize).filter((item): item is YoutubeVideoMetadata => item !== null);
    const found = new Set(normalized.map((item) => item.videoId));
    output.push(...normalized, ...batch.filter((id) => !found.has(id)).map(unavailable));
  }
  return output;
}

export async function enrichYoutubeMetadata(repository: Repository, limit = 500): Promise<number> {
  const ids = repository.youtubeVideosNeedingMetadata(limit);
  if (!ids.length || !config.youtube.apiKey) return 0;
  const metadata = await fetchYoutubeMetadata(ids);
  repository.upsertYoutubeVideoMetadata(metadata);
  return metadata.length;
}

export async function enrichYoutubeVideoStatistics(
  repository: Repository, limit = 500, apiKey = config.youtube.apiKey,
  fetchImpl: typeof fetch = fetch, now = () => new Date(),
): Promise<number> {
  if (!apiKey) return 0;
  const ids = repository.youtubeVideosNeedingStatistics(limit, now());
  let processed = 0;
  for (let index = 0; index < ids.length; index += 50) {
    const batch = ids.slice(index, index + 50);
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'statistics');
    url.searchParams.set('id', batch.join(','));
    url.searchParams.set('key', apiKey);
    const body = await youtubeApiRequest(async () => {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`YouTube video statistics: HTTP ${response.status}`);
      return response.json() as Promise<{ items?: YoutubeApiItem[] }>;
    });
    const found = new Map((body.items ?? []).map(item => [item.id, publicCount(item.statistics?.viewCount)]));
    repository.saveYoutubeVideoStatistics(batch.map(videoId => ({ videoId, viewCount: found.get(videoId) ?? null })), now().toISOString());
    processed += batch.length;
  }
  return processed;
}

export async function fetchYoutubeChannelMetadata(
  channelIds: string[],
  apiKey = config.youtube.apiKey,
  fetchImpl: typeof fetch = fetch,
): Promise<YoutubeChannelMetadata[]> {
  if (!apiKey) throw new Error('YOUTUBE_API_KEY is required for YouTube channel metadata enrichment');
  const output: YoutubeChannelMetadata[] = [];
  for (let index = 0; index < channelIds.length; index += 50) {
    const batch = channelIds.slice(index, index + 50);
    const url = new URL('https://www.googleapis.com/youtube/v3/channels');
    url.searchParams.set('part', 'snippet,statistics,topicDetails');
    url.searchParams.set('id', batch.join(','));
    url.searchParams.set('key', apiKey);
    const body = await youtubeApiRequest(async () => {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) {
        throw new Error(`YouTube Channels API: HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
      }
      return response.json() as Promise<{ items?: YoutubeChannelApiItem[] }>;
    });
    const found = new Map((body.items ?? [])
      .filter((item): item is YoutubeChannelApiItem & { id: string } => Boolean(item.id))
      .map((item) => [item.id, {
        channelId: item.id,
        name: item.snippet?.title ?? '',
        thumbnailUrl: channelThumbnail(item),
        statistics: channelStatistics(item),
      }]));
    output.push(...batch.map((channelId) => found.get(channelId) ?? {
      channelId,
      name: '',
      thumbnailUrl: '',
      statistics: channelStatistics({}),
    }));
  }
  return output;
}

export async function enrichYoutubeChannelMetadata(repository: Repository, limit = 500): Promise<number> {
  const ids = repository.youtubeChannelsNeedingMetadata(limit);
  if (!ids.length || !config.youtube.apiKey) return 0;
  const metadata = await fetchYoutubeChannelMetadata(ids);
  repository.upsertYoutubeChannelMetadata(metadata);
  return metadata.length;
}
