import { createDispatchLimiter } from './dispatch.js';
import { type AsyncLimiter } from '../youtube/concurrency.js';
import { GENRES, CHANNEL_TYPES, CONTENT_GENRES, digest, version, type Classification, type Genre, type GenreProfile, type Profile, type Settings, type SourceSnapshot, type TagPoint, type VideoInput } from './model.js';
import type { Compute } from './compute.js';
import { PartialClassificationError, ProviderError, type Provider } from './provider.js';
import { MatchingStore, sourceKey, type JobProgress } from './store.js';
import type { UserRegistry } from '../users.js';

// One API gate and in-flight cache map per registry, shared by every account.
const workStates = new WeakMap<MatchingStore, { limit: AsyncLimiter; embeddingLimit: AsyncLimiter; pending: Map<string, Promise<void>> }>();
async function settleWork(work: Promise<unknown>[]) {
  const results = await Promise.allSettled(work);
  const failed = results.find(r => r.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

export class CycleBudgetReached extends Error {}
export class DailyBudgetReached extends Error {}
export const classificationKey = (s: Settings, video: VideoInput) => digest(['video-classification-3', s.classificationCacheNamespace, s.classificationModel, video.id, video.title, video.tags.filter(t => t.length <= 100).slice(0, 30)]);
export const embeddingKey = (s: Settings, text: string) => digest(['tag-embedding-2', s.embeddingBaseUrl, s.embeddingModel, s.task, s.dimensions, text]);

export function aggregateTags(videos: VideoInput[], classifications: Map<string, Classification>, genre: Genre) {
  const tags = new Map<string, { count: number; generatedCount: number }>();
  let videoCount = 0;
  for (const video of new Map(videos.map(v => [v.id, v])).values()) {
    const classification = classifications.get(video.id);
    const assigned = new Set(classification?.assignments.filter(a => a.genre === genre).flatMap(a => a.tags) ?? []);
    if (classification?.assignments.some(a => a.genre === genre)) videoCount++;
    for (const text of assigned) {
      const entry = tags.get(text) ?? { count: 0, generatedCount: 0 };
      entry.count++;
      entry.generatedCount += classification?.tagSource === 'generated' ? 1 : 0;
      tags.set(text, entry);
    }
  }
  return { tags, videoCount };
}

export async function buildProfile(
  source: SourceSnapshot, genres: Genre[], store: MatchingStore, s: Settings,
  provider: Provider, compute: Compute, beforeCall: () => void = () => {},
  progress: (value: JobProgress) => void = () => {},
): Promise<Profile> {
  let state = workStates.get(store);
  if (!state) { state = { limit: createDispatchLimiter(s.concurrency), embeddingLimit: createDispatchLimiter(Infinity), pending: new Map() }; workStates.set(store, state); }
  const { limit, embeddingLimit, pending } = state;
  const call = <T>(work: () => Promise<T>) => limit(async () => { beforeCall(); return work(); });
  // Register before yielding so overlapping accounts share the same paid work.
  function cachedWork(keys: string[], work: () => Promise<void>): Promise<void> {
    const waits = keys.map(key => pending.get(key)).filter((p): p is Promise<void> => !!p);
    if (waits.length) return settleWork(waits).then(() => cachedWork(keys, work));
    const task = Promise.resolve().then(work).finally(() => { for (const key of keys) pending.delete(key); });
    for (const key of keys) pending.set(key, task);
    return task;
  }
  const classifications = new Map<string, Classification>();
  const contentRequested = genres.some(g => g !== 'channel type');
  // Warm vectors as classification batches land, not only after an entire
  // large account finishes classification. Resume unfinished vector batches.
  async function warmEmbeddings(tags: string[]) {
    const unique = [...new Set(tags)].sort();
    const missing = unique.filter(text => !store.cache(embeddingKey(s, text)));
    const tasks: Promise<unknown>[] = [];
    for (let offset = 0; offset < missing.length; offset += 64) {
      const batch = missing.slice(offset, offset + 64);
      tasks.push(cachedWork(batch.map(text => embeddingKey(s, text)), async () => {
        const remaining = batch.filter(text => !store.cache(embeddingKey(s, text)));
        if (!remaining.length) return;
        const vectors = await embeddingLimit(async () => { beforeCall(); return provider.embed(remaining); });
        if (vectors.length !== remaining.length) throw new Error('Embedding count mismatch');
        vectors.forEach((vector, i) => store.putCache(embeddingKey(s, remaining[i]), vector));
      }));
    }
    await settleWork(tasks);
    progress({ phase: 'embedding', processed: unique.length, total: unique.length });
  }
  if (contentRequested && provider.classifyBatch) {
    const missing = source.videos.filter(v => !store.cache(classificationKey(s, v)));
    let processed = source.videos.length - missing.length;
    progress({ phase: 'classification', processed, total: source.videos.length });
    const tasks: Promise<unknown>[] = [];
    // Cached vectors and every classification batch are eligible immediately.
    tasks.push(warmEmbeddings(source.videos.flatMap(v => store.cache<Classification>(classificationKey(s, v))?.tags ?? [])));
    for (let offset = 0; offset < missing.length; offset += s.classificationBatchSize) {
      const batch = missing.slice(offset, offset + s.classificationBatchSize);
      tasks.push(cachedWork(batch.map(v => classificationKey(s, v)), async () => {
        const remaining = batch.filter(v => !store.cache(classificationKey(s, v)));
        if (!remaining.length) return;
        let partial: PartialClassificationError | null = null;
        let results: (Classification | null)[];
        try { results = await call(() => provider.classifyBatch!(remaining)); }
        catch (error) { if (!(error instanceof PartialClassificationError)) throw error; partial = error; results = error.results; }
        if (results.length !== remaining.length) throw new Error('Classification batch count mismatch');
        results.forEach((result, i) => { if (result) store.putCache(classificationKey(s, remaining[i]), result); });
        processed += results.filter(Boolean).length;
        progress({ phase: 'classification', processed, total: source.videos.length });
        await warmEmbeddings(results.flatMap(result => result?.tags ?? []));
        if (partial) throw partial;
      }));
    }
    // Keep the lease until all dispatched work settles, including on failure.
    await settleWork(tasks);
  }
  if (contentRequested) for (const video of source.videos) {
    const key = classificationKey(s, video);
    let classification = store.cache<Classification>(key);
    const uncached = !classification;
    if (!classification) {
      classification = await call(() => provider.classify(video));
      store.putCache(key, classification);
    }
    classifications.set(video.id, classification);
    if (uncached || classifications.size % 25 === 0 || classifications.size === source.videos.length) {
      progress({ phase: 'classification', processed: classifications.size, total: source.videos.length });
    }
  }
  if (contentRequested) await warmEmbeddings([...classifications.values()].flatMap(c => c.tags));
  const profiles: Profile['genres'] = {};
  const uncertain = contentRequested && [...classifications.values()].some(c => !c.assignments.length);
  for (const genre of CONTENT_GENRES.filter(g => genres.includes(g))) {
    const { tags, videoCount } = aggregateTags(source.videos, classifications, genre);
    const missing = [...tags.keys()].filter(text => !store.cache(embeddingKey(s, text))).sort();
    progress({ phase: 'embedding', genre, processed: tags.size - missing.length, total: tags.size });
    await warmEmbeddings([...tags.keys()]);
    const points: TagPoint[] = [...tags.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([text, counts]) => ({
      text, ...counts, vector: store.cache<number[]>(embeddingKey(s, text))!,
    }));
    // Explicitly fail, never silently truncate a large user profile.
    if (points.length > 10000) throw new Error('Genre exceeds 10000 unique tags');
    const result = points.length ? await compute.cluster(points) : { clusters: [], totalMass: 0, retainedCoverage: 0 };
    profiles[genre] = { ...result, videoCount,
      status: !source.videos.length || uncertain || (videoCount > 0 && tags.size === 0) || (points.length > 0 && result.retainedCoverage < 0.5) ? 'insufficient' : result.clusters.length ? 'ready' : 'empty' };
  }
  if (genres.includes('channel type')) {
    progress({ phase: 'channels', processed: 0, total: source.videos.length });
    const counts = new Map<string, number>();
    let videoCount = 0;
    let unknown = false;
    const channels = [...new Map(source.videos.filter(v => v.channelId).map(v => [v.channelId, v])).values()];
    await settleWork(channels.map(video => {
      const key = digest(['channel-types-2', s.classificationCacheNamespace, s.classificationModel, video.channelId]);
      return cachedWork([key], async () => {
        let value = store.cache<{ types: string[]; evidenceAvailable: boolean }>(key, 30 * 86400_000);
        if (value && !value.evidenceAvailable) value = store.cache(key, 300_000);
        if (value) return;
        store.putCache(key, await call(() => provider.channel(video.channelId!, video.channelTitle ?? '')));
      });
    }));
    for (const video of source.videos) {
      if (!video.channelId) { unknown = true; continue; }
      const key = digest(['channel-types-2', s.classificationCacheNamespace, s.classificationModel, video.channelId]);
      let channel = store.cache<{ types: string[]; evidenceAvailable: boolean }>(key, 30 * 86400_000);
      if (channel && !channel.evidenceAvailable) channel = store.cache(key, 300_000);
      if (!channel) {
        channel = await call(() => provider.channel(video.channelId!, video.channelTitle ?? ''));
        store.putCache(key, channel);
      }
      if (!channel.evidenceAvailable || !channel.types.length) { unknown = true; continue; }
      videoCount++;
      for (const type of channel.types) counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    const totalMass = [...counts.values()].reduce((a, b) => a + b, 0);
    profiles['channel type'] = {
      videoCount, totalMass, retainedCoverage: source.videos.length ? videoCount / source.videos.length : 0,
      status: !source.videos.length || unknown ? 'insufficient' : totalMass ? 'ready' : 'empty',
      clusters: CHANNEL_TYPES.filter(type => counts.has(type)).map(type => ({
        centroid: CHANNEL_TYPES.map(t => t === type ? 1 : 0), mass: counts.get(type)!, share: counts.get(type)! / totalMass,
        tags: [{ text: type, count: counts.get(type)!, generatedCount: 0 }],
      })),
    };
  }
  return { version: version(s), sourceFingerprint: source.fingerprint, builtAt: new Date().toISOString(),
    complete: source.complete, totalVideos: source.videos.length,
    processedVideos: contentRequested ? classifications.size : profiles['channel type']?.videoCount ?? 0,
    genres: profiles };
}

export async function runCycle(registry: UserRegistry, s: Settings, provider: Provider, compute: Compute, shouldStop: () => boolean = () => false): Promise<void> {
  if (!s.enabled) return;
  const store = registry.matchingV3Store();
  const users = registry.listUsers();
  const allGenres = { genres: [...GENRES], topics: [] };
  for (const user of users) {
    const source = registry.repositoryFor(user).matchingV3Source(s.backfillVideoLimit);
    store.schedule(user.id, sourceKey(source.fingerprint, allGenres), version(s));
  }
  let calls = 0;
  // Each user gets at most one attempt per cycle. Persistent cache resumes a
  // large import next cycle without rerunning successful API work.
  const visited: number[] = [];
  let attempts = 0;
  const drain = s.callsPerCycle === 0;
  async function consume() {
  while (!shouldStop() && (drain || attempts++ < users.length)) {
    const job = store.claim(Date.now(), drain ? [] : visited);
    if (!job) {
      const wait = drain ? store.queuedWorkDelay() : null;
      if (wait === null) break;
      await new Promise(resolve => setTimeout(resolve, wait));
      continue;
    }
    visited.push(job.userId);
    const leaseTimer = setInterval(() => {
      try { store.heartbeat(job); } catch { /* final activation also checks the lease token */ }
    }, 30_000);
    try {
      const user = users.find(u => u.id === job.userId);
      if (!user) { store.defer(job, 'User no longer opted in', true); continue; }
      const source = registry.repositoryFor(user).matchingV3Source(s.backfillVideoLimit);
      if (sourceKey(source.fingerprint, allGenres) !== job.fingerprint) {
        store.schedule(user.id, sourceKey(source.fingerprint, allGenres), version(s));
        continue;
      }
      const profile = await buildProfile(source, [...GENRES], store,
        { ...s, classificationBatchSize: Math.max(1, s.classificationBatchSize >> Math.min(job.attempts, 3)) }, provider, compute, () => {
        store.heartbeat(job);
        if (shouldStop() || (s.callsPerCycle > 0 && calls >= s.callsPerCycle)) throw new CycleBudgetReached();
        if (!store.reserveApiCall(s.dailyApiCalls)) throw new DailyBudgetReached();
        calls++;
      }, value => store.progress(job, value));
      const currentUser = registry.listUsers().find(u => u.id === user.id);
      const current = registry.repositoryFor(user).matchingV3Source(s.backfillVideoLimit);
      if (!currentUser || sourceKey(current.fingerprint, allGenres) !== job.fingerprint) {
        if (currentUser) store.schedule(user.id, sourceKey(current.fingerprint, allGenres), version(s));
        else store.defer(job, 'user_deleted', true);
        continue;
      }
      store.heartbeat(job);
      store.finish(job, profile);
    } catch (error) {
      if (error instanceof DailyBudgetReached) {
        store.defer(job, 'daily_budget_reached', false, (Math.floor(Date.now() / 86400_000) + 1) * 86400_000);
        break;
      }
      if (error instanceof CycleBudgetReached) { store.defer(job, null); break; }
      const transient = error instanceof ProviderError && error.retryable
        || error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
      const permanent = !transient && (error instanceof ProviderError || job.attempts >= 4);
      // Provider bodies may contain inputs or credentials: persist only safe codes.
      store.defer(job, error instanceof ProviderError ? `provider_http_${error.status}`
        : error instanceof PartialClassificationError ? 'partial_classification_retry'
        : error instanceof SyntaxError ? 'invalid_provider_json'
        : error instanceof Error && error.name === 'ZodError' ? 'invalid_provider_schema'
        : error instanceof Error && error.message === 'Invalid batch tag index' ? 'invalid_provider_tag_index'
        : error instanceof Error && error.message === 'Batch attempted to replace original tags' ? 'provider_replaced_tags'
        : error instanceof Error && error.name === 'TimeoutError' ? 'provider_timeout' : 'processing_failed', permanent);
    } finally { clearInterval(leaseTimer); }
  }
  }
  await Promise.all(Array.from({ length: Math.min(s.concurrency, users.length) }, () => consume()));
}
