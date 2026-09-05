import { config } from '../config.js';
import type { Repository } from '../data/database.js';
import { createAsyncLimiter } from './concurrency.js';
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
const aiRequest = createAsyncLimiter(4);

export interface YoutubeAiClient {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
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

async function chatJson(system: string, input: unknown, client: YoutubeAiClient): Promise<unknown> {
  return aiRequest(async () => {
    const response = await (client.fetchImpl ?? fetch)(`${client.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${client.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: client.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(input) },
        ],
      }),
      signal: AbortSignal.timeout(client.timeoutMs ?? config.ai.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`AI topics: HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    }
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI topics: response did not contain message content');
    return parseJson(content);
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

export async function classifyYoutubeVideos(repository: Repository, limit = 250): Promise<number> {
  return classifyYoutubeVideosWithClient(repository, limit, defaultClient());
}

function workRun(repository: Repository, client: YoutubeAiClient): PersonalTaxonomyRun | null {
  const run = repository.youtubeTaxonomyRunForContract(
    PERSONAL_TAXONOMY_DEFINITION_VERSION,
    client.model,
    PERSONAL_TAXONOMY_PROMPT_VERSION,
  );
  return run && (run.status === 'candidate' || run.status === 'active') ? run : null;
}

export async function classifyYoutubeVideosWithClient(
  repository: Repository,
  limit: number,
  client: YoutubeAiClient,
): Promise<number> {
  if (!configured(client)) return 0;
  await ensureYoutubeTaxonomyWithClient(repository, false, client);
  const run = workRun(repository, client);
  if (!run) return 0;
  const topics = repository.youtubeTopics(run.taxonomyVersion);
  const videos = repository.youtubeVideosForPersonalClassification(run, limit);
  let classified = 0;
  for (let index = 0; index < videos.length; index += 20) {
    const batch = videos.slice(index, index + 20);
    let validated: Array<{
      video: YoutubeVideoMetadata;
      decision: ReturnType<typeof decidePersonalClassification>;
    }> | null = null;
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3 && !validated; attempt += 1) {
      try {
        const response = await chatJson(
          'Classify every supplied YouTube video into exactly one governed topic. '
          + 'Return JSON {"videos":[{"videoId":"...","slug":"...","confidence":0.0,'
          + '"alternativeSlug":null,"alternativeConfidence":null,'
          + '"evidence":[{"text":"exact metadata text","source":"title|channel|tag|description","score":0.0}]}]}. '
          + 'Use Other for clear content outside the listed subjects. Use Unknown when metadata is insufficient. '
          + 'Evidence text must occur verbatim in its declared public metadata source and scores must be above zero. '
          + 'Return every videoId exactly once. Do not return secondary assignments or infer viewer identity.',
          {
            taxonomy: topics.map(({ slug, name, description }) => ({ slug, name, description })),
            videos: batch.map(youtubePublicMetadata),
          },
          client,
        );
        if (!response || typeof response !== 'object' || !Array.isArray((response as any).videos)) {
          throw new Error('AI classification response must contain a videos array');
        }
        const responseById = new Map<string, Record<string, unknown>>();
        for (const raw of (response as any).videos as unknown[]) {
          if (!raw || typeof raw !== 'object') throw new Error('AI classification entries must be objects');
          const item = raw as Record<string, unknown>;
          const videoId = String(item.videoId ?? '');
          if (!batch.some((video) => video.videoId === videoId) || responseById.has(videoId)) {
            throw new Error('AI classification returned an unknown or duplicate videoId');
          }
          responseById.set(videoId, item);
        }
        if (responseById.size !== batch.length) {
          throw new Error('AI classification must return every supplied videoId');
        }
        validated = batch.map((video) => {
          const item = responseById.get(video.videoId)!;
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
          return {
            video,
            decision: decidePersonalClassification(video, {
              slug: String(item.slug ?? '').trim().toLocaleLowerCase('en-US'),
              confidence: Number(item.confidence),
              alternativeSlug: item.alternativeSlug == null
                ? null : String(item.alternativeSlug).trim().toLocaleLowerCase('en-US'),
              alternativeConfidence: item.alternativeConfidence == null
                ? null : Number(item.alternativeConfidence),
              evidence,
            }),
          };
        });
      } catch (error) {
        lastError = error;
      }
    }
    if (!validated) throw lastError;
    for (const { video, decision } of validated) {
      repository.savePersonalYoutubeVideoTopic(run, video, decision);
      classified += 1;
    }
  }
  repository.refreshPersonalTaxonomyRunQuality(run.taxonomyVersion);
  return classified;
}
