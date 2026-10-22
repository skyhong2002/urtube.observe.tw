import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { UserRegistry } from '../src/users.js';
import { version } from '../src/matching-v3/model.js';
import { demoEmbedding, seedMatchingDemo } from '../scripts/matching-demo-seed.js';

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
