import { Worker } from 'node:worker_threads';
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
interface Slot { worker: Worker; busy: number }
const slots: Slot[] = [];
const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; slot: Slot }>();
let nextId = 0;
let idleWaiters: Array<() => void> = [];
function settled(): void {
  if (waiting.size) return;
  const waiters = idleWaiters;
  idleWaiters = [];
  for (const resolve of waiters) resolve();
}

// Resolves once no pooled read is queued or running, including background
// refreshes. Lets bounded batch work run one page's reads at a time.
export function readPoolIdle(): Promise<void> {
  if (!waiting.size) return Promise.resolve();
  return new Promise((resolve) => { idleWaiters.push(resolve); });
}

function slot(): Slot {
  if (slots.length < POOL_SIZE) {
    const worker = new Worker(new URL('./read-thread.ts', import.meta.url));
    // Idle readers must not keep a finished process (or test run) alive.
    worker.unref();
    const created: Slot = { worker, busy: 0 };
    worker.on('message', (message: { id: number; value?: unknown; error?: string }) => {
      const request = waiting.get(message.id);
      if (!request) return;
      waiting.delete(message.id);
      created.busy--;
      if (message.error !== undefined) request.reject(new Error(message.error));
      else request.resolve(message.value);
      settled();
    });
    const fail = (error: Error) => {
      slots.splice(slots.indexOf(created), 1);
      for (const [id, request] of waiting) {
        if (request.slot !== created) continue;
        waiting.delete(id);
        request.reject(error);
      }
      settled();
    };
    worker.on('error', fail);
    worker.on('exit', (code) => fail(new Error(`Read thread exited (${code})`)));
    slots.push(created);
    return created;
  }
  return slots.reduce((best, candidate) => candidate.busy < best.busy ? candidate : best);
}

export function readOffThread<K extends ReadKind>(
  repository: Repository,
  databasePath: string,
  kind: K,
  args: ReadRequests[K],
): Promise<unknown> {
  // An in-memory database cannot be opened from another thread (tests).
  if (databasePath === ':memory:') return Promise.resolve(runRead(repository, kind, args));
  const target = slot();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject, slot: target });
    target.busy++;
    target.worker.ref();
    target.worker.postMessage({ id, databasePath, kind, args });
  }).finally(() => { if (!target.busy) target.worker.unref(); });
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
