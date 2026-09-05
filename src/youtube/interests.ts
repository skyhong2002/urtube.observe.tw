import { createHash } from 'node:crypto';
import type { Repository } from '../data/database.js';
import type { UserRegistry } from '../users.js';
import { defaultEmbeddingClient, embeddingContract, embeddingsConfigured, EMBEDDING_POLICY } from './embeddings.js';
import { MATCHING_TAXONOMY, MATCHING_WINDOW_DAYS } from './matching.js';
import { normalizeSemanticLabel, semanticTagContract, type SemanticTag, type SemanticTagResult } from './semantic-tags.js';

export const INTEREST_POLICY = {
  algorithmVersion: 1, epsilon: 0.2, minSupport: 3, maxGroups: 5,
  maxVideos: 2000, maxLabelsPerCategory: 256, representatives: 3,
  windowDays: MATCHING_WINDOW_DAYS, dimensions: EMBEDDING_POLICY.dimensions,
} as const;

export interface InterestVideo {
  videoId: string;
  watchedAt: string;
  metadataHash: string | null;
  status: SemanticTagResult['status'] | 'pending';
  tags: SemanticTag[];
}

export interface InterestGroup {
  categoryKey: string;
  centroid: number[];
  mass: number;
  representativeTags: string[];
  supportingVideoIds: string[];
  modelContract: string;
  algorithmVersion: number;
}

export interface InterestSnapshot {
  inputHash: string;
  modelContract: string;
  tagsContract: string;
  algorithmVersion: number;
  generatedAt: string;
  validUntil: string | null;
  status: 'ready' | 'partial' | 'processing' | 'unavailable' | 'error';
  groups: InterestGroup[];
  coverage: {
    windowVideos: number;
    consideredVideos: number;
    processedVideos: number;
    unavailableVideos: number;
    unidentifiedEvents: number;
    categories: CategoryCoverage[];
  };
}

interface Sample {
  key: string;
  label: string;
  weight: number;
  videoIds: string[];
}
interface CategoryCoverage {
  categoryKey: string;
  totalLabels: number;
  usedLabels: number;
  totalMass: number;
  usedMass: number;
}
export interface WeightedInterestPoint extends Sample { vector: number[] }
const byKey = (a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key, 'en');
const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);

function unitVector(vector: number[]): number[] {
  if (vector.length !== INTEREST_POLICY.dimensions || vector.some(value => !Number.isFinite(value))) {
    throw new Error('Interest vector has invalid dimensions or values');
  }
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm <= 1e-12) throw new Error('Interest vector has zero or invalid norm');
  return vector.map(value => value / norm);
}

// Standard core expansion: border points join one component but never bridge two cores.
export function weightedDbscan(input: WeightedInterestPoint[]): WeightedInterestPoint[][] {
  if (input.length > INTEREST_POLICY.maxLabelsPerCategory) throw new Error('Interest category exceeds point limit');
  const points = input.map(point => ({ ...point, vector: unitVector(point.vector) })).sort(byKey);
  if (new Set(points.map(point => point.key)).size !== points.length
    || points.some(point => !Number.isFinite(point.weight) || point.weight <= 0)) throw new Error('Invalid weighted interest samples');
  // ponytail: O(n² × 1024) per category, hard-capped at 256 points; use a radius index only if this bound grows.
  const neighbors = points.map((_point, index) => [index]);
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    if (1 - dot(points[i].vector, points[j].vector) <= INTEREST_POLICY.epsilon + 1e-12) {
      neighbors[i].push(j); neighbors[j].push(i);
    }
  }
  const core = neighbors.map(indices => indices.reduce((sum, index) => sum + points[index].weight, 0) >= INTEREST_POLICY.minSupport - 1e-9);
  const assigned = new Set<number>();
  const clusters: WeightedInterestPoint[][] = [];
  for (let seed = 0; seed < points.length; seed++) {
    if (!core[seed] || assigned.has(seed)) continue;
    const members: number[] = [seed];
    assigned.add(seed);
    for (let cursor = 0; cursor < members.length; cursor++) {
      const current = members[cursor];
      if (!core[current]) continue;
      for (const neighbor of neighbors[current]) {
        if (assigned.has(neighbor)) continue;
        assigned.add(neighbor); members.push(neighbor);
      }
    }
    clusters.push(members.map(index => points[index]).sort(byKey));
  }
  return clusters;
}

export function interestSamples(videos: InterestVideo[]): Map<string, Sample[]> {
  if (videos.length > INTEREST_POLICY.maxVideos) throw new Error('Interest video input exceeds limit');
  const categories = new Map<string, Map<string, { label: string; videos: Map<string, number> }>>();
  const allowed = new Set(MATCHING_TAXONOMY.topics.map(topic => topic.key));
  const seenVideos = new Set<string>();
  for (const video of [...videos].sort((a, b) => b.watchedAt.localeCompare(a.watchedAt) || a.videoId.localeCompare(b.videoId))) {
    if (seenVideos.has(video.videoId)) continue;
    seenVideos.add(video.videoId);
    if (video.status !== 'ready') continue;
    if (video.tags.length > 15) throw new Error('Interest video exceeds tag limit');
    const perCategory = new Map<string, Map<string, string>>();
    for (const tag of video.tags) {
      if (!allowed.has(tag.categoryKey)) throw new Error('Unknown interest category');
      const key = normalizeSemanticLabel(tag.label);
      if (tag.confidence < 0.7 || !key) continue;
      const labels = perCategory.get(tag.categoryKey) ?? new Map<string, string>();
      labels.set(key, [labels.get(key) ?? tag.label, tag.label].sort()[0]);
      perCategory.set(tag.categoryKey, labels);
    }
    for (const [category, labels] of perCategory) {
      const samples = categories.get(category) ?? new Map();
      for (const [key, label] of labels) {
        const sample = samples.get(key) ?? { label, videos: new Map<string, number>() };
        sample.label = [sample.label, label].sort()[0];
        sample.videos.set(video.videoId, 1 / labels.size);
        samples.set(key, sample);
      }
      categories.set(category, samples);
    }
  }
  return new Map([...categories].sort(([a], [b]) => a.localeCompare(b)).map(([category, samples]) => [category,
    [...samples].map(([key, sample]) => ({ key, label: sample.label,
      weight: [...sample.videos.values()].reduce((sum, weight) => sum + weight, 0), videoIds: [...sample.videos.keys()].sort() }))
      .sort((a, b) => b.weight - a.weight || byKey(a, b)),
  ]));
}

export function clusterInterestCategory(categoryKey: string, points: WeightedInterestPoint[], modelContract: string): InterestGroup[] {
  return weightedDbscan(points).flatMap(members => {
    const supportingVideoIds = [...new Set(members.flatMap(point => point.videoIds))].sort();
    if (supportingVideoIds.length < INTEREST_POLICY.minSupport) return [];
    const centroid = new Array<number>(INTEREST_POLICY.dimensions).fill(0);
    for (const point of members) point.vector.forEach((value, index) => { centroid[index] += value * point.weight; });
    if (Math.hypot(...centroid) <= 1e-12) return [];
    const normalized = unitVector(centroid);
    const representatives = [...members].sort((a, b) => dot(b.vector, normalized) - dot(a.vector, normalized) || byKey(a, b));
    return [{ categoryKey, centroid: normalized, mass: members.reduce((sum, point) => sum + point.weight, 0),
      representativeTags: representatives.slice(0, INTEREST_POLICY.representatives).map(point => point.label),
      supportingVideoIds, modelContract, algorithmVersion: INTEREST_POLICY.algorithmVersion }];
  }).sort((a, b) => b.mass - a.mass || JSON.stringify(a.representativeTags).localeCompare(JSON.stringify(b.representativeTags), 'en'))
    .slice(0, INTEREST_POLICY.maxGroups);
}

function interestInput(registry: UserRegistry, repository: Repository, client: ReturnType<typeof defaultEmbeddingClient>, tagsContract: string, now: Date) {
  const modelContract = embeddingContract(client);
  const window = repository.youtubeInterestWindow(tagsContract,
    new Date(now.getTime() - INTEREST_POLICY.windowDays * 86400_000).toISOString(), now.toISOString(), INTEREST_POLICY.maxVideos);
  const samples = interestSamples(window.videos);
  const selected = new Map([...samples].map(([key, points]) => [key, points.slice(0, INTEREST_POLICY.maxLabelsPerCategory)]));
  const labels = [...new Set([...selected.values()].flatMap(points => points.map(point => point.key)))].sort();
  const states = registry.embeddingCacheStates(modelContract, labels);
  const configured = embeddingsConfigured(client);
  const inputHash = createHash('sha256').update(JSON.stringify({ policy: INTEREST_POLICY, modelContract, tagsContract, configured,
    window, vectors: labels.map(label => [label, states.get(label)?.status ?? 'missing']) })).digest('hex');
  return { modelContract, window, samples, selected, states, configured, inputHash };
}

export function currentInterests(registry: UserRegistry, repository: Repository, client = defaultEmbeddingClient(), tagsContract = semanticTagContract(), now = new Date()): InterestSnapshot | null {
  const stored = repository.youtubeInterests();
  return stored && stored.inputHash === interestInput(registry, repository, client, tagsContract, now).inputHash ? stored : null;
}

export function buildSemanticInterests(registry: UserRegistry, repository: Repository, client = defaultEmbeddingClient(), tagsContract = semanticTagContract(), now = new Date()): number {
  const input = interestInput(registry, repository, client, tagsContract, now);
  if (repository.youtubeInterests()?.inputHash === input.inputHash) return 0;
  const { modelContract, window, samples, selected, states } = input;
  const groups: InterestGroup[] = [];
  const categories: CategoryCoverage[] = [];
  for (const [categoryKey, chosen] of selected) {
    const points = chosen.flatMap(point => {
      const vector = registry.embeddingVector(modelContract, point.key);
      return vector ? [{ ...point, vector }] : [];
    });
    groups.push(...clusterInterestCategory(categoryKey, points, modelContract));
    const all = samples.get(categoryKey)!;
    categories.push({ categoryKey, totalLabels: all.length, usedLabels: points.length,
      totalMass: all.reduce((sum, point) => sum + point.weight, 0), usedMass: points.reduce((sum, point) => sum + point.weight, 0) });
  }
  const errors = window.videos.some(video => video.status === 'error') || [...states.values()].some(state => state.status === 'error');
  const pending = window.videos.some(video => video.status === 'pending')
    || [...selected.values()].some(points => points.some(point => states.get(point.key)?.status !== 'ready'));
  const partial = window.total > window.videos.length || categories.some(category => category.usedLabels < category.totalLabels);
  repository.saveYoutubeInterests({ inputHash: input.inputHash, modelContract, tagsContract,
    algorithmVersion: INTEREST_POLICY.algorithmVersion, generatedAt: now.toISOString(),
    validUntil: window.firstExpiryWatch ? new Date(Date.parse(window.firstExpiryWatch) + INTEREST_POLICY.windowDays * 86400_000).toISOString() : null,
    status: !input.configured ? 'unavailable' : errors ? 'error' : pending ? 'processing' : partial ? 'partial' : 'ready',
    groups, coverage: { windowVideos: window.total, consideredVideos: window.videos.length,
      processedVideos: window.videos.filter(video => !['pending', 'error'].includes(video.status)).length,
      unavailableVideos: window.videos.filter(video => video.status === 'unavailable').length,
      unidentifiedEvents: window.unidentifiedEvents, categories } });
  return 1;
}
