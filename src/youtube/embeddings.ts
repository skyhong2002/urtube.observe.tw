import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import type { Repository } from '../data/database.js';
import type { UserRegistry } from '../users.js';
import { createAsyncLimiter } from './concurrency.js';
import { normalizeSemanticLabel, semanticTagContract } from './semantic-tags.js';

export const EMBEDDING_POLICY = {
  schema: 1, preprocessing: 1, dimensions: 1024, normalization: 'l2',
  batchSize: 64, concurrency: 2, timeoutMs: 60_000, attempts: 3,
  cycleLimit: 1024, retryMs: 3600_000, leaseMs: 210_000,
} as const;

export interface EmbeddingClient {
  baseUrl: string;
  apiKey: string;
  model: string;
  revision: string;
  fetchImpl?: typeof fetch;
}

export const defaultEmbeddingClient = (): EmbeddingClient => config.embeddings;

export function embeddingsConfigured(client = defaultEmbeddingClient()): boolean {
  try {
    const url = new URL(client.baseUrl);
    return Boolean(client.model.trim() && client.revision.trim()
      && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash);
  } catch { return false; }
}

export function embeddingContract(client = defaultEmbeddingClient()): string {
  return JSON.stringify({ schema: EMBEDDING_POLICY.schema, preprocessing: EMBEDDING_POLICY.preprocessing,
    dimensions: EMBEDDING_POLICY.dimensions, normalization: EMBEDDING_POLICY.normalization,
    model: client.model, revision: client.revision });
}

const requestSlot = createAsyncLimiter(EMBEDDING_POLICY.concurrency);
const responseSchema = z.object({ model: z.string(), data: z.array(z.object({
  index: z.number().int().nonnegative(), embedding: z.array(z.number().finite()).length(EMBEDDING_POLICY.dimensions),
})).max(EMBEDDING_POLICY.batchSize) });

export function validateEmbeddings(raw: unknown, count: number, model: string): number[][] {
  const result = responseSchema.parse(raw);
  if (result.model !== model || result.data.length !== count) throw new Error('Embedding model or count mismatch');
  const seen = new Set<number>();
  const ordered = new Array<number[]>(count);
  for (const item of result.data) {
    if (item.index >= count || seen.has(item.index)) throw new Error('Embedding indices must occur exactly once');
    seen.add(item.index);
    const norm = Math.hypot(...item.embedding);
    if (!Number.isFinite(norm) || norm === 0) throw new Error('Embedding norm must be finite and nonzero');
    ordered[item.index] = item.embedding.map(value => value / norm);
  }
  return ordered;
}

async function requestEmbeddings(labels: string[], client: EmbeddingClient): Promise<number[][]> {
  const response = await (client.fetchImpl ?? fetch)(`${client.baseUrl.replace(/\/$/, '')}/embeddings`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(EMBEDDING_POLICY.timeoutMs),
    headers: { 'Content-Type': 'application/json', ...(client.apiKey ? { Authorization: `Bearer ${client.apiKey}` } : {}) },
    body: JSON.stringify({ model: client.model, input: labels, encoding_format: 'float' }),
  });
  if (!response.ok) throw new Error('Embedding service request failed');
  return validateEmbeddings(await response.json(), labels.length, client.model);
}

export async function checkEmbeddingCapability(client = defaultEmbeddingClient()): Promise<string> {
  if (!embeddingsConfigured(client)) throw new Error('Embedding endpoint, model and immutable revision must be configured');
  await requestSlot(() => requestEmbeddings(['basketball', '籃球'], client));
  return embeddingContract(client);
}

function currentLabels(repository: Repository, tagsContract: string): string[] {
  return [...new Set(repository.youtubeSemanticLabels(tagsContract).map(normalizeSemanticLabel))].sort();
}

export function semanticEmbeddingProgress(
  registry: UserRegistry, repository: Repository, client = defaultEmbeddingClient(), tagsContract = semanticTagContract(),
) {
  const contract = embeddingContract(client);
  const labels = currentLabels(repository, tagsContract);
  const states = registry.embeddingCacheStates(contract, labels);
  const completed = [...states.values()].filter(value => value.status === 'ready').length;
  const errors = [...states.values()].filter(value => value.status === 'error').length;
  const upstream = repository.youtubeSemanticTagCounts(tagsContract);
  const pendingVideos = upstream.pending + upstream.metadataPending;
  const pending = labels.length - completed - errors;
  const status = !embeddingsConfigured(client) ? 'unavailable'
    : errors || upstream.errors ? 'error'
    : pending || pendingVideos ? 'processing' : 'ready';
  return { status, contract, total: labels.length, completed, errors, pending, pendingVideos };
}

export function embeddingWorkPending(registry: UserRegistry, repository: Repository, client = defaultEmbeddingClient(), tagsContract = semanticTagContract(), now = new Date()): boolean {
  if (!embeddingsConfigured(client)) return false;
  const labels = currentLabels(repository, tagsContract);
  const states = registry.embeddingCacheStates(embeddingContract(client), labels);
  return labels.some(label => !states.has(label)
    || (states.get(label)!.status !== 'ready' && states.get(label)!.retryAt <= now.toISOString()));
}

export async function embedSemanticTags(
  registry: UserRegistry, repository: Repository, client = defaultEmbeddingClient(),
  tagsContract = semanticTagContract(), now = () => new Date(),
): Promise<number> {
  const persistProgress = () => repository.setYoutubeSyncState('semantic_embeddings_progress',
    JSON.stringify(semanticEmbeddingProgress(registry, repository, client, tagsContract)));
  if (!embeddingsConfigured(client)) { persistProgress(); return 0; }
  const contract = embeddingContract(client);
  const labels = currentLabels(repository, tagsContract);
  const states = registry.embeddingCacheStates(contract, labels);
  const due = labels.filter(label => !states.has(label)
    || (states.get(label)!.status !== 'ready' && states.get(label)!.retryAt <= now().toISOString()))
    .slice(0, EMBEDDING_POLICY.cycleLimit);
  const batches: string[][] = [];
  for (let i = 0; i < due.length; i += EMBEDDING_POLICY.batchSize) batches.push(due.slice(i, i + EMBEDDING_POLICY.batchSize));
  let completed = 0;
  let failed = false;
  await Promise.all(batches.map(batch => requestSlot(async () => {
    const token = randomUUID();
    const at = now();
    // Claim only after reaching a request slot, so time spent queued cannot expire the lease.
    const claimed = batch.filter(label => registry.claimEmbedding(contract, label, token,
      new Date(at.getTime() + EMBEDDING_POLICY.leaseMs).toISOString(), at.toISOString()));
    if (!claimed.length) return;
    for (let attempt = 0; attempt < EMBEDDING_POLICY.attempts; attempt++) {
      try {
        const vectors = await requestEmbeddings(claimed, client);
        claimed.forEach((label, index) => {
          const stamp = now().toISOString();
          if (registry.finishEmbedding(contract, label, token, vectors[index], stamp, stamp)) completed++;
        });
        return;
      } catch {
        if (attempt + 1 < EMBEDDING_POLICY.attempts) continue;
        failed = true;
        const finished = now();
        for (const label of claimed) registry.finishEmbedding(contract, label, token, null,
          finished.toISOString(), new Date(finished.getTime() + EMBEDDING_POLICY.retryMs).toISOString());
      }
    }
  })));
  persistProgress();
  if (failed) throw new Error('Embedding request or validation failed after 3 attempts; retry state is saved');
  return completed;
}
