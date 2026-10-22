// Reproducible matching-effectiveness runner (#92 R17).
import { execFileSync } from 'node:child_process';
import { CONTENT_GENRES } from '../../src/matching-v3/model.js';
import { corpusDigest, type CorpusUser, type EvaluationCorpus } from './corpus.js';
import { createMethods, DEFAULT_METHOD_OPTIONS, type Method, type MethodOptions } from './methods.js';
import {
  bootstrapInterval, cohenKappa, macroF1, mean, ndcgAtK, precisionAtK, rankByScore, seededRandom, type F1Summary,
} from './metrics.js';

export interface QueryResult {
  queryUserId: string;
  ranking: string[];
  precision: Record<number, number>;
  ndcg: Record<number, number | null>;
}

export interface MethodResult {
  id: string;
  label: string;
  family: Method['family'];
  version: string;
  notes: string;
  status: 'ran' | 'skipped';
  // Fraction of judged pairs the method could score at all.
  scoredPairShare: number | null;
  // Fraction of queries with at least one scorable candidate (the app would show someone).
  servedQueryShare: number | null;
  metrics: Record<string, { mean: number; ci95: { low: number; high: number } | null; n: number }>;
  worstQueries: Array<{ queryUserId: string; ndcg: number | null; top: Array<{ id: string; grade: number; note: string }> }>;
  queries: QueryResult[];
}

export interface AblationRow { name: string; methodId: string; setting: string; metric: string; value: number; isDefault: boolean }

export interface EvaluationReport {
  provenance: {
    corpusId: string; corpusVersion: string; corpusSha256: string; manifestSha256Match: boolean | null;
    kind: EvaluationCorpus['kind']; relevanceSource: EvaluationCorpus['relevanceSource']; relevanceVerified: boolean;
    seed: number | null; generator: string | null; gitRevision: string; gitDirty: boolean | null; node: string;
    ks: number[]; bootstrap: { resamples: number; seed: number };
    cost: string;
  };
  sample: { users: number; queries: number; judgedPairs: number; relevantPairs: number; queriesWithoutRelevant: number;
    raters: string[]; agreement: { kappa: number | null; overlappingItems: number } | null };
  methods: MethodResult[];
  genre: { labelSet: string[]; threshold: number; result: F1Summary; ablation: Array<{ threshold: number; macroF1: number }> } | null;
  ablations: AblationRow[];
  ablationsNotImplemented: string[];
}

function gitRevision(): { revision: string; dirty: boolean | null } {
  try {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { revision, dirty: status.trim().length > 0 };
  } catch {
    return { revision: 'unknown (not a git checkout)', dirty: null };
  }
}

// Aggregates multiple raters by the median grade (lower median on ties).
export function aggregateJudgments(corpus: EvaluationCorpus): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  for (const query of corpus.queries) {
    const byCandidate = new Map<string, number[]>();
    for (const j of query.judgments) byCandidate.set(j.candidateUserId, [...(byCandidate.get(j.candidateUserId) ?? []), j.grade]);
    result.set(query.queryUserId, new Map([...byCandidate.entries()].map(([id, grades]) => {
      const sorted = [...grades].sort((a, b) => a - b);
      return [id, sorted[Math.floor((sorted.length - 1) / 2)]];
    })));
  }
  return result;
}

// Mean pairwise Cohen's kappa on binary relevance (grade >= 1) over items both raters judged.
export function raterAgreement(corpus: EvaluationCorpus): { kappa: number | null; overlappingItems: number } | null {
  const byRater = new Map<string, Map<string, number>>();
  for (const query of corpus.queries) for (const j of query.judgments) {
    if (!byRater.has(j.raterId)) byRater.set(j.raterId, new Map());
    byRater.get(j.raterId)!.set(`${query.queryUserId}>${j.candidateUserId}`, j.grade >= 1 ? 1 : 0);
  }
  const raters = [...byRater.keys()].sort();
  if (raters.length < 2) return null;
  const kappas: number[] = [];
  let overlapping = 0;
  for (let i = 0; i < raters.length; i++) for (let j = i + 1; j < raters.length; j++) {
    const a = byRater.get(raters[i])!, b = byRater.get(raters[j])!;
    const items = [...a.keys()].filter((key) => b.has(key));
    if (!items.length) continue;
    overlapping += items.length;
    const kappa = cohenKappa(items.map((key) => a.get(key)!), items.map((key) => b.get(key)!));
    if (kappa !== null) kappas.push(kappa);
  }
  return { kappa: kappas.length ? mean(kappas) : null, overlappingItems: overlapping };
}

// Predicted genres: genres holding at least `threshold` of the person's tag mass.
export function predictedGenres(user: CorpusUser, threshold: number): string[] {
  const tags = user.windows.recent.tags;
  const total = tags.reduce((sum, tag) => sum + tag.count, 0);
  if (!total) return [];
  const mass = new Map<string, number>();
  for (const tag of tags) mass.set(tag.genre, (mass.get(tag.genre) ?? 0) + tag.count);
  return [...mass.entries()].filter(([, value]) => value / total >= threshold).map(([genre]) => genre).sort();
}

async function runMethod(
  method: Method, corpus: EvaluationCorpus, grades: Map<string, Map<string, number>>, options: MethodOptions, ks: number[],
  bootstrap: { resamples: number; seed: number },
): Promise<MethodResult> {
  const base = { id: method.id, label: method.label, family: method.family, notes: method.notes };
  if (!method.score) {
    return { ...base, version: method.version, status: 'skipped', scoredPairShare: null, servedQueryShare: null, metrics: {}, worstQueries: [], queries: [] };
  }
  await method.prepare?.(corpus, options);
  const users = new Map(corpus.users.map((user) => [user.id, user]));
  const queries: QueryResult[] = [];
  let scored = 0, total = 0, served = 0;
  for (const query of corpus.queries) {
    const queryGrades = grades.get(query.queryUserId)!;
    const items = [];
    for (const candidateId of queryGrades.keys()) {
      const score = await method.score(users.get(query.queryUserId)!, users.get(candidateId)!);
      total++;
      if (score !== null && Number.isFinite(score)) scored++;
      items.push({ id: candidateId, score });
    }
    if (items.some((item) => item.score !== null && Number.isFinite(item.score))) served++;
    const ranking = rankByScore(items);
    queries.push({
      queryUserId: query.queryUserId, ranking,
      precision: Object.fromEntries(ks.map((k) => [k, precisionAtK(ranking, queryGrades, k)])),
      ndcg: Object.fromEntries(ks.map((k) => [k, ndcgAtK(ranking, queryGrades, k)])),
    });
  }
  const metrics: MethodResult['metrics'] = {};
  for (const k of ks) {
    for (const [name, values] of [
      [`P@${k}`, queries.map((q) => q.precision[k])],
      [`NDCG@${k}`, queries.map((q) => q.ndcg[k]).filter((v): v is number => v !== null)],
    ] as const) {
      metrics[name] = { mean: mean([...values]), ci95: bootstrapInterval([...values], seededRandom(bootstrap.seed), bootstrap.resamples), n: values.length };
    }
  }
  const kMax = Math.max(...ks);
  const note = (id: string) => {
    const a = users.get(id)?.annotations;
    return a ? [a.community, a.secondary ? `+${a.secondary}` : '', a.sparse ? ' sparse' : '', a.drifted ? ` drifted-from:${a.priorCommunity}` : ''].join('') : '';
  };
  const worstQueries = [...queries]
    .filter((q) => q.ndcg[kMax] !== null)
    .sort((a, b) => (a.ndcg[kMax] ?? 0) - (b.ndcg[kMax] ?? 0) || a.queryUserId.localeCompare(b.queryUserId))
    .slice(0, 3)
    .map((q) => ({ queryUserId: `${q.queryUserId} (${note(q.queryUserId)})`, ndcg: q.ndcg[kMax],
      top: q.ranking.slice(0, 3).map((id) => ({ id, grade: grades.get(q.queryUserId)!.get(id) ?? 0, note: note(id) })) }));
  return { ...base, version: method.version, status: 'ran', scoredPairShare: total ? scored / total : null,
    servedQueryShare: queries.length ? served / queries.length : null, metrics, worstQueries, queries };
}

export interface EvaluateOptions {
  ks?: number[];
  methodIds?: string[];
  expectedSha256?: string | null;
  bootstrap?: { resamples: number; seed: number };
  genreThreshold?: number;
  ablations?: boolean;
}

export async function evaluateCorpus(corpus: EvaluationCorpus, options: EvaluateOptions = {}): Promise<EvaluationReport> {
  const ks = options.ks ?? [5, 10];
  const bootstrap = options.bootstrap ?? { resamples: 1000, seed: 7 };
  const grades = aggregateJudgments(corpus);
  const digest = corpusDigest(corpus);
  const git = gitRevision();
  const all = createMethods();
  const selected = options.methodIds ? all.filter((m) => options.methodIds!.includes(m.id)) : all;
  const methods: MethodResult[] = [];
  for (const method of selected) methods.push(await runMethod(method, corpus, grades, DEFAULT_METHOD_OPTIONS, ks, bootstrap));

  const kMax = Math.max(...ks);
  const ablations: AblationRow[] = [];
  if (options.ablations !== false) {
    const metric = `NDCG@${kMax}`;
    const quick = { resamples: 0, seed: bootstrap.seed };
    for (const recencyWeight of [0.5, 0.75, 1]) {
      for (const id of ['legacy-calibrated', 'tag-cosine', 'v3-single-cluster-local']) {
        const method = createMethods().find((m) => m.id === id)!;
        const result = await runMethod(method, corpus, grades, { ...DEFAULT_METHOD_OPTIONS, recencyWeight }, [kMax], quick);
        ablations.push({ name: 'recency weight (recent vs prior window)', methodId: id, setting: `w=${recencyWeight}`, metric,
          value: result.metrics[metric].mean, isDefault: recencyWeight === DEFAULT_METHOD_OPTIONS.recencyWeight });
      }
    }
    for (const similarityFloor of [0, 0.5, 0.7, 0.9]) {
      const method = createMethods().find((m) => m.id === 'v3-single-cluster-local')!;
      const result = await runMethod(method, corpus, grades, { ...DEFAULT_METHOD_OPTIONS, similarityFloor }, [kMax], quick);
      ablations.push({ name: 'v3 similarityFloor', methodId: method.id, setting: `floor=${similarityFloor}`, metric,
        value: result.metrics[metric].mean, isDefault: similarityFloor === DEFAULT_METHOD_OPTIONS.similarityFloor });
    }
  }

  const labelled = corpus.users.filter((user) => user.genres);
  const threshold = options.genreThreshold ?? 0.1;
  const genre = labelled.length ? {
    labelSet: [...CONTENT_GENRES],
    threshold,
    result: macroF1(CONTENT_GENRES, labelled.map((u) => u.genres!), labelled.map((u) => predictedGenres(u, threshold))),
    ablation: [0.05, 0.1, 0.2, 0.3].map((t) => ({ threshold: t,
      macroF1: macroF1(CONTENT_GENRES, labelled.map((u) => u.genres!), labelled.map((u) => predictedGenres(u, t))).macroF1 })),
  } : null;

  const judgedPairs = [...grades.values()].reduce((sum, map) => sum + map.size, 0);
  const relevantPairs = [...grades.values()].reduce((sum, map) => sum + [...map.values()].filter((g) => g >= 1).length, 0);
  return {
    provenance: {
      corpusId: corpus.corpusId, corpusVersion: corpus.corpusVersion, corpusSha256: digest,
      manifestSha256Match: options.expectedSha256 ? options.expectedSha256 === digest : null,
      kind: corpus.kind, relevanceSource: corpus.relevanceSource, relevanceVerified: corpus.relevanceVerified,
      seed: corpus.generator?.seed ?? null, generator: corpus.generator ? `${corpus.generator.name}@${corpus.generator.version}` : null,
      gitRevision: git.revision, gitDirty: git.dirty, node: process.version, ks, bootstrap,
      cost: 'All methods run locally: 0 model/API calls, 0 embedding calls, no compute-service requests.',
    },
    sample: {
      users: corpus.users.length, queries: corpus.queries.length, judgedPairs, relevantPairs,
      queriesWithoutRelevant: [...grades.values()].filter((map) => ![...map.values()].some((g) => g >= 1)).length,
      raters: [...new Set(corpus.queries.flatMap((q) => q.judgments.map((j) => j.raterId)))].sort(),
      agreement: raterAgreement(corpus),
    },
    methods,
    genre,
    ablations,
    ablationsNotImplemented: [
      'clustering on/off and optimal transport vs centroid matching: needs the Python matching-compute service',
      'per-dimension weights inside calibrated-v2 (topic vs channel): fixed equal mean in app code, not parameterised',
      'v3 compactDistance / minSamples: only used by the compute service clustering',
    ],
  };
}

const f = (value: number | null | undefined, digits = 3) => value === null || value === undefined || Number.isNaN(value) ? 'n/a' : value.toFixed(digits);

export function formatReport(report: EvaluationReport): string {
  const p = report.provenance;
  const lines: string[] = [];
  lines.push('# urtube matching evaluation report', '');
  if (p.relevanceSource === 'planted' || !p.relevanceVerified) {
    lines.push('> **Relevance on this corpus is planted by a synthetic generator and is NOT evidence of real-world usefulness.**',
      '> The generator decides which signals separate people, so it also decides which method can win.',
      '> Human-labelled, consented relevance judgments are pending; no real user data is used.', '');
  }
  lines.push('## Provenance', '',
    `- corpus: ${p.corpusId} ${p.corpusVersion} (${p.kind}, relevance: ${p.relevanceSource}, verified: ${p.relevanceVerified})`,
    `- corpus sha256: ${p.corpusSha256}${p.manifestSha256Match === null ? '' : p.manifestSha256Match ? ' (matches manifest)' : ' (DOES NOT match manifest)'}`,
    `- generator: ${p.generator ?? 'n/a'}, seed: ${p.seed ?? 'n/a'}`,
    `- code revision: ${p.gitRevision}${p.gitDirty ? ' (working tree has uncommitted changes)' : ''}`,
    `- runtime: Node ${p.node}; k = ${p.ks.join(', ')}; bootstrap ${p.bootstrap.resamples} resamples, seed ${p.bootstrap.seed}`,
    `- cost: ${p.cost}`, '');
  const s = report.sample;
  lines.push('## Sample and limits', '',
    `- ${s.users} users, ${s.queries} queries, ${s.judgedPairs} judged pairs (${s.relevantPairs} with grade >= 1); ${s.queriesWithoutRelevant} queries have no relevant candidate (excluded from NDCG).`,
    `- raters: ${s.raters.join(', ')}; agreement: ${s.agreement ? `mean Cohen's kappa ${f(s.agreement.kappa)} over ${s.agreement.overlappingItems} overlapping items` : 'not measurable (single rater)'}`,
    '- Unscorable pairs rank last (ties by id); a query nobody can be scored for still counts with its id-ordered list.',
    '- Positive = grade >= 1 (P@k); NDCG uses gain 2^grade - 1. 95% intervals are percentile bootstrap over queries;',
    '  queries share candidates, so intervals are optimistic. Differences inside overlapping intervals are not meaningful.', '');
  const ks = p.ks;
  const header = ['method', 'family', 'scored pairs', 'served queries', ...ks.flatMap((k) => [`P@${k}`, `NDCG@${k}`])];
  lines.push('## Results', '', `| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`);
  for (const m of report.methods) {
    const cells = m.status === 'skipped'
      ? ks.flatMap(() => ['skipped', 'skipped'])
      : ks.flatMap((k) => [`P@${k}`, `NDCG@${k}`].map((name) => {
        const metric = m.metrics[name];
        return `${f(metric.mean)} [${f(metric.ci95?.low)}, ${f(metric.ci95?.high)}]`;
      }));
    const share = (value: number | null) => value === null ? 'n/a' : `${(100 * value).toFixed(0)}%`;
    lines.push(`| ${m.id} | ${m.family} | ${share(m.scoredPairShare)} | ${share(m.servedQueryShare)} | ${cells.join(' | ')} |`);
  }
  lines.push('', '### Method versions and notes', '');
  for (const m of report.methods) lines.push(`- **${m.id}** (${m.version}): ${m.notes}`);
  if (report.genre) {
    lines.push('', '## Genre macro-F1', '',
      `Predicted genres = genres holding >= ${report.genre.threshold} of a person's recent tag mass, from the corpus' per-tag genre labels.`,
      'On synthetic data those labels are simulated classifier output with injected noise, so this checks aggregation, not the GPT classifier.', '',
      `- macro-F1 = ${f(report.genre.result.macroF1)} over ${report.genre.labelSet.length} content genres`,
      `- per genre: ${Object.entries(report.genre.result.perLabel).map(([g, v]) => `${g} ${f(v.f1, 2)} (n=${v.support})`).join('; ')}`,
      `- threshold ablation: ${report.genre.ablation.map((a) => `${a.threshold} -> ${f(a.macroF1)}`).join(', ')}`);
  }
  if (report.ablations.length) {
    lines.push('', '## Ablations (implemented)', '', '| ablation | method | setting | metric | value |', '| --- | --- | --- | --- | --- |');
    for (const a of report.ablations) lines.push(`| ${a.name} | ${a.methodId} | ${a.setting}${a.isDefault ? ' (app default)' : ''} | ${a.metric} | ${f(a.value)} |`);
  }
  lines.push('', 'Not implemented:', ...report.ablationsNotImplemented.map((item) => `- ${item}`));
  lines.push('', `## Error analysis (lowest NDCG@${Math.max(...ks)} queries)`, '');
  for (const m of report.methods.filter((x) => x.status === 'ran')) {
    lines.push(`- **${m.id}**`);
    for (const q of m.worstQueries) {
      lines.push(`  - ${q.queryUserId}: NDCG ${f(q.ndcg)}; top-3 ${q.top.map((t) => `${t.id}[g${t.grade}, ${t.note}]`).join(', ')}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
