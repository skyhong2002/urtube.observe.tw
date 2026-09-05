import type { Comparison, GenreProfile, Settings, TagPoint } from './model.js';

export interface Compute {
  cluster(points: TagPoint[]): Promise<Pick<GenreProfile, 'clusters' | 'totalMass' | 'retainedCoverage'>>;
  compare(left: GenreProfile, right: GenreProfile): Promise<Comparison>;
}
export function computeClient(s: Settings): Compute {
  async function call<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${path === '/compare' && s.compareUrl ? s.compareUrl : s.computeUrl}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.computeToken}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`Compute service HTTP ${response.status}`);
    return await response.json() as T;
  }
  return {
    cluster: async points => {
      const result = await call<Pick<GenreProfile, 'clusters' | 'totalMass' | 'retainedCoverage'>>('/cluster', { points, algorithm: 'compact-medoid-v1', compactDistance: s.compactDistance, eps: s.eps, minSamples: s.minSamples, minShare: s.minShare });
      if (points.length && (!Array.isArray(result.clusters) || result.clusters.some(c => !c.representative))) throw new Error('Compute service must support compact-medoid-v1');
      return result;
    },
    compare: async (left, right) => {
      if (!left.clusters.length || !right.clusters.length) return { score: 0, transport: [] };
      // A 1x1 transport matrix has exactly one feasible flow (mass=1).
      // Identical to the solver, without HTTP/LP startup for the common case.
      if (!left.clusters[0].representative && !right.clusters[0].representative && left.clusters.length === 1 && right.clusters.length === 1) {
        const a = left.clusters[0], b = right.clusters[0];
        const na = Math.hypot(...a.centroid), nb = Math.hypot(...b.centroid);
        if (a.share === 1 && b.share === 1 && a.centroid.length === b.centroid.length
          && na > 0 && nb > 0 && Number.isFinite(na) && Number.isFinite(nb)) {
          const cosine = a.centroid.reduce((sum, value, i) => sum + (value / na) * (b.centroid[i] / nb), 0);
          const score = Math.min(1, Math.max(0, (cosine - s.similarityFloor) / (1 - s.similarityFloor)));
          return { score, transport: [{ left: 0, right: 0, mass: 1, similarity: score, contribution: score }] };
        }
      }
      return call('/compare', { left: left.clusters, right: right.clusters, similarityFloor: s.similarityFloor, ...(left.clusters[0].representative || right.clusters[0].representative ? { algorithm: 'compact-medoid-v1', leftCoverage: left.retainedCoverage, rightCoverage: right.retainedCoverage } : {}) });
    },
  };
}
