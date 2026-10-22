import { createDispatchLimiter } from './dispatch.js';
import { yieldToEventLoop } from '../event-loop-turns.js';
import { type AsyncLimiter } from '../youtube/concurrency.js';
import { assessProfileAvailability, classificationInput, GENRES, CHANNEL_TYPES, CONTENT_GENRES, digest, version, type Classification, type Genre, type GenreProfile, type Profile, type Settings, type SourceSnapshot, type TagPoint, type VideoInput } from './model.js';
import type { Compute } from './compute.js';
import { BatchKeyMismatchError, PartialClassificationError, ProviderError, type Provider } from './provider.js';
import { MatchingStore, sourceKey, type JobProgress } from './store.js';
import type { UserRegistry } from '../users.js';

// One API gate and in-flight cache map per registry, shared by every account.
const workStates = new WeakMap<MatchingStore, { limit: AsyncLimiter; embeddingLimit: AsyncLimiter; pending: Map<string, Promise<void>> }>();
async function settleWork(work: Promise<unknown>[]) {
  const results = await Promise.allSettled(work);
  const failed = results.find(r => r.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

type ChannelResult = Awaited<ReturnType<Provider['channel']>>;
const CHANNEL_CACHE_MS = 30 * 86400_000;
const CHANNEL_LOOKUP_CHUNK = 200;

export class CycleBudgetReached extends Error {}
export class DailyBudgetReached extends Error {}
export const classificationKey = (s: Settings, video: VideoInput) => {
  const input = classificationInput(video);
  return digest(['video-classification-4', s.classificationCacheNamespace, s.classificationCacheModel, video.id, input.title, input.tags]);
};
// The previous key hashed only the first 30 tags of at most 100 characters
// while the provider saw every tag. Its entries stay in place and are read only
// when they provably answer the current input; nothing is cleared or migrated.
export const legacyClassificationKey = (s: Settings, video: VideoInput) => digest(['video-classification-3', s.classificationCacheNamespace, s.classificationCacheModel, video.id, video.title, video.tags.filter(t => t.length <= 100).slice(0, 30)]);
export function cachedClassification(store: MatchingStore, s: Settings, video: VideoInput): Classification | null {
  const current = store.cache<Classification>(classificationKey(s, video));
  if (current) return current;
  const legacy = store.cache<Classification>(legacyClassificationKey(s, video));
  if (!legacy) return null;
  // The title is in both keys. An original result records every tag the
  // provider saw, so it is valid exactly when that set equals today's input.
  // Generated results (retired tag generation) only exist for tagless videos.
  const { tags } = classificationInput(video);
  const seen = [...new Set(legacy.tags)].sort();
  const valid = legacy.tagSource === 'original'
    ? seen.length === tags.length && seen.every((tag, i) => tag === tags[i])
    : !tags.length;
  return valid ? legacy : null;
}
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
    const missing = source.videos.filter(v => !cachedClassification(store, s, v));
    let processed = source.videos.length - missing.length;
    progress({ phase: 'classification', processed, total: source.videos.length });
    const tasks: Promise<unknown>[] = [];
    // Cached vectors and every classification batch are eligible immediately.
    tasks.push(warmEmbeddings(source.videos.flatMap(v => cachedClassification(store, s, v)?.tags ?? [])));
    for (let offset = 0; offset < missing.length; offset += s.classificationBatchSize) {
      const batch = missing.slice(offset, offset + s.classificationBatchSize);
      tasks.push(cachedWork(batch.map(v => classificationKey(s, v)), async () => {
        const remaining = batch.filter(v => !cachedClassification(store, s, v));
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
    let classification = cachedClassification(store, s, video);
    const uncached = !classification;
    if (!classification) {
      classification = await call(() => provider.classify(video));
      store.putCache(classificationKey(s, video), classification);
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
    if (points.length > 250000) throw new Error('Genre exceeds 250000 unique tags');
    const result = points.length ? await compute.cluster(points) : { clusters: [], totalMass: 0, retainedCoverage: 0 };
    profiles[genre] = { ...result, videoCount,
      // Unknown videos prevent claiming an absent interest, but do not
      // invalidate evidence already available for another genre.
      status: result.clusters.length ? 'ready' : !source.videos.length || uncertain || videoCount > 0 ? 'insufficient' : 'empty' };
  }
  if (genres.includes('channel type')) {
    progress({ phase: 'channels', processed: 0, total: source.videos.length });
    const counts = new Map<string, number>();
    let videoCount = 0;
    let unknown = false;
    const channels = [...new Map(source.videos.filter(v => v.channelId).map(v => [v.channelId, v])).values()];
    const channelKey = (channelId: string) => digest(['channel-types-2', s.classificationCacheNamespace, s.classificationCacheModel, channelId]);
    // A channel without a usable description stays without evidence for the
    // normal cache lifetime; re-asking YouTube every few minutes spent the
    // shared daily quota. Only a result that says nothing about the channel
    // (no YouTube key configured) expires quickly.
    const cachedChannel = (key: string) => {
      const value = store.cache<ChannelResult>(key, CHANNEL_CACHE_MS);
      return value?.transient ? store.cache<ChannelResult>(key, 300_000) : value;
    };
    const uncached = channels.filter(video => !cachedChannel(channelKey(video.channelId!)));
    // Chunks share 50-ID YouTube requests while keeping in-flight lookups
    // bounded on archives with thousands of channels.
    for (let offset = 0; offset < uncached.length; offset += CHANNEL_LOOKUP_CHUNK) {
      const chunk = uncached.slice(offset, offset + CHANNEL_LOOKUP_CHUNK);
      provider.prefetchChannels?.(chunk.map(video => video.channelId!));
      await settleWork(chunk.map(video => {
        const key = channelKey(video.channelId!);
        return cachedWork([key], async () => {
          if (cachedChannel(key)) return;
          store.putCache(key, await call(() => provider.channel(video.channelId!, video.channelTitle ?? '')));
        });
      }));
    }
    for (const video of source.videos) {
      if (!video.channelId) { unknown = true; continue; }
      const key = channelKey(video.channelId);
      let channel = cachedChannel(key);
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
      status: totalMass ? 'ready' : !source.videos.length || unknown ? 'insufficient' : 'empty',
      clusters: CHANNEL_TYPES.filter(type => counts.has(type)).map(type => ({
        centroid: CHANNEL_TYPES.map(t => t === type ? 1 : 0), mass: counts.get(type)!, share: counts.get(type)! / totalMass,
        tags: [{ text: type, count: counts.get(type)!, generatedCount: 0 }],
      })),
    };
  }
  return assessProfileAvailability({ version: version(s), sourceFingerprint: source.fingerprint, builtAt: new Date().toISOString(),
    complete: source.complete, totalVideos: source.videos.length,
    processedVideos: contentRequested ? classifications.size : profiles['channel type']?.videoCount ?? 0,
    genres: profiles });
}

// Discovery SLA: while a cycle drains provider retries, new accounts and new
// videos are still queued within this interval (plus at most one idle poll).
export const DISCOVERY_INTERVAL_MS = 60_000;

export async function runCycle(registry: UserRegistry, s: Settings, provider: Provider, compute: Compute, shouldStop: () => boolean = () => false,
  { discoveryIntervalMs = DISCOVERY_INTERVAL_MS }: { discoveryIntervalMs?: number } = {}): Promise<void> {
  if (!s.enabled) return;
  const store = registry.matchingV3Store();
  const allGenres = { genres: [...GENRES], topics: [] };
  // Discovery is separate from the drain: a job waiting on provider retries
  // must not hide accounts or videos that arrived after the cycle started.
  let userCount = 0;
  // Building every archive's source took ~25 s across 37 production archives
  // when caches were cold. One turn per archive keeps the heartbeat timer
  // running in between (the same stall #97 found in the YouTube worker).
  async function discover() {
    store.resumeRecoverableFailures();
    const users = registry.listUsers();
    userCount = users.length;
    for (const user of users) {
      await yieldToEventLoop();
      if (shouldStop()) return;
      const source = registry.repositoryFor(user).matchingV3Source(s.backfillVideoLimit);
      store.schedule(user.id, sourceKey(source.fingerprint, allGenres), version(s));
    }
  }
  await discover();
  // Idle consumers wake on each discovery tick instead of sleeping out a poll.
  const sleepers = new Set<() => void>();
  const nap = (ms: number) => new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); sleepers.delete(done); resolve(); };
    const timer = setTimeout(done, ms);
    sleepers.add(done);
  });
  const wake = () => { for (const done of [...sleepers]) done(); };
  let calls = 0;
  // Each user gets at most one attempt per cycle. Persistent cache resumes a
  // large import next cycle without rerunning successful API work.
  const visited: number[] = [];
  let attempts = 0;
  const drain = s.callsPerCycle === 0;
  async function consume() {
  while (!shouldStop() && (drain || attempts++ < userCount)) {
    const job = store.claim(Date.now(), drain ? [] : visited);
    if (!job) {
      const wait = drain ? store.queuedWorkDelay() : null;
      if (wait === null) break;
      await nap(wait);
      continue;
    }
    visited.push(job.userId);
    const leaseTimer = setInterval(() => {
      try { store.heartbeat(job); } catch { /* final activation also checks the lease token */ }
    }, 30_000);
    try {
      // Read current users at claim time: rebuilds may queue accounts created
      // after this cycle started.
      const user = registry.listUsers().find(u => u.id === job.userId);
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
      if (!currentUser) { store.defer(job, 'user_deleted', true); continue; }
      const current = registry.repositoryFor(currentUser).matchingV3Source(s.backfillVideoLimit);
      if (sourceKey(current.fingerprint, allGenres) !== job.fingerprint) {
        store.schedule(user.id, sourceKey(current.fingerprint, allGenres), version(s));
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
      if (error instanceof ProviderError && error.retryAt !== undefined) {
        // Completed caches stay; the job resumes once the provider quota resets.
        store.defer(job, 'youtube_quota_exhausted', false, error.retryAt);
        continue;
      }
      const transient = error instanceof ProviderError && error.retryable
        || error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
      const permanent = !transient && error instanceof ProviderError;
      // Provider bodies may contain inputs or credentials: persist only safe codes.
      store.defer(job, error instanceof ProviderError ? `provider_http_${error.status}`
        : error instanceof PartialClassificationError ? 'partial_classification_retry'
        : error instanceof BatchKeyMismatchError ? 'invalid_provider_batch_keys'
        : error instanceof SyntaxError ? 'invalid_provider_json'
        : error instanceof Error && error.name === 'ZodError' ? 'invalid_provider_schema'
        : error instanceof Error && error.message === 'Invalid batch tag index' ? 'invalid_provider_tag_index'
        : error instanceof Error && error.message === 'Batch attempted to replace original tags' ? 'provider_replaced_tags'
        : error instanceof Error && error.name === 'TimeoutError' ? 'provider_timeout' : 'processing_failed', permanent);
    } finally { clearInterval(leaseTimer); }
  }
  }
  // Consumers grow with discovered accounts, up to the configured ceiling.
  const consumers: Promise<void>[] = [];
  const spawn = () => { while (consumers.length < Math.min(s.concurrency, userCount)) consumers.push(consume()); };
  let discovering = false;
  const discovery = setInterval(() => {
    if (!shouldStop() && !discovering) {
      discovering = true;
      discover().then(spawn, () => console.error('Matching v3 discovery failed; will retry.'))
        .finally(() => { discovering = false; wake(); });
    }
    wake();
  }, discoveryIntervalMs);
  try {
    spawn();
    for (let settled = 0; settled < consumers.length;) {
      const spawned = consumers.length;
      await Promise.all(consumers.slice(settled));
      settled = spawned;
    }
  } finally { clearInterval(discovery); wake(); }
}
