import { createHash } from 'node:crypto';
import {
  CONTENT_KEYS,
  POLITICAL_KEYS,
  type TagGroupKey,
  type TagLeanData,
  type TagLeanGroup,
} from './taglists.js';

export const REFERENCE_POPULATION_MIN_SAMPLE = 5;
export const REFERENCE_POPULATION_METHOD_VERSION = 'channel-tags-equal-user-v1';
export const REFERENCE_POPULATION_POLICY_URL =
  'https://github.com/skyhong2002/urtube.observe.tw/blob/main/docs/reference-population.md';

export interface ReferenceContribution {
  subjectId: number;
  dataUpdatedAt: string;
  data: TagLeanData;
}

export interface ReferenceMetric {
  key: TagGroupKey;
  viewerPct: number;
  meanPct: number;
  medianPct: number;
  lift: number | null;
  percentile: number;
}

export type ReferenceAxis = {
  status: 'insufficient';
  sampleSize: number;
} | {
  status: 'viewer-unavailable';
  sampleSize: number;
} | {
  status: 'ready';
  sampleSize: number;
  metrics: ReferenceMetric[];
};

export interface ReferencePopulation {
  methodVersion: string;
  version: string;
  generatedAt: string;
  dataUpdatedAt: string | null;
  minimumSampleSize: number;
  range: TagLeanData['range'];
  policyVersion: string;
  membershipVersion: string;
  content: ReferenceAxis;
  political: ReferenceAxis;
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function groupShare(groups: TagLeanGroup[], key: TagGroupKey, denominator: number): number {
  if (denominator <= 0) return 0;
  return (groups.find((group) => group.key === key)?.estimatedWatchSeconds ?? 0) / denominator;
}

function politicalSeconds(data: TagLeanData): number {
  return data.political.reduce((sum, group) => sum + group.estimatedWatchSeconds, 0);
}

function axis(
  viewer: TagLeanData,
  contributions: ReferenceContribution[],
  keys: readonly TagGroupKey[],
  groups: (data: TagLeanData) => TagLeanGroup[],
  denominator: (data: TagLeanData) => number,
): ReferenceAxis {
  const comparable = contributions.filter((contribution) => denominator(contribution.data) > 0);
  if (comparable.length < REFERENCE_POPULATION_MIN_SAMPLE) {
    return { status: 'insufficient', sampleSize: comparable.length };
  }
  const viewerDenominator = denominator(viewer);
  if (viewerDenominator <= 0) {
    return { status: 'viewer-unavailable', sampleSize: comparable.length };
  }
  return {
    status: 'ready',
    sampleSize: comparable.length,
    metrics: keys.map((key) => {
      const rawViewer = groupShare(groups(viewer), key, viewerDenominator);
      const values = comparable.map((contribution) =>
        groupShare(groups(contribution.data), key, denominator(contribution.data)));
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const equal = values.filter((value) => value === rawViewer).length;
      const below = values.filter((value) => value < rawViewer).length;
      return {
        key,
        viewerPct: oneDecimal(rawViewer * 100),
        meanPct: oneDecimal(mean * 100),
        medianPct: oneDecimal(median(values) * 100),
        lift: mean > 0 ? oneDecimal(rawViewer / mean) : null,
        percentile: Math.round((below + equal / 2) / values.length * 20) * 5,
      };
    }),
  };
}

function populationVersion(
  viewer: TagLeanData,
  contributions: ReferenceContribution[],
): string {
  const rows = [...contributions].sort((left, right) => left.subjectId - right.subjectId)
    .map((contribution) => [
      contribution.subjectId,
      contribution.dataUpdatedAt,
      contribution.data.totals.estimatedWatchSeconds,
      ...contribution.data.content.map((group) => group.estimatedWatchSeconds),
      ...contribution.data.political.map((group) => group.estimatedWatchSeconds),
    ].join(':'));
  const input = [
    REFERENCE_POPULATION_METHOD_VERSION,
    viewer.range,
    viewer.provenance.policyVersion,
    viewer.provenance.membershipVersion,
    ...rows,
  ].join('\n');
  return `sha256:${createHash('sha256').update(input).digest('hex').slice(0, 12)}`;
}

export function referencePopulation(
  viewer: TagLeanData,
  contributions: ReferenceContribution[],
  now = new Date(),
): ReferencePopulation {
  for (const contribution of contributions) {
    if (contribution.data.range !== viewer.range
      || contribution.data.provenance.policyVersion !== viewer.provenance.policyVersion
      || contribution.data.provenance.membershipVersion !== viewer.provenance.membershipVersion) {
      throw new Error('Reference contribution is not comparable with the viewer');
    }
  }
  const dataUpdatedAt = contributions.map((contribution) => contribution.dataUpdatedAt)
    .sort()
    .at(-1) ?? null;
  return {
    methodVersion: REFERENCE_POPULATION_METHOD_VERSION,
    version: populationVersion(viewer, contributions),
    generatedAt: now.toISOString(),
    dataUpdatedAt,
    minimumSampleSize: REFERENCE_POPULATION_MIN_SAMPLE,
    range: viewer.range,
    policyVersion: viewer.provenance.policyVersion,
    membershipVersion: viewer.provenance.membershipVersion,
    content: axis(
      viewer,
      contributions,
      CONTENT_KEYS,
      (data) => data.content,
      (data) => data.totals.estimatedWatchSeconds,
    ),
    political: axis(
      viewer,
      contributions,
      POLITICAL_KEYS,
      (data) => data.political,
      politicalSeconds,
    ),
  };
}
