import type { Repository } from './database.js';

// Cache data, never authorization or rendered HTML. Repository identity keeps
// different registries/accounts isolated, even if their handles are identical.
let caches = new WeakMap<Repository, Map<string, { revision: string; at: number; value: unknown }>>();

export function clearReadCaches(): void {
  caches = new WeakMap();
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
