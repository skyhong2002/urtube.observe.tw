import assert from 'node:assert/strict';
import test from 'node:test';
import { corpusDigest, loadManifest, parseCorpus, type EvaluationCorpus } from '../scripts/eval/corpus.js';
import { aggregateJudgments, evaluateCorpus, formatReport, raterAgreement } from '../scripts/eval/matching-eval.js';
import { cohenKappa, macroF1, ndcgAtK, precisionAtK, rankByScore } from '../scripts/eval/metrics.js';
import { generateSyntheticCorpus } from '../scripts/eval/synthetic-corpus.js';

const close = (actual: number | null, expected: number, message?: string) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${message ?? ''} expected ${expected}, got ${actual}`);

test('hand-checked Precision@k and NDCG@k', () => {
  const grades = new Map([['a', 2], ['b', 0], ['c', 1], ['d', 0]]);
  const ranking = ['a', 'b', 'c', 'd'];
  close(precisionAtK(ranking, grades, 1), 1);
  close(precisionAtK(ranking, grades, 2), 0.5);
  close(precisionAtK(ranking, grades, 3), 2 / 3);
  // Short lists are divided by k, never by their own length.
  close(precisionAtK(['a'], grades, 4), 0.25);
  // DCG@3 = (2^2-1)/log2(2) + 0 + (2^1-1)/log2(4) = 3.5; ideal [2,1,0] = 3 + 1/log2(3).
  close(ndcgAtK(ranking, grades, 3), 3.5 / (3 + 1 / Math.log2(3)));
  close(ndcgAtK(['c', 'a'], grades, 2), (1 + 3 / Math.log2(3)) / (3 + 1 / Math.log2(3)));
  assert.equal(ndcgAtK(ranking, new Map([['a', 0]]), 3), null, 'NDCG is undefined without a relevant candidate');
});

test('ranking is deterministic: unscorable last, ties by id', () => {
  assert.deepEqual(rankByScore([
    { id: 'c', score: 0.5 }, { id: 'a', score: null }, { id: 'b', score: 0.5 }, { id: 'd', score: 0.9 }, { id: 'e', score: Number.NaN },
  ]), ['d', 'b', 'c', 'a', 'e']);
});

test('hand-checked macro-F1 and Cohen kappa', () => {
  const result = macroF1(['A', 'B'], [['A'], ['A', 'B'], ['B']], [['A'], ['A'], ['A', 'B']]);
  close(result.perLabel.A.f1, 0.8);
  close(result.perLabel.B.f1, 2 / 3);
  close(result.macroF1, (0.8 + 2 / 3) / 2);
  close(cohenKappa([1, 1, 0, 0], [1, 0, 0, 0]), 0.5);
  assert.equal(cohenKappa([1, 1], [1, 1]), null);
});

function window(channels: string[]) {
  return {
    watchEvents: 300, activeDays: 30, topicCoverage: 1,
    channels: channels.map((key) => ({ key, name: key, share: 1 / channels.length })),
    topics: [{ key: 'music' as const, share: 1 }],
    tags: [{ text: 'tag', count: 1, genre: 'Music' as const }],
  };
}

function tinyCorpus(judgments: EvaluationCorpus['queries'][number]['judgments']): EvaluationCorpus {
  const user = (id: string, channels: string[]) => ({ id, windows: { recent: window(channels), prior: window(channels) } });
  return parseCorpus({
    schema: 'urtube-eval-corpus', schemaVersion: 1, corpusId: 'tiny', corpusVersion: 'tiny-1', kind: 'synthetic',
    relevanceSource: 'planted', relevanceVerified: false, generator: null, tagVectors: { tag: [1, 0] },
    users: [user('u1', ['a', 'b']), user('u2', ['a', 'b']), user('u3', ['a', 'c']), user('u4', ['d'])],
    queries: [{ queryUserId: 'u1', judgments }],
  });
}

test('runner computes metrics end to end on a hand-checked fixture', async () => {
  // Jaccard: u2 = 1, u3 = 1/3, u4 = 0  ->  ranking u2, u3, u4.
  const corpus = tinyCorpus([
    { candidateUserId: 'u2', grade: 2, raterId: 'planted' },
    { candidateUserId: 'u3', grade: 0, raterId: 'planted' },
    { candidateUserId: 'u4', grade: 1, raterId: 'planted' },
  ]);
  const report = await evaluateCorpus(corpus, { ks: [1, 2], methodIds: ['channel-jaccard'], ablations: false });
  const method = report.methods[0];
  assert.deepEqual(method.queries[0].ranking, ['u2', 'u3', 'u4']);
  close(method.metrics['P@1'].mean, 1);
  close(method.metrics['P@2'].mean, 0.5);
  close(method.metrics['NDCG@2'].mean, 3 / (3 + 1 / Math.log2(3)));
  assert.equal(method.metrics['NDCG@2'].ci95, null, 'one query has no meaningful interval');
  assert.equal(report.sample.relevantPairs, 2);
  assert.equal(report.sample.agreement, null);
  assert.match(formatReport(report), /NOT evidence of real-world usefulness/);
});

test('multiple raters aggregate by median and report agreement', () => {
  const corpus = tinyCorpus([
    { candidateUserId: 'u2', grade: 2, raterId: 'r1' }, { candidateUserId: 'u2', grade: 1, raterId: 'r2' },
    { candidateUserId: 'u3', grade: 0, raterId: 'r1' }, { candidateUserId: 'u3', grade: 1, raterId: 'r2' },
    { candidateUserId: 'u4', grade: 0, raterId: 'r1' }, { candidateUserId: 'u4', grade: 0, raterId: 'r2' },
  ]);
  assert.deepEqual([...aggregateJudgments(corpus).get('u1')!.entries()], [['u2', 1], ['u3', 0], ['u4', 0]]);
  // Binary labels r1 = [1,0,0], r2 = [1,1,0]: po = 2/3, pe = 1/3*2/3 + 2/3*1/3 = 4/9 -> kappa = 0.4.
  const agreement = raterAgreement(corpus)!;
  close(agreement.kappa, 0.4);
  assert.equal(agreement.overlappingItems, 3);
});

test('schema refuses planted relevance marked as verified', () => {
  const corpus = tinyCorpus([{ candidateUserId: 'u2', grade: 1, raterId: 'planted' }]);
  assert.throws(() => parseCorpus({ ...corpus, relevanceVerified: true }), /planted relevance cannot be marked verified/);
  assert.throws(() => parseCorpus({ ...corpus, queries: [{ queryUserId: 'u1', judgments: [{ candidateUserId: 'u1', grade: 1 }] }] }), /invalid judgment/);
});

test('synthetic generator is reproducible and matches the manifest digest', () => {
  const manifest = loadManifest(new URL('../scripts/eval/manifest.json', import.meta.url));
  const entry = manifest.corpora.find((corpus) => corpus.source === 'generator')!;
  const corpus = generateSyntheticCorpus(entry.seed);
  assert.equal(corpusDigest(corpus), entry.expectedSha256);
  assert.equal(corpusDigest(generateSyntheticCorpus(entry.seed)), entry.expectedSha256);
  assert.notEqual(corpusDigest(generateSyntheticCorpus(entry.seed + 1)), entry.expectedSha256);
  assert.equal(corpus.relevanceSource, 'planted');
  assert.equal(corpus.relevanceVerified, false);
});

test('every method runs on a small synthetic corpus; the compute-service method is skipped explicitly', async () => {
  const corpus = generateSyntheticCorpus(3, { usersPerCommunity: 3 });
  const report = await evaluateCorpus(corpus, { ks: [5], bootstrap: { resamples: 50, seed: 1 } });
  const byId = new Map(report.methods.map((m) => [m.id, m]));
  for (const id of ['channel-jaccard', 'tag-cosine', 'legacy-calibrated', 'legacy-compare-raw', 'v3-single-cluster-local']) {
    const method = byId.get(id)!;
    assert.equal(method.status, 'ran', id);
    for (const value of [method.metrics['P@5'].mean, method.metrics['NDCG@5'].mean]) {
      assert.ok(value >= 0 && value <= 1, `${id} metric in range`);
    }
  }
  assert.equal(byId.get('v3-compact-medoid-ot')!.status, 'skipped');
  assert.match(byId.get('v3-compact-medoid-ot')!.notes, /requires the Python matching-compute service/);
  assert.ok(report.genre && report.genre.result.macroF1 > 0);
  assert.ok(report.ablations.some((a) => a.name === 'v3 similarityFloor' && a.isDefault));
  assert.ok(report.ablations.some((a) => a.name.startsWith('recency weight') && a.isDefault));
  assert.match(report.provenance.gitRevision, /^([0-9a-f]{40}|unknown)/);
  assert.equal(report.provenance.seed, 3);
  const text = formatReport(report);
  assert.match(text, /Human-labelled, consented relevance judgments are pending/);
  assert.match(text, /code revision: /);
});
