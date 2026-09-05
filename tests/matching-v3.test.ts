import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { UserRegistry } from '../src/users.js';
import { createApp } from '../src/index.js';
import { MatchingStore, sourceKey } from '../src/matching-v3/store.js';
import { aggregateTags, buildProfile, runCycle } from '../src/matching-v3/pipeline.js';
import { settings, version, normalizeTag, type Classification, type Profile, type VideoInput } from '../src/matching-v3/model.js';
import { matchingRoutes } from '../src/matching-v3/routes.js';
import { matchingProvider, type Provider } from '../src/matching-v3/provider.js';
import { computeClient, type Compute } from '../src/matching-v3/compute.js';
import { normalizeYoutubeCapture } from '../src/youtube/capture.js';
import { compareProfiles } from '../src/matching-v3/matching.js';

const s = settings({ MATCHING_V3_ENABLED: 'true' });

test('compact profiles invalidate legacy clusters while preserving the bounded source', () => {
  assert.equal(s.backfillVideoLimit, 2000);
  assert.notEqual(version(s), '20376b513a2150fb5899e999bd53812dc9c3dae98b4ce7b8849c27477f276d88');
  assert.notEqual(version({...s, compactDistance: .1}), version(s));
  assert.notEqual(version({ ...s, backfillVideoLimit: 1000 }), version(s));
  for (const value of ['0', '-1', '2.5', '1000001', 'invalid']) {
    assert.throws(() => settings({ MATCHING_V3_BACKFILL_VIDEO_LIMIT: value }), /BACKFILL_VIDEO_LIMIT/);
  }
});
const video: VideoInput = { id: 'testvideo01', title: '羽球練習', tags: ['羽球'], channelId: 'UC-test', channelTitle: 'Test' };
const classification: Classification = { tagSource: 'original', tags: ['羽球'], assignments: [{ genre: 'Sport', tags: ['羽球', '羽球'] }] };
const compute: Compute = {
  cluster: async points => ({ totalMass: points.reduce((n, p) => n + p.count, 0), retainedCoverage: 1,
    clusters: points.map(p => ({ centroid: p.vector, mass: p.count, share: p.count / points.reduce((n, q) => n + q.count, 0), tags: [{ text: p.text, count: p.count, generatedCount: p.generatedCount }] })) }),
  compare: async (a, b) => ({ score: a.clusters.length && b.clusters.length ? .5 : 0,
    transport: a.clusters.length && b.clusters.length ? [{ left: 0, right: 0, mass: .5, similarity: 1, contribution: .5 }] : [] }),
};
function profile(): Profile {
  return { version: version(s), sourceFingerprint: 'source', builtAt: '2026-09-05T00:00:00Z', complete: true, totalVideos: 9, processedVideos: 9,
    genres: { Sport: { status: 'ready', retainedCoverage: 1, totalMass: 9, videoCount: 9,
      clusters: [{ centroid: [1, 0], mass: 9, share: 1, tags: [{ text: '羽球', count: 9, generatedCount: 2 }] }] } } };
}
function storeFixture() {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1);');
  return { db, store: new MatchingStore(db) };
}

test('v3 tag weighting deduplicates videos and tags, isolates genres, and tracks generated origin', () => {
  const generated = { ...classification, tagSource: 'generated' as const };
  const map = new Map([['testvideo01', classification], ['testvideo02', generated]]);
  const result = aggregateTags([video, video, { ...video, id: 'testvideo02' }], map, 'Sport');
  assert.equal(result.videoCount, 2);
  assert.deepEqual(result.tags.get('羽球'), { count: 2, generatedCount: 1 });
  assert.equal(aggregateTags([video], map, 'Music').tags.size, 0);
  assert.equal(normalizeTag(' ＃ＨＥＬＬＯ   World '), 'hello world');
});

test('v3 cache resumes processing and embeds only normalized tag text', async () => {
  const { db, store } = storeFixture(); let classifications = 0, embeddings = 0;
  const provider: Provider = { classify: async () => { classifications++; return classification; },
    embed: async tags => { embeddings++; assert.deepEqual(tags, ['羽球']); return [[1, 0]]; },
    channel: async () => ({ types: [], evidenceAvailable: false }) };
  try {
    const source = { videos: [video], complete: true, fingerprint: 'one' };
    const first = await buildProfile(source, ['Sport', 'Music'], store, s, provider, compute);
    assert.equal(first.genres.Music?.status, 'empty');
    await buildProfile(source, ['Sport'], store, s, provider, compute);
    assert.equal(classifications, 1); assert.equal(embeddings, 1);
    await buildProfile({ ...source, videos: [{ ...video, title: '新的羽球標題' }] }, ['Sport'], store, s, provider, compute);
    assert.equal(classifications, 2); assert.equal(embeddings, 1);
  } finally { db.close(); }
});

test('v3 leases prevent stale activation, respect retries and cascade on deletion', () => {
  const { db, store } = storeFixture();
  try {
    store.schedule(1, 'old', version(s)); const old = store.claim()!;
    assert.equal(store.claim(), null);
    store.schedule(1, 'new', version(s)); assert.equal(store.finish(old, profile()), false);
    const fresh = store.claim()!; store.defer(fresh, 'provider_http_429'); assert.equal(store.claim(), null);
    const retry = store.claim(Date.now() + 100000)!; assert.equal(retry.attempts, 1);
    assert.equal(store.finish(retry, profile()), true); assert.ok(store.profile(1));
    store.savePreferences(1, { genres: ['Sport'], topics: [] }); assert.ok(store.profile(1));
    db.exec('DELETE FROM users'); assert.equal(store.status(1), null); assert.deepEqual(store.preferences(1).genres, []);
  } finally { db.close(); }
});

test('v3 selection changes retain precomputed profiles', () => {
  const { db, store } = storeFixture();
  try {
    store.savePreferences(1, { genres: ['Sport'], topics: [] });
    store.schedule(1, 'source', version(s)); store.finish(store.claim()!, profile());
    store.savePreferences(1, { genres: ['Sport'], topics: [{ id: 't', name: '球友', genres: ['Sport'] }] });
    assert.ok(store.profile(1));
    store.savePreferences(1, { genres: [], topics: [] }); assert.ok(store.profile(1));
  } finally { db.close(); }
});

test('v3 comparisons expose factual provenance, keep missing totals unknown and reject mixed versions', async () => {
  const result = await compareProfiles(profile(), profile(), ['Sport'], compute);
  assert.equal(result.score, .5);
  assert.equal(result.reasons[0].hasGeneratedTags, true);
  assert.match(result.reasons[0].text, /50.0 分/);
  assert.match(result.reasons[0].text, /模型標籤/);
  assert.equal((await compareProfiles(profile(), profile(), ['Sport', 'Music'], compute)).score, null);
  assert.equal((await compareProfiles({ ...profile(), complete: false }, profile(), ['Sport'], compute)).provisional, true);
  await assert.rejects(compareProfiles(profile(), { ...profile(), version: 'old' }, ['Sport'], compute));
});

test('v3 genre-only classification never generates tags and retains all existing tags', async () => {
  const fakeFetch = (async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.temperature, undefined);
    assert.equal(body.model, 'gpt-5.6-luna');
    assert.equal(body.reasoning_effort, 'low');
    assert.equal(body.max_completion_tokens, 2048);
    assert.ok(body.messages.every((m: { content: unknown }) => typeof m.content === 'string'));
    assert.deepEqual(Object.keys(JSON.parse(body.messages[1].content)).sort(), ['tags', 'title']);
    assert.equal(body.tools, undefined);
    return new Response(JSON.stringify({ choices: [{ message: { content: '```json\n' + JSON.stringify({ genres: ['Sport', 'Education'] }) + '\n```' } }] }));
  }) as typeof fetch;
  const provider = matchingProvider({ ...s, apiKey: 'fake-test-key' }, '', fakeFetch);
  const missing = await provider.classify({ ...video, tags: [] });
  assert.equal(missing.tagSource, 'original'); assert.deepEqual(missing.tags, []);
  assert.deepEqual(missing.assignments, [{ genre: 'Education', tags: [] }, { genre: 'Sport', tags: [] }].sort((a,b)=> ['Sport','Education'].indexOf(a.genre)-['Sport','Education'].indexOf(b.genre)));
  const tags = Array.from({length: 40}, (_,i) => `tag${i}`);
  const result = await provider.classify({ ...video, tags });
  assert.deepEqual(result.tags, tags);
  assert.ok(result.assignments.every(a => a.tags.length === 40));
});

test('v3 Gemini embeddings send tag text alone with an independent key and normalize', async () => {
  const fakeFetch = (async (url: unknown, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    assert.equal(String(url), 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents');
    const headers = new Headers(options.headers);
    assert.equal(headers.get('x-goog-api-key'), 'gemini-test-key');
    assert.equal(headers.get('authorization'), null);
    assert.deepEqual(body.requests, [{ model: 'models/gemini-embedding-001',
      content: { parts: [{ text: '羽球' }] }, taskType: 'SEMANTIC_SIMILARITY', outputDimensionality: 2 }]);
    return new Response(JSON.stringify({ embeddings: [{ values: [3, 4] }] }));
  }) as typeof fetch;
  const provider = matchingProvider({ ...s, apiKey: 'gpt-test-key', embeddingApiKey: 'gemini-test-key', dimensions: 2 }, '', fakeFetch);
  assert.deepEqual(await provider.embed(['羽球']), [[.6, .8]]);
});

test('v3 channel classification sends only bounded text name and description', async () => {
  const fakeFetch = (async (url: unknown, options?: RequestInit) => {
    if (String(url).startsWith('https://www.googleapis.com/')) {
      return new Response(JSON.stringify({ items: [{ snippet: { title: 'School', description: 'Education '.repeat(1000) } }] }));
    }
    const body = JSON.parse(String(options?.body));
    const input = JSON.parse(body.messages[1].content);
    assert.deepEqual(Object.keys(input).sort(), ['description', 'title']);
    assert.equal(input.description.length, 3000);
    assert.ok(body.messages.every((m: { content: unknown }) => typeof m.content === 'string'));
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"types":["educational institution"]}' } }] }));
  }) as typeof fetch;
  const result = await matchingProvider({ ...s, apiKey: 'fake' }, 'fake-youtube', fakeFetch).channel('fixture', 'School');
  assert.deepEqual(result, { types: ['educational institution'], evidenceAvailable: true });
});

test('v3 daily request ceiling survives worker restarts and resets by UTC day', () => {
  const { db, store } = storeFixture();
  try {
    const day = new Date('2026-09-05T12:00:00Z');
    assert.equal(store.reserveApiCall(2, day), true);
    assert.equal(new MatchingStore(db).reserveApiCall(2, day), true);
    assert.equal(store.reserveApiCall(2, day), false);
    assert.equal(store.reserveApiCall(2, new Date('2026-09-06T00:00:00Z')), true);
  } finally { db.close(); }
});

test('v3 settings keep GPT and Gemini credentials independent', () => {
  const gateway = settings({ AI_BASE_URL: 'http://gateway:8320/v1', AI_API_KEY: 'gateway-key' });
  assert.equal(gateway.classificationModel, 'gpt-5.6-luna');
  assert.equal(gateway.apiKey, 'gateway-key');
  assert.equal(gateway.embeddingApiKey, '');
  const split = settings({ AI_BASE_URL: 'http://gateway:8320/v1', AI_API_KEY: 'gateway-key', GEMINI_API_KEY: 'gemini-key' });
  assert.equal(split.embeddingApiKey, 'gemini-key');
  assert.equal(split.apiKey, 'gateway-key');
  assert.equal(split.embeddingModel, 'gemini-embedding-001');
});

test('v3 Gemini missing key does not fall back to GPT; malformed vectors are rejected', async () => {
  let calls = 0;
  const fakeFetch = (async () => { calls++; return new Response(JSON.stringify({ embeddings: [{ values: [0, 0] }] })); }) as typeof fetch;
  await assert.rejects(matchingProvider({ ...s, apiKey: 'gpt-key', embeddingApiKey: '' }, '', fakeFetch).embed(['羽球']), /GEMINI_API_KEY/);
  assert.equal(calls, 0);
  await assert.rejects(matchingProvider({ ...s, embeddingApiKey: 'gemini-key', dimensions: 2 }, '', fakeFetch).embed(['羽球']), /Zero embedding/);
  await assert.rejects(matchingProvider({ ...s, embeddingApiKey: 'gemini-key', dimensions: 3 }, '', fakeFetch).embed(['羽球']));
});

test('v3 API enforces authentication, origin, genre consent and member detail visibility', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    registry.createUser('v3left', 'Left'); registry.createUser('v3right', 'Right', { googleEmail: 'private@example.com' });
    registry.setMatchingOptIn('v3left', true); registry.setMatchingOptIn('v3right', true);
    const left = registry.userByHandle('v3left')!, right = registry.userByHandle('v3right')!;
    const store = registry.matchingV3Store();
    for (const user of [left, right]) {
      store.savePreferences(user.id, { genres: ['Sport'], topics: [] });
      store.schedule(user.id, 'source', version(s)); store.finish(store.claim()!, profile());
    }
    const app = matchingRoutes(registry, s, 'http://localhost:3000', compute);
    assert.equal((await app.request('/api/matching-v3')).status, 401);
    const headers = { Cookie: `urtube_session=${registry.createSession(left)}`, Origin: 'http://localhost:3000', 'Content-Type': 'application/json' };
    const post = (genres: string[], custom = headers) => app.request('/api/matching-v3/match', { method: 'POST', headers: custom, body: JSON.stringify({ genres }) });
    assert.equal((await post(['Sport'], { ...headers, Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post(['Custom'])).status, 400);
    assert.equal((await post(['Music'])).status, 403);
    const response = await post(['Sport']); assert.equal(response.status, 200);
    const body = await response.text(); assert.ok(!/centroid|testvideo01|羽球|private@example.com|googleEmail|keySeed/.test(body));
    assert.equal(JSON.parse(body).candidates[0].handle, 'v3right');
    assert.deepEqual(JSON.parse(body).candidates[0].reasons, []);
    assert.equal(JSON.parse(body).candidates.length, 1);
    registry.setMatchingOptIn('v3right', false);
    assert.equal((await (await post(['Sport'])).json() as { candidates: unknown[] }).candidates.length, 0);
    const all = ['Politic', 'Music', 'Sport', 'Education', 'Video gaming', 'Streaming', 'News', 'Podcast', 'channel type'];
    assert.equal((await app.request('/api/matching-v3/preferences', { method: 'PUT', headers, body: JSON.stringify({ genres: all, topics: [] }) })).status, 200);
  } finally { registry.close(); }
});

test('v3 feature disabled preserves existing health and creates no v3 routes', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const app = createApp(registry);
    assert.equal((await app.request('/healthz')).status, 200);
    assert.equal((await app.request('/api/matching-v3')).status, 404);
    assert.equal((await matchingRoutes(registry, { ...s, enabled: false }, 'http://localhost:3000').request('/api/matching-v3')).status, 404);
  } finally { registry.close(); }
});

test('v3 worker resumes within budget and source fingerprint ignores replay watches', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    registry.createUser('workerfixture', 'Worker Fixture'); registry.setMatchingOptIn('workerfixture', true);
    const user = registry.userByHandle('workerfixture')!, repo = registry.repositoryFor(user), store = registry.matchingV3Store();
    const capture = (sessionId: string) => repo.upsertYoutubeCapture(normalizeYoutubeCapture({ sessionId, videoId: 'V3FIXTURE01',
      title: '羽球 #羽球', url: 'https://www.youtube.com/watch?v=V3FIXTURE01', watchedAt: sessionId.endsWith('001') ? '2026-09-04T12:00:00Z' : '2026-09-04T13:00:00Z', actualWatchedSeconds: 30, durationSeconds: 60 }, new Date('2026-09-05T12:00:00Z')));
    capture('v3-fixture-session-001');
    const first = repo.matchingV3Source(); capture('v3-fixture-session-002');
    assert.equal(repo.matchingV3Source().fingerprint, first.fingerprint);
    assert.equal(first.videos.length, 1); assert.equal(first.complete, false); assert.deepEqual(first.videos[0].tags, ['羽球']);
    assert.equal(store.hasPreferences(user.id), false);
    let classifyCalls = 0, embedCalls = 0;
    const provider: Provider = { classify: async () => { classifyCalls++; return classification; }, embed: async () => { embedCalls++; return [[1, 0]]; }, channel: async () => ({ types: [], evidenceAvailable: false }) };
    await runCycle(registry, { ...s, callsPerCycle: 1 }, provider, compute);
    assert.equal(store.profile(user.id), null); assert.equal(classifyCalls, 1); assert.equal(embedCalls, 0);
    // Ready work resumes immediately without a fixed scheduling delay.
    await runCycle(registry, { ...s, callsPerCycle: 1 }, provider, compute);
    assert.equal(classifyCalls, 1); assert.equal(embedCalls, 1);
    assert.equal(store.profile(user.id)?.processedVideos, 1);
    assert.equal(Object.keys(store.profile(user.id)!.genres).length, 9);
    assert.equal(store.profile(user.id)?.complete, false);
    const scan = (id: string, at: string, endReason: 'history-start' | 'time-limit') => repo.ingestYoutubeProgress({
      scanId: id, observedAt: at, complete: true, items: [], summary: { mode: 'full', videos: 1, passes: 1,
        endReason, oldestWatchedAt: null, newestWatchedAt: null, error: null, landedUrl: null },
    });
    scan('v3-complete-scan-fixture', '2026-09-05T13:00:00Z', 'history-start');
    assert.equal(repo.matchingV3Source().complete, true);
    scan('v3-interrupted-scan-fixture', '2026-09-05T14:00:00Z', 'time-limit');
    assert.equal(repo.matchingV3Source().complete, false);
  } finally { registry.close(); }
});

test('v3 source and worker apply the same recent unique-video limit without replay churn', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('boundedfixture', 'Bounded Fixture'), repo = registry.repositoryFor(user);
    let session = 0;
    const capture = (id: string, hour: number) => repo.upsertYoutubeCapture(normalizeYoutubeCapture({
      sessionId: `bounded-fixture-session-${++session}`, videoId: id, title: '羽球 #羽球',
      url: `https://www.youtube.com/watch?v=${id}`, watchedAt: `2026-09-04T${hour}:00:00Z`,
      actualWatchedSeconds: 30, durationSeconds: 60,
    }, new Date('2026-09-05T12:00:00Z')));
    capture('LIMITTEST01', 10); capture('LIMITTEST02', 11); capture('LIMITTEST03', 12);
    const first = repo.matchingV3Source(2);
    assert.deepEqual(first.videos.map(v => v.id), ['LIMITTEST02', 'LIMITTEST03']);
    capture('LIMITTEST02', 13);
    assert.equal(repo.matchingV3Source(2).fingerprint, first.fingerprint);
    const classified: string[] = [];
    const provider: Provider = {
      classify: async v => { classified.push(v.id); return classification; },
      embed: async () => [[1, 0]], channel: async () => ({ types: [], evidenceAvailable: false }),
    };
    await runCycle(registry, { ...s, backfillVideoLimit: 2 }, provider, compute);
    assert.deepEqual(classified.sort(), ['LIMITTEST02', 'LIMITTEST03']);
    assert.equal(registry.matchingV3Store().profile(user.id)?.totalVideos, 2);
    capture('LIMITTEST01', 14);
    assert.notEqual(repo.matchingV3Source(2).fingerprint, first.fingerprint);
    assert.deepEqual(repo.matchingV3Source(2).videos.map(v => v.id), ['LIMITTEST01', 'LIMITTEST02']);
  } finally { registry.close(); }
});

test('v3 enabled middleware does not intercept unrelated application routes', async () => {
  const registry = new UserRegistry(':memory:'); const previous = process.env.MATCHING_V3_ENABLED;
  try {
    process.env.MATCHING_V3_ENABLED = 'true'; const app = createApp(registry);
    assert.equal((await app.request('/healthz')).status, 200);
    assert.equal((await app.request('/api/matching-v3')).status, 401);
    assert.equal((await app.request('/matching-v3')).status, 302);
  } finally { if (previous === undefined) delete process.env.MATCHING_V3_ENABLED; else process.env.MATCHING_V3_ENABLED = previous; registry.close(); }
});

test('v3 Node to Python HTTP integration returns the weighted A/B score', { skip: !process.env.MATCHING_V3_TEST_COMPUTE_URL }, async () => {
  const real = computeClient({ ...s, computeUrl: process.env.MATCHING_V3_TEST_COMPUTE_URL!, computeToken: 'isolated-numeric-test-token-32-characters' });
  const vectors = [[1, .01, 0], [1, .1, 0], [1, -.1, 0], [0, 0, 1]], names = ['羽球', '籃球', '排球', '拳擊'];
  const build = async (weights: number[]) => ({ ...await real.cluster(weights.map((count, i) => ({ text: names[i], vector: vectors[i], count, generatedCount: 0 }))), status: 'ready' as const, videoCount: weights.reduce((a,b) => a+b,0) });
  const a = await build([3, 2, 5, 9]), b = await build([1, 2, 1, 100]);
  assert.equal(a.clusters.length, 2); assert.equal(b.clusters.length, 1);
  const result = await real.compare(a, b); assert.ok(Math.abs(result.score - 9/19) < 1e-8);
});

test('v3 uncapped backfill still counts operations across restarts', () => {
  const { db, store } = storeFixture();
  try {
    assert.equal(settings({ MATCHING_V3_DAILY_API_CALLS: '0' }).dailyApiCalls, 0);
    for (let i = 0; i < 205; i++) assert.equal(new MatchingStore(db).reserveApiCall(0), true);
    assert.equal(store.reserveApiCall(200), false);
    assert.equal(db.prepare('SELECT calls FROM matching_v3_api_budget').get()!.calls, 205);
  } finally { db.close(); }
});

test('v3 batches embed immediately and resume after a cycle interrupts classification', async () => {
  const { db, store } = storeFixture();
  const calls: string[] = [];
  const provider: Provider = {
    classify: async () => { throw new Error('Unexpected single classification'); },
    classifyBatch: async videos => { calls.push('classify:' + videos.length); return videos.map(() => classification); },
    embed: async tags => { calls.push('embed:' + tags.length); return tags.map(() => [1, 0]); },
    channel: async () => ({ types: [], evidenceAvailable: false }),
  };
  const source = { videos: [video, { ...video, id: 'testvideo02' }], complete: true, fingerprint: 'two' };
  let budget = 0;
  try {
    await assert.rejects(buildProfile(source, ['Sport'], store, { ...s, classificationBatchSize: 1 }, provider, compute,
      () => { if (++budget > 2) throw new Error('cycle exhausted'); }), /cycle exhausted/);
    assert.deepEqual(calls, ['classify:1', 'classify:1']);
    const result = await buildProfile(source, ['Sport'], store, { ...s, classificationBatchSize: 1 }, provider, compute);
    assert.deepEqual(calls, ['classify:1', 'classify:1', 'embed:1']);
    assert.equal(result.processedVideos, 2);
    assert.equal(result.genres.Sport!.totalMass, 2);
  } finally { db.close(); }
});

test('v3 batch classification accepts genres only and rejects unknown genres', async () => {
  let invalid = false;
  const request = (async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    assert.ok(body.messages.every((m: { content: unknown }) => typeof m.content === 'string'));
    assert.deepEqual(JSON.parse(body.messages[1].content), { videos: [{ title: video.title, tags: ['羽球'] }] });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ videos: [
      { genres: [invalid ? 'Custom genre' : 'Sport'] },
    ] }) } }] }));
  }) as typeof fetch;
  const provider = matchingProvider({ ...s, apiKey: 'fake' }, '', request);
  assert.deepEqual((await provider.classifyBatch!([video]))[0].assignments, [{ genre: 'Sport', tags: ['羽球'] }]);
  invalid = true;
  await assert.rejects(provider.classifyBatch!([video]), /Some classification rows failed validation/);
});

test('v3 admin monitoring requires allowlisted session and reveals no raw profile or secrets', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    registry.createUser('monitoradmin', 'Admin'); registry.createUser('monitorviewer', 'Viewer');
    const admin = registry.userByHandle('monitoradmin')!, viewer = registry.userByHandle('monitorviewer')!;
    const store = registry.matchingV3Store();
    store.schedule(viewer.id, 'source', version(s));
    const job = store.claim()!; store.defer(job, 'provider_http_429');
    store.workerHeartbeat();
    const operation = store.operationStart('gemini_embedding', 12); store.operationEnd(operation);
    const app = matchingRoutes(registry, { ...s, adminHandles: [admin.handle] }, 'http://localhost:3000', compute);
    const headers = { Cookie: `urtube_session=${registry.createSession(admin)}`, Origin: 'http://localhost:3000' };
    const viewerHeaders = { Cookie: `urtube_session=${registry.createSession(viewer)}` };
    for (const path of ['/api/matching-v3/admin', '/matching-v3/admin', '/matching-v3/admin.js']) {
      assert.equal((await app.request(path)).status, 401);
      assert.equal((await app.request(path, { headers: viewerHeaders })).status, 403);
      assert.equal((await app.request(path, { headers })).status, 200);
    }
    const response = await app.request('/api/matching-v3/admin', { headers });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const text = await response.text(); assert.ok(!/centroid|apiKey|preferences_json|value_json/.test(text));
    const body = JSON.parse(text); assert.equal(body.recent[0].items, 12); assert.ok(body.heartbeat);
    assert.equal(body.users.find((u: { id: number }) => u.id === viewer.id).usable, false);
    const url = `/api/matching-v3/admin/retry/${viewer.id}`;
    assert.equal((await app.request(url, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await app.request(url, { method: 'POST', headers })).status, 202);
    assert.equal(store.status(viewer.id)!.retry_at, 0);
    assert.equal(store.status(viewer.id)!.attempts, 0);
    assert.ok(!(await (await app.request('/matching-v3', { headers: viewerHeaders })).text()).includes('資料處理監控'));
    assert.equal((await app.request('/matching-v3', { headers })).headers.get('location'), '/matches?view=topics');
  } finally { registry.close(); }
});

test('v3 parallel worker processes four distinct accounts without duplicating leases', async () => {
  const registry = new UserRegistry(':memory:'); let active = 0, peak = 0, calls = 0;
  try {
    for (let i = 0; i < 4; i++) {
      const name = `parallel${i}`; registry.createUser(name, name);
      registry.repositoryFor(registry.userByHandle(name)!).upsertYoutubeCapture(normalizeYoutubeCapture({
        sessionId: `parallel-fixture-session-${i}`, videoId: `PARALLEL00${i}`, title: '羽球',
        url: `https://www.youtube.com/watch?v=PARALLEL00${i}`, watchedAt: '2026-09-04T12:00:00Z', actualWatchedSeconds: 30, durationSeconds: 60,
      }, new Date('2026-09-05T12:00:00Z')));
    }
    const provider: Provider = { classify: async () => classification,
      classifyBatch: async videos => { calls++; peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 20)); active--; return videos.map(() => classification); },
      embed: async tags => tags.map(() => [1, 0]), channel: async () => ({ types: [], evidenceAvailable: false }) };
    await runCycle(registry, { ...s, concurrency: 4, callsPerCycle: 20 }, provider, compute);
    assert.equal(peak, 4); assert.equal(calls, 4);
    for (let i = 0; i < 4; i++) assert.ok(registry.matchingV3Store().profile(registry.userByHandle(`parallel${i}`)!.id));
  } finally { registry.close(); }
});

test('v3 partial batch preserves valid classifications and vectors before retry', async () => {
  const { PartialClassificationError } = await import('../src/matching-v3/provider.js');
  const { classificationKey } = await import('../src/matching-v3/pipeline.js');
  const { db, store } = storeFixture();
  const bad = { ...video, id: 'invalidfixture' };
  const provider: Provider = { classify: async () => classification,
    classifyBatch: async () => { throw new PartialClassificationError([classification, null]); },
    embed: async tags => tags.map(() => [1, 0]), channel: async () => ({ types: [], evidenceAvailable: false }) };
  try {
    await assert.rejects(buildProfile({ videos: [video, bad], fingerprint: 'partial', complete: true }, ['Sport'], store, s, provider, compute), PartialClassificationError);
    assert.deepEqual(store.cache(classificationKey(s, video)), classification);
    assert.equal(store.cache(classificationKey(s, bad)), null);
    assert.equal(store.monitoring().cache.find(row => row.kind === 'embedding')?.count, 1);
  } finally { db.close(); }
});

test('v3 metrics distinguish queue, HTTP time and estimated tokens when gateway omits usage', async () => {
  const { chatJson } = await import('../src/youtube/ai.js');
  let metrics: import('../src/youtube/ai.js').AiCallMetrics | undefined;
  await chatJson('Return JSON.', { title: '羽球' }, { baseUrl: 'https://fixture.invalid', apiKey: 'test', model: 'gpt-5.6-luna',
    fetchImpl: (async (_url: unknown, options: RequestInit) => {
      assert.equal(JSON.parse(String(options.body)).reasoning_effort, 'low');
      await new Promise(resolve => setTimeout(resolve, 10));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
    }) as typeof fetch }, { reasoningEffort: 'low', onUsage: value => { metrics = value; } });
  assert.ok(metrics); assert.equal(metrics.requestedModel, 'gpt-5.6-luna'); assert.equal(metrics.reasoningEffort, 'low');
  assert.equal(metrics.returnedModel, null); assert.equal(metrics.inputTokens, null); assert.equal(metrics.outputTokens, null);
  assert.ok(metrics.estimatedInputTokens! > 0); assert.ok(metrics.estimatedOutputTokens! > 0);
  assert.ok(metrics.requestMs >= 9); assert.ok(metrics.queueMs >= 0);
});

test('v3 monitoring counts validated items in partial batches without calling all videos failures', async () => {
  const { observedProvider } = await import('../src/matching-v3/observability.js');
  const { PartialClassificationError } = await import('../src/matching-v3/provider.js');
  const { db, store } = storeFixture();
  const provider: Provider = { classify: async () => classification,
    classifyBatch: async () => { throw new PartialClassificationError([classification, null]); },
    embed: async () => [], channel: async () => ({ types: [], evidenceAvailable: false }) };
  try {
    await assert.rejects(observedProvider(provider, store).classifyBatch!([video, video]), PartialClassificationError);
    const event = store.monitoring().operations[0]; assert.equal(event.status, 'partial'); assert.equal(event.items, 2); assert.equal(event.valid_items, 1);
    assert.equal(store.monitoring().recent[0].valid_items, 1);
  } finally { db.close(); }
});

test('v3 tagless genre classification produces no embeddings and is not treated as an empty genre', async () => {
  const { db, store } = storeFixture();
  const provider: Provider = { classify: async () => ({ tagSource: 'original', tags: [], assignments: [{ genre: 'News', tags: [] }] }),
    embed: async () => { throw new Error('No tags should reach embedding'); }, channel: async () => ({ types: [], evidenceAvailable: false }) };
  try {
    const result = await buildProfile({ videos: [{ ...video, tags: [] }], complete: true, fingerprint: 'tagless' }, ['News'], store, s, provider, compute);
    assert.equal(result.genres.News!.videoCount, 1); assert.equal(result.genres.News!.status, 'insufficient');
    assert.deepEqual(result.genres.News!.clusters, []);
  } finally { db.close(); }
});

test('v3 all existing tags are embedded even for an unassigned video; legacy cache keys stay reusable', async () => {
  const { classificationKey } = await import('../src/matching-v3/pipeline.js');
  const { digest } = await import('../src/matching-v3/model.js');
  assert.equal(classificationKey(s, video), digest(['video-classification-3', s.baseUrl, s.classificationModel, video.id, video.title, video.tags]));
  const { db, store } = storeFixture(); let embedded: string[] = [];
  const tags = Array.from({length: 40}, (_,i) => `tag${i}`);
  const provider: Provider = { classify: async () => ({ tagSource: 'original', tags, assignments: [] }),
    embed: async values => { embedded.push(...values); return values.map(() => [1, 0]); }, channel: async () => ({ types: [], evidenceAvailable: false }) };
  try { await buildProfile({ videos: [{ ...video, tags }], complete: true, fingerprint: 'all' }, ['Sport'], store, s, provider, compute);
    assert.deepEqual(embedded.sort(), tags.sort());
  } finally { db.close(); }
});

test('v3 GPT concurrency reaches thirty-two and shares a cap across provider instances', async () => {
  let active = 0, peak = 0;
  const request = (async () => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 30));
    active--;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"genres":["Sport"]}' } }] }));
  }) as typeof fetch;
  const providers = Array.from({ length: 2 }, () => matchingProvider({ ...s, concurrency: 32, apiKey: 'fake' }, '', request));
  await Promise.all(Array.from({ length: 64 }, (_,i) => providers[i % 2].classify(video)));
  assert.equal(peak, 32); assert.equal(active, 0);
});

 test('v3 accepts ten thousand workers and rejects excessive concurrency', () => {
  assert.equal(settings({ MATCHING_V3_CONCURRENCY: "10000" }).concurrency, 10000);
  assert.throws(() => settings({ MATCHING_V3_CONCURRENCY: "10001" }));
});

test('v3 ready work has no fixed delay while provider backoff remains', () => {
  const { db, store } = storeFixture();
  try {
    assert.equal(store.nextWorkDelay(), 5000);
    store.schedule(1, 'ready', version(s)); assert.equal(store.nextWorkDelay(), 0);
    store.defer(store.claim()!, null); assert.equal(store.nextWorkDelay(), 0);
    const retry = store.claim()!; store.defer(retry, 'provider_http_429');
    assert.ok(store.nextWorkDelay() > 0); assert.equal(store.claim(), null);
  } finally { db.close(); }
});

test('v3 accounts continue beyond three API operations without requeueing', async () => {
  const registry = new UserRegistry(':memory:'); let calls = 0;
  try {
    registry.createUser('continuous', 'Continuous'); const user = registry.userByHandle('continuous')!;
    for (let i = 0; i < 6; i++) registry.repositoryFor(user).upsertYoutubeCapture(normalizeYoutubeCapture({
      sessionId: `continuous-session-${i}`, videoId: `CONTINUOUS${i}`, title: '羽球', url: `https://www.youtube.com/watch?v=CONTINUOUS${i}`,
      watchedAt: '2026-09-04T12:00:00Z', actualWatchedSeconds: 30, durationSeconds: 60,
    }, new Date('2026-09-05T12:00:00Z')));
    const provider: Provider = { classify: async () => { calls++; return classification; }, embed: async tags => { calls++; return tags.map(() => [1,0]); }, channel: async () => ({ types: [], evidenceAvailable: false }) };
    await runCycle(registry, { ...s, callsPerCycle: 0 }, provider, compute);
    assert.equal(calls, 7); assert.equal(registry.matchingV3Store().status(user.id)?.state, 'done');
    assert.equal(registry.matchingV3Store().profile(user.id)?.processedVideos, 6);
  } finally { registry.close(); }
});

 test('v3 endpoint switch can preserve existing cache identity without migration', async () => {
  const { classificationKey } = await import('../src/matching-v3/pipeline.js');
  const before = settings({ AI_BASE_URL: 'http://gateway:8320/v1' });
  const after = settings({ MATCHING_V3_BASE_URL: 'https://api.openai.com/v1', MATCHING_V3_CLASSIFICATION_CACHE_NAMESPACE: before.classificationCacheNamespace });
  assert.equal(classificationKey(before, video), classificationKey(after, video));
  assert.equal(version(before), version(after));
  assert.equal(settings({ MATCHING_V3_CALLS_PER_CYCLE: '0' }).callsPerCycle, 0);
});


test('v3 one account dispatches multiple batches and all accounts share the API ceiling', async () => {
  const { db, store } = storeFixture();
  let active = 0, peak = 0, calls = 0;
  const provider: Provider = {
    classify: async () => classification,
    classifyBatch: async videos => {
      active++; calls++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      return videos.map(() => classification);
    },
    embed: async tags => tags.map(() => [1, 0]),
    channel: async () => ({ types: [], evidenceAvailable: false }),
  };
  const source = (prefix: string) => ({ videos: Array.from({ length: 12 }, (_, i) => ({ ...video, id: prefix + i })), complete: true, fingerprint: prefix });
  try {
    await Promise.all(['a', 'b'].map(prefix => buildProfile(source(prefix), ['Sport'], store,
      { ...s, concurrency: 3, classificationBatchSize: 1 }, provider, compute)));
    assert.equal(peak, 3);
    assert.equal(calls, 24);
    assert.equal(active, 0);
  } finally { db.close(); }
});

test('v3 parallel failure waits for siblings and preserves successful batches for resume', async () => {
  const { db, store } = storeFixture();
  let completed = false, fail = true, calls = 0, embeds = 0;
  const provider: Provider = {
    classify: async () => classification,
    classifyBatch: async videos => {
      calls++;
      if (videos[0].id === 'bad' && fail) throw new Error('synthetic failure');
      await new Promise(resolve => setTimeout(resolve, 15));
      completed = true;
      return videos.map(() => classification);
    },
    embed: async tags => { embeds++; return tags.map(() => [1, 0]); },
    channel: async () => ({ types: [], evidenceAvailable: false }),
  };
  const source = { videos: ['bad', 'good', 'good2'].map(id => ({ ...video, id })), complete: true, fingerprint: 'siblings' };
  try {
    await assert.rejects(buildProfile(source, ['Sport'], store, { ...s, classificationBatchSize: 1 }, provider, compute), /synthetic failure/);
    assert.equal(completed, true);
    assert.equal(embeds, 1);
    fail = false;
    const result = await buildProfile(source, ['Sport'], store, { ...s, classificationBatchSize: 1 }, provider, compute);
    assert.equal(calls, 4);
    assert.equal(result.processedVideos, 3);
    assert.equal(embeds, 1);
  } finally { db.close(); }
});


test('v3 operation retention never drops in-flight requests during a large burst', () => {
  const { db, store } = storeFixture();
  try {
    const first = store.operationStart('gpt_classification', 20);
    for (let i = 0; i < 2010; i++) { const id = store.operationStart('gpt_classification', 20); store.operationEnd(id); }
    assert.equal(db.prepare('SELECT status FROM matching_v3_operations WHERE id=?').get(first)?.status, 'running');
    store.operationEnd(first);
    db.prepare('UPDATE matching_v3_operations SET finished_at=? WHERE id=?').run(Date.now()-360000, first);
    for (let i=0;i<256;i++) store.operationStart('gpt_classification', 20);
    assert.equal(db.prepare('SELECT id FROM matching_v3_operations WHERE id=?').get(first), undefined);
  } finally { db.close(); }
});

test('v3 Gemini dispatch is not blocked by a saturated GPT queue', async () => {
  const { classificationKey } = await import('../src/matching-v3/pipeline.js');
  const { db, store } = storeFixture();
  let release!: () => void, started!: () => void;
  const blocked = new Promise<void>(r => { release = r; });
  const entered = new Promise<void>(r => { started = r; });
  let embedded = false;
  const provider: Provider = {
    classify: async () => classification,
    classifyBatch: async videos => { started(); await blocked; return videos.map(() => classification); },
    embed: async tags => { embedded = true; return tags.map(() => [1,0]); },
    channel: async () => ({ types: [], evidenceAvailable: false }),
  };
  const config = { ...s, concurrency: 1, classificationBatchSize: 1 };
  const first = buildProfile({ videos: [video], complete: true, fingerprint: 'blocked' }, ['Sport'], store, config, provider, compute);
  await entered;
  const cached = { ...video, id: 'cached' };
  store.putCache(classificationKey(config, cached), classification);
  let second: Promise<Profile> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    second = buildProfile({ videos: [cached], complete: true, fingerprint: 'cached' }, ['Sport'], store, config, provider, compute);
    await Promise.race([second, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Gemini blocked behind GPT')), 1000); })]);
    assert.equal(embedded, true);
  } finally { clearTimeout(timer); release(); await Promise.allSettled([first, ...(second ? [second] : [])]); db.close(); }
});

test('cached preview uses real vectors only, stays provisional and preserves background job', async () => {
  const { cachedPreview } = await import('../src/matching-v3/preview.js');
  const { classificationKey, embeddingKey } = await import('../src/matching-v3/pipeline.js');
  const { db, store } = storeFixture();
  try {
    store.putCache(classificationKey(s, video), { tagSource: 'original', tags: ['ready','pending'], assignments: [{ genre:'Sport', tags:['ready','pending'] }] });
    store.putCache(embeddingKey(s,'ready'), [1,0]);
    store.schedule(1,'original-job',version(s));
    const before = store.status(1);
    const p = await cachedPreview({ videos:[video], complete:true, fingerprint:'bounded' },store,s,compute);
    assert.equal(p.complete,false);
    assert.equal(p.genres.Sport?.retainedCoverage,0.5);
    assert.equal(p.genres.Sport?.status,'insufficient');
    assert.equal(p.genres.Sport?.clusters.length,1);
    assert.equal(store.publishPreview(1,p,null),true);
    assert.deepEqual(store.status(1),before);
    assert.equal(store.publishPreview(1,{...p,builtAt:'replacement'},p),false);
    const result=await compareProfiles(p,p,['Sport'],compute);
    assert.equal(result.provisional,true);
    assert.notEqual(result.score,null);
  } finally { db.close(); }
});

test('cached preview cannot replace a worker result published during clustering', () => {
  const { db, store } = storeFixture();
  try {
    const previous = { ...profile(), version: 'old-profile' };
    store.schedule(1, 'old', previous.version); store.finish(store.claim()!, previous);
    const observed = store.profile(1);
    const newer = { ...profile(), version: 'new-worker-version', builtAt: '2026-09-06T01:00:00Z' };
    store.schedule(1, 'new', newer.version); store.finish(store.claim()!, newer);
    const preview = { ...profile(), complete: false };
    assert.equal(store.publishPreview(1, preview, observed), false);
    assert.equal(store.publishPreview(1, preview, null), false);
    assert.deepEqual(store.profile(1), newer);
  } finally { db.close(); }
});

for (const action of ['delete', 'rename'] as const) test(`cached preview skips a user ${action}d during clustering`, async () => {
  const { publishCachedPreviews } = await import('../src/matching-v3/preview.js');
  const { classificationKey, embeddingKey } = await import('../src/matching-v3/pipeline.js');
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('previewfixture', 'Preview Fixture');
    const repo = registry.repositoryFor(user), store = registry.matchingV3Store();
    repo.upsertYoutubeCapture(normalizeYoutubeCapture({ sessionId: 'preview-fixture-session-001', videoId: 'V3FIXTURE01',
      title: '羽球 #羽球', url: 'https://www.youtube.com/watch?v=V3FIXTURE01', watchedAt: '2026-09-04T12:00:00Z',
      actualWatchedSeconds: 30, durationSeconds: 60 }, new Date('2026-09-05T12:00:00Z')));
    const source = repo.matchingV3Source();
    store.putCache(classificationKey(s, source.videos[0]), classification);
    store.putCache(embeddingKey(s, '羽球'), [1, 0]);
    const original = registry.repositoryFor.bind(registry);
    registry.repositoryFor = candidate => {
      assert.equal(registry.userByHandle(candidate.handle)?.id, candidate.id, 'never reopen a stale user database');
      return original(candidate);
    };
    const raceCompute: Compute = { ...compute, cluster: async points => {
      if (action === 'delete') registry.deleteUser(user.handle);
      else registry.renameUser(user.handle, 'previewrenamed');
      return compute.cluster(points);
    } };
    assert.deepEqual(await publishCachedPreviews(registry, s, raceCompute), { published: 0, skipped: 1 });
    assert.equal(store.profile(user.id), null);
  } finally { registry.close(); }
});

test('v3 comparison uses independent endpoint while clustering stays on background endpoint', async () => {
  const original = globalThis.fetch, urls: string[] = [];
  globalThis.fetch = (async url => { urls.push(String(url)); return new Response('{}'); }) as typeof fetch;
  try {
    const client = computeClient({ ...s, computeUrl:'http://background:8090', compareUrl:'http://interactive:8090' });
    const g=profile().genres.Sport!; const multi={...g,clusters:[{...g.clusters[0],share:0.5},{...g.clusters[0],share:0.5}]};
    await client.cluster([]); await client.compare(multi,multi);
    assert.deepEqual(urls,['http://background:8090/cluster','http://interactive:8090/compare']);
  } finally { globalThis.fetch=original; }
});

test('v3 singleton transport uses the exact cosine formula without remote solver', async () => {
  const client = computeClient({...s, computeUrl:'http://unreachable.invalid',similarityFloor:0.7});
  const g=profile().genres.Sport!;
  const one=(vector:number[])=>({...g,clusters:[{...g.clusters[0],centroid:vector,share:1}]});
  assert.equal((await client.compare(one([2,0]),one([4,0]))).score,1);
  assert.equal((await client.compare(one([1,0]),one([0,1]))).score,0);
  assert.ok(Math.abs((await client.compare(one([1,0]),one([0.8,0.6]))).score-1/3)<1e-12);
});

test('v3 cache monitoring can use the compact statistics index', () => {
  const {db}=storeFixture();
  try {
    const plan=db.prepare(`EXPLAIN QUERY PLAN SELECT CASE WHEN json_type(value_json)='array' THEN 'embedding'
      WHEN json_type(value_json,'$.assignments')='array' THEN 'classification' ELSE 'channel' END kind,
      count(*) count,max(created_at) latest FROM matching_v3_cache GROUP BY kind`).all();
    assert.ok(plan.some(row=>String(row.detail).includes('matching_v3_cache_stats')));
  } finally { db.close(); }
});

 test('compact singleton keeps coverage and actual representative in remote comparison', async () => {
  const original=globalThis.fetch; let body:any;
  globalThis.fetch=(async (_url,init)=>{body=JSON.parse(String(init?.body));return new Response(JSON.stringify({score:.2,transport:[]}));}) as typeof fetch;
  try {
    const g=profile().genres.Sport!;
    const compact={...g,retainedCoverage:.2,clusters:[{...g.clusters[0],representative:[0,1]}]};
    await computeClient(s).compare(compact,compact);
    assert.equal(body.algorithm,'compact-medoid-v1');
    assert.equal(body.leftCoverage,.2);
    assert.deepEqual(body.left[0].representative,[0,1]);
  } finally {globalThis.fetch=original;}
 });
 test('compact explanation uses full genre mass instead of retained-only share', async () => {
   const p=profile();p.genres.Sport!.retainedCoverage=.2;
   p.genres.Sport!.clusters[0].representative=[1,0];
   const result=await compareProfiles(p,p,['Sport'],compute);
   assert.equal(result.reasons[0].leftShare,.2);
   assert.match(result.reasons[0].text,/20.0%/);
   assert.doesNotMatch(result.reasons[0].text,/100.0%/);
 });
