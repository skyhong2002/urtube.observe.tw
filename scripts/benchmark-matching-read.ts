// Bounded synthetic request benchmark. No deployment data or model calls.
// DEMO_PYTHON=/path/to/venv/bin/python node --import tsx scripts/benchmark-matching-read.ts 25
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { startDemoCompute } from './demo-compute.js';

Object.assign(process.env, { NODE_ENV: 'test', DATABASE_PATH: ':memory:', USERS_DATABASE_PATH: ':memory:',
  PUBLIC_BASE_URL: 'http://localhost:3000', MAX_USERS: '1000',
  YOUTUBE_API_KEY: '', YOUTUBE_API_KEYS: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '', GEMINI_API_KEYS: '',
  MATCHING_V3_ENABLED: 'false' });
const users = Number(process.argv[2] ?? 25);
if (![25, 100, 500].includes(users)) throw new Error('Choose 25, 100 or 500 synthetic participants');
const { UserRegistry } = await import('../src/users.js');
const { matchingRoutes } = await import('../src/matching-v3/routes.js');
const { computeClient } = await import('../src/matching-v3/compute.js');
const { seedMatchingDemo, demoMatchingV3Settings } = await import('./matching-demo-seed.js');
const numeric = await startDemoCompute();
const registry = new UserRegistry(':memory:');
try {
  const settings = { ...demoMatchingV3Settings(), computeUrl: numeric.url, compareUrl: numeric.url, computeToken: numeric.token };
  const compute = computeClient(settings);
  const demo = await seedMatchingDemo(registry, { settings, compute });
  const store = registry.matchingV3Store();
  const reference = store.profile(demo.bob.id)!;
  registry.setMatchingOptIn(demo.bob.handle, false);
  registry.setMatchingOptIn(demo.carol.handle, false);
  registry.setMatchingOptIn(demo.newcomer.handle, false);
  // Retire the deliberate pending fixture before claiming benchmark jobs.
  const pending = store.claim();
  if (pending) store.defer(pending, 'synthetic fixture held', true);
  for (let i = 1; i < users; i++) {
    const peer = registry.createUser(`synthetic-peer-${i}`, `Synthetic ${i}`);
    registry.setMatchingOptIn(peer.handle, true);
    store.savePreferences(peer.id, { genres: ['Music', 'Education'], topics: [] });
    store.schedule(peer.id, reference.sourceFingerprint, reference.version);
    const job = store.claim();
    if (!job || job.userId !== peer.id || !store.finish(job, structuredClone(reference))) throw new Error('Fixture publication failed');
  }
  const app = matchingRoutes(registry, settings, 'http://localhost:3000', compute);
  const cookie = `urtube_session=${registry.createSession(demo.alice)}`;
  const request = async () => {
    const start = performance.now();
    const response = await app.request('/api/matching-v3/match', { method: 'POST',
      headers: { cookie, origin: 'http://localhost:3000', 'content-type': 'application/json' },
      body: JSON.stringify({ genres: ['Music', 'Education'] }) });
    const body = await response.json() as { candidates?: unknown[] };
    if (response.status !== 200 || body.candidates?.length !== users - 1) throw new Error('Incomplete benchmark response');
    return performance.now() - start;
  };
  const lag = monitorEventLoopDelay({ resolution: 1 });
  lag.enable();
  let ingested = 0, peakRss = process.memoryUsage().rss;
  const repository = registry.repositoryFor(demo.alice);
  const concurrentIngest = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    repository.ingestYoutubeArchive({ archiveHash: `synthetic-benchmark-${++ingested}`, source: 'takeout', searches: [], watches: [{
      eventId: `synthetic-benchmark-${ingested}`, videoId: 'DEMOSHARED1', title: 'Synthetic concurrent ingest',
      url: 'https://www.youtube.com/watch?v=DEMOSHARED1', channelId: 'shared-studio', channelTitle: 'Shared Studio',
      channelUrl: '', watchedAt: new Date(Date.now() - ingested * 3600_000).toISOString(), actualWatchedSeconds: 60, activityType: 'video',
    }] });
  }, 10);
  try {
    await new Promise(resolve => setTimeout(resolve, 20));
    const coldMs = await request();
    const warm = [];
    for (let i = 0; i < 7; i++) warm.push(await request());
    await new Promise(resolve => setTimeout(resolve, 20));
    warm.sort((a, b) => a - b);
    console.log(JSON.stringify({ synthetic: true, users, measuredRequests: 8, coldMs, warmP50Ms: warm[3], warmP95Ms: warm[6],
      eventLoopP95Ms: lag.percentile(95) / 1e6, eventLoopMaxMs: lag.max / 1e6,
      peakNodeRssMiB: Math.max(peakRss, process.memoryUsage().rss) / 1024 ** 2, concurrentIngestEvents: ingested,
      numeric: 'real compact-medoid and exact transport', node: process.version,
      limits: 'In-process Hono API, memory SQLite, identical synthetic peers, two genres; no browser/render/network ingress or provider workload. Seven warm samples; not a production SLA.' }));
  } finally { clearInterval(concurrentIngest); lag.disable(); }
} finally { registry.close(); await numeric.close(); }
