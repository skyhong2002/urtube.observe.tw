import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Repository } from './database.js';

// Cache data, never authorization or rendered HTML. Repository identity keeps
// different registries/accounts isolated, even if their handles are identical.
type Entry = { revision: string; at: number; value: unknown; guard?: string };
let caches = new WeakMap<Repository, Map<string, Entry>>();

let pending = new WeakMap<Repository, Map<string, Promise<unknown>>>();

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

// A durable copy of each aggregate lets the first visitor after a restart be
// served without recomputing it: cold, one archive took up to 70 s of disk
// reads on the production host (2026-10-23). Files sit next to the archive,
// are keyed by its owner's user ID, and hold the same projection the read
// returned. Never served to the owner (staleFor 0) and never after an import.
export interface DurableRead { path: string; subject: number }
const durableDir = (path: string) => `${path}-aggregates`;
const durableFile = (durable: DurableRead, key: string) =>
  join(durableDir(durable.path), `${createHash('sha256').update(`${durable.subject}\0${key}`).digest('hex').slice(0, 40)}.json`);

async function loadDurable(durable: DurableRead, key: string): Promise<Entry | undefined> {
  try {
    const saved = JSON.parse(await readFile(durableFile(durable, key), 'utf8')) as { subject: number; key: string; at: number; guard: string; value: unknown };
    if (saved.subject !== durable.subject || saved.key !== key) return undefined;
    // An empty revision never matches, so a loaded entry is always refreshed.
    return { revision: '', at: saved.at, guard: saved.guard, value: saved.value };
  } catch { return undefined; }
}

async function saveDurable(durable: DurableRead, key: string, entry: Entry): Promise<void> {
  const file = durableFile(durable, key);
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await mkdir(durableDir(durable.path), { recursive: true });
    await writeFile(temporary, JSON.stringify({ subject: durable.subject, key, at: entry.at, guard: entry.guard, value: entry.value }));
    await rename(temporary, file);
  } catch {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

// Called when an archive is imported into, deleted or replaced.
export function forgetDurableReads(path: string): void {
  if (path !== ':memory:') rmSync(durableDir(path), { recursive: true, force: true });
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
  durable?: DurableRead;
}

// For reads computed elsewhere (a read thread). Concurrent requests share one
// computation. The revision is taken before the read starts, so a write that
// lands meanwhile makes the next request recompute.
export async function cachedReadAsync<T>(repository: Repository, key: string, read: () => Promise<T>, ttl = 300_000,
  { staleFor = 0, refreshAfter = 0, durable }: AsyncReadOptions = {}): Promise<T> {
  let cache = caches.get(repository);
  if (!cache) {
    cache = new Map();
    caches.set(repository, cache);
  }
  const revision = repository.readRevision();
  let entry = cache.get(key);
  if (entry && entry.revision === revision && Date.now() - entry.at < ttl) return entry.value as T;
  const guard = importGuard(repository, revision);
  if (!entry && staleFor > 0 && durable && durable.path !== ':memory:') {
    const store = cache;
    entry = await loadDurable(durable, key);
    // Another request may have filled the cache meanwhile; keep the newer one.
    const current = store.get(key);
    if (current && (!entry || current.at >= entry.at)) entry = current;
    else if (entry) store.set(key, entry);
  }
  let inflight = pending.get(repository);
  if (!inflight) {
    inflight = new Map();
    pending.set(repository, inflight);
  }
  const stale = entry && entry.guard === guard && Date.now() - entry.at < staleFor ? entry : undefined;
  const existing = inflight.get(key);
  if (existing) return stale ? stale.value as T : existing as Promise<T>;
  if (stale && Date.now() - stale.at < refreshAfter) return stale.value as T;
  const store = cache;
  const requests = inflight;
  const promise = read().then((value) => {
    if (store.size >= 128) store.delete(store.keys().next().value!);
    const fresh: Entry = { revision, at: Date.now(), value, guard };
    store.set(key, fresh);
    if (durable && durable.path !== ':memory:') void saveDurable(durable, key, fresh);
    return value;
  }).finally(() => requests.delete(key));
  inflight.set(key, promise);
  if (stale) {
    // A failed background refresh keeps the previous entry until staleFor.
    promise.catch(() => {});
    return stale.value as T;
  }
  return promise;
}
