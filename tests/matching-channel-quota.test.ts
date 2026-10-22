import assert from 'node:assert/strict';
import test from 'node:test';
import { UserRegistry } from '../src/users.js';
import { runCycle } from '../src/matching-v3/pipeline.js';
import { settings, type Classification } from '../src/matching-v3/model.js';
import { matchingProvider, ProviderError, type Provider } from '../src/matching-v3/provider.js';
import type { Compute } from '../src/matching-v3/compute.js';
import { createYoutubeApiKeyPool, nextYoutubeQuotaReset } from '../src/youtube/api-keys.js';

// Synthetic keys and channels only; no request leaves the process.
const s = { ...settings({ MATCHING_V3_ENABLED: 'true' }), apiKey: 'fixture', dailyApiCalls: 0 };
const quota = () => Response.json({ error: { errors: [{ reason: 'quotaExceeded', domain: 'youtube.quota' }] } }, { status: 403 });
const forbidden = () => Response.json({ error: { errors: [{ reason: 'forbidden' }] } }, { status: 403 });
const compute: Compute = {
  cluster: async () => ({ clusters: [], totalMass: 0, retainedCoverage: 0 }),
  compare: async () => ({ score: 0, transport: [] }),
};

test('quota on every YouTube key is retryable at the pool reset; a permission 403 is not', async () => {
  const now = Date.UTC(2026, 9, 22, 12);
  const pool = createYoutubeApiKeyPool(['first', 'second'], () => now);
  const exhausted = matchingProvider(s, pool, (async () => quota()) as typeof fetch);
  const error = await exhausted.channel('UC-quota', '').catch(e => e);
  assert.ok(error instanceof ProviderError);
  assert.equal(error.status, 403);
  assert.equal(error.retryable, true);
  assert.equal(error.retryAt, nextYoutubeQuotaReset(now));
  // Once every key is parked, no further request is spent before the reset.
  const again = await exhausted.channel('UC-quota-2', '').catch(e => e);
  assert.equal(again.retryAt, nextYoutubeQuotaReset(now));

  const denied = await matchingProvider(s, ['only'], (async () => forbidden()) as typeof fetch).channel('UC-denied', '').catch(e => e);
  assert.ok(denied instanceof ProviderError);
  assert.equal(denied.status, 403);
  assert.equal(denied.retryable, false);
  assert.equal(denied.retryAt, undefined);
});

function fixture() {
  const registry = new UserRegistry(':memory:');
  registry.createUser('quota', 'Quota');
  const user = registry.userByHandle('quota')!;
  registry.repositoryFor(user).ingestYoutubeArchive({ archiveHash: 'quota-archive', source: 'takeout', searches: [], watches: [{
    eventId: 'quota-watch', videoId: 'QUOTAVIDEO1', title: 'Synthetic', url: 'https://www.youtube.com/watch?v=QUOTAVIDEO1',
    channelId: 'UC-synthetic-channel', channelTitle: 'Synthetic channel', channelUrl: '', watchedAt: '2026-09-04T12:00:00Z', actualWatchedSeconds: 30, activityType: 'video',
  }] });
  return { registry, user, store: registry.matchingV3Store() };
}
function provider(youtube: () => Response, clock: () => number) {
  let classifications = 0;
  const classification: Classification = { tagSource: 'original', tags: [], assignments: [{ genre: 'Sport', tags: [] }] };
  const real = matchingProvider(s, createYoutubeApiKeyPool(['fixture-key'], clock), (async (input: unknown) => new URL(String(input)).hostname === 'www.googleapis.com'
    ? youtube()
    : new Response(JSON.stringify({ choices: [{ message: { content: '{"types":["personal creator"]}' } }] }))) as typeof fetch);
  const wrapped: Provider = {
    classify: async () => { classifications++; return classification; },
    embed: async tags => tags.map(() => [1, 0]),
    channel: (id, title) => real.channel(id, title),
    prefetchChannels: ids => real.prefetchChannels!(ids),
  };
  return { wrapped, classifications: () => classifications };
}

test('a quota-exhausted channel stage waits for the reset and then finishes without reclassifying', async () => {
  const { registry, user, store } = fixture();
  let now = Date.now(), exhausted = true;
  const youtube = () => exhausted ? quota()
    : Response.json({ items: [{ id: 'UC-synthetic-channel', snippet: { title: 'Synthetic channel', description: 'A synthetic personal channel.' } }] });
  const { wrapped, classifications } = provider(youtube, () => now);
  try {
    await runCycle(registry, s, wrapped, compute);
    const deferred = store.status(user.id)!;
    assert.equal(deferred.state, 'queued');
    assert.equal(deferred.error, 'youtube_quota_exhausted');
    assert.equal(deferred.retry_at, nextYoutubeQuotaReset(now));
    assert.equal(deferred.attempts, 0);
    assert.equal(classifications(), 1);
    // The Pacific-midnight reset arrives.
    now = deferred.retry_at + 1; exhausted = false;
    store.retry(user.id);
    await runCycle(registry, s, wrapped, compute);
    assert.equal(store.status(user.id)?.state, 'done');
    assert.equal(store.profile(user.id)?.genres['channel type']?.status, 'ready');
    assert.equal(classifications(), 1, 'completed classification cache is reused');
  } finally { registry.close(); }
});

test('a genuine YouTube permission 403 stops the job instead of retrying forever', async () => {
  const { registry, user, store } = fixture();
  const { wrapped } = provider(forbidden, Date.now);
  try {
    await runCycle(registry, s, wrapped, compute);
    assert.equal(store.status(user.id)?.state, 'failed');
    assert.equal(store.status(user.id)?.error, 'provider_http_403');
  } finally { registry.close(); }
});
