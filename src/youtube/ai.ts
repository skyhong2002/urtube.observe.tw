import { config } from '../config.js';
import type { Repository } from '../data/database.js';
import { createAsyncLimiter, type AsyncLimiter } from './concurrency.js';
import {
  PERSONAL_TAXONOMY_DEFINITION_VERSION,
  PERSONAL_TAXONOMY_MIN_AVAILABLE_VIDEOS,
  PERSONAL_TAXONOMY_PROMPT_VERSION,
  PERSONAL_TOPICS,
  decidePersonalClassification,
  samplePersonalTaxonomy,
  type PersonalClassificationEvidence,
  type PersonalTaxonomyRun,
} from './personal-taxonomy.js';
import type { YoutubeTopic, YoutubeVideoMetadata } from './types.js';

// Accounts run concurrently while all model calls share one bounded FIFO.
// This prevents a large archive from consuming every classification slot.
const aiRequest = createAsyncLimiter(config.ai.concurrency);

export interface YoutubeAiClient {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  concurrency?: number;
  fetchImpl?: typeof fetch;
  requestLimiter?: AsyncLimiter;
}

function defaultClient(): YoutubeAiClient {
  return {
    baseUrl: config.ai.baseUrl,
    apiKey: config.ai.apiKey,
    model: config.ai.model,
    timeoutMs: config.ai.timeoutMs,
  };
}

function configured(client: YoutubeAiClient): boolean {
  return Boolean(client.apiKey && client.model && (client.fetchImpl || config.ai.enabled));
}

export function youtubeClassificationConfigured(): boolean {
  return configured(defaultClient());
}

function parseJson(content: string): unknown {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

export class AiHttpError extends Error {
  constructor(public readonly status: number, detail: string) { super(`AI topics: HTTP ${status}: ${detail}`); }
}

export interface AiCallMetrics {
  inputTokens: number | null; outputTokens: number | null;
  inputCharacters: number; outputCharacters: number;
  estimatedInputTokens: number | null; estimatedOutputTokens: number | null;
  tokenizer: 'o200k_base'; queueMs: number; requestMs: number;
  requestedModel: string; returnedModel: string | null; reasoningEffort: string | null;
}
let encoder: import('js-tiktoken').Tiktoken | undefined;
export async function chatJson(system: string, input: unknown, client: YoutubeAiClient,
  feedbackOrOptions: string | { maxCompletionTokens?: number; reasoningEffort?: 'low'; onUsage?: (value: AiCallMetrics) => void } = {}): Promise<unknown> {
  const feedback = typeof feedbackOrOptions === 'string' ? feedbackOrOptions : undefined;
  const options = typeof feedbackOrOptions === 'string' ? {} : feedbackOrOptions;
  const queuedAt = performance.now();
  return (client.requestLimiter ?? aiRequest)(async () => {
    const startedAt = performance.now(), inputText = JSON.stringify(input);
    let content = '', inputTokens: number | null = null, outputTokens: number | null = null, returnedModel: string | null = null;
    try {
      const response = await (client.fetchImpl ?? fetch)(`${client.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${client.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: client.model,
          ...(!options.reasoningEffort || new URL(client.baseUrl).hostname !== 'api.openai.com' ? { temperature: 0 } : {}), response_format: { type: 'json_object' },
          ...(options.maxCompletionTokens ? { max_completion_tokens: options.maxCompletionTokens } : {}),
          ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
          messages: [{ role: 'system', content: system }, { role: 'user', content: inputText },
            ...(feedback ? [{ role: 'user', content: feedback }] : [])],
        }), signal: AbortSignal.timeout(client.timeoutMs ?? config.ai.timeoutMs),
      });
      if (!response.ok) throw new AiHttpError(response.status, (await response.text()).slice(0, 500));
      const body = await response.json() as { model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number }; choices?: Array<{ finish_reason?: string; message?: { content?: string; refusal?: string } }> };
      const validTokens = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
      inputTokens = validTokens(body.usage?.prompt_tokens); outputTokens = validTokens(body.usage?.completion_tokens);
      returnedModel = typeof body.model === 'string' ? body.model.slice(0, 100) : null;
      content = body.choices?.[0]?.message?.content ?? '';
      if (options.maxCompletionTokens && (body.choices?.[0]?.message?.refusal
        || body.choices?.[0]?.finish_reason && body.choices[0].finish_reason !== 'stop')) throw new Error('AI classification incomplete or refused');
      if (!content) throw new Error('AI topics: response did not contain message content');
      return parseJson(content);
    } finally {
      const requestMs = performance.now() - startedAt;
      if (options.onUsage) {
        let estimatedInputTokens: number | null = null, estimatedOutputTokens: number | null = null;
        try {
          encoder ??= (await import('js-tiktoken')).getEncoding('o200k_base');
          estimatedInputTokens = encoder.encode(system).length + encoder.encode(inputText).length;
          estimatedOutputTokens = content ? encoder.encode(content).length : null;
        } catch { /* Metrics must not fail completed API work. */ }
        options.onUsage({ inputTokens, outputTokens, inputCharacters: system.length + inputText.length, outputCharacters: content.length,
          estimatedInputTokens, estimatedOutputTokens, tokenizer: 'o200k_base', queueMs: startedAt - queuedAt, requestMs,
          requestedModel: client.model, returnedModel, reasoningEffort: options.reasoningEffort ?? null });
      }
    }
  });
}

export function youtubePublicMetadata(video: YoutubeVideoMetadata) {
  return {
    videoId: video.videoId,
    title: video.title,
    channel: video.channelTitle,
    description: video.description.slice(0, 700),
    tags: video.tags.slice(0, 20),
  };
}

function fixedTopics(): Array<{ slug: string; name: string; description: string }> {
  return PERSONAL_TOPICS.map(({ slug, name, description }) => ({ slug, name, description }));
}

export async function ensureYoutubeTaxonomy(
  repository: Repository,
  rebuild = false,
): Promise<YoutubeTopic[]> {
  return ensureYoutubeTaxonomyWithClient(repository, rebuild, defaultClient());
}

export async function ensureYoutubeTaxonomyWithClient(
  repository: Repository,
  rebuild: boolean,
  client: YoutubeAiClient,
): Promise<YoutubeTopic[]> {
  if (!configured(client)) return repository.youtubeTopics();
  const existing = repository.youtubeTaxonomyRunForContract(
    PERSONAL_TAXONOMY_DEFINITION_VERSION,
    client.model,
    PERSONAL_TAXONOMY_PROMPT_VERSION,
  );
  if (existing && !rebuild) return repository.youtubeTopics(existing.taxonomyVersion);
  // Migrated archives keep their generated v1 active until their owner
  // explicitly starts a governed candidate. Otherwise the first worker cycle
  // after migration 11 would silently enqueue every large archive for a full
  // AI rebuild. New archives, and an intentional model/prompt change after v2
  // is active, can still start automatically once readiness passes.
  const active = repository.youtubeTaxonomyRuns().find((run) => run.status === 'active');
  if (!rebuild && active && active.definitionVersion !== PERSONAL_TAXONOMY_DEFINITION_VERSION) {
    return repository.youtubeTopics(active.taxonomyVersion);
  }
  const readiness = repository.youtubePersonalTaxonomyReadiness();
  if (!readiness.ready) return repository.youtubeTopics();
  const candidates = repository.youtubePersonalTaxonomyCandidates();
  if (candidates.length < PERSONAL_TAXONOMY_MIN_AVAILABLE_VIDEOS) return repository.youtubeTopics();
  const sample = samplePersonalTaxonomy(candidates);
  if (sample.sampledVideos < PERSONAL_TAXONOMY_MIN_AVAILABLE_VIDEOS) return repository.youtubeTopics();
  const run = repository.createPersonalTaxonomyRun({
    definitionVersion: PERSONAL_TAXONOMY_DEFINITION_VERSION,
    model: client.model,
    promptVersion: PERSONAL_TAXONOMY_PROMPT_VERSION,
    topics: fixedTopics(),
    sample,
  });
  return repository.youtubeTopics(run.taxonomyVersion);
}

export async function classifyYoutubeVideos(repository: Repository, limit = 250, autoActivateFirst = false): Promise<number> {
  return classifyYoutubeVideosWithClient(repository, limit, defaultClient(), autoActivateFirst);
}

function workRun(repository: Repository, client: YoutubeAiClient): PersonalTaxonomyRun | null {
  const run = repository.youtubeTaxonomyRunForContract(
    PERSONAL_TAXONOMY_DEFINITION_VERSION,
    client.model,
    PERSONAL_TAXONOMY_PROMPT_VERSION,
  );
  return run && (run.status === 'candidate' || run.status === 'active' || run.status === 'ready') ? run : null;
}

export async function classifyYoutubeVideosWithClient(
  repository: Repository,
  limit: number,
  client: YoutubeAiClient,
  autoActivateFirst = false,
): Promise<number> {
  if (!configured(client)) return 0;
  await ensureYoutubeTaxonomyWithClient(repository, false, client);
  if (autoActivateFirst) activateInitialTopicsIfReady(repository);
  const run = workRun(repository, client);
  if (!run) return 0;
  const topics = repository.youtubeTopics(run.taxonomyVersion);
  const videos = repository.youtubeVideosForPersonalClassification(run, limit);
  const batches: YoutubeVideoMetadata[][] = [];
  for (let index = 0; index < videos.length; index += 20) batches.push(videos.slice(index, index + 20));
  let classified = 0;
  let failedBatches = 0;
  let firstFailure: unknown;
  const system = 'Classify every supplied YouTube video into exactly one governed topic. '
    + 'Return JSON {"videos":[{"videoId":"...","slug":"...","confidence":0.0,'
    + '"alternativeSlug":null,"alternativeConfidence":null,'
    + '"evidence":[{"text":"exact metadata text","source":"title|channel|tag|description","score":0.0}]}]}. '
    + 'Use Other for clear content outside the listed subjects. Use Unknown when metadata is insufficient. '
    + 'Give at most three evidence items per video. Each evidence text must be a verbatim quote of at most 80 characters '
    + 'from its declared public metadata source, with a score above 0 and at most 1. '
    + 'Return every videoId exactly once. Do not return secondary assignments or infer viewer identity.';
  const classifyBatch = async (batch: YoutubeVideoMetadata[]): Promise<void> => {
    let pending = [...batch];
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3 && pending.length; attempt += 1) {
      try {
        // Tell the model why the previous answer was rejected; blind retries
        // of a strict verbatim-evidence contract rarely converge.
        const feedback = lastError
          ? `Your previous answer was rejected: ${errorText(lastError)}. Return the complete JSON object again with that fixed.`
          : undefined;
        const response = await chatJson(
          system,
          {
            taxonomy: topics.map(({ slug, name, description }) => ({ slug, name, description })),
            videos: pending.map(youtubePublicMetadata),
          },
          client,
          feedback,
        );
        if (!response || typeof response !== 'object' || !Array.isArray((response as any).videos)) {
          throw new Error('AI classification response must contain a videos array');
        }
        const responseById = new Map<string, Record<string, unknown>>();
        const duplicates = new Set<string>();
        for (const raw of (response as any).videos as unknown[]) {
          if (!raw || typeof raw !== 'object') continue;
          const item = raw as Record<string, unknown>;
          const videoId = String(item.videoId ?? '');
          if (!pending.some((video) => video.videoId === videoId)) continue;
          if (responseById.has(videoId)) duplicates.add(videoId);
          responseById.set(videoId, item);
        }
        const remaining: YoutubeVideoMetadata[] = [];
        for (const video of pending) {
          try {
            if (duplicates.has(video.videoId)) throw new Error('AI classification returned a duplicate videoId');
            const item = responseById.get(video.videoId);
            if (!item) throw new Error('AI classification must return every supplied videoId');
            const evidence = Array.isArray(item.evidence)
              ? item.evidence.map((raw): PersonalClassificationEvidence => {
                  if (!raw || typeof raw !== 'object') throw new Error('AI evidence entries must be objects');
                  const value = raw as Record<string, unknown>;
                  return {
                    text: String(value.text ?? ''),
                    source: String(value.source ?? '') as PersonalClassificationEvidence['source'],
                    score: Number(value.score),
                  };
                })
              : [];
            const decision = decidePersonalClassification(video, {
                slug: String(item.slug ?? '').trim().toLocaleLowerCase('en-US'),
                confidence: Number(item.confidence),
                alternativeSlug: item.alternativeSlug == null
                  ? null : String(item.alternativeSlug).trim().toLocaleLowerCase('en-US'),
                alternativeConfidence: item.alternativeConfidence == null
                  ? null : Number(item.alternativeConfidence),
                evidence,
              });
            repository.savePersonalYoutubeVideoTopic(run, video, decision);
            classified += 1;
          } catch (error) { remaining.push(video); lastError = error; }
        }
        pending = remaining;
      } catch (error) {
        lastError = error;
      }
    }
    if (pending.length) {
      // One stubborn batch must not stall every other video for this
      // archive; it is retried on the next cycle.
      failedBatches += 1;
      firstFailure ??= lastError;
      console.warn(`personal classification batch skipped after 3 attempts: ${errorText(lastError)}`);
      return;
    }
  };
  // Batches of one archive fan out up to the shared limiter width; the
  // limiter still bounds total in-flight model calls across archives.
  let cursor = 0;
  const lanes = Math.min(client.concurrency ?? config.ai.concurrency, Math.max(1, batches.length));
  await Promise.all(Array.from({ length: lanes }, async () => {
    while (cursor < batches.length) {
      const batch = batches[cursor]!;
      cursor += 1;
      await classifyBatch(batch);
    }
  }));
  repository.refreshPersonalTaxonomyRunQuality(run.taxonomyVersion);
  if (autoActivateFirst) activateInitialTopicsIfReady(repository);
  if (failedBatches && !classified) throw firstFailure;
  return classified;
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}


// Only callers for newly created accounts enable this. Never replace an
// active/retired version or bypass quality checks, including after a restart.
export function activateInitialTopicsIfReady(repository: Repository): boolean {
  const runs = repository.youtubeTaxonomyRuns();
  if (runs.length !== 1) return false;
  const run = runs[0];
  if (run.definitionVersion !== PERSONAL_TAXONOMY_DEFINITION_VERSION || run.status !== 'ready') return false;
  repository.activatePersonalTaxonomy(run.taxonomyVersion);
  return true;
}
