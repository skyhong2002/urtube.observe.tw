import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { settings, type VideoInput } from '../src/matching-v3/model.js';
import { buildProfile, classificationKey } from '../src/matching-v3/pipeline.js';
import { matchingProvider, BatchKeyMismatchError, PartialClassificationError } from '../src/matching-v3/provider.js';
import { MatchingStore } from '../src/matching-v3/store.js';
import type { Compute } from '../src/matching-v3/compute.js';

const s = settings({ MATCHING_V3_ENABLED: 'true' });
const videos: VideoInput[] = [
  { id: 'batchkey001', title: 'Synthetic badminton final', tags: ['羽球'], channelId: null, channelTitle: null },
  { id: 'batchkey002', title: 'Synthetic piano lesson', tags: ['Piano'], channelId: null, channelTitle: null },
  { id: 'batchkey003', title: 'Synthetic evening bulletin', tags: [], channelId: null, channelTitle: null },
];

// Answers each request with `rows` and records what the provider was asked.
function provider(rows: unknown[]) {
  const sent: unknown[] = [];
  const request = (async (_url: unknown, init?: RequestInit) => {
    const messages = JSON.parse(String(init?.body)).messages as { content: string }[];
    sent.push(JSON.parse(messages.at(-1)!.content));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ videos: rows }) } }] }));
  }) as typeof fetch;
  return { sent, provider: matchingProvider({ ...s, apiKey: 'fixture' }, '', request) };
}

test('batch classification sends short per-item keys and maps a complete response', async () => {
  const { sent, provider: p } = provider([
    { key: 'v0', genres: ['Sport'] }, { key: 'v1', genres: ['Music', 'Education'] }, { key: 'v2', genres: ['News'] },
  ]);
  const results = await p.classifyBatch!(videos);
  assert.deepEqual(sent[0], { videos: [
    { key: 'v0', title: videos[0].title, tags: ['羽球'] },
    { key: 'v1', title: videos[1].title, tags: ['piano'] },
    { key: 'v2', title: videos[2].title, tags: [] },
  ] });
  assert.deepEqual(results.map(r => r.assignments.map(a => a.genre)), [['Sport'], ['Music', 'Education'], ['News']]);
  assert.deepEqual(results[1].tags, ['piano']);
});

for (const [name, rows] of [
  ['swapped', [{ key: 'v1', genres: ['Music'] }, { key: 'v0', genres: ['Sport'] }, { key: 'v2', genres: ['News'] }]],
  ['duplicated', [{ key: 'v0', genres: ['Sport'] }, { key: 'v0', genres: ['Music'] }, { key: 'v2', genres: ['News'] }]],
  ['missing', [{ key: 'v0', genres: ['Sport'] }, { key: 'v2', genres: ['News'] }]],
  ['missing key field', [{ key: 'v0', genres: ['Sport'] }, { genres: ['Music'] }, { key: 'v2', genres: ['News'] }]],
  ['unknown', [{ key: 'v0', genres: ['Sport'] }, { key: 'v9', genres: ['Music'] }, { key: 'v2', genres: ['News'] }]],
  ['extra', [{ key: 'v0', genres: ['Sport'] }, { key: 'v1', genres: ['Music'] }, { key: 'v2', genres: ['News'] }, { key: 'v3', genres: ['News'] }]],
] as const) {
  test(`batch classification rejects ${name} item keys as a provider error`, async () => {
    const { provider: p } = provider([...rows]);
    await assert.rejects(p.classifyBatch!(videos), BatchKeyMismatchError);
  });
}

test('a mapped row with an illegal genre keeps the existing partial semantics', async () => {
  const { provider: p } = provider([{ key: 'v0', genres: ['Sport'] }, { key: 'v1', genres: ['Custom'] }, { key: 'v2', genres: ['News'] }]);
  const error = await p.classifyBatch!(videos).then(() => null, e => e);
  assert.ok(error instanceof PartialClassificationError);
  assert.deepEqual(error.results.map((r: unknown) => r !== null), [true, false, true]);
});

test('a key mismatch caches nothing and leaves classification cache keys unchanged', async () => {
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY)');
  const store = new MatchingStore(db);
  const compute: Compute = { cluster: async () => ({ clusters: [], totalMass: 0, retainedCoverage: 0 }), compare: async () => ({ score: 0, transport: [] }) };
  const before = videos.map(v => classificationKey(s, v));
  try {
    const { provider: p } = provider([{ key: 'v1', genres: ['Music'] }, { key: 'v0', genres: ['Sport'] }, { key: 'v2', genres: ['News'] }]);
    const failing = { ...p, embed: async (tags: string[]) => tags.map(() => [1, 0]) };
    await assert.rejects(buildProfile({ videos, complete: true, fingerprint: 'swap' }, ['Sport'], store, { ...s, classificationBatchSize: 3 }, failing, compute), BatchKeyMismatchError);
    for (const key of before) assert.equal(store.cache(key), null);
    // The request keys are transport-only: the cache identity is still title + canonical tags.
    assert.deepEqual(videos.map(v => classificationKey(s, v)), before);
  } finally { db.close(); }
});
