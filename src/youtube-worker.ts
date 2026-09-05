import { config } from './config.js';
import type { Repository } from './data/database.js';
import {
  patchOpsStatus,
  WORKER_HEARTBEAT_INTERVAL_MS,
  type WorkerOpsStatus,
} from './ops-status.js';
import { UserRegistry, DEFAULT_HANDLE, type User } from './users.js';
import { classifyYoutubeVideos } from './youtube/ai.js';
import { buildYoutubeCrystal } from './youtube/crystal.js';
import { enrichYoutubeChannelMetadata, enrichYoutubeMetadata, enrichYoutubeVideoStatistics } from './youtube/metadata.js';
import { classifyYoutubeVideosForMatching, youtubeMatchingWorkPending } from './youtube/matching.js';
import { runYoutubePortabilityStep } from './youtube/portability.js';
import { registryMatchingCrystal } from './youtube/registry-crystal.js';
import {
  YOUTUBE_WORKER_CATCHUP_MINUTES,
  YOUTUBE_WORKER_FULL_CYCLE_MINUTES,
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
  statistics(repository: Repository, user: User): Promise<number>;
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

const defaultSteps: YoutubeWorkerSteps = {
  portability: (repository) => runYoutubePortabilityStep(repository),
  // A fresh history import can contain tens of thousands of videos. The
  // repository caps both calls at 5,000, which is only 100 batched YouTube
  // API requests and prevents a new account from waiting days for enrichment.
  metadata: (repository) => enrichYoutubeMetadata(repository, YOUTUBE_WORKER_METADATA_PER_CYCLE),
  channelMetadata: (repository) => enrichYoutubeChannelMetadata(repository, YOUTUBE_WORKER_METADATA_PER_CYCLE),
  statistics: (repository) => enrichYoutubeVideoStatistics(repository, YOUTUBE_WORKER_METADATA_PER_CYCLE),
  matchingClassification: async (repository) =>
    classifyYoutubeVideosForMatching(repository, YOUTUBE_WORKER_METADATA_PER_CYCLE),
  // A deep extension backfill can also contain tens of thousands of videos.
  // Recency ordering makes the current dashboard useful first; a larger
  // cycle keeps new extension-only accounts from waiting days for analysis.
  classification: (repository) => classifyYoutubeVideos(repository, YOUTUBE_WORKER_TOPICS_PER_CYCLE),
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

// Data Portability remains tied to the instance owner's Google OAuth grant.
// Public metadata enrichment and AI classification, however, belong to each
// user's independent archive and must sweep every per-user database.
export async function runYoutubeWorkerCycle(
  registry: UserRegistry,
  steps: YoutubeWorkerSteps = defaultSteps,
  now = () => new Date(),
): Promise<YoutubeWorkerUserResult[]> {
  // Repositories are independent SQLite files. Start every archive together;
  // the external-service limiters provide bounded, FIFO backpressure. Promise
  // ordering keeps logs and tests stable even though the work overlaps.
  return Promise.all(registry.listUsers().map(async (user): Promise<YoutubeWorkerUserResult> => {
    const repository = registry.repositoryFor(user);
    // Stamped before the steps run so the processing notice can say when
    // this archive was last looked at, even when a step fails midway.
    repository.setYoutubeSyncState('worker_cycle_at', now().toISOString());
    try {
      const portability = user.handle === DEFAULT_HANDLE
        ? await steps.portability(repository, user)
        : 'not_applicable';
      const metadata = await steps.metadata(repository, user);
      const matchingClassified = await steps.matchingClassification(repository, user);
      // The matching projection only needs metadata and the category-based
      // matching topics. Publish it before the optional AI step so a model
      // outage cannot leave a stale crystal in the registry.
      const crystal = registryMatchingCrystal(buildYoutubeCrystal(repository, user, now()));
      registry.upsertMatchingCrystal(user, crystal);
      // Public counters and private topics are independent; an outage in
      // either service must leave the other's progress intact.
      const [channelMetadata, statistics, classification] = await Promise.allSettled([
        steps.channelMetadata(repository, user), steps.statistics(repository, user), steps.classification(repository, user),
      ]);
      const errors = [channelMetadata, statistics, classification].flatMap(result => result.status === 'rejected' ? [errorMessage(result.reason)] : []);
      const error = errors.join('\n');
      repository.setYoutubeSyncState('last_error', error.slice(0, 2000));
      return {
        user: user.handle,
        portability,
        metadata,
        channelMetadata: channelMetadata.status === 'fulfilled' ? channelMetadata.value : 0,
        matchingClassified,
        statistics: statistics.status === 'fulfilled' ? statistics.value : 0,
        classified: classification.status === 'fulfilled' ? classification.value : 0,
        ...(error ? { error } : {}),
      };
    } catch (error) {
      const message = errorMessage(error);
      repository.setYoutubeSyncState('last_error', message.slice(0, 2000));
      return { user: user.handle, error: message };
    }
  }));
}

export function youtubeWorkerMadeProgress(results: YoutubeWorkerUserResult[]): boolean {
  return results.some((result) =>
    (result.metadata ?? 0) + (result.channelMetadata ?? 0)
      + (result.statistics ?? 0) + (result.matchingClassified ?? 0) + (result.classified ?? 0) > 0);
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
    return youtubeMatchingWorkPending(repository)
      || (capabilities.metadata && repository.youtubeVideosNeedingStatistics(1).length > 0)
      || describeYoutubeProcessing(repository.youtubeProcessingCounts(), capabilities).pending > 0;
  });
}

if (process.env.NODE_ENV !== 'test') {
  const registry = new UserRegistry(process.env.USERS_DATABASE_PATH ?? './data/users.sqlite');
  if (config.youtube.captureToken || config.ingestToken) registry.ensureDefaultUser();
  let running = false;

  const recordStatus = (value: Partial<WorkerOpsStatus>) => {
    try {
      patchOpsStatus<WorkerOpsStatus>('worker', value);
    } catch (error) {
      console.error(`worker status write failed: ${errorMessage(error)}`);
    }
  };

  const CATCHUP_MS = YOUTUBE_WORKER_CATCHUP_MINUTES * 60_000;
  const FULL_CYCLE_MS = YOUTUBE_WORKER_FULL_CYCLE_MINUTES * 60_000;
  let lastCycleStartedAt = 0;
  let lastCycleFailed = false;
  let stopping = false;

  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    let continueImmediately = false;
    lastCycleStartedAt = Date.now();
    const lastStartedAt = new Date(lastCycleStartedAt).toISOString();
    recordStatus(youtubeWorkerCycleStartedStatus(lastStartedAt));
    const heartbeat = setInterval(() => {
      recordStatus({ heartbeatAt: new Date().toISOString(), running: true });
    }, WORKER_HEARTBEAT_INTERVAL_MS);
    try {
      const users = await runYoutubeWorkerCycle(registry);
      console.log(JSON.stringify({ at: new Date().toISOString(), users }));
      const failedUsers = users.filter((result) => result.error).length;
      for (const result of users) {
        if (result.error) console.error(`[${result.user}] ${result.error}`);
      }
      lastCycleFailed = failedUsers > 0;
      recordStatus({
        lastStartedAt,
        lastCompletedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
        running: false,
        users: users.length,
        failedUsers,
        lastError: '',
      });
      // A batch limit protects memory and external services; it should not
      // impose an additional five-minute sleep. Continue immediately while a
      // successful cycle actually moved the backlog forward. The timer below
      // remains the idle/no-progress safety poll.
      continueImmediately = youtubeWorkerShouldContinue(users, youtubeWorkPending(registry));
    } catch (error) {
      const lastError = errorMessage(error);
      lastCycleFailed = true;
      console.error(lastError);
      recordStatus({
        lastStartedAt,
        heartbeatAt: new Date().toISOString(),
        running: false,
        lastError,
      });
    } finally {
      clearInterval(heartbeat);
      running = false;
      if (continueImmediately && !stopping) setImmediate(() => { void run(); });
    }
  };

  // Hourly full cycle, plus catch-up runs every few minutes while an archive
  // still has actionable work. A failed cycle waits for the hourly slot so a
  // broken API key does not retry every five minutes.
  const tick = async (): Promise<void> => {
    if (running) return;
    const due = Date.now() - lastCycleStartedAt >= FULL_CYCLE_MS;
    if (!due && (lastCycleFailed || !youtubeWorkPending(registry))) return;
    await run();
  };

  void run();
  const interval = setInterval(() => { void tick(); }, CATCHUP_MS);
  process.once('SIGTERM', () => {
    stopping = true;
    clearInterval(interval);
    recordStatus({
      heartbeatAt: new Date().toISOString(),
      running: false,
      lastError: running ? 'Worker stopped before its active cycle completed' : '',
    });
    registry.close();
    process.exit(0);
  });
}
