import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { UserRegistry } from '../src/users.js';
import { version } from '../src/matching-v3/model.js';
import { demoEmbedding, demoMatchingV3Settings, seedMatchingDemo } from '../scripts/matching-demo-seed.js';
import { computeClient } from '../src/matching-v3/compute.js';
import { youtubeMatchingCrystalSection } from '../src/youtube/crystal.js';
import { startDemoCompute } from '../scripts/demo-compute.js';

test('the credential-free demo seeds v3 profiles and real topic scores without API keys', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const demo = await seedMatchingDemo(registry);
    const { alice, bob, carol } = demo, s = demo.matchingV3.settings;
    assert.equal(s.apiKey, '');
    assert.deepEqual(s.embeddingApiKeys, []);
    const store = registry.matchingV3Store();
    const profile = store.profile(alice.id)!;
    assert.equal(profile.version, version(s));
    assert.equal(profile.complete, true);
    assert.equal(profile.genres.Music!.status, 'ready');
    assert.ok(profile.genres.Music!.clusters.some(c => c.tags.some(t => t.text === 'synthesizer')));
    // A genre known from the title with no original tags stays unscored.
    assert.equal(profile.genres.News!.videoCount, 1);
    assert.equal(profile.genres.News!.clusters.length, 0);
    assert.equal(store.profile(carol.id)!.complete, false);

    const app = createApp(registry, { matchingV3: demo.matchingV3 });
    const headers = { cookie: `urtube_session=${registry.createSession(alice)}`, origin: 'http://localhost:3000', 'content-type': 'application/json' };
    const state = await (await app.request('/api/matching-v3', { headers })).json() as any;
    assert.deepEqual(state.preferences.topics.map((t: any) => t.name), ['Music & learning', 'Music', 'News']);
    assert.equal(state.profile.genres.News.reason, 'missing_tags');
    const response = await app.request('/api/matching-v3/match?lang=en', { method: 'POST', headers, body: JSON.stringify({ genres: ['Music', 'Education'] }) });
    const body = await response.json() as any;
    const ranked = body.candidates.map((c: any) => [c.handle, c.provisional]);
    assert.deepEqual(ranked, [['bob-demo', false], ['carol-demo', true]]);
    const scoreBob = body.candidates[0].score;
    assert.ok(scoreBob > 0 && scoreBob <= 1);
    assert.match(body.candidates[0].memberHtml, /Bob/);
    assert.equal(store.profile(bob.id)!.genres.Music!.status, 'ready');

    // Seeding is deterministic: the same synthetic input gives the same scores.
    const again = new UserRegistry(':memory:');
    try {
      const second = await seedMatchingDemo(again);
      const replay = createApp(again, { matchingV3: second.matchingV3 });
      const replayHeaders = { ...headers, cookie: `urtube_session=${again.createSession(second.alice)}` };
      const replayBody = await (await replay.request('/api/matching-v3/match?lang=en', { method: 'POST', headers: replayHeaders, body: JSON.stringify({ genres: ['Music', 'Education'] }) })).json() as any;
      assert.equal(replayBody.candidates[0].score, scoreBob);
    } finally { again.close(); }

    // Invite → accept → Blend shows the v3 topic score for the shared interests.
    registry.createMatchRequest(alice, registry.issueMatchActionToken(alice, bob.id, ['Music']));
    registry.respondToMatchRequest(bob, registry.matchingInboxFor(bob).incoming[0]!.requestToken, 'accept');
    const blend = await app.request('/alice-demo/compare/bob-demo?lang=en', { headers });
    assert.equal(blend.status, 200);
    const html = await blend.text();
    assert.match(html, /data-blend-genre="Music"/);
    assert.match(html, /class="mt-blend-keywords"[^>]*>.*synth/);
  } finally { registry.close(); }
});

test('demo embeddings relate synthetic tags deterministically', () => {
  const cos = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  assert.deepEqual(demoEmbedding('synth', 128), demoEmbedding('synth', 128));
  assert.ok(cos(demoEmbedding('synth', 128), demoEmbedding('synthesizer', 128)) > .9);
  assert.ok(cos(demoEmbedding('synth', 128), demoEmbedding('typescript', 128)) < .1);
});

test('warm matching lets pending consent changes run before disclosing cached results', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const demo = await seedMatchingDemo(registry);
    const app = createApp(registry, { matchingV3: demo.matchingV3 });
    const request = () => app.request('/api/matching-v3/match', { method: 'POST',
      headers: { cookie: `urtube_session=${registry.createSession(demo.alice)}`, origin: 'http://localhost:3000', 'content-type': 'application/json' },
      body: JSON.stringify({ genres: ['Music', 'Education'] }) });
    assert.equal((await request()).status, 200);
    let consentChanged = false;
    setImmediate(() => { registry.setMatchingOptIn(demo.bob.handle, false); consentChanged = true; });
    const response = await request();
    assert.equal(response.status, 200);
    assert.ok(consentChanged, 'warm results must yield to other event-loop work');
    const body = await response.json() as any;
    assert.ok(body.candidates.every((candidate: any) => candidate.handle !== demo.bob.handle));
  } finally { registry.close(); }
});

test('demo dates and aggregate eligibility come from the same synthetic history in future years', async () => {
  for (const at of ['2026-10-22T04:00:00Z', '2032-03-01T04:00:00Z']) {
    const registry = new UserRegistry(':memory:');
    try {
      const now = new Date(at);
      const demo = await seedMatchingDemo(registry, { now });
      const repo = registry.repositoryFor(demo.alice);
      const actual = youtubeMatchingCrystalSection(repo, now);
      assert.ok(actual.watchEvents >= 200);
      assert.ok(actual.activeDays >= 14);
      assert.equal(actual.uniqueVideos, 8);
      assert.deepEqual(registry.matchingCrystalFor(demo.alice.handle)!.data, {
        watchEvents: actual.watchEvents, uniqueVideos: actual.uniqueVideos,
        activeDays: actual.activeDays, estimatedWatchSeconds: actual.estimatedWatchSeconds, topicCoverage: actual.topicCoverage,
      });
      const popularity = repo.youtubePopularity('7d', now);
      assert.equal(popularity.totalVideos, 8);
      assert.equal(popularity.videos.known, 7);
      assert.ok(popularity.channels.unknown.hidden > 0);
      const store = registry.matchingV3Store();
      assert.equal(store.status(demo.pending.id)?.state, 'queued');
      assert.equal(store.status(demo.failed.id)?.state, 'failed');
      assert.equal(store.profile(demo.pending.id), null);
      assert.equal(store.profile(demo.failed.id), null);
    } finally { registry.close(); }
  }
});

test('a missing demo Python executable fails promptly instead of hanging cleanup', { timeout: 5000 }, async () => {
  await assert.rejects(startDemoCompute('/nonexistent/urtube-demo-python'), /ENOENT/);
});

test('synthetic v3 demo uses real Python clustering and exact transport', {
  skip: !process.env.MATCHING_V3_TEST_COMPUTE_URL,
}, async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const settings = { ...demoMatchingV3Settings(), computeUrl: process.env.MATCHING_V3_TEST_COMPUTE_URL!,
      compareUrl: process.env.MATCHING_V3_TEST_COMPUTE_URL!, computeToken: process.env.MATCHING_V3_COMPUTE_TOKEN! };
    const compute = computeClient(settings);
    // The shared single-threaded test service can be occupied by another
    // test's clustering. Verify its wire contract without imposing the live
    // readiness SLA on a concurrently loaded integration-test process.
    const health = await fetch(`${settings.computeUrl}/healthz`, {
      headers: { Authorization: `Bearer ${settings.computeToken}` }, signal: AbortSignal.timeout(30_000),
    });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ready', algorithm: 'compact-medoid-v1' });
    const unauthorized = await fetch(`${settings.computeUrl}/healthz`, { signal: AbortSignal.timeout(30_000) });
    assert.equal(unauthorized.status, 401);
    await unauthorized.body?.cancel();
    const demo = await seedMatchingDemo(registry, { settings, compute });
    const app = createApp(registry, { matchingV3: demo.matchingV3 });
    const response = await app.request('/api/matching-v3/match', { method: 'POST',
      headers: { cookie: `urtube_session=${registry.createSession(demo.alice)}`, origin: 'http://localhost:3000', 'content-type': 'application/json' },
      body: JSON.stringify({ genres: ['Music', 'Education'] }) });
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.deepEqual(body.candidates.map((candidate: any) => [candidate.handle, candidate.provisional]), [['bob-demo', false], ['carol-demo', true]]);
    assert.ok(body.candidates[0].score > 0 && body.candidates[0].score <= 1);
  } finally { registry.close(); }
});
