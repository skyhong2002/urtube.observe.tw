import type { Compute } from './compute.js';
import { compareProfiles } from './matching.js';
import { digest, type Genre, type Profile } from './model.js';
import type { MatchingStore } from './store.js';
import { blendKeywords } from '../output/blend-keywords.js';

type Result = Awaited<ReturnType<typeof compareProfiles>> & { keywords: Partial<Record<Genre, string[]>> };
interface CachedScore { revision: string; result: Result }

// Ordered account IDs preserve directional explanations; the exact genre set
// prevents a broader cached selection from leaking into a narrower request.
export async function cachedScore(store: MatchingStore, leftId: number, rightId: number,
  left: Profile, right: Profile, genres: Genre[], compute: Compute): Promise<Result | null> {
  const selection = [...genres].sort();
  const key = JSON.stringify(selection);
  const cached = store.score<CachedScore>(leftId, rightId, key);
  if (left.version !== right.version) return cached?.result ?? null;
  const ready = store.status(leftId)?.state === 'done' && store.status(rightId)?.state === 'done';
  if (cached && !ready) return cached.result;
  const revision = digest([left.version, left.builtAt, right.builtAt, left.sourceFingerprint,
    right.sourceFingerprint, left.complete, right.complete, ready]);
  if (cached?.revision === revision) return cached.result;
  try {
    const compared = await compareProfiles({ ...left, complete: left.complete && ready },
      { ...right, complete: right.complete && ready }, selection, compute);
    if (compared.score === null) return cached?.result ?? { ...compared, keywords: {} };
    const result = { ...compared, keywords: Object.fromEntries(selection.map(genre =>
      [genre, blendKeywords(left, right, [genre], 12)])) };
    // Never let a superseded async calculation overwrite a newer snapshot.
    if (store.profile(leftId)?.builtAt === left.builtAt && store.profile(rightId)?.builtAt === right.builtAt
      && store.profile(leftId)?.version === left.version && store.profile(rightId)?.version === right.version) {
      store.saveScore(leftId, rightId, key, { revision, result });
    }
    return result;
  } catch (error) {
    if (cached) return cached.result;
    throw error;
  }
}
