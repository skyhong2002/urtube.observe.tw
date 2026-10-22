import assert from 'node:assert/strict';
import test from 'node:test';
import { UserRegistry, type User } from '../src/users.js';
import { runCycle } from '../src/matching-v3/pipeline.js';
import { GENRES, settings, version, type Classification } from '../src/matching-v3/model.js';
import { ProviderError, type Provider } from '../src/matching-v3/provider.js';
import { sourceKey } from '../src/matching-v3/store.js';
import type { Compute } from '../src/matching-v3/compute.js';
import { normalizeYoutubeCapture } from '../src/youtube/capture.js';

// Synthetic accounts on an in-memory registry. Discovery runs every 25 ms here;
// production uses the exported interval as the discovery SLA.
const s = { ...settings({ MATCHING_V3_ENABLED: 'true' }), callsPerCycle: 0, dailyApiCalls: 0 };
const options = { discoveryIntervalMs: 25 };
const classification: Classification = { tagSource: 'original', tags: [], assignments: [{ genre: 'Sport', tags: [] }] };
const compute: Compute = {
  cluster: async () => ({ clusters: [], totalMass: 0, retainedCoverage: 0 }),
  compare: async () => ({ score: 0, transport: [] }),
};
function watch(registry: UserRegistry, user: User, videoId: string) {
  registry.repositoryFor(user).upsertYoutubeCapture(normalizeYoutubeCapture({
    sessionId: `session-${videoId}`, videoId, title: 'Synthetic', url: `https://www.youtube.com/watch?v=${videoId}`,
    watchedAt: '2026-09-04T12:00:00Z', actualWatchedSeconds: 30, durationSeconds: 60,
  }, new Date('2026-09-05T12:00:00Z')));
}
function account(registry: UserRegistry, handle: string, ...videos: string[]) {
  registry.createUser(handle, handle);
  const user = registry.userByHandle(handle)!;
  for (const id of videos) watch(registry, user, id);
  return user;
}
// Every STUCK video answers a persistent provider 429.
const provider = (gate?: Promise<void>): Provider => ({
  classify: async video => {
    if (video.id.startsWith('STUCK')) throw new ProviderError(true, 429);
    if (gate && video.id.startsWith('GATED')) await gate;
    return classification;
  },
  embed: async tags => tags.map(() => [1, 0]),
  channel: async () => ({ types: [], evidenceAvailable: false }),
});
async function until(check: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) return false;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return true;
}
function cycle(registry: UserRegistry, p: Provider) {
  let stop = false;
  const done = runCycle(registry, s, p, compute, () => stop, options);
  return { done, stop: async () => { stop = true; await done; } };
}

test('a persistently rate-limited account does not block discovery of new accounts or new videos', async () => {
  const registry = new UserRegistry(':memory:');
  const store = registry.matchingV3Store();
  const stuck = account(registry, 'stuck', 'STUCK000001');
  const finished = account(registry, 'finished', 'DONEVIDEO01');
  const running = cycle(registry, provider());
  try {
    assert.ok(await until(() => store.status(finished.id)?.state === 'done'));
    assert.ok(await until(() => store.status(stuck.id)?.error === 'provider_http_429'));
    const fresh = account(registry, 'fresh', 'FRESHVIDEO1');
    watch(registry, finished, 'DONEVIDEO02');
    assert.ok(await until(() => store.status(fresh.id)?.state === 'done'), 'new account is discovered during the drain');
    assert.ok(await until(() => store.profile(finished.id)?.processedVideos === 2), 'new videos of a completed account are discovered');
    assert.equal(store.status(stuck.id)?.state, 'queued');
  } finally { await running.stop(); registry.close(); }
});

test('an account queued by rebuild during a drain is claimed with current users, not a stale snapshot', async () => {
  const registry = new UserRegistry(':memory:');
  const store = registry.matchingV3Store();
  const stuck = account(registry, 'stuck', 'STUCK000001');
  const running = cycle(registry, provider());
  try {
    assert.ok(await until(() => store.status(stuck.id)?.error === 'provider_http_429'));
    const routed = account(registry, 'routed', 'ROUTEDVIDEO');
    // Same scheduling as POST /api/matching-v3/rebuild.
    const source = registry.repositoryFor(routed).matchingV3Source(s.backfillVideoLimit);
    store.schedule(routed.id, sourceKey(source.fingerprint, { genres: [...GENRES], topics: [] }), version(s));
    assert.ok(await until(() => ['done', 'failed'].includes(store.status(routed.id)?.state ?? ''), 7000));
    assert.equal(store.status(routed.id)?.state, 'done');
  } finally { await running.stop(); registry.close(); }
});

test('the stop signal ends a draining cycle promptly while retries are pending', async () => {
  const registry = new UserRegistry(':memory:');
  const store = registry.matchingV3Store();
  const stuck = account(registry, 'stuck', 'STUCK000001');
  const running = cycle(registry, provider());
  try {
    assert.ok(await until(() => store.status(stuck.id)?.error === 'provider_http_429'));
    const started = Date.now();
    await running.stop();
    assert.ok(Date.now() - started < 1000, `stopped after ${Date.now() - started} ms`);
  } finally { await running.stop(); registry.close(); }
});

test('a user deleted mid-build publishes nothing and is not rediscovered', async () => {
  const registry = new UserRegistry(':memory:');
  const store = registry.matchingV3Store();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const leaving = account(registry, 'leaving', 'GATEDVIDEO1');
  const staying = account(registry, 'staying', 'STAYVIDEO01');
  const running = cycle(registry, provider(gate));
  try {
    assert.ok(await until(() => store.status(leaving.id)?.state === 'running'));
    registry.deleteUser('leaving');
    release();
    assert.ok(await until(() => store.status(staying.id)?.state === 'done'));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(store.status(leaving.id), null);
    assert.equal(store.profile(leaving.id), null);
  } finally { release(); await running.stop(); registry.close(); }
});

test('a job whose lease expired under a crashed worker is recovered by the next cycle', async () => {
  const registry = new UserRegistry(':memory:');
  const store = registry.matchingV3Store();
  const user = account(registry, 'orphan', 'ORPHANVIDEO');
  const source = registry.repositoryFor(user).matchingV3Source(s.backfillVideoLimit);
  store.schedule(user.id, sourceKey(source.fingerprint, { genres: [...GENRES], topics: [] }), version(s));
  // A worker claimed it long ago and died without releasing the lease.
  assert.ok(store.claim(Date.now() - 600_000));
  assert.equal(store.status(user.id)?.state, 'running');
  const running = cycle(registry, provider());
  try {
    assert.ok(await until(() => store.status(user.id)?.state === 'done'));
    assert.equal(store.profile(user.id)?.processedVideos, 1);
  } finally { await running.stop(); registry.close(); }
});

test('discovery lets heartbeat timers run between archives', async () => {
  const registry = new UserRegistry(':memory:');
  for (let index = 0; index < 5; index++) account(registry, `slow-${index}`, `SLOWVIDEO0${index}`);
  // Stand-in for a cold matchingV3Source: synchronous work per archive.
  let built = 0;
  const repositoryFor = registry.repositoryFor.bind(registry);
  registry.repositoryFor = (user) => {
    const repository = repositoryFor(user);
    return new Proxy(repository, {
      get(target, property, receiver) {
        if (property !== 'matchingV3Source') return Reflect.get(target, property, receiver);
        return (limit: number) => {
          built++;
          const until = Date.now() + 20;
          while (Date.now() < until) { /* synchronous SQLite stand-in */ }
          return target.matchingV3Source(limit);
        };
      },
    });
  };
  let ticks = 0;
  const heartbeat = setInterval(() => { ticks++; }, 1);
  // Stop once discovery has built all five sources.
  const done = runCycle(registry, s, provider(), compute, () => built >= 5, options);
  try {
    await done;
    assert.ok(ticks >= 4, `heartbeat ran ${ticks} times during discovery of 5 archives`);
  } finally { clearInterval(heartbeat); registry.close(); }
});
