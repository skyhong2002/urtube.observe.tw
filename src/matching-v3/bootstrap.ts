import { randomUUID } from 'node:crypto';
import type { UserRegistry } from '../users.js';
import { GENRES, version, type Settings } from './model.js';
import { sourceKey } from './store.js';

// Explicit administrator action; never run this on ordinary worker startup.
export function bootstrapMatching(registry: UserRegistry, s: Settings) {
  const store = registry.matchingV3Store();
  let initialized = 0, scheduled = 0, optedOut = 0;
  for (const user of registry.listUsers()) {
    if (!user.matchingOptIn) optedOut++;
    if (user.matchingOptIn && !store.hasPreferences(user.id)) {
      store.savePreferences(user.id, { genres: [...GENRES],
        topics: [{ id: randomUUID(), name: '探索共同興趣', genres: [...GENRES] }] });
      initialized++;
    }
    const source = registry.repositoryFor(user).matchingV3Source();
    store.schedule(user.id, sourceKey(source.fingerprint, { genres: [...GENRES], topics: [] }), version(s));
    scheduled++;
  }
  return { initialized, scheduled, optedOut };
}
