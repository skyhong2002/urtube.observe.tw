import { isMainThread, Worker } from 'node:worker_threads';
import { yieldToEventLoop } from './event-loop-turns.js';
import type { Repository } from './data/database.js';
import {
  EventLoopLagProbe,
  nextEventLoopDelay,
  patchOpsStatus,
  WORKER_HEARTBEAT_INTERVAL_MS,
  type WorkerOpsStatus,
} from './ops-status.js';
import { UserRegistry, DEFAULT_HANDLE, type User } from './users.js';
import { classifyYoutubeVideos } from './youtube/ai.js';
import { youtubeMatchingCrystalSection } from './youtube/crystal.js';
import {
  enrichYoutubeChannelMetadata,
  enrichYoutubeMetadata,
  enrichYoutubeVideoStatistics,
} from './youtube/metadata.js';
import { classifyYoutubeVideosForMatching, youtubeMatchingWorkPending } from './youtube/matching.js';
import { runYoutubePortabilityStep } from './youtube/portability.js';
import { registryMatchingCrystal } from './youtube/registry-crystal.js';
import {
  YOUTUBE_WORKER_METADATA_PER_CYCLE,
  YOUTUBE_WORKER_TOPICS_PER_CYCLE,
  describeYoutubeProcessing,
  youtubeProcessingCapabilities,
  type YoutubeProcessingCapabilities,
} from './youtube/processing.js';

type YoutubePortabilityResult = Awaited<ReturnType<typeof runYoutubePortabilityStep>>;

export interface YoutubeWorkerSteps {
  portability(repository: Repository, user: User): Promise<YoutubePortabilityResult>;
  metadata(repository: Repository, user: User): Promise<number>;
  channelMetadata(repository: Repository, user: User): Promise<number>;
  // Optional so callers that only drive the classification pipeline need
  // not stub it; the default steps always refresh view counts.
  statistics?(repository: Repository, user: User): Promise<number>;
  matchingClassification(repository: Repository, user: User): Promise<number>;
  classification(repository: Repository, user: User): Promise<number>;
}

export interface YoutubeWorkerUserResult {
  user: string;
  portability?: YoutubePortabilityResult | 'not_applicable';
  metadata?: number;
  channelMetadata?: number;
  statistics?: number;
  matchingClassified?: number;
  classified?: number;
  error?: string;
}

// Metadata is shared through the registry-wide cache, so accounts that
// watched the same videos and channels spend YouTube quota only once.
export function youtubeWorkerSteps(registry: UserRegistry): YoutubeWorkerSteps {
  return { ...defaultSteps,
    metadata: (repository) => enrichYoutubeMetadata(repository, YOUTUBE_WORKER_METADATA_PER_CYCLE, registry.youtubeMetadataCache()),
    channelMetadata: (repository) =>
      enrichYoutubeChannelMetadata(repository, YOUTUBE_WORKER_METADATA_PER_CYCLE, registry.youtubeMetadataCache()),
    statistics: (repository) =>
      enrichYoutubeVideoStatistics(repository, YOUTUBE_WORKER_METADATA_PER_CYCLE, registry.youtubeMetadataCache()),
  };
}

const defaultSteps: YoutubeWorkerSteps = {
  portability: (repository) => runYoutubePortabilityStep(repository),
  // A fresh history import can contain tens of thousands of videos. The
  // repository caps both calls at 5,000, which is only 100 batched YouTube
  // API requests and prevents a new account from waiting days for enrichment.
  metadata: (repository) => enrichYoutubeMetadata(repository, YOUTUBE_WORKER_METADATA_PER_CYCLE),
  channelMetadata: (repository) => enrichYoutubeChannelMetadata(repository, YOUTUBE_WORKER_METADATA_PER_CYCLE),
  // Public view counts for Insights only; never a matching input.
  statistics: (repository) => enrichYoutubeVideoStatistics(repository, YOUTUBE_WORKER_METADATA_PER_CYCLE),
  matchingClassification: async (repository) =>
    classifyYoutubeVideosForMatching(repository, YOUTUBE_WORKER_METADATA_PER_CYCLE),
  // A deep extension backfill can also contain tens of thousands of videos.
  // Recency ordering makes the current dashboard useful first; a larger
  // cycle keeps new extension-only accounts from waiting days for analysis.
  classification: (repository, user) => classifyYoutubeVideos(repository, YOUTUBE_WORKER_TOPICS_PER_CYCLE, user.autoActivateInitialTopics),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

// Data Portability remains tied to the instance owner's Google OAuth grant.
// Public metadata enrichment and AI classification, however, belong to each
// user's independent archive and must sweep every per-user database.
export async function runYoutubeWorkerCycle(
  registry: UserRegistry,
  steps: YoutubeWorkerSteps = defaultSteps,
  now = () => new Date(),
  options: { userIds?: number[]; activeUsers?: Set<number>; onUserSettled?: () => void } = {},
): Promise<YoutubeWorkerUserResult[]> {
  // Repositories are independent SQLite files. Start every archive together;
  // the external-service limiters provide bounded, FIFO backpressure. Promise
  // ordering keeps logs and tests stable even though the work overlaps.
  //
  // Steps with nothing to do resolve without real I/O, so without explicit
  // yields every archive's synchronous SQLite work (crystal builds alone took
  // 64 s across 37 archives on 2026-10-22) ran as one microtask chain. Timers
  // never fired, so the heartbeat went stale for ~129 s and /readyz failed
  // (#97). Yield before each synchronous stage so heartbeats keep landing.
  return Promise.all(registry.listUsers().filter(user => !options.userIds || options.userIds.includes(user.id)).map(async (user): Promise<YoutubeWorkerUserResult> => {
    if (options.activeUsers?.has(user.id)) return { user: user.handle };
    // Claim synchronously so a concurrent sweep skips this account, then
    // yield before opening it: the first open in a new process runs
    // migrations and a channel-id backfill, and opening all 38 archives in
    // one turn blocked the loop for 32 s after a deploy on 2026-10-22.
    options.activeUsers?.add(user.id);
    let repository: Repository;
    try {
      await yieldToEventLoop();
      repository = registry.repositoryFor(user);
    } catch (error) {
      options.activeUsers?.delete(user.id);
      throw error;
    }
    if (!youtubeRetryDue(repository, now().getTime())) {
      options.activeUsers?.delete(user.id);
      return { user: user.handle };
    }
    // Stamped before the steps run so the processing notice can say when
    // this archive was last looked at, even when a step fails midway.
    repository.setYoutubeSyncState('worker_cycle_at', now().toISOString());
    try {
      await yieldToEventLoop();
      const portability = user.storageName === DEFAULT_HANDLE
        ? await steps.portability(repository, user)
        : 'not_applicable';
      await yieldToEventLoop();
      repository.setYoutubeSyncState('worker_stage', 'metadata');
      const metadata = await steps.metadata(repository, user);
      await yieldToEventLoop();
      repository.setYoutubeSyncState('worker_stage', 'channels');
      const channelMetadata = await steps.channelMetadata(repository, user);
      await yieldToEventLoop();
      repository.setYoutubeSyncState('worker_stage', 'matching');
      const matchingClassified = await steps.matchingClassification(repository, user);
      // The matching projection only needs metadata and the category-based
      // matching topics. Publish it before the optional AI step so a model
      // outage cannot leave a stale crystal in the registry.
      await yieldToEventLoop();
      const builtAt = now();
      const crystal = registryMatchingCrystal({
        generatedAt: builtAt.toISOString(),
        matching: youtubeMatchingCrystalSection(repository, builtAt),
      });
      registry.upsertMatchingCrystal(user, crystal);
      await yieldToEventLoop();
      repository.setYoutubeSyncState('worker_stage', 'topics');
      const classified = await steps.classification(repository, user);
      // Last and isolated: an optional counter refresh that fails (e.g. the
      // shared YouTube quota ran out) must neither put the archive into retry
      // backoff nor show a processing error after metadata and topics
      // succeeded. The cycle log records it; the next cycle retries the same
      // videos.
      await yieldToEventLoop();
      repository.setYoutubeSyncState('worker_stage', 'statistics');
      let statistics = 0;
      let statisticsError = '';
      try {
        statistics = await steps.statistics?.(repository, user) ?? 0;
      } catch (error) {
        statisticsError = errorMessage(error);
      }
      repository.setYoutubeSyncState('worker_retry_at', '0');
      repository.setYoutubeSyncState('worker_retry_attempts', '0');
      repository.setYoutubeSyncState('last_error', '');
      repository.setYoutubeSyncState('worker_stage', 'idle');
      return {
        user: user.handle,
        portability,
        metadata,
        channelMetadata,
        statistics,
        matchingClassified,
        classified,
        ...(statisticsError ? { error: statisticsError } : {}),
      };
    } catch (error) {
      const attempts = Number(repository.youtubeSyncState('worker_retry_attempts') ?? 0) + 1;
      repository.setYoutubeSyncState('worker_retry_attempts', String(attempts));
      repository.setYoutubeSyncState('worker_retry_at', String(now().getTime() + youtubeRetryDelay(attempts)));
      repository.setYoutubeSyncState('worker_stage', 'failed');
      const message = errorMessage(error);
      repository.setYoutubeSyncState('last_error', message.slice(0, 2000));
      return { user: user.handle, error: message };
    } finally {
      options.activeUsers?.delete(user.id);
      options.onUserSettled?.();
    }
  }));
}

// Persisted per-account backoff survives CD restarts and does not hold a lane.
export function youtubeRetryDelay(attempts: number): number {
  return Math.min(3600_000, 30_000 * 2 ** Math.min(7, Math.max(0, attempts - 1)));
}
export function youtubeRetryDue(repository: Repository, now = Date.now()): boolean {
  return Number(repository.youtubeSyncState('worker_retry_at') ?? 0) <= now;
}

// Include accounts waiting for their persisted retry deadline, even when
// this sweep only processed a subset of users.
export function youtubeWorkerFailedUsers(registry: UserRegistry): number {
  return registry.listUsers().filter(user =>
    registry.repositoryFor(user).youtubeSyncState('worker_stage') === 'failed').length;
}

export function youtubeWorkerMadeProgress(results: YoutubeWorkerUserResult[]): boolean {
  return results.some((result) =>
    (result.metadata ?? 0) + (result.channelMetadata ?? 0) + (result.statistics ?? 0)
      + (result.matchingClassified ?? 0) + (result.classified ?? 0) > 0);
}

export function youtubeWorkerShouldContinue(
  results: YoutubeWorkerUserResult[],
  workPending: boolean,
): boolean {
  // A failed archive must not reintroduce a global queue. Keep advancing the
  // other archives while any cycle is still making progress; once every
  // result is stalled, the normal failure/no-progress cooldown takes over.
  return workPending && youtubeWorkerMadeProgress(results);
}

// A new cycle supersedes the previous cycle's failure state as soon as it
// publishes a fresh heartbeat. Keep lastCompletedAt through patchOpsStatus so
// readers still know when the last complete sweep finished.
export function youtubeWorkerCycleStartedStatus(at: string): Partial<WorkerOpsStatus> {
  return {
    lastStartedAt: at,
    heartbeatAt: at,
    running: true,
    failedUsers: 0,
    lastError: '',
  };
}

// New imports with already-complete metadata still need their first taxonomy
// initialization/activation; pending-topic counts alone have no run to count.
export function youtubeInitialTopicsPending(repository: Repository, autoActivateFirst: boolean): boolean {
  if (!autoActivateFirst || !repository.youtubePersonalTaxonomyReadiness().ready) return false;
  const runs = repository.youtubeTaxonomyRuns();
  return runs.length === 0 || (runs.length === 1 && runs[0].status === 'ready');
}

// Archives with enrichment the configured stages can still do. Catch-up runs
// between hourly sweeps visit only these, so one archive that keeps gaining
// new channels does not make every idle archive rescan every few minutes.
export function youtubePendingUserIds(
  registry: UserRegistry,
  capabilities: YoutubeProcessingCapabilities = youtubeProcessingCapabilities(),
): number[] {
  return registry.listUsers().filter((user) => {
    const repository = registry.repositoryFor(user);
    return (capabilities.topics && youtubeInitialTopicsPending(repository, user.autoActivateInitialTopics))
      || youtubeMatchingWorkPending(repository)
      || describeYoutubeProcessing(repository.youtubeProcessingCounts(), capabilities).pending > 0;
  }).map((user) => user.id);
}
// Whether any archive has enrichment the configured stages can still do.
// Drives the catch-up cadence: a fresh Takeout should not wait an hour for
// its first metadata pass.
export function youtubeWorkPending(
  registry: UserRegistry,
  capabilities: YoutubeProcessingCapabilities = youtubeProcessingCapabilities(),
): boolean {
  if (registry.crystalRefreshPending()) return true;
  return registry.listUsers().some((user) => {
    const repository = registry.repositoryFor(user);
    return (capabilities.topics && youtubeInitialTopicsPending(repository, user.autoActivateInitialTopics))
      || youtubeMatchingWorkPending(repository)
      || describeYoutubeProcessing(repository.youtubeProcessingCounts(), capabilities).pending > 0;
  });
}

// The supervisor below owns the heartbeat and the status file; all archive
// work runs on youtube-worker-thread.ts. Its synchronous SQLite stages took
// 31-207 s per stage under host memory pressure (2026-10-22), long enough to
// stall a heartbeat sharing their loop and fail /readyz although the worker
// was still making progress.
export const WORKER_THREAD_TICK_MS = 1_000;
// A thread that has not ticked for this long is treated as hung: the
// supervisor stops vouching for it, so /readyz fails after
// WORKER_HEARTBEAT_MAX_AGE_MS more. Well above the worst observed stage.
export const WORKER_THREAD_STALL_MAX_MS = 10 * 60_000;

export type WorkerThreadMessage =
  | { type: 'tick' }
  | { type: 'status'; value: Partial<WorkerOpsStatus> }
  | { type: 'stopped'; active: boolean };

// Whether the supervisor should publish a heartbeat on the thread's behalf.
export function workerThreadHeartbeatDue(running: boolean, lastTickAt: number, now: number): boolean {
  return running && now - lastTickAt <= WORKER_THREAD_STALL_MAX_MS;
}

if (process.env.NODE_ENV !== 'test' && isMainThread) {
  const lag = new EventLoopLagProbe(WORKER_THREAD_TICK_MS);
  let lastTickAt = Date.now();
  let threadRunning = false;
  let worstDelay: { ms: number; at: number } | null = null;
  const recordStatus = (value: Partial<WorkerOpsStatus>) => {
    if (value.running !== undefined) threadRunning = value.running;
    const observedMs = lag.take();
    if (observedMs >= WORKER_HEARTBEAT_INTERVAL_MS) {
      console.error(`worker thread event loop blocked for ${observedMs} ms`);
    }
    worstDelay = nextEventLoopDelay(worstDelay, observedMs, Date.now());
    try {
      patchOpsStatus<WorkerOpsStatus>('worker', {
        ...value,
        eventLoopMaxDelayMs: worstDelay.ms,
        eventLoopMaxDelayAt: new Date(worstDelay.at).toISOString(),
      });
    } catch (error) {
      console.error(`worker status write failed: ${errorMessage(error)}`);
    }
  };

  const thread = new Worker(new URL('./youtube-worker-thread.ts', import.meta.url));
  thread.on('message', (message: WorkerThreadMessage) => {
    if (message.type === 'tick') {
      lag.tick();
      lastTickAt = Date.now();
    } else if (message.type === 'status') {
      recordStatus(message.value);
    } else {
      stop(message.active);
    }
  });
  // Let the container restart a crashed worker instead of reporting a
  // heartbeat for work that no longer runs.
  thread.on('error', (error) => {
    console.error(errorMessage(error));
    recordStatus({ heartbeatAt: new Date().toISOString(), running: false, lastError: errorMessage(error) });
    process.exit(1);
  });
  thread.on('exit', (code) => {
    console.error(`worker thread exited with code ${code}`);
    process.exit(1);
  });

  setInterval(() => {
    if (workerThreadHeartbeatDue(threadRunning, lastTickAt, Date.now())) {
      recordStatus({ heartbeatAt: new Date().toISOString(), running: true });
    }
  }, WORKER_HEARTBEAT_INTERVAL_MS);

  function stop(active: boolean): never {
    recordStatus({
      heartbeatAt: new Date().toISOString(),
      running: false,
      lastError: active ? 'Worker stopped before its active cycle completed' : '',
    });
    process.exit(0);
  }
  process.once('SIGTERM', () => {
    thread.postMessage({ type: 'stop' });
    // A thread inside a synchronous stage cannot answer. SQLite's WAL keeps
    // the archives consistent when the process ends without closing them.
    setTimeout(() => stop(threadRunning), 5_000).unref();
  });
}
