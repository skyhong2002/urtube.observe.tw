import { createAsyncLimiter, type AsyncLimiter } from '../youtube/concurrency.js';
import type { Comparison, GenreProfile, Settings, TagPoint } from './model.js';

// One numerical server handles one cluster request at a time. Queue before
// allocating upload buffers; comparison has its own independent service.
const clusterLanes = new Map<string, AsyncLimiter>();
const MAX_CLUSTER_POINTS = 250000;

export function clusterUpload(points: TagPoint[], s: Settings) {
  if (!points.length || points.length > MAX_CLUSTER_POINTS) throw new Error('Invalid cluster point count');
  const ordered = points.map(point => ({ point, key: Buffer.from(point.text) }))
    .sort((a, b) => Buffer.compare(a.key, b.key)).map(value => value.point);
  const dimensions = ordered[0].vector.length;
  if (!dimensions || dimensions > 3072 || ordered.some((p, i) => p.vector.length !== dimensions
    || p.vector.some(v => !Number.isFinite(v)) || i > 0 && p.text === ordered[i-1].text)) throw new Error('Invalid cluster vectors');
  const metadata = Buffer.from(JSON.stringify({ algorithm: 'compact-medoid-v1', compactDistance: s.compactDistance,
    minSamples: s.minSamples, dimensions, points: ordered.map(({ vector, ...point }) => point) }));
  if (metadata.length > 64 * 1024 * 1024) throw new Error('Cluster metadata exceeds upload limit');
  const header = Buffer.allocUnsafe(4 + metadata.length);
  header.writeUInt32LE(metadata.length); metadata.copy(header, 4);
  let cursor = -1;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (cursor === -1) { cursor = 0; controller.enqueue(header); return; }
      if (cursor === ordered.length) { controller.close(); return; }
      const end = Math.min(cursor + 128, ordered.length);
      const buffer = Buffer.allocUnsafe((end-cursor) * dimensions * 8);
      let offset = 0;
      for (; cursor < end; cursor++) for (const value of ordered[cursor].vector) {
        buffer.writeDoubleLE(value, offset); offset += 8;
      }
      controller.enqueue(buffer);
    },
  });
  return { body, length: header.length + ordered.length * dimensions * 8 };
}

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
  let lane = clusterLanes.get(s.computeUrl);
  if (!lane) { lane = createAsyncLimiter(1); clusterLanes.set(s.computeUrl, lane); }
  return {
    cluster: points => lane!(async () => {
      if (!points.length) return { clusters: [], totalMass: 0, retainedCoverage: 0 };
      const upload = clusterUpload(points, s);
      const response = await fetch(`${s.computeUrl}/cluster`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-urtube-vectors',
          'Content-Length': String(upload.length), Authorization: `Bearer ${s.computeToken}` },
        body: upload.body, duplex: 'half', signal: AbortSignal.timeout(1800_000),
      } as RequestInit & { duplex: 'half' });
      if (!response.ok) throw new Error(`Compute service HTTP ${response.status}`);
      const result = await response.json() as Pick<GenreProfile, 'clusters' | 'totalMass' | 'retainedCoverage'>;
      if (points.length && (!Array.isArray(result.clusters) || result.clusters.some(c => !c.representative))) throw new Error('Compute service must support compact-medoid-v1');
      return result;
    }),
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
