// Matching methods compared by the evaluation runner (#92 R17). The
// "current app" methods call the app's own pure scoring functions; nothing
// here re-implements the production formula.
import { computeClient, type Compute } from '../../src/matching-v3/compute.js';
import { compareProfiles } from '../../src/matching-v3/matching.js';
import { CONTENT_GENRES, settings as v3Settings, version as v3Version, type GenreProfile, type Profile } from '../../src/matching-v3/model.js';
import { calibratedMatchScore, MATCHING_PERCENTAGE_VERSION } from '../../src/youtube/candidates.js';
import { compareCrystals } from '../../src/youtube/crystal.js';
import { matchingCandidateSimilarity, resolveMatchingDimensions } from '../../src/youtube/dimensions.js';
import { MATCHING_TAXONOMY, MATCHING_WINDOW_DAYS } from '../../src/youtube/matching.js';
import { REGISTRY_CRYSTAL_CHANNEL_LIMIT, REGISTRY_CRYSTAL_TOPIC_LIMIT, REGISTRY_CRYSTAL_VERSION, type RegistryMatchingCrystal } from '../../src/youtube/registry-crystal.js';
import type { CorpusUser, CorpusWindow, EvaluationCorpus } from './corpus.js';

export interface MethodOptions {
  // Weight of the recent window when blending recent and prior windows.
  // 1 = the app's behaviour (only the 90-day matching window is used).
  recencyWeight: number;
  // v3 similarity floor (production default 0.7, MATCHING_V3_SIMILARITY_FLOOR).
  similarityFloor: number;
}
export const DEFAULT_METHOD_OPTIONS: MethodOptions = { recencyWeight: 1, similarityFloor: 0.7 };

export interface Method {
  id: string;
  label: string;
  family: 'baseline' | 'current-app' | 'requires-compute-service';
  version: string;
  notes: string;
  // Returns null when the method cannot compare the pair (shown as unscorable).
  prepare?(corpus: EvaluationCorpus, options: MethodOptions): Promise<void> | void;
  score?(query: CorpusUser, candidate: CorpusUser): Promise<number | null> | number | null;
}

type Weighted = { key: string; share: number };

function blend<T extends Weighted>(recent: T[], prior: T[], weight: number): Weighted[] {
  if (weight >= 1) return recent.map(({ key, share }) => ({ key, share }));
  const mass = new Map<string, number>();
  for (const item of recent) mass.set(item.key, (mass.get(item.key) ?? 0) + weight * item.share);
  for (const item of prior) mass.set(item.key, (mass.get(item.key) ?? 0) + (1 - weight) * item.share);
  return [...mass.entries()].map(([key, share]) => ({ key, share }))
    .sort((a, b) => b.share - a.share || a.key.localeCompare(b.key));
}

function blendedWindow(user: CorpusUser, weight: number): CorpusWindow {
  const { recent, prior } = user.windows;
  if (weight >= 1) return recent;
  const channelNames = new Map([...recent.channels, ...prior.channels].map((c) => [c.key, c.name]));
  const tagGenres = new Map([...recent.tags, ...prior.tags].map((t) => [t.text, t.genre]));
  const tagMass = new Map<string, number>();
  for (const tag of recent.tags) tagMass.set(tag.text, (tagMass.get(tag.text) ?? 0) + weight * tag.count);
  for (const tag of prior.tags) tagMass.set(tag.text, (tagMass.get(tag.text) ?? 0) + (1 - weight) * tag.count);
  return {
    // Eligibility stays tied to the recent window, as in the app.
    watchEvents: recent.watchEvents,
    activeDays: recent.activeDays,
    topicCoverage: weight * recent.topicCoverage + (1 - weight) * prior.topicCoverage,
    channels: blend(recent.channels, prior.channels, weight).map((c) => ({ ...c, name: channelNames.get(c.key)! })),
    topics: blend(recent.topics, prior.topics, weight) as CorpusWindow['topics'],
    // Tag counts must stay integers for the schema; scale before rounding.
    tags: [...tagMass.entries()].map(([text, mass]) => ({ text, count: Math.max(1, Math.round(mass * 10)), genre: tagGenres.get(text)! })),
  };
}

function cosine(left: Weighted[], right: Weighted[]): number | null {
  const rightByKey = new Map(right.map((item) => [item.key, item.share]));
  const dot = left.reduce((sum, item) => sum + item.share * (rightByKey.get(item.key) ?? 0), 0);
  const norm = (items: Weighted[]) => Math.sqrt(items.reduce((sum, item) => sum + item.share ** 2, 0));
  const denominator = norm(left) * norm(right);
  return denominator > 0 ? dot / denominator : null;
}

const topicName = new Map(MATCHING_TAXONOMY.topics.map((topic) => [topic.key, topic.name]));

// Exactly the projection the worker publishes to the registry (limits included).
export function registryCrystalFor(window: CorpusWindow): RegistryMatchingCrystal {
  return {
    kind: 'matching',
    version: REGISTRY_CRYSTAL_VERSION,
    taxonomyVersion: MATCHING_TAXONOMY.version,
    generatedAt: '2026-01-01T00:00:00.000Z',
    windowDays: MATCHING_WINDOW_DAYS,
    data: {
      watchEvents: window.watchEvents,
      uniqueVideos: window.watchEvents,
      estimatedWatchSeconds: window.watchEvents * 600,
      activeDays: window.activeDays,
      topicCoverage: window.topicCoverage,
    },
    topics: window.topics.slice(0, REGISTRY_CRYSTAL_TOPIC_LIMIT).map((t) => ({ key: t.key, name: topicName.get(t.key) ?? t.key, share: t.share })),
    channels: window.channels.slice(0, REGISTRY_CRYSTAL_CHANNEL_LIMIT).map(({ key, name, share }) => ({ key, name, share })),
  };
}

export class ComputeServiceRequired extends Error {
  constructor() { super('This comparison needs the Python matching-compute service (multi-cluster optimal transport)'); }
}

// Mean of the tag vectors per genre as ONE cluster with share 1. The real
// computeClient compares a 1x1 profile locally without HTTP; anything else
// would need the compute service and is refused here.
function singleClusterProfile(window: CorpusWindow, vectors: EvaluationCorpus['tagVectors'], profileVersion: string): Profile {
  const genres: Profile['genres'] = {};
  for (const genre of CONTENT_GENRES) {
    const tags = window.tags.filter((tag) => tag.genre === genre && vectors[tag.text]);
    if (!tags.length) continue;
    const dims = vectors[tags[0].text].length;
    const sum = new Array<number>(dims).fill(0);
    let mass = 0;
    for (const tag of tags) {
      vectors[tag.text].forEach((value, i) => { sum[i] += tag.count * value; });
      mass += tag.count;
    }
    const norm = Math.hypot(...sum) || 1;
    const profile: GenreProfile = {
      status: 'ready', retainedCoverage: 1, totalMass: mass, videoCount: mass,
      clusters: [{ centroid: sum.map((value) => value / norm), mass, share: 1,
        tags: tags.slice(0, 3).map((tag) => ({ text: tag.text, count: tag.count, generatedCount: 0 })) }],
    };
    genres[genre] = profile;
  }
  return { version: profileVersion, sourceFingerprint: 'synthetic', builtAt: '2026-01-01T00:00:00.000Z',
    complete: true, processedVideos: window.watchEvents, totalVideos: window.watchEvents, genres };
}

export function createMethods(): Method[] {
  let options = DEFAULT_METHOD_OPTIONS;
  let windows = new Map<string, CorpusWindow>();
  const prepareWindows = (corpus: EvaluationCorpus, next: MethodOptions) => {
    options = next;
    windows = new Map(corpus.users.map((user) => [user.id, blendedWindow(user, next.recencyWeight)]));
  };
  const w = (user: CorpusUser) => windows.get(user.id)!;

  const legacyCrystals = new Map<string, ReturnType<typeof legacyProfile>>();
  function legacyProfile(window: CorpusWindow) {
    const crystal = registryCrystalFor(window);
    return { crystal, dimensions: resolveMatchingDimensions(crystal, null) };
  }

  const v3Profiles = new Map<string, Profile>();
  let v3Compute: Compute | null = null;
  let v3VersionId = '';

  const v3: Method = {
    id: 'v3-single-cluster-local', label: 'v3 genre profiles, single cluster per genre (local path)', family: 'current-app',
    version: 'pending',
    notes: 'App code: compareProfiles() with the real computeClient, whose 1x1 comparison runs locally. '
      + 'Each genre is collapsed to one centroid of synthetic tag vectors, so this is v3 WITHOUT compact-medoid '
      + 'clustering or optimal transport; genre labels come from the corpus, not from the GPT classifier.',
    prepare: (corpus, next) => {
      prepareWindows(corpus, next);
      const s = v3Settings({ MATCHING_V3_SIMILARITY_FLOOR: String(next.similarityFloor),
        // Unroutable on purpose: a comparison that is not 1x1 must fail, never call out.
        MATCHING_V3_COMPUTE_URL: 'http://compute.invalid', MATCHING_V3_COMPARE_URL: 'http://compute.invalid' });
      v3VersionId = v3Version(s);
      const client = computeClient(s);
      v3Compute = {
        cluster: async () => { throw new ComputeServiceRequired(); },
        compare: async (left, right) => {
          if (left.clusters.length !== 1 || right.clusters.length !== 1) throw new ComputeServiceRequired();
          return client.compare(left, right);
        },
      };
      v3Profiles.clear();
      for (const user of corpus.users) v3Profiles.set(user.id, singleClusterProfile(w(user), corpus.tagVectors, v3VersionId));
      v3.version = `matching-v3 settings digest ${v3VersionId.slice(0, 12)} (similarityFloor=${next.similarityFloor}); single-cluster-local`;
    },
    score: async (q, c) => (await compareProfiles(v3Profiles.get(q.id)!, v3Profiles.get(c.id)!, [...CONTENT_GENRES], v3Compute!)).score,
  };

  return [
    {
      id: 'channel-jaccard', label: 'Channel overlap (Jaccard)', family: 'baseline', version: 'jaccard-v1',
      notes: 'Non-AI baseline: |shared channels| / |union of channels| on the recent window.',
      prepare: prepareWindows,
      score: (q, c) => {
        const a = new Set(w(q).channels.map((x) => x.key)), b = new Set(w(c).channels.map((x) => x.key));
        const union = new Set([...a, ...b]).size;
        return union ? [...a].filter((key) => b.has(key)).length / union : null;
      },
    },
    {
      id: 'tag-cosine', label: 'Tag cosine (exact strings)', family: 'baseline', version: 'tag-count-cosine-v1',
      notes: 'Non-AI baseline: cosine of tag-count vectors, exact normalized tag text only (no embeddings).',
      prepare: prepareWindows,
      score: (q, c) => cosine(
        w(q).tags.map((t) => ({ key: t.text, share: t.count })),
        w(c).tags.map((t) => ({ key: t.text, share: t.count }))),
    },
    {
      id: 'legacy-calibrated', label: 'Current /matches directory (calibrated-v2)', family: 'current-app',
      version: `${MATCHING_PERCENTAGE_VERSION}+registry-crystal-v${REGISTRY_CRYSTAL_VERSION}+taxonomy-v${MATCHING_TAXONOMY.version}`,
      notes: 'App code: matchingCandidateSimilarity() + calibratedMatchScore() over the registry crystal projection, '
        + 'with default (unconfirmed) dimensions. Pairs the app would not score (activity below eligibility) are unscorable.',
      prepare: (corpus, next) => {
        prepareWindows(corpus, next);
        legacyCrystals.clear();
        for (const user of corpus.users) legacyCrystals.set(user.id, legacyProfile(w(user)));
      },
      score: (q, c) => {
        const similarity = matchingCandidateSimilarity(legacyCrystals.get(q.id)!, legacyCrystals.get(c.id)!);
        return similarity.mode === 'none' ? null : calibratedMatchScore(similarity.topicSimilarity, similarity.channelSimilarity);
      },
    },
    {
      id: 'legacy-compare-raw', label: 'Compare page raw cosines (compareCrystals)', family: 'current-app',
      version: `compareCrystals+taxonomy-v${MATCHING_TAXONOMY.version}`,
      notes: 'App code: compareCrystals() channel and topic cosines averaged without calibration (calibration ablation).',
      prepare: prepareWindows,
      score: (q, c) => {
        const crystal = (user: CorpusUser) => {
          const r = registryCrystalFor(w(user));
          return { handle: user.id, displayName: user.id, matching: {
            taxonomyVersion: r.taxonomyVersion, windowDays: r.windowDays, ...r.data,
            channels: r.channels.map((x) => ({ ...x, watches: 0, estimatedWatchSeconds: 0 })),
            topics: r.topics.map((x) => ({ ...x, watches: 0, estimatedWatchSeconds: 0 })),
          } };
        };
        const result = compareCrystals(crystal(q), crystal(c));
        const parts = [result.channelSimilarity, result.topicSimilarity].filter((x): x is number => x !== null);
        return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
      },
    },
    v3,
    {
      id: 'v3-compact-medoid-ot', label: 'v3 production (compact-medoid clusters + optimal transport)', family: 'requires-compute-service',
      version: 'compact-medoid-v1',
      notes: 'Skipped: requires the Python matching-compute service (services/matching-compute) and real tag embeddings. '
        + 'Not run by this runner; no number is reported for it.',
    },
  ];
}
