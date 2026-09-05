import type { Comparison, GenreProfile, Settings, TagPoint } from './model.js';

export interface Compute {
  cluster(points: TagPoint[]): Promise<Pick<GenreProfile, 'clusters' | 'totalMass' | 'retainedCoverage'>>;
  compare(left: GenreProfile, right: GenreProfile): Promise<Comparison>;
}
export function computeClient(s: Settings): Compute {
  async function call<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${s.computeUrl}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.computeToken}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`Compute service HTTP ${response.status}`);
    return await response.json() as T;
  }
  return {
    cluster: points => call('/cluster', { points, eps: s.eps, minSamples: s.minSamples, minShare: s.minShare }),
    compare: (left, right) => call('/compare', { left: left.clusters, right: right.clusters, similarityFloor: s.similarityFloor }),
  };
}
