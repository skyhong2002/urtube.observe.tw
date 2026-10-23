import type { Repository } from './database.js';

// Cache data, never authorization or rendered HTML. Repository identity keeps
// different registries/accounts isolated, even if their handles are identical.
let caches = new WeakMap<Repository, Map<string, { revision: string; at: number; value: unknown }>>();

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

// For reads computed elsewhere (a read thread). Concurrent requests share one
// computation. The revision is taken before the read starts, so a write that
// lands meanwhile makes the next request recompute.
//
// staleFor > 0 (stale-while-revalidate): an entry younger than staleFor is
// returned even after a write, while one recompute runs in the background.
// The worker's bookkeeping writes change every archive's revision every few
// minutes, so without this each public view recomputed. Only for data, never
// for authorization: callers check access on every request.
export async function cachedReadAsync<T>(repository: Repository, key: string, read: () => Promise<T>, ttl = 300_000, staleFor = 0): Promise<T> {
  let cache = caches.get(repository);
  if (!cache) {
    cache = new Map();
    caches.set(repository, cache);
  }
  const revision = repository.readRevision();
  const entry = cache.get(key);
  if (entry && entry.revision === revision && Date.now() - entry.at < ttl) return entry.value as T;
  let inflight = pending.get(repository);
  if (!inflight) {
    inflight = new Map();
    pending.set(repository, inflight);
  }
  const stale = entry && Date.now() - entry.at < staleFor ? entry : undefined;
  const existing = inflight.get(key);
  if (existing) return stale ? stale.value as T : existing as Promise<T>;
  const store = cache;
  const requests = inflight;
  const promise = read().then((value) => {
    if (store.size >= 128) store.delete(store.keys().next().value!);
    store.set(key, { revision, at: Date.now(), value });
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
