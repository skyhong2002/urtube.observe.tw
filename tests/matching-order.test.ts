import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { load } from 'cheerio';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { UserRegistry, type User } from '../src/users.js';
import { settings, version, type Profile } from '../src/matching-v3/model.js';
import * as matching from '../src/matching-v3/matching.js';
import type { Compute } from '../src/matching-v3/compute.js';

// Synthetic members only. Each member's single tag selects its comparison score.
const config = settings({ MATCHING_V3_ENABLED: 'true' });
const scores: Record<string, number> = { complete: .49, provisional: .81, zero: 0 };
const compute: Compute = {
  cluster: async () => { throw new Error('Classification must not run from the UI'); },
  compare: async (_left, right) => {
    const score = scores[right.clusters[0]?.tags[0]?.text ?? ''] ?? 0;
    return { score, transport: score ? [{ left: 0, right: 0, contribution: score, mass: 1, similarity: score }] : [] };
  },
};
function publish(registry: UserRegistry, user: User, tag: string, complete = true) {
  const store = registry.matchingV3Store();
  const profile: Profile = {
    version: version(config), sourceFingerprint: tag, builtAt: '2026-09-06T00:00:00Z', complete,
    processedVideos: 20, totalVideos: 20,
    genres: { Music: { status: 'ready', retainedCoverage: 1, totalMass: 20, videoCount: 20,
      clusters: [{ centroid: [1, 0], mass: 20, share: 1, tags: [{ text: tag, count: 20, generatedCount: 0 }] }] } },
  };
  store.savePreferences(user.id, { genres: ['Music'], topics: [] });
  store.schedule(user.id, tag, version(config)); store.finish(store.claim()!, profile);
}

test('one ranking contract: complete before provisional, then score, missing last, ties keep input order', () => {
  const rows = [
    { id: 'provisional-high', provisional: true, score: .9 },
    { id: 'missing', provisional: true, score: null },
    { id: 'complete-zero', provisional: false, score: 0 },
    { id: 'tie-first', provisional: false, score: .5 },
    { id: 'complete', provisional: false, score: .7 },
    { id: 'tie-second', provisional: false, score: .5 },
    { id: 'provisional-low', provisional: true, score: .1 },
  ];
  assert.deepEqual(rows.sort(matching.compareMatchRank).map(row => row.id),
    ['complete', 'tie-first', 'tie-second', 'complete-zero', 'provisional-high', 'provisional-low', 'missing']);
});

test('/matches and the topic API agree: a provisional 0.9 never outranks a complete 0.7, and is labelled', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const viewer = registry.createUser('order-viewer', 'Viewer');
    // Created first so input order alone would put the provisional member on top.
    const provisional = registry.createUser('order-provisional', 'Provisional member');
    const complete = registry.createUser('order-complete', 'Complete member');
    for (const user of [viewer, provisional, complete]) registry.setMatchingOptIn(user.handle, true);
    publish(registry, viewer, 'viewer'); publish(registry, provisional, 'provisional', false); publish(registry, complete, 'complete');
    const app = createApp(registry, { matchingV3: { settings: config, compute } });
    const headers = { cookie: `urtube_session=${registry.createSession(viewer)}`, origin: 'http://localhost:3000', 'content-type': 'application/json' };
    const page = load(await (await app.request('/matches?lang=zh', { headers })).text());
    const cards = page('#mv-directory .mt-card');
    assert.deepEqual(cards.map((_, card) => page(card).find('.mt-person-link').attr('href')).get(), ['/order-complete', '/order-provisional']);
    assert.equal(page(cards[0]).find('.mt-score-note').length, 0);
    assert.equal(page(cards[1]).find('.mt-score-note').text(), '暫定分數');
    const body = await (await app.request('/api/matching-v3/match?lang=zh', { method: 'POST', headers, body: JSON.stringify({ genres: ['Music'] }) })).json() as any;
    assert.deepEqual(body.candidates.map((c: any) => [c.handle, c.provisional]), [['order-complete', false], ['order-provisional', true]]);
    assert.match(body.candidates[1].memberHtml, /mt-score-note[^>]*>暫定分數</);
  } finally { registry.close(); }
});

const source = readFileSync(new URL('../src/matching-v3/client.js', import.meta.url), 'utf8');
function render(candidates: { memberHtml: string; score: number | null; provisional: boolean }[]) {
  const cards = new Map<string, any>();
  for (const { memberHtml: id } of candidates) cards.set(id, {
    id, badges: [] as any[], querySelector() { return { append: (badge: unknown) => this.badges.push(badge) }; },
  });
  const result: any = { children: [], replaceChildren() { this.children = []; }, append(child: unknown) { this.children.push(child); } };
  const context: any = {
    t: (zh: string) => zh, lang: 'zh',
    element: (tag: string, text?: string, cls?: string) => ({ tag, text, cls, children: [] as unknown[], append(child: unknown) { this.children.push(child); } }),
    document: { createElement: () => ({ innerHTML: '', get content(): any { const id = this.innerHTML; return { querySelector: () => cards.get(id) }; } }) },
  };
  runInNewContext(source.slice(source.indexOf('function renderMatches'), source.indexOf('async function save')) + '\nglobalThis.render = renderMatches;', context);
  context.render({ candidates }, result);
  return { order: Array.from(result.children[0].children, (card: any) => card.id), badged: [...cards.values()].filter(c => c.badges.length).map(c => c.id) };
}

test('the topic view keeps server order and never calls provisional, missing or zero scores the best match', () => {
  const { order, badged } = render([
    { memberHtml: 'complete', score: .7, provisional: false },
    { memberHtml: 'provisional', score: .9, provisional: true },
    { memberHtml: 'missing', score: null, provisional: true },
  ]);
  assert.deepEqual(order, ['complete', 'provisional', 'missing']);
  assert.deepEqual(badged, ['complete']);
  const zero = render([{ memberHtml: 'zero', score: 0, provisional: false }, { memberHtml: 'later', score: .2, provisional: true }]);
  assert.deepEqual(zero.order, ['zero', 'later']);
  assert.deepEqual(zero.badged, []);
  const ties = render([
    { memberHtml: 'b', score: .5, provisional: false }, { memberHtml: 'a', score: .5, provisional: false },
    { memberHtml: 'c', score: .4, provisional: false }, { memberHtml: 'd', score: .3, provisional: false },
  ]);
  assert.deepEqual(ties.order, ['b', 'a', 'c', 'd']);
  assert.deepEqual(ties.badged, ['b', 'a', 'c']);
});
