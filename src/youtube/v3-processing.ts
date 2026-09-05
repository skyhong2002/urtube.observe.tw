import { GENRES, type Profile } from '../matching-v3/model.js';
import type { JobProgress } from '../matching-v3/store.js';

export interface YoutubeMetadataProcessingCounts {
  videos: number;
  videosPendingMetadata: number;
  channelsPendingMetadata: number;
}

export interface V3JobStatus {
  state: string;
  version: string;
  attempts: number;
  retryAt: number;
  progress: JobProgress | null;
}

export type V3ProcessingState = 'disabled' | 'missing' | 'queued' | 'running' | 'retry' | 'failed' | 'done' | 'provisional' | 'stale';
export interface V3ProcessingStatus {
  metadata: YoutubeMetadataProcessingCounts & { enabled: boolean };
  state: V3ProcessingState;
  progress: JobProgress | null;
  backfillVideoLimit: number;
  retryAt: number | null;
  profile: { currentVersion: boolean; builtAt: string; processedVideos: number; totalVideos: number; provisional: boolean } | null;
}

// Only existing job/profile summaries are consumed. Progress denominators belong
// to their worker phase; an embedding batch is never a percentage of the archive.
export function describeV3Processing(input: {
  metadata: YoutubeMetadataProcessingCounts;
  metadataEnabled: boolean;
  enabled: boolean;
  profileVersion: string;
  backfillVideoLimit: number;
  profile: Profile | null;
  job: V3JobStatus | null;
  now?: number;
}): V3ProcessingStatus {
  const { profile, job } = input;
  const now = input.now ?? Date.now();
  const currentProfile = profile?.version === input.profileVersion;
  const currentJob = job?.version === input.profileVersion;
  const provisional = !profile?.complete
    || GENRES.some(genre => !profile.genres[genre] || profile.genres[genre]!.status === 'insufficient');
  let state: V3ProcessingState;
  if (!input.enabled) state = 'disabled';
  else if (job && !currentJob) state = 'stale';
  else if (job?.state === 'failed') state = 'failed';
  else if (job?.state === 'running') state = 'running';
  else if (job?.state === 'queued') state = job.attempts > 0 || job.retryAt > now ? 'retry' : 'queued';
  else if (profile && !currentProfile) state = 'stale';
  else if (currentProfile) state = job?.state === 'done' && !provisional ? 'done' : 'provisional';
  else state = 'missing';
  return {
    metadata: { ...input.metadata, enabled: input.metadataEnabled }, state,
    progress: input.enabled && currentJob && ['running', 'retry'].includes(state) ? job!.progress : null,
    backfillVideoLimit: input.backfillVideoLimit,
    retryAt: state === 'retry' && job!.retryAt > now ? job!.retryAt : null,
    profile: profile ? { currentVersion: currentProfile, builtAt: profile.builtAt,
      processedVideos: profile.processedVideos, totalVideos: profile.totalVideos,
      provisional: provisional || state !== 'done' } : null,
  };
}
