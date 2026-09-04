import type { CrystalItem, YoutubeCrystal } from './crystal.js';
import { MATCHING_TOPIC_MIN_COVERAGE, matchingDataEligible } from './matching.js';

// v2 changes pool eligibility from "non-empty" to the #9 activity policy.
// Older rows stay stored but cannot enter a current-version candidate query.
export const REGISTRY_CRYSTAL_VERSION = 2;

export interface RegistryMatchingCrystal {
  kind: 'matching';
  version: typeof REGISTRY_CRYSTAL_VERSION;
  taxonomyVersion: number;
  generatedAt: string;
  windowDays: number;
  data: {
    watchEvents: number;
    uniqueVideos: number;
    estimatedWatchSeconds: number;
    activeDays: number;
    topicCoverage: number;
  };
  topics: Array<Pick<CrystalItem, 'key' | 'name' | 'share'>>;
  channels: Array<Pick<CrystalItem, 'key' | 'name' | 'share'>>;
}

function projectedItems(items: CrystalItem[], limit: number): RegistryMatchingCrystal['topics'] {
  return items.slice(0, limit).map(({ key, name, share }) => ({ key, name, share }));
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

export function registryMatchingCrystal(crystal: YoutubeCrystal): RegistryMatchingCrystal {
  return {
    kind: 'matching',
    version: REGISTRY_CRYSTAL_VERSION,
    taxonomyVersion: crystal.matching.taxonomyVersion,
    generatedAt: crystal.generatedAt,
    windowDays: crystal.matching.windowDays,
    data: {
      watchEvents: crystal.matching.watchEvents,
      uniqueVideos: crystal.matching.uniqueVideos,
      estimatedWatchSeconds: crystal.matching.estimatedWatchSeconds,
      activeDays: crystal.matching.activeDays,
      topicCoverage: crystal.matching.topicCoverage,
    },
    topics: projectedItems(crystal.matching.topics, 20),
    channels: projectedItems(crystal.matching.channels, 40),
  };
}

export function registryCrystalEligible(crystal: RegistryMatchingCrystal): boolean {
  return matchingDataEligible(crystal.data)
    && (crystal.channels.length > 0
      || (crystal.data.topicCoverage >= MATCHING_TOPIC_MIN_COVERAGE && crystal.topics.length > 0));
}

function validItem(value: unknown): value is RegistryMatchingCrystal['topics'][number] {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return hasOnlyKeys(item, ['key', 'name', 'share'])
    && typeof item.key === 'string' && item.key.length > 0 && item.key.length <= 160
    && typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 160
    && typeof item.share === 'number' && Number.isFinite(item.share)
    && item.share >= 0 && item.share <= 1;
}

export function parseRegistryMatchingCrystal(value: string): RegistryMatchingCrystal | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const data = parsed.data as Record<string, unknown> | null;
    const count = (key: string) => typeof data?.[key] === 'number'
      && Number.isInteger(data[key]) && (data[key] as number) >= 0;
    const coverage = data?.topicCoverage;
    if (
      parsed.kind !== 'matching'
      || !hasOnlyKeys(parsed, [
        'kind', 'version', 'taxonomyVersion', 'generatedAt', 'windowDays',
        'data', 'topics', 'channels',
      ])
      || parsed.version !== REGISTRY_CRYSTAL_VERSION
      || typeof parsed.taxonomyVersion !== 'number'
      || !Number.isInteger(parsed.taxonomyVersion)
      || parsed.taxonomyVersion < 1
      || typeof parsed.generatedAt !== 'string'
      || !Number.isFinite(Date.parse(parsed.generatedAt))
      || typeof parsed.windowDays !== 'number'
      || !Number.isInteger(parsed.windowDays)
      || parsed.windowDays < 1
      || parsed.windowDays > 3660
      || !data
      || !hasOnlyKeys(data, [
        'watchEvents', 'uniqueVideos', 'estimatedWatchSeconds', 'activeDays', 'topicCoverage',
      ])
      || !['watchEvents', 'uniqueVideos', 'estimatedWatchSeconds', 'activeDays'].every(count)
      || typeof coverage !== 'number'
      || !Number.isFinite(coverage)
      || coverage < 0
      || coverage > 1
      || !Array.isArray(parsed.topics)
      || parsed.topics.length > 20
      || !parsed.topics.every(validItem)
      || !Array.isArray(parsed.channels)
      || parsed.channels.length > 40
      || !parsed.channels.every(validItem)
    ) return null;
    return parsed as unknown as RegistryMatchingCrystal;
  } catch {
    return null;
  }
}
