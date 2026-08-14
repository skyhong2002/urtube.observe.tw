import { config } from '../config.js';
import type { Repository } from '../data/database.js';
import type { YoutubeTopic, YoutubeVideoMetadata } from './types.js';

const PROMPT_VERSION = 'youtube-topics-v1';

export interface YoutubeAiClient {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

function defaultClient(): YoutubeAiClient {
  return {
    baseUrl: config.ai.baseUrl,
    apiKey: config.ai.apiKey,
    model: config.ai.model,
  };
}

function configured(client: YoutubeAiClient): boolean {
  return Boolean(
    client.apiKey
    && client.model
    && (client.fetchImpl || config.ai.enabled)
  );
}

function parseJson(content: string): unknown {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

async function chatJson(system: string, input: unknown, client: YoutubeAiClient): Promise<unknown> {
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
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`AI topics: HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI topics: response did not contain message content');
  return parseJson(content);
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

function slug(value: unknown): string {
  return String(value ?? '').toLocaleLowerCase('en-US')
    .normalize('NFKD').replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 64);
}

export async function ensureYoutubeTaxonomy(repository: Repository, rebuild = false): Promise<YoutubeTopic[]> {
  return ensureYoutubeTaxonomyWithClient(repository, rebuild, defaultClient());
}

export async function ensureYoutubeTaxonomyWithClient(
  repository: Repository,
  rebuild: boolean,
  client: YoutubeAiClient,
): Promise<YoutubeTopic[]> {
  const existing = repository.youtubeTopics();
  if (existing.length && !rebuild) return existing;
  if (!configured(client)) return existing;
  const candidates = repository.youtubeVideosForTaxonomy(160);
  if (candidates.length < 12) return existing;
  const response = await chatJson(
    'Create a stable high-level taxonomy for a personal YouTube viewing archive. '
    + 'Return JSON {"topics":[{"slug":"...","name":"...","description":"..."}]}. '
    + 'Produce 12 to 20 non-overlapping topics. Names and descriptions must be concise English. '
    + 'Use only the public video metadata provided.',
    { videos: candidates.map(youtubePublicMetadata) },
    client,
  );
  if (!response || typeof response !== 'object' || !Array.isArray((response as any).topics)) {
    throw new Error('AI taxonomy response must contain a topics array');
  }
  const topics = (response as any).topics as unknown[];
  const version = (existing[0]?.version ?? 0) + 1;
  const normalized = topics.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('AI taxonomy topics must be objects');
    const item = raw as Record<string, unknown>;
    const normalizedTopic = {
      version,
      slug: slug(item.slug || item.name),
      name: String(item.name ?? '').trim().slice(0, 80),
      description: String(item.description ?? '').trim().slice(0, 240),
    };
    if (!normalizedTopic.slug || !normalizedTopic.name || !normalizedTopic.description) {
      throw new Error('AI taxonomy topics require slug, name, and description');
    }
    return normalizedTopic;
  });
  const unique: Array<Omit<YoutubeTopic, 'id'>> = [
    ...new Map<string, Omit<YoutubeTopic, 'id'>>(
      normalized.map((item: Omit<YoutubeTopic, 'id'>) => [item.slug, item])
    ).values(),
  ];
  if (unique.length < 12 || unique.length > 20) throw new Error('AI taxonomy must contain 12 to 20 unique topics');
  return repository.replaceYoutubeTaxonomy(unique);
}

export async function classifyYoutubeVideos(repository: Repository, limit = 250): Promise<number> {
  return classifyYoutubeVideosWithClient(repository, limit, defaultClient());
}

export async function classifyYoutubeVideosWithClient(
  repository: Repository,
  limit: number,
  client: YoutubeAiClient,
): Promise<number> {
  if (!configured(client)) return 0;
  const topics = await ensureYoutubeTaxonomyWithClient(repository, false, client);
  if (!topics.length) return 0;
  const videos = repository.youtubeVideosForClassification(limit);
  const bySlug = new Map(topics.map((topic) => [topic.slug, topic]));
  let classified = 0;
  for (let index = 0; index < videos.length; index += 20) {
    const batch = videos.slice(index, index + 20);
    let validated: Array<{
      video: YoutubeVideoMetadata;
      selected: Array<{ topicId: number; rank: number; confidence: number }>;
    }> | null = null;
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3 && !validated; attempt++) {
      try {
        const response = await chatJson(
          'Classify each YouTube video into the supplied stable taxonomy. '
          + 'Return JSON {"videos":[{"videoId":"...","topics":[{"slug":"...","confidence":0.0}]}]}. '
          + 'Return every supplied videoId exactly once. Confidence must be a number from 0 to 1. '
          + 'Assign one primary and at most two secondary topics, ordered by relevance. '
          + 'Use only supplied public metadata and only supplied topic slugs.',
          { topics: topics.map(({ slug: topicSlug, name, description }) => ({ slug: topicSlug, name, description })), videos: batch.map(youtubePublicMetadata) },
          client,
        );
        if (!response || typeof response !== 'object' || !Array.isArray((response as any).videos)) {
          throw new Error('AI classification response must contain a videos array');
        }
        const assignments = (response as any).videos as unknown[];
        const responseById = new Map<string, Record<string, unknown>>();
        for (const raw of assignments) {
          if (!raw || typeof raw !== 'object') throw new Error('AI classification entries must be objects');
          const item = raw as Record<string, unknown>;
          const videoId = String(item.videoId ?? '');
          if (!batch.some((video) => video.videoId === videoId) || responseById.has(videoId)) {
            throw new Error('AI classification returned an unknown or duplicate videoId');
          }
          responseById.set(videoId, item);
        }
        const batchAssignments = batch.map((video) => {
          const item = responseById.get(video.videoId);
          if (!item || !Array.isArray(item.topics) || item.topics.length < 1 || item.topics.length > 3) {
            throw new Error(`AI classification requires one to three topics for ${video.videoId}`);
          }
          const seen = new Set<number>();
          const selected = item.topics.map((raw, assignmentIndex: number) => {
            if (!raw || typeof raw !== 'object') throw new Error('AI topic assignments must be objects');
            const assignment = raw as Record<string, unknown>;
            const topic = bySlug.get(slug(assignment.slug));
            const confidence = Number(assignment.confidence);
            if (!topic || seen.has(topic.id) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
              throw new Error(`AI classification returned an invalid topic for ${video.videoId}`);
            }
            seen.add(topic.id);
            return {
              topicId: topic.id,
              rank: assignmentIndex + 1,
              confidence,
            };
          });
          return { video, selected };
        });
        validated = batchAssignments;
      } catch (error) {
        lastError = error;
      }
    }
    if (!validated) throw lastError;
    for (const { video, selected } of validated) {
      repository.saveYoutubeVideoTopics(
        video.videoId, selected, client.model, PROMPT_VERSION, video.metadataHash
      );
      classified++;
    }
  }
  return classified;
}
