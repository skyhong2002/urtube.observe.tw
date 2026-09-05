import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { UserRegistry } from '../src/users.js';
import { runYoutubeWorkerCycle, youtubeWorkerMadeProgress } from '../src/youtube-worker.js';
import {
  EMBEDDING_POLICY, checkEmbeddingCapability, embedSemanticTags, embeddingContract,
  embeddingsConfigured, embeddingWorkPending, semanticEmbeddingProgress, validateEmbeddings,
  type EmbeddingClient,
} from '../src/youtube/embeddings.js';

const client: EmbeddingClient = { baseUrl: 'http://127.0.0.1:8000/v1', apiKey: '', model: 'BAAI/bge-m3', revision: 'fixture-weights' };
const tagsContract = 'fixture-public-tags-v1';
const vector = () => [3, 4, ...Array(1022).fill(0)];
const payload = (count = 1) => ({ model: client.model, data: Array.from({ length: count }, (_, index) => ({ index, embedding: vector() })) });

function archive(registry: UserRegistry, handle: string, labels = ['Basketball']) {
  const user = registry.createUser(handle, handle);
  const repository = registry.repositoryFor(user);
  for (let index = 0; index < labels.length; index += 5) {
    const batch = labels.slice(index, index + 5);
    const videoId = `public-video-${index}`;
    repository.upsertYoutubeVideoMetadata([{ videoId, title: batch.join(', '),
      channelTitle: null, channelId: null, description: '', tags: batch, thumbnailUrl: '',
      durationSeconds: 60, publishedAt: null, categoryId: '17', availability: 'available', metadataHash: 'hash-v1' }]);
    repository.saveYoutubeSemanticTagResult({ videoId, metadataHash: 'hash-v1', contract: tagsContract,
      status: 'ready', tags: batch.map(label => ({ label, categoryKey: 'sports-fitness',
        confidence: 0.9, source: 'tag', evidence: label })), error: null });
  }
  return { user, repository };
}

test('embeddings enforce explicit service configuration and exact vectors without padding or truncation', async () => {
  assert.equal(embeddingsConfigured(client), true);
  for (const invalid of [{ model: '' }, { revision: '' }, { baseUrl: '' }, { baseUrl: 'file:///tmp/model' }, { baseUrl: 'https://user:secret@example.com/v1' }]) {
    assert.equal(embeddingsConfigured({ ...client, ...invalid }), false);
  }
  assert.deepEqual(validateEmbeddings(payload(), 1, client.model)[0].slice(0, 2), [0.6, 0.8]);
  const reversed = payload(2); reversed.data[1].embedding[0] = 0; reversed.data.reverse();
  assert.deepEqual(validateEmbeddings(reversed, 2, client.model).map(item => item.slice(0, 2)), [[0.6, 0.8], [0, 1]]);
  assert.throws(() => validateEmbeddings({ ...payload(2), data: [payload().data[0], payload().data[0]] }, 2, client.model), /indices/);
  for (const invalid of [
    { ...payload(), model: 'wrong-model' }, payload(0), payload(2),
    { ...payload(), data: [{ index: -1, embedding: vector() }] },
    { ...payload(), data: [{ index: 1, embedding: vector() }] },
    { ...payload(2), data: [payload().data[0], payload().data[0]] },
    ...[[], vector().slice(1), [...vector(), 1], Array(1024).fill(0),
      [NaN, ...vector().slice(1)], [Infinity, ...vector().slice(1)],
    ].map(embedding => ({ ...payload(), data: [{ index: 0, embedding }] })),
  ]) assert.throws(() => validateEmbeddings(invalid, 1, client.model));
  await checkEmbeddingCapability({ ...client, fetchImpl: async (url, options) => {
    assert.equal(String(url), `${client.baseUrl}/embeddings`);
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal);
    const request = JSON.parse(String(options?.body));
    assert.deepEqual(request, { model: client.model, input: ['basketball', '籃球'], encoding_format: 'float' });
    return Response.json(payload(2));
  } });
});

test('concurrent accounts reuse only public labels, cap batches and concurrency, and invalidate stale input/contracts', async () => {
  const registry = new UserRegistry(':memory:');
  const labels = Array.from({ length: 130 }, (_, index) => `Public sport ${index}`);
  const alice = archive(registry, 'private-alice', labels);
  const bob = archive(registry, 'private-bob', [...labels, 'PUBLIC SPORT 0']);
  let active = 0, peak = 0;
  const requested: string[] = [];
  const mocked: EmbeddingClient = { ...client, fetchImpl: async (_url, options) => {
    const request = JSON.parse(String(options?.body));
    assert.deepEqual(Object.keys(request).sort(), ['encoding_format', 'input', 'model']);
    assert.ok(request.input.length <= 64);
    assert.ok(request.input.every((label: string) => label.startsWith('public sport ')));
    requested.push(...request.input);
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return Response.json(payload(request.input.length));
  } };
  try {
    const results = await Promise.all([alice, bob].map(({ repository }) => embedSemanticTags(registry, repository, mocked, tagsContract)));
    assert.equal(results.reduce((sum, value) => sum + value, 0), 130);
    assert.equal(requested.length, 130);
    assert.equal(new Set(requested).size, 130);
    assert.equal(peak, 2);
    assert.equal(await embedSemanticTags(registry, bob.repository, mocked, tagsContract), 0);
    assert.equal(semanticEmbeddingProgress(registry, bob.repository, mocked, tagsContract).status, 'ready');
    assert.equal(embeddingWorkPending(registry, bob.repository, mocked, tagsContract), false);
    assert.equal(semanticEmbeddingProgress(registry, bob.repository, { ...mocked, revision: 'next' }, tagsContract).pending, 130);
    assert.equal(registry.embeddingVector(embeddingContract({ ...mocked, revision: 'next' }), 'public sport 0'), null);
    assert.equal(semanticEmbeddingProgress(registry, bob.repository, mocked, 'next-tags').pendingVideos, 27);
    assert.equal(bob.repository.youtubeSemanticLabels('next-tags').length, 0);
    assert.equal(await embedSemanticTags(registry, bob.repository, { ...mocked, baseUrl: '' }, tagsContract), 0);
    assert.equal(JSON.parse(bob.repository.youtubeSyncState('semantic_embeddings_progress')!).status, 'unavailable');
    registry.deleteUser(alice.user.handle);
    assert.equal(registry.userByHandle(alice.user.handle), null);
    assert.ok(registry.embeddingVector(embeddingContract(mocked), 'public sport 0'));
    assert.equal(semanticEmbeddingProgress(registry, bob.repository, mocked, tagsContract).completed, 130);
  } finally { registry.close(); }
});

test('worker embeds completed tags after partial tag failure and isolates account and private classifier failures', async () => {
  const registry = new UserRegistry(':memory:');
  const alice = archive(registry, 'failure-alice', ['Failed label']);
  const bob = archive(registry, 'success-bob', ['Successful label']);
  const tagged = new Set<string>();
  const classified = new Set<string>();
  const mocked: EmbeddingClient = { ...client, fetchImpl: async (_url, options) => {
    const request = JSON.parse(String(options?.body));
    if (request.input.includes('failed label')) return new Response('service fixture', { status: 503 });
    return Response.json(payload(request.input.length));
  } };
  try {
    const results = await runYoutubeWorkerCycle(registry, {
      portability: async () => 'idle', metadata: async () => 2, channelMetadata: async () => 0,
      matchingClassification: async () => 0,
      semanticTags: async (_repository, user) => {
        tagged.add(user.handle);
        if (user.id === alice.user.id) throw new Error('partial tag failure');
        return 1;
      },
      embeddings: async (cache, repository, user) => {
        assert.ok(tagged.has(user.handle));
        return embedSemanticTags(cache, repository, mocked, tagsContract);
      },
      classification: async (_repository, user) => { classified.add(user.handle); return 1; },
    });
    assert.equal(results.find(result => result.user === bob.user.handle)?.embedded, 1);
    const failed = results.find(result => result.user === alice.user.handle)!;
    assert.match(failed.error ?? '', /partial tag failure/);
    assert.match(failed.error ?? '', /Embedding request/);
    assert.equal(failed.metadata, 2);
    assert.equal(failed.classified, 1);
    assert.equal(classified.size, 2);
    assert.equal(youtubeWorkerMadeProgress(results), true);
  } finally { registry.close(); }
});

test('cache leases survive restart, reject stale owners, and failed service requests retain completion-time retry state', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'urtube-embeddings-'));
  const path = join(directory, 'registry.sqlite');
  let registry = new UserRegistry(path);
  let elapsed = Date.now();
  const now = () => new Date(elapsed);
  const contract = embeddingContract(client);
  const { user } = archive(registry, 'cache-owner');
  try {
    assert.equal(registry.claimEmbedding(contract, 'basketball', 'interrupted', new Date(elapsed + EMBEDDING_POLICY.leaseMs).toISOString(), now().toISOString()), true);
    registry.close();
    registry = new UserRegistry(path);
    const otherProcess = new UserRegistry(path);
    assert.equal(otherProcess.claimEmbedding(contract, 'basketball', 'duplicate', new Date(elapsed + EMBEDDING_POLICY.leaseMs).toISOString(), now().toISOString()), false);
    otherProcess.close();
    const repository = registry.repositoryFor(registry.userByHandle(user.handle)!);
    assert.equal(embeddingWorkPending(registry, repository, client, tagsContract, now()), false);
    elapsed += EMBEDDING_POLICY.leaseMs + 1;
    let calls = 0;
    const failing: EmbeddingClient = { ...client, fetchImpl: async () => {
      calls++; elapsed += 60_000;
      throw new Error('must not expose service credentials or response data');
    } };
    await assert.rejects(embedSemanticTags(registry, repository, failing, tagsContract, now), /3 attempts/);
    assert.equal(calls, 3);
    assert.equal(semanticEmbeddingProgress(registry, repository, client, tagsContract).status, 'error');
    assert.equal(embeddingWorkPending(registry, repository, client, tagsContract, now()), false);
    assert.equal(registry.finishEmbedding(contract, 'basketball', 'interrupted', vector(), now().toISOString(), now().toISOString()), false);
    elapsed += EMBEDDING_POLICY.retryMs + 1;
    const recovered: EmbeddingClient = { ...client, fetchImpl: async () => Response.json(payload()) };
    assert.equal(await embedSemanticTags(registry, repository, recovered, tagsContract, now), 1);
    registry.close(); registry = new UserRegistry(path);
    assert.deepEqual(registry.embeddingVector(contract, 'basketball')?.slice(0, 2), [0.6, 0.8]);
    const inspector = new DatabaseSync(path);
    assert.deepEqual(inspector.prepare('PRAGMA table_info(embedding_cache)').all().map(row => row.name),
      ['contract', 'label', 'status', 'vector_json', 'lease_token', 'retry_at', 'updated_at']);
    inspector.close();
    registry.deleteUser(user.handle);
    assert.equal(registry.listUsers().length, 0);
  } finally { registry.close(); rmSync(directory, { recursive: true, force: true }); }
});
