import { config } from '../config.js';
import { youtubeClassificationConfigured } from './ai.js';

// Per-archive counts of the background work that follows an import. The
// import itself is synchronous; what makes the numbers trustworthy (video
// details, channel details, AI topics) arrives from the worker afterwards.
export interface YoutubeProcessingCounts {
  videos: number;
  videosPendingMetadata: number;
  channelsPendingMetadata: number;
  // Videos whose public metadata is fetched and that YouTube still serves:
  // the only ones AI classification can ever cover.
  videosClassifiable: number;
  videosPendingTopics: number;
  lastImportAt: string | null;
  lastCycleAt: string | null;
  lastError: string | null;
}

// Which enrichment stages this deployment can actually run. Pending work for
// a stage that is not configured is not "processing"; it will never happen,
// so it must not keep a banner up forever.
export interface YoutubeProcessingCapabilities {
  metadata: boolean;
  topics: boolean;
}

export const YOUTUBE_WORKER_METADATA_PER_CYCLE = 5000;
export const YOUTUBE_WORKER_TOPICS_PER_CYCLE = 1000;
// While any archive has actionable work the worker runs every catch-up
// interval; otherwise it settles back to the hourly full cycle.
export const YOUTUBE_WORKER_CATCHUP_MINUTES = 5;
export const YOUTUBE_WORKER_FULL_CYCLE_MINUTES = 60;

export interface YoutubeProcessingStage {
  done: number;
  total: number;
  pending: number;
}

export interface YoutubeProcessingStatus {
  stage: 'metadata' | 'topics' | 'done';
  // Items still waiting on a configured stage. Zero means the dashboard
  // numbers are as final as this deployment can make them.
  pending: number;
  metadata: YoutubeProcessingStage | null;
  topics: YoutubeProcessingStage | null;
  estimatedMinutes: number | null;
  lastImportAt: string | null;
  lastCycleAt: string | null;
  lastError: string | null;
}

export function youtubeProcessingCapabilities(): YoutubeProcessingCapabilities {
  return {
    metadata: Boolean(config.youtube.apiKey),
    topics: youtubeClassificationConfigured(),
  };
}

export function describeYoutubeProcessing(
  counts: YoutubeProcessingCounts,
  capabilities: YoutubeProcessingCapabilities,
): YoutubeProcessingStatus {
  const metadata: YoutubeProcessingStage | null = capabilities.metadata ? {
    done: counts.videos - counts.videosPendingMetadata,
    total: counts.videos,
    pending: counts.videosPendingMetadata + counts.channelsPendingMetadata,
  } : null;
  // Videos still waiting on metadata may become classifiable, so they count
  // toward the topic total; otherwise the bar would jump backwards as
  // metadata lands.
  const topics: YoutubeProcessingStage | null = capabilities.topics ? {
    done: counts.videosClassifiable - counts.videosPendingTopics,
    total: counts.videosClassifiable + (capabilities.metadata ? counts.videosPendingMetadata : 0),
    pending: counts.videosPendingTopics + (capabilities.metadata ? counts.videosPendingMetadata : 0),
  } : null;
  const pending = (metadata?.pending ?? 0) + (topics ? counts.videosPendingTopics : 0);
  const stage = metadata && counts.videosPendingMetadata > 0 ? 'metadata'
    : topics && counts.videosPendingTopics > 0 ? 'topics'
      : metadata && counts.channelsPendingMetadata > 0 ? 'metadata'
        : 'done';
  let estimatedMinutes: number | null = null;
  if (pending > 0) {
    const cycles = Math.ceil((metadata?.pending ?? 0) / YOUTUBE_WORKER_METADATA_PER_CYCLE)
      + Math.ceil((topics?.pending ?? 0) / YOUTUBE_WORKER_TOPICS_PER_CYCLE);
    estimatedMinutes = Math.max(1, cycles) * YOUTUBE_WORKER_CATCHUP_MINUTES;
  }
  return {
    stage,
    pending,
    metadata,
    topics,
    estimatedMinutes,
    lastImportAt: counts.lastImportAt,
    lastCycleAt: counts.lastCycleAt,
    lastError: counts.lastError || null,
  };
}
