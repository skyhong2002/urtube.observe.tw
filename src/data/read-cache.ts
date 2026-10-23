import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { renameSync, rmdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Repository } from './database.js';
import { logTiming, SLOW_MS } from '../timing.js';
import { currentlyBackground, promoteReads, withReadPriority, type ReadPriority } from '../read-pool.js';

// Cache data, never authorization or rendered HTML. Repository identity keeps
// different registries/accounts isolated, even if their handles are identical.
// projected: loaded from a durable copy (a public projection). Never returned
// to a request that asked for current data (staleFor 0).
type Entry = { revision: string; at: number; value: unknown; guard?: string; projected?: boolean };
let caches = new WeakMap<Repository, Map<string, Entry>>();

type Inflight = { promise: Promise<unknown>; priority: ReadPriority };
let pending = new WeakMap<Repository, Map<string, Inflight>>();

export function clearReadCaches(): void {
  caches = new WeakMap();
  pending = new WeakMap();
}

export function cachedRead<T>(repository: Repository, key: string, read: () => T, ttl = 300_000): T {
  let cache = caches.get(repository);
  if (!cache) {
    cache = new Map();
    caches.set(repository, cache);
  }
  const entry = cache.get(key);
  if (entry && entry.revision === repository.readRevision() && Date.now() - entry.at < ttl) {
    return entry.value as T;
  }
  const value = read();
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  // Aggregate reads can materialize a TEMP table, advancing total_changes.
  cache.set(key, { revision: repository.readRevision(), at: Date.now(), value });
  return value;
}


// Owner imports (Takeout, data portability, extension history) are recorded in
// youtube_imports. An entry computed before an import is never served stale
// after it. Memoized per revision; the table is a handful of rows.
const guards = new WeakMap<Repository, { revision: string; guard: string }>();
function importGuard(repository: Repository, revision: string): string {
  const known = guards.get(repository);
  if (known?.revision === revision) return known.guard;
  const guard = repository.youtubeImportMark();
  guards.set(repository, { revision, guard });
  return guard;
}

// A durable copy of each public aggregate lets the first visitor after a
// restart be served without recomputing it: cold, one archive took up to 70 s
// of disk reads on the production host (2026-10-23). Copies sit next to the
// archive (directory 0700, files 0600). Each is keyed by its owner's user ID,
// the read key and the read's version. It holds only the public projection the
// caller supplies, and is used only by requests that accept stale data
// (staleFor > 0), never by the owner, and never after an import.
export interface DurableRead {
  path: string;
  subject: number;
  // Bump when the read's calculation or shape changes; old copies are ignored.
  version: string;
  // What may be written to disk: no individual watches or private fields.
  project: (value: unknown) => unknown;
  // Rejects a copy whose shape does not match what callers expect.
  valid: (value: unknown) => boolean;
}
const DURABLE_FORMAT = 1;
const durableDir = (path: string) => `${path}-aggregates`;
const durableFile = (durable: DurableRead, key: string) =>
  join(durableDir(durable.path), `${createHash('sha256').update(`${DURABLE_FORMAT}\0${durable.version}\0${durable.subject}\0${key}`).digest('hex').slice(0, 40)}.json`);

// Per archive, in this process. forgetDurableReads advances it; a read or a
// write that started under an earlier generation neither saves nor returns.
const generations = new Map<string, number>();
const generationOf = (path: string) => generations.get(path) ?? 0;
// Start time of the newest computation written per file, so an older refresh
// that finishes later never replaces a newer copy.
const written = new Map<string, number>();

async function loadDurable(durable: DurableRead, key: string): Promise<Entry | undefined> {
  try {
    const saved = JSON.parse(await readFile(durableFile(durable, key), 'utf8')) as Record<string, unknown>;
    if (saved.format !== DURABLE_FORMAT || saved.version !== durable.version || saved.subject !== durable.subject
      || saved.key !== key || typeof saved.at !== 'number' || typeof saved.guard !== 'string' || !durable.valid(saved.value)) return undefined;
    // An empty revision never matches, so a loaded entry is always refreshed.
    return { revision: '', at: saved.at, guard: saved.guard, value: saved.value, projected: true };
  } catch { return undefined; }
}

async function saveDurable(durable: DurableRead, key: string, entry: Entry, generation: number, startedAt: number): Promise<void> {
  const directory = durableDir(durable.path);
  const file = durableFile(durable, key);
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  const current = () => generationOf(durable.path) === generation && (written.get(file) ?? -1) <= startedAt;
  if (!current()) return;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(temporary, JSON.stringify({
      format: DURABLE_FORMAT, version: durable.version, subject: durable.subject, key,
      at: entry.at, guard: entry.guard, value: durable.project(entry.value),
    }), { mode: 0o600, flag: 'wx' });
    // Synchronous from the check to the rename: forgetDurableReads runs on this
    // thread too, so it cannot interleave.
    if (!current()) throw new Error('superseded');
    renameSync(temporary, file);
    written.set(file, startedAt);
  } catch {
    rmSync(temporary, { force: true });
    // A forgotten archive keeps no directory, not even one recreated empty.
    if (generationOf(durable.path) !== generation) {
      try { rmdirSync(directory); } catch { /* not empty or already gone */ }
    }
  }
}

// Called when an archive is imported into, deleted or replaced.
export function forgetDurableReads(path: string): void {
  if (path === ':memory:') return;
  generations.set(path, generationOf(path) + 1);
  rmSync(durableDir(path), { recursive: true, force: true });
}

export interface AsyncReadOptions {
  // Stale-while-revalidate (> 0): an entry younger than staleFor is returned
  // even after a write, while one recompute runs in the background. The
  // worker's bookkeeping writes change every archive's revision every few
  // minutes, so without this each public view recomputed. Data only, never
  // authorization: callers check access on every request.
  staleFor?: number;
  // A stale entry younger than this is served without starting a recompute,
  // so frequent visits do not keep the read threads rebuilding aggregates.
  refreshAfter?: number;
  // The archive's path: a computation spanning forgetDurableReads for it is
  // discarded, for the owner too.
  archive?: string;
  // Only together with staleFor > 0.
  durable?: DurableRead;
  // false: the value is not kept in this process's memory (only on disk, if
  // durable). For large inputs that are reduced right away: kept in memory,
  // they were swapped out between visits and paging them back in stalled the
  // request thread for seconds (2026-10-23).
  memory?: boolean;
}

// For reads computed elsewhere (a read thread). Concurrent requests share one
// computation. The revision is taken before the read starts, so a write that
// lands meanwhile makes the next request recompute.
export async function cachedReadAsync<T>(repository: Repository, key: string, read: () => Promise<T>, ttl = 300_000,
  options: AsyncReadOptions = {}): Promise<T> {
  // Timing metadata only: the key's first segment (a read name) and the path taken.
  const started = performance.now();
  const decision = { name: 'compute' };
  try {
    return await cachedReadAsyncInner(repository, key, read, ttl, options, decision);
  } finally {
    const waitMs = performance.now() - started;
    if (waitMs >= SLOW_MS) logTiming('cache-read', { read: key.split(':')[0], decision: decision.name, waitMs: Math.round(waitMs), owner: options.staleFor ? 0 : 1 });
  }
}

async function cachedReadAsyncInner<T>(repository: Repository, key: string, read: () => Promise<T>, ttl: number,
  { staleFor = 0, refreshAfter = 0, archive, durable: requested, memory = true }: AsyncReadOptions, decision: { name: string }): Promise<T> {
  const durable = staleFor > 0 && requested && requested.path !== ':memory:' ? requested : undefined;
  let cache = memory ? caches.get(repository) : new Map<string, Entry>();
  if (!cache) {
    cache = new Map();
    caches.set(repository, cache);
  }
  let entry = cache.get(key);
  if (entry && !entry.projected && entry.revision === repository.readRevision() && Date.now() - entry.at < ttl) {
    decision.name = 'fresh';
    return entry.value as T;
  }
  let loadedFromDisk = false;
  if (!entry && durable) {
    const store = cache;
    const generation = generationOf(durable.path);
    const loaded = await loadDurable(durable, key);
    // Forgotten (import, deletion) while the file was read: discard it.
    const usable = loaded && generationOf(durable.path) === generation ? loaded : undefined;
    // Another request may have filled the cache meanwhile; keep the newer one.
    const current = store.get(key);
    if (current && (!usable || current.at >= usable.at)) entry = current;
    else if (usable) {
      entry = usable;
      store.set(key, usable);
      loadedFromDisk = true;
    }
  }
  // Taken after any await above, so an import that landed meanwhile counts.
  const revision = repository.readRevision();
  const guard = importGuard(repository, revision);
  let inflight = pending.get(repository);
  if (!inflight) {
    inflight = new Map();
    pending.set(repository, inflight);
  }
  const stale = staleFor > 0 && entry && entry.guard === guard && Date.now() - entry.at < staleFor ? entry : undefined;
  const source = loadedFromDisk ? 'disk' : 'memory';
  const existing = inflight.get(key);
  if (existing) {
    decision.name = stale ? `stale-${source}` : `join-inflight${durable && !entry ? '-disk-miss' : ''}`;
    if (stale) return stale.value as T;
    // A request now waits for it: queued background work becomes a request.
    if (!currentlyBackground()) promoteReads(existing.priority);
    return existing.promise as Promise<T>;
  }
  if (stale && Date.now() - stale.at < refreshAfter) {
    decision.name = `stale-${source}`;
    return stale.value as T;
  }
  decision.name = stale ? `stale-${source}+refresh` : durable && !entry ? 'compute-disk-miss' : 'compute';
  const store = cache;
  const requests = inflight;
  const path = archive ?? requested?.path;
  // A computation that spans forgetDurableReads (an import into or deletion of
  // this archive) is discarded and run once more; it is never returned.
  const compute = async (attempt: number): Promise<T> => {
    const startRevision = attempt ? repository.readRevision() : revision;
    const startGuard = attempt ? importGuard(repository, startRevision) : guard;
    const generation = path ? generationOf(path) : 0;
    const startedAt = Date.now();
    const value = await read();
    if (path && generationOf(path) !== generation) {
      if (attempt) throw new Error('archive changed during read');
      return compute(1);
    }
    if (store.size >= 128) store.delete(store.keys().next().value!);
    const fresh: Entry = { revision: startRevision, at: Date.now(), value, guard: startGuard };
    store.set(key, fresh);
    if (durable) void saveDurable(durable, key, fresh, generation, startedAt);
    return value;
  };
  // Background for the read pool: a refresh behind a stale value, or any read
  // started by background work (start-up warming, landing statistics).
  const priority: ReadPriority = { background: Boolean(stale) || currentlyBackground() };
  const promise = withReadPriority(priority, () => compute(0)).finally(() => requests.delete(key));
  inflight.set(key, { promise, priority });
  if (stale) {
    // A failed background refresh keeps the previous entry until staleFor.
    promise.catch(() => {});
    return stale.value as T;
  }
  return promise;
}
