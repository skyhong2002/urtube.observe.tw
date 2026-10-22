import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { MatchingStore } from '../src/matching-v3/store.js';
import { buildProfile } from '../src/matching-v3/pipeline.js';
import { digest, settings, type Classification, type VideoInput } from '../src/matching-v3/model.js';
import { matchingProvider, type Provider } from '../src/matching-v3/provider.js';
import type { Compute } from '../src/matching-v3/compute.js';

// Synthetic fixtures only. The provider mirrors the real one: every tag it
// receives comes back as an original tag assigned to Sport.
const s = settings({ MATCHING_V3_ENABLED: 'true' });
const compute: Compute = {
  cluster: async points => ({ totalMass: points.length, retainedCoverage: 1,
    clusters: points.map(p => ({ centroid: p.vector, mass: 1, share: 1 / points.length, tags: [{ text: p.text, count: p.count, generatedCount: 0 }] })) }),
  compare: async () => ({ score: 0, transport: [] }),
};
const legacyKey = (video: VideoInput) => digest(['video-classification-3', s.classificationCacheNamespace, s.classificationCacheModel,
  video.id, video.title, video.tags.filter(t => t.length <= 100).slice(0, 30)]);

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES (1);');
  const seen: string[][] = [];
  const provider: Provider = {
    classify: async video => {
      const tags = [...new Set(video.tags.map(t => t.normalize('NFKC').trim().toLowerCase()))].sort();
      seen.push(tags);
      return { tagSource: 'original', tags, assignments: [{ genre: 'Sport', tags }] };
    },
    embed: async tags => tags.map(() => [1, 0]),
    channel: async () => ({ types: [], evidenceAvailable: false }),
  };
  const build = async (tags: string[], id = 'keyfixture1') => {
    const profile = await buildProfile({ videos: [{ id, title: 'Synthetic title', tags, channelId: null, channelTitle: null }],
      complete: true, fingerprint: digest(tags) }, ['Sport'], new MatchingStore(db), s, provider, compute);
    return profile.genres.Sport!.clusters.flatMap(c => c.tags.map(t => t.text)).sort();
  };
  return { db, store: new MatchingStore(db), seen, build };
}
const many = (n: number) => Array.from({ length: n }, (_, i) => `tag-${String(i).padStart(2, '0')}`);

test('changing only the 31st tag classifies the new input instead of reusing the old result', async () => {
  const { db, seen, build } = fixture();
  try {
    await build([...many(30), 'z-old']);
    const tags = await build([...many(30), 'z-new']);
    assert.equal(seen.length, 2);
    assert.ok(tags.includes('z-new') && !tags.includes('z-old'));
  } finally { db.close(); }
});

test('changing a tag longer than 100 characters is part of the cache identity', async () => {
  const { db, seen, build } = fixture();
  try {
    await build(['short', 'a'.repeat(101)]);
    const tags = await build(['short', 'b'.repeat(101)]);
    assert.equal(seen.length, 2);
    assert.ok(tags.includes('b'.repeat(101)) && !tags.includes('a'.repeat(101)));
  } finally { db.close(); }
});

test('adding or removing tags misses, including removing the 31st tag', async () => {
  const { db, seen, build } = fixture();
  try {
    await build([...many(30), 'z-extra']);
    const removed = await build(many(30));
    assert.equal(seen.length, 2);
    assert.ok(!removed.includes('z-extra'));
    const added = await build([...many(30), 'z-added']);
    assert.equal(seen.length, 3);
    assert.ok(added.includes('z-added'));
  } finally { db.close(); }
});

test('the key follows the canonical provider input: normalization, duplicates and order', async () => {
  const { db, seen, build } = fixture();
  try {
    await build(['Ｆｏｏ', 'bar']);
    await build(['bar', 'foo']);
    await build(['#foo', 'BAR', 'bar ']);
    assert.equal(seen.length, 1);
    await build(['bar', 'foo', 'baz']);
    assert.equal(seen.length, 2);
  } finally { db.close(); }
});

test('the provider sends exactly the canonical tags used by the cache key', async () => {
  const bodies: { tags: string[] }[] = [];
  const provider = matchingProvider({ ...s, apiKey: 'fixture' }, '', (async (_url: unknown, init?: RequestInit) => {
    const messages = JSON.parse(String(init?.body)).messages as { content: string }[];
    bodies.push(JSON.parse(messages.at(-1)!.content));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"genres":["Sport"]}' } }] }));
  }) as typeof fetch);
  const tags = [...many(30), 'Ｚ-LAST', '#tag-00', 'x'.repeat(120)];
  const result = await provider.classify({ id: 'keyfixture2', title: 'Synthetic', tags, channelId: null, channelTitle: null });
  const expected = [...new Set([...many(30), 'z-last', 'x'.repeat(120)])].sort();
  assert.deepEqual(bodies[0].tags, expected);
  assert.deepEqual(result.tags, expected);
});

test('completed legacy entries are reused only when provably valid and are never deleted', async () => {
  const { db, store, seen, build } = fixture();
  const video = (id: string, tags: string[]): VideoInput => ({ id, title: 'Synthetic title', tags, channelId: null, channelTitle: null });
  const original = (tags: string[]): Classification => ({ tagSource: 'original', tags, assignments: [{ genre: 'Sport', tags }] });
  try {
    // Unaffected: at most 30 short canonical tags, and the stored result covers them.
    store.putCache(legacyKey(video('legacyok', ['a', 'b'])), original(['a', 'b']));
    // A legacy result produced while a since-removed 31st tag still existed.
    store.putCache(legacyKey(video('legacystale', many(30))), original([...many(30), 'z-removed']));
    // More than 30 tags: the key alone cannot prove the input, but the stored
    // original tag set does when it equals the current canonical tags.
    store.putCache(legacyKey(video('legacywide', [...many(30), 'z'])), original([...many(30), 'z']));
    // Tag generation is retired; existing generated results for tagless videos stay.
    store.putCache(legacyKey(video('legacygen', [])), { tagSource: 'generated', tags: ['kept'], assignments: [{ genre: 'Sport', tags: ['kept'] }] });
    assert.deepEqual(await build(['a', 'b'], 'legacyok'), ['a', 'b']);
    assert.deepEqual(await build([], 'legacygen'), ['kept']);
    assert.deepEqual(await build([...many(30), 'z'], 'legacywide'), [...many(30), 'z']);
    assert.equal(seen.length, 0);
    assert.ok(!(await build(many(30), 'legacystale')).includes('z-removed'));
    assert.equal(seen.length, 1);
    const rows = Number(db.prepare('SELECT count(*) n FROM matching_v3_cache WHERE key IN (?,?,?,?)')
      .get(legacyKey(video('legacyok', ['a', 'b'])), legacyKey(video('legacystale', many(30))),
        legacyKey(video('legacywide', [...many(30), 'z'])), legacyKey(video('legacygen', [])))!.n);
    assert.equal(rows, 4);
  } finally { db.close(); }
});
