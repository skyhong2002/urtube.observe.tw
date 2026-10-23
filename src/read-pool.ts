import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { logTiming, SLOW_MS } from './timing.js';
import type { Repository } from './data/database.js';
import { youtubeCrystalShiftSection, youtubeMatchingCrystalSection, type YoutubeCrystalShiftSection } from './youtube/crystal.js';
import type { YoutubeDashboardData, YoutubeRange } from './youtube/types.js';

// Aggregate dashboard reads are synchronous SQLite and, on a cold or freshly
// written archive, took 20-110 s for the largest production archives
// (2026-10-22). On the request thread that stalled every visitor and the
// health checks. They run on a small pool of threads instead, each holding
// read-only connections (and their TEMP caches) per archive.
// Read-only Repository methods that are safe to call on another connection.
export const POOLED_METHODS = [
  'youtubeCounts',
  'youtubeProcessingCounts',
  'youtubeMetadataProcessingCounts',
  'youtubeChannelTotals',
  'youtubeChannelDetail',
  'youtubeComparisonProfile',
  'youtubeHistoryPage',
  'youtubeReferenceDataUpdatedAt',
] as const;
export type PooledMethod = typeof POOLED_METHODS[number];

export interface ReadRequests {
  dashboard: { range: YoutubeRange; now: string; includeInsights: boolean | 'overview' | 'summary' };
  crystalShifts: { now: string };
  matchingCrystal: { now: string };
  popularity: { range: YoutubeRange; now: string };
  method: { name: PooledMethod; args: unknown[] };
}
type ReadKind = keyof ReadRequests;

export function runRead(repository: Repository, kind: ReadKind, args: ReadRequests[ReadKind]): unknown {
  switch (kind) {
    case 'dashboard': {
      const { range, now, includeInsights } = args as ReadRequests['dashboard'];
      return repository.youtubeDashboard(range, new Date(now), includeInsights);
    }
    case 'crystalShifts':
      return youtubeCrystalShiftSection(repository, new Date((args as ReadRequests['crystalShifts']).now));
    case 'matchingCrystal':
      return youtubeMatchingCrystalSection(repository, new Date((args as ReadRequests['matchingCrystal']).now));
    case 'popularity':
      return repository.youtubePopularity((args as ReadRequests['popularity']).range,
        new Date((args as ReadRequests['popularity']).now));
    case 'method': {
      const { name, args: methodArgs } = args as ReadRequests['method'];
      if (!POOLED_METHODS.includes(name)) throw new Error(`${name} is not a pooled read`);
      return (repository[name] as (...values: unknown[]) => unknown)(...methodArgs);
    }
  }
}

const POOL_SIZE = 2;
// Background refreshes (a visitor was already served the previous aggregate)
// may hold at most this many threads, so a request waiting for data it does
// not have yet never queues behind them. On 2026-10-23 refreshes of the
// reference and landing aggregates kept both threads busy for over half an
// hour while first computations for public pages waited.
const BACKGROUND_THREADS = 1;
// Each computation carries its own priority; promoteReads lets a request that
// joins a queued background computation move it ahead.
export interface ReadPriority { background: boolean }
const priority = new AsyncLocalStorage<ReadPriority>();
// Reads started anywhere inside fn, across awaits, use this priority.
export function withReadPriority<T>(context: ReadPriority, fn: () => T): T {
  return priority.run(context, fn);
}
export function currentlyBackground(): boolean {
  return priority.getStore()?.background ?? false;
}
// Queued jobs of this computation become requests; running ones continue.
export function promoteReads(context: ReadPriority): void {
  if (!context.background) return;
  context.background = false;
  dispatch();
}
interface Job {
  id: number; label: string; postedAt: number; priority: ReadPriority;
  message: { id: number; databasePath: string; kind: ReadKind; args: unknown };
  resolve: (value: unknown) => void; reject: (error: Error) => void;
}
interface Slot { worker: Worker; job?: Job }
const slots: Slot[] = [];
const queue: Job[] = [];
let nextId = 0;
let idleWaiters: Array<() => void> = [];
const running = () => slots.filter((candidate) => candidate.job).length;
function settled(): void {
  if (queue.length || running()) return;
  const waiters = idleWaiters;
  idleWaiters = [];
  for (const resolve of waiters) resolve();
}

// Queued plus running reads.
export function readPoolPending(): number {
  return queue.length + running();
}

export function readPoolState(): { queued: number; running: number; backgroundRunning: number; queuedBackground: number } {
  return {
    queued: queue.length, running: running(),
    backgroundRunning: slots.filter((candidate) => candidate.job?.priority.background).length,
    queuedBackground: queue.filter((job) => job.priority.background).length,
  };
}

// Tests only: hold queued jobs so their priorities can be inspected.
let paused = false;
export function pauseReadPoolForTests(value: boolean): void {
  paused = value;
  if (!paused) dispatch();
}

// Resolves once no pooled read is queued or running, including background
// refreshes. Lets bounded batch work run one page's reads at a time.
export function readPoolIdle(): Promise<void> {
  if (!readPoolPending()) return Promise.resolve();
  return new Promise((resolve) => { idleWaiters.push(resolve); });
}

function createSlot(): Slot {
  const worker = new Worker(new URL('./read-thread.ts', import.meta.url));
  // Idle readers must not keep a finished process (or test run) alive.
  worker.unref();
  const created: Slot = { worker };
  worker.on('message', (message: { id: number; value?: unknown; error?: string; runMs?: number }) => {
    const job = created.job;
    if (!job || job.id !== message.id) return;
    created.job = undefined;
    worker.unref();
    const totalMs = performance.now() - job.postedAt;
    if (totalMs >= SLOW_MS) {
      const runMs = message.runMs ?? 0;
      logTiming('pool-read', { kind: job.label, background: job.priority.background ? 1 : 0, queuedMs: Math.round(totalMs - runMs),
        runMs: Math.round(runMs), queued: queue.length, ok: message.error === undefined ? 1 : 0 });
    }
    if (message.error !== undefined) job.reject(new Error(message.error));
    else job.resolve(message.value);
    dispatch();
    settled();
  });
  const fail = (error: Error) => {
    const index = slots.indexOf(created);
    if (index < 0) return;
    slots.splice(index, 1);
    const job = created.job;
    created.job = undefined;
    job?.reject(error);
    dispatch();
    settled();
  };
  worker.on('error', fail);
  worker.on('exit', (code) => fail(new Error(`Read thread exited (${code})`)));
  slots.push(created);
  return created;
}

// Send queued jobs to idle threads: requests first, then at most
// BACKGROUND_THREADS refreshes at a time, each in arrival order.
function dispatch(): void {
  while (queue.length && !paused) {
    const idle = slots.find((candidate) => !candidate.job) ?? (slots.length < POOL_SIZE ? createSlot() : undefined);
    if (!idle) return;
    let index = queue.findIndex((job) => !job.priority.background);
    if (index < 0 && slots.filter((candidate) => candidate.job?.priority.background).length < BACKGROUND_THREADS) {
      index = queue.findIndex((job) => job.priority.background);
    }
    if (index < 0) return;
    const [job] = queue.splice(index, 1);
    idle.job = job;
    idle.worker.ref();
    idle.worker.postMessage(job.message);
  }
}

export function readOffThread<K extends ReadKind>(
  repository: Repository,
  databasePath: string,
  kind: K,
  args: ReadRequests[K],
): Promise<unknown> {
  // An in-memory database cannot be opened from another thread (tests).
  if (databasePath === ':memory:') return Promise.resolve(runRead(repository, kind, args));
  const id = nextId++;
  const context = priority.getStore() ?? { background: false };
  return new Promise((resolve, reject) => {
    const label = kind === 'method' ? (args as ReadRequests['method']).name : kind;
    queue.push({ id, label, postedAt: performance.now(), priority: context, message: { id, databasePath, kind, args }, resolve, reject });
    dispatch();
  });
}

export type { YoutubeCrystalShiftSection, YoutubeDashboardData };

// Pooled call of one read-only Repository method, typed like the method.
// Pass clock-dependent arguments (now) explicitly: the read thread has its
// own clock, which callers' tests cannot mock.
export function readMethodOffThread<M extends PooledMethod>(
  repository: Repository,
  databasePath: string,
  name: M,
  ...args: Parameters<Repository[M]>
): Promise<ReturnType<Repository[M]>> {
  return readOffThread(repository, databasePath, 'method', { name, args }) as Promise<ReturnType<Repository[M]>>;
}
