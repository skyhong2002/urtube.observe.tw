import { parentPort } from 'node:worker_threads';
import { config } from './config.js';
import type { WorkerOpsStatus } from './ops-status.js';
import { UserRegistry } from './users.js';
import { youtubeApiUsage } from './youtube/metadata.js';
import { YOUTUBE_WORKER_CATCHUP_MINUTES, YOUTUBE_WORKER_FULL_CYCLE_MINUTES } from './youtube/processing.js';
import {
  errorMessage,
  runYoutubeWorkerCycle,
  WORKER_THREAD_TICK_MS,
  youtubePendingUserIds,
  youtubeRetryDue,
  youtubeWorkerCycleStartedStatus,
  youtubeWorkerFailedUsers,
  youtubeWorkerShouldContinue,
  youtubeWorkerSteps,
  type WorkerThreadMessage,
} from './youtube-worker.js';

// The YouTube worker's scheduling and archive work. It runs on its own thread
// so its synchronous SQLite stages (31-207 s under host memory pressure on
// 2026-10-22) cannot delay the supervisor's heartbeat; see youtube-worker.ts.
if (!parentPort) throw new Error('youtube-worker-thread.ts must run as a worker thread');
const port = parentPort;
const post = (message: WorkerThreadMessage) => port.postMessage(message);

const registry = new UserRegistry(process.env.USERS_DATABASE_PATH ?? './data/users.sqlite');
if (config.youtube.captureToken || config.ingestToken) registry.ensureDefaultUser();
const steps = youtubeWorkerSteps(registry);
let running = false;
const activeUsers = new Set<number>();

// Delayed by every synchronous stage on this thread; the supervisor measures
// this thread's stalls from the gaps between ticks.
const ticker = setInterval(() => post({ type: 'tick' }), WORKER_THREAD_TICK_MS);
const recordStatus = (value: Partial<WorkerOpsStatus>) => post({ type: 'status', value });
// Publish each account's outcome even while unrelated retries are still
// running. Waiting for the entire sweep leaves recovered failures visible.
const onUserSettled = () => recordStatus({ failedUsers: youtubeWorkerFailedUsers(registry) });

const CATCHUP_MS = YOUTUBE_WORKER_CATCHUP_MINUTES * 60_000;
const FULL_CYCLE_MS = YOUTUBE_WORKER_FULL_CYCLE_MINUTES * 60_000;
let lastCycleStartedAt = 0;
// Who a catch-up run should visit: every archive while a crystal refresh is
// queued (undefined), only the pending ones otherwise, or nobody (null).
const catchUpTarget = (): number[] | undefined | null => {
  if (registry.crystalRefreshPending()) return undefined;
  const ids = youtubePendingUserIds(registry);
  return ids.length ? ids : null;
};
let lastCycleFailed = false;
let stopping = false;

// `userIds` limits a catch-up run to archives with pending work; only full
// sweeps (no userIds) move the hourly schedule, so idle archives still get
// their hourly visit while one busy archive keeps catching up.
const run = async (userIds?: number[]): Promise<void> => {
  if (running) return;
  running = true;
  let continueWith: number[] | undefined | null = null;
  const startedAt = Date.now();
  if (!userIds) lastCycleStartedAt = startedAt;
  const lastStartedAt = new Date(startedAt).toISOString();
  recordStatus(youtubeWorkerCycleStartedStatus(lastStartedAt));
  try {
    const users = await runYoutubeWorkerCycle(registry, steps, () => new Date(), { userIds, activeUsers, onUserSettled });
    console.log(JSON.stringify({ at: new Date().toISOString(), users }));
    const failedUsers = youtubeWorkerFailedUsers(registry);
    for (const result of users) {
      if (result.error) console.error(`[${result.user}] ${result.error}`);
    }
    lastCycleFailed = failedUsers > 0;
    recordStatus({
      lastStartedAt,
      lastCompletedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      running: activeUsers.size > 0,
      users: users.length,
      failedUsers,
      lastError: '',
      youtubeApiRequestsSinceReset: youtubeApiUsage().requestsSinceReset,
      youtubeApiQuotaResetAt: youtubeApiUsage().quotaResetAt,
    });
    // A batch limit protects memory and external services; it should not
    // impose an additional five-minute sleep. Continue immediately while a
    // successful cycle actually moved the backlog forward. The timer below
    // remains the idle/no-progress safety poll.
    const target = catchUpTarget();
    continueWith = youtubeWorkerShouldContinue(users, target !== null) ? target : null;
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
    running = false;
    const next = continueWith;
    if (next !== null && !stopping) setImmediate(() => { void run(next); });
  }
};

// Hourly full cycle, plus catch-up runs every few minutes while an archive
// still has actionable work. A failed cycle waits for the hourly slot so a
// broken API key does not retry every five minutes.
const tick = async (): Promise<void> => {
  if (running) return;
  if (Date.now() - lastCycleStartedAt >= FULL_CYCLE_MS) return run();
  if (lastCycleFailed) return;
  const target = catchUpTarget();
  if (target !== null) await run(target);
};

// Check failed accounts independently of a slow account's full-cycle work.
// The shared in-flight set prevents overlapping writes for the same account.
const retryInterval = setInterval(() => {
  if (stopping) return;
  const userIds = registry.listUsers().filter(user => {
    const repository = registry.repositoryFor(user);
    return !activeUsers.has(user.id) && repository.youtubeSyncState('worker_stage') === 'failed'
      && youtubeRetryDue(repository);
  }).map(user => user.id);
  if (userIds.length) {
    recordStatus({ running: true, heartbeatAt: new Date().toISOString() });
    void runYoutubeWorkerCycle(registry, steps, () => new Date(), { userIds, activeUsers, onUserSettled })
    .then(() => {
      if (!running && !activeUsers.size) recordStatus({ running: false, lastCompletedAt: new Date().toISOString(),
        failedUsers: youtubeWorkerFailedUsers(registry) });
    })
    .catch(() => console.error('Account retry sweep failed; will check again.'));
  }
}, 30_000);

void run();
const interval = setInterval(() => { void tick(); }, CATCHUP_MS);
port.on('message', (message: { type: 'stop' }) => {
  if (message.type !== 'stop') return;
  stopping = true;
  clearInterval(interval);
  clearInterval(retryInterval);
  clearInterval(ticker);
  const active = running || activeUsers.size > 0;
  registry.close();
  post({ type: 'stopped', active });
});
