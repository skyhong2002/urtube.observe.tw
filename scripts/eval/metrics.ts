// Ranking and classification metrics for the matching evaluation (#92 R17).
// Pure functions only, so tests can hand-check every number.

export interface RankedItem { id: string; score: number | null }

// Deterministic ranking: higher score first, unscorable (null / non-finite)
// last, ties broken by id so reruns never reorder equal scores.
export function rankByScore(items: RankedItem[]): string[] {
  const value = (score: number | null) => typeof score === 'number' && Number.isFinite(score) ? score : -Infinity;
  return [...items]
    .sort((a, b) => value(b.score) - value(a.score) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((item) => item.id);
}

// Binary relevance: a candidate counts as relevant when its grade >= minGrade.
export function precisionAtK(ranking: string[], grades: ReadonlyMap<string, number>, k: number, minGrade = 1): number {
  if (k <= 0) throw new Error('k must be positive');
  const top = ranking.slice(0, k);
  const hits = top.filter((id) => (grades.get(id) ?? 0) >= minGrade).length;
  // Divide by k (not by the list length) so a short list cannot inflate P@k.
  return hits / k;
}

const gain = (grade: number) => 2 ** grade - 1;
const discount = (index: number) => Math.log2(index + 2);

export function dcgAtK(gradesInRankOrder: number[], k: number): number {
  return gradesInRankOrder.slice(0, k).reduce((sum, grade, index) => sum + gain(grade) / discount(index), 0);
}

// NDCG with exponential gain (2^g - 1) and log2 discount. The ideal ranking
// is computed over every judged candidate, not only the retrieved ones.
// Returns null when the query has no relevant candidate (undefined NDCG).
export function ndcgAtK(ranking: string[], grades: ReadonlyMap<string, number>, k: number): number | null {
  if (k <= 0) throw new Error('k must be positive');
  const ideal = dcgAtK([...grades.values()].sort((a, b) => b - a), k);
  if (ideal === 0) return null;
  return dcgAtK(ranking.map((id) => grades.get(id) ?? 0), k) / ideal;
}

export interface F1Summary {
  macroF1: number;
  perLabel: Record<string, { precision: number; recall: number; f1: number; support: number }>;
}

// Multi-label macro-F1 over a fixed label set. A label with no true and no
// predicted instances scores F1=1 (nothing to get wrong) and is reported with
// support 0 so readers can discount it.
export function macroF1(labels: readonly string[], truth: string[][], predicted: string[][]): F1Summary {
  if (truth.length !== predicted.length) throw new Error('truth/predicted length mismatch');
  const perLabel: F1Summary['perLabel'] = {};
  for (const label of labels) {
    let tp = 0, fp = 0, fn = 0;
    truth.forEach((actual, index) => {
      const t = actual.includes(label), p = predicted[index].includes(label);
      if (t && p) tp++; else if (p) fp++; else if (t) fn++;
    });
    const precision = tp + fp ? tp / (tp + fp) : (fn ? 0 : 1);
    const recall = tp + fn ? tp / (tp + fn) : (fp ? 0 : 1);
    const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
    perLabel[label] = { precision, recall, f1, support: tp + fn };
  }
  const values = Object.values(perLabel).map((entry) => entry.f1);
  return { macroF1: values.reduce((sum, value) => sum + value, 0) / (values.length || 1), perLabel };
}

// Cohen's kappa for two raters over the same items (binary or graded labels).
// Returns null when chance agreement is 1 (both raters constant and equal).
export function cohenKappa(left: number[], right: number[]): number | null {
  if (left.length !== right.length || !left.length) throw new Error('kappa needs two equal, non-empty label lists');
  const n = left.length;
  const categories = [...new Set([...left, ...right])];
  const observed = left.filter((value, index) => value === right[index]).length / n;
  const expected = categories.reduce((sum, category) =>
    sum + (left.filter((v) => v === category).length / n) * (right.filter((v) => v === category).length / n), 0);
  return expected === 1 ? null : (observed - expected) / (1 - expected);
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
}

// Seeded percentile bootstrap over queries: an honest width for a small corpus.
export function bootstrapInterval(
  values: number[],
  random: () => number,
  resamples = 1000,
  confidence = 0.95,
): { low: number; high: number } | null {
  if (values.length < 2 || resamples < 1) return null;
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(random() * values.length)];
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  const tail = (1 - confidence) / 2;
  return {
    low: means[Math.floor(tail * (resamples - 1))],
    high: means[Math.ceil((1 - tail) * (resamples - 1))],
  };
}

// mulberry32: tiny, fast, fully deterministic 32-bit PRNG.
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
