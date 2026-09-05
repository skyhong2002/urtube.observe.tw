import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { UserRegistry } from '../src/users.js';
import { describePipeline, processingComplete, ProgressEstimator, type PipelineProgress } from '../src/youtube/pipeline-progress.js';
import { personalTaxonomyReadiness } from '../src/youtube/personal-taxonomy.js';

const input: Parameters<typeof describePipeline>[0] = {
  metadata: { videos: 24, videosPendingMetadata: 0, channelsPendingMetadata: 0 },
  topics: { readiness: personalTaxonomyReadiness(24, 24, 24), run: null, processed: 0, total: 24 },
  capabilities: { metadata: true, topics: true }, worker: { running: true, heartbeatAt: new Date(100000).toISOString() },
  workerStage: 'topics', v3Enabled: false, job: null, profile: null, profileVersion: 'fixture', now: 100000,
};

test('keyword progress follows metadata while topic classification remains independent of v3', () => {
  const rows = describePipeline(input);
  assert.equal(rows.length, 6);
  assert.equal(rows.find(row => row.id === 'metadata')?.state, 'done');
  assert.equal(rows.find(row => row.id === 'keywords')?.state, 'done');
  assert.equal(rows.find(row => row.id === 'topics')?.state, 'running');
  assert.equal(rows.find(row => row.id === 'v3')?.state, 'disabled');
  const waiting = describePipeline({ ...input, topics: { ...input.topics, readiness: personalTaxonomyReadiness(24, 20, 20) } });
  assert.equal(waiting.find(row => row.id === 'topics')?.state, 'waiting');
  const stopped = describePipeline({ ...input, worker: null });
  assert.equal(stopped.find(row => row.id === 'topics')?.state, 'queued');
  const blocked = describePipeline({ ...input, topics: { ...input.topics,
    run: { taxonomyVersion: 1, definitionVersion: 'personal-fixed-v2', status: 'blocked' } } });
  assert.equal(blocked.find(row => row.id === 'topics')?.state, 'blocked');
});

test('measured ETA requires positive progress and resets after changed work, stalls or failures', () => {
  const estimate = new ProgressEstimator();
  const row: PipelineProgress = { id: 'topics', state: 'running', done: 0, total: 100, detail: '', basis: 'run1', estimatedMinutes: null };
  assert.equal(estimate.estimate(row, 1000), null);
  assert.equal(estimate.estimate({ ...row, done: 10 }, 61000), 9);
  assert.equal(estimate.estimate({ ...row, done: 10 }, 181001), null);
  assert.equal(estimate.estimate({ ...row, done: 10, total: 200 }, 182001), null);
  assert.equal(estimate.estimate({ ...row, done: 20, basis: 'run2' }, 183001), null);
  assert.equal(estimate.estimate({ ...row, state: 'failed' }, 184001), null);
  assert.equal(estimate.estimate({ ...row, state: 'done', done: 100 }, 185001), 0);
});

test('processing endpoint is session-only, read-only, and works before import and with matching disabled', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const alice = registry.createUser('pipeline-alice', 'Alice');
    const bob = registry.createUser('pipeline-bob', 'Bob');
    const app = createApp(registry);
    assert.equal((await app.request('/api/processing')).status, 401);
    const repository = registry.repositoryFor(alice);
    const response = await app.request(`/api/processing?userId=${bob.id}`, {
      headers: { cookie: `urtube_session=${registry.createSession(alice)}` },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control')!, /private, no-store/);
    const data = await response.json() as { pipeline: PipelineProgress[] };
    assert.equal(data.pipeline.length, 6);
    assert.equal(data.pipeline.find((row: PipelineProgress) => row.id === 'topics')?.state, 'done');
    assert.doesNotMatch(JSON.stringify(data), /pipeline-bob|Alice|Bob|apiKey|keySeed|googleEmail/);
    assert.deepEqual(repository.youtubeTaxonomyRuns(), [], 'monitoring must not start a classification');
    const page = await (await app.request('/pipeline-alice', {
      headers: { cookie: `urtube_session=${registry.createSession(alice)}` },
    })).text();
    assert.match(page, /data-processing-monitor/, 'new accounts see progress before any data arrives');
  } finally { registry.close(); }
});


test('current completion is independent of older history but failed enabled work remains visible', () => {
  const complete = describePipeline({ ...input, selectedRange:'28d', topics:{...input.topics,processed:24,total:24} });
  assert.equal(processingComplete(complete), true);
  assert.equal(processingComplete(describePipeline(input)), false);
  assert.equal(processingComplete(describePipeline({ ...input, selectedRange:'28d',
    topics:{...input.topics,processed:24,total:24}, v3Enabled:true,
    job:{state:'failed',attempts:5,error:'processing_failed',retry_at:0,progress:null},
  })), false);
});
