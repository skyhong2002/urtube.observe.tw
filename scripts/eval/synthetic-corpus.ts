// Seeded synthetic corpus with planted ground truth (#92 R17).
//
// Everything here is invented: community names, channels, tags, vectors and
// relevance. The generator's design choices (which signals separate the
// communities, how much noise each signal carries) decide which method can
// win. A result on this corpus verifies the runner end to end; it is NOT
// evidence that any method is useful to real people.
import { CONTENT_GENRES } from '../../src/matching-v3/model.js';
import { CORPUS_SCHEMA, CORPUS_SCHEMA_VERSION, parseCorpus, type CorpusUser, type CorpusWindow, type EvaluationCorpus } from './corpus.js';
import { seededRandom } from './metrics.js';

export const SYNTHETIC_GENERATOR = 'urtube-synthetic-communities' as const;
export const SYNTHETIC_GENERATOR_VERSION = '1.0.0' as const;
type ContentGenre = typeof CONTENT_GENRES[number];

export interface SyntheticParams {
  usersPerCommunity: number;
  dimensions: number;
  // Fraction of users whose prior window belongs to a different community.
  driftRate: number;
  // Fraction of users with a secondary community in their recent window.
  secondaryRate: number;
  // Fraction of users below the app's activity eligibility threshold.
  sparseRate: number;
  // Probability a tag's observed genre label is wrong (simulated classifier noise).
  genreNoise: number;
  // Share of recent watch time spent on globally popular channels.
  popularShare: [number, number];
}

export const DEFAULT_SYNTHETIC_PARAMS: SyntheticParams = {
  usersPerCommunity: 9,
  dimensions: 24,
  driftRate: 0.2,
  secondaryRate: 0.3,
  sparseRate: 0.1,
  genreNoise: 0.15,
  popularShare: [0.2, 0.45],
};

interface Community {
  key: string;
  // Communities with the same parent share a broad topic but differ in detail.
  parent: string;
  topics: Array<[string, number]>;
  topicCoverage: [number, number];
  genres: ContentGenre[];
  stems: string[];
}

// Pairs of sibling communities (same broad topic) make the legacy 14-topic
// profile ambiguous on purpose; the news community is mostly outside the
// legacy taxonomy (News & Politics is deliberately excluded there).
const COMMUNITIES: Community[] = [
  { key: 'jazz', parent: 'music', topics: [['music', 0.7], ['learning', 0.3]], topicCoverage: [0.85, 1], genres: ['Music', 'Education'],
    stems: ['jazz piano', 'bebop', 'swing drums', 'jazz harmony', 'big band', 'scat', 'modal jazz', 'upright bass'] },
  { key: 'metal', parent: 'music', topics: [['music', 0.8], ['entertainment', 0.2]], topicCoverage: [0.85, 1], genres: ['Music', 'Streaming'],
    stems: ['metal riffs', 'blast beats', 'guitar distortion', 'doom metal', 'breakdowns', 'metal vocals', 'seven string', 'thrash'] },
  { key: 'speedrun', parent: 'gaming', topics: [['gaming', 0.85], ['comedy', 0.15]], topicCoverage: [0.85, 1], genres: ['Video gaming', 'Streaming'],
    stems: ['speedrun', 'any percent', 'glitch skip', 'frame perfect', 'world record', 'route planning', 'tas', 'sequence break'] },
  { key: 'strategy', parent: 'gaming', topics: [['gaming', 0.7], ['learning', 0.3]], topicCoverage: [0.85, 1], genres: ['Video gaming', 'Education'],
    stems: ['grand strategy', 'build order', 'economy macro', 'turn based', '4x', 'army composition', 'map control', 'opening theory'] },
  { key: 'football', parent: 'sport', topics: [['sports-fitness', 0.8], ['entertainment', 0.2]], topicCoverage: [0.85, 1], genres: ['Sport', 'Podcast'],
    stems: ['match highlights', 'tactics board', 'transfer window', 'pressing', 'goalkeeping', 'set pieces', 'derby', 'formation'] },
  { key: 'devtools', parent: 'tech', topics: [['science-technology', 0.6], ['learning', 0.4]], topicCoverage: [0.85, 1], genres: ['Education', 'Podcast'],
    stems: ['typescript', 'compilers', 'sqlite', 'linux kernel', 'type systems', 'profiling', 'rust', 'distributed systems'] },
  { key: 'civics', parent: 'news', topics: [['learning', 0.4]], topicCoverage: [0.35, 0.6], genres: ['News', 'Politic'],
    stems: ['election analysis', 'policy explainer', 'parliament', 'budget debate', 'local news', 'fact check', 'interview', 'polling'] },
  { key: 'cooking', parent: 'home', topics: [['diy-style', 0.5], ['lifestyle-vlogs', 0.5]], topicCoverage: [0.85, 1], genres: ['Education', 'Streaming'],
    stems: ['knife skills', 'fermentation', 'sourdough', 'wok', 'meal prep', 'braising', 'pastry', 'stock'] },
];
const MODIFIERS = ['basics', 'live', 'analysis', 'tutorial', 'highlights', 'review'];
const POPULAR_CHANNELS = Array.from({ length: 6 }, (_, i) => `popular-${i + 1}`);
const CHANNELS_PER_COMMUNITY = 25;

const round = (value: number, digits = 4) => Number(value.toFixed(digits));

export function generateSyntheticCorpus(seed = 20261022, overrides: Partial<SyntheticParams> = {}): EvaluationCorpus {
  const params = { ...DEFAULT_SYNTHETIC_PARAMS, ...overrides };
  const random = seededRandom(seed);
  const gaussian = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const unit = (vector: number[]) => {
    const norm = Math.hypot(...vector) || 1;
    return vector.map((value) => value / norm);
  };
  const randomVector = () => unit(Array.from({ length: params.dimensions }, gaussian));
  const add = (left: number[], right: number[], weight: number) => left.map((value, i) => value + weight * right[i]);
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)];
  const between = ([low, high]: [number, number]) => low + random() * (high - low);
  const zipf = (n: number) => Array.from({ length: n }, (_, i) => 1 / (i + 1));
  const shuffled = <T>(items: readonly T[]) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  // Sibling communities share a parent direction, so their tags look alike.
  const parents = new Map<string, number[]>();
  const centroid = new Map<string, number[]>();
  for (const community of COMMUNITIES) {
    if (!parents.has(community.parent)) parents.set(community.parent, randomVector());
    centroid.set(community.key, unit(add(parents.get(community.parent)!, randomVector(), 0.9)));
  }
  const tagVectors: Record<string, number[]> = {};
  const tagGenre = new Map<string, ContentGenre>();
  const tagPool = new Map<string, string[]>();
  for (const community of COMMUNITIES) {
    const pool: string[] = [];
    for (const stem of community.stems) {
      const stemVector = unit(add(centroid.get(community.key)!, randomVector(), 0.35));
      const stemGenre = pick(community.genres);
      for (const modifier of MODIFIERS) {
        const text = `${stem} ${modifier}`;
        tagVectors[text] = unit(add(stemVector, randomVector(), 0.1)).map((value) => round(value));
        tagGenre.set(text, stemGenre);
        pool.push(text);
      }
    }
    tagPool.set(community.key, pool);
  }

  function windowFor(primary: Community, secondary: Community | null, sparse: boolean): CorpusWindow {
    const mix: Array<[Community, number]> = secondary ? [[primary, 0.7], [secondary, 0.3]] : [[primary, 1]];
    // Channels: popular channels everyone watches + a Zipf sample of community channels.
    const popularTotal = between(params.popularShare);
    const popular = shuffled(POPULAR_CHANNELS).slice(0, 2 + Math.floor(random() * 3));
    const channelMass = new Map<string, number>();
    const popularWeights = zipf(popular.length);
    const popularSum = popularWeights.reduce((a, b) => a + b, 0);
    popular.forEach((key, i) => channelMass.set(key, popularTotal * popularWeights[i] / popularSum));
    for (const [community, weight] of mix) {
      const chosen = shuffled(Array.from({ length: CHANNELS_PER_COMMUNITY }, (_, i) => `${community.key}-ch-${i + 1}`))
        .slice(0, 6 + Math.floor(random() * 8));
      const weights = zipf(chosen.length);
      const sum = weights.reduce((a, b) => a + b, 0);
      chosen.forEach((key, i) => channelMass.set(key, (channelMass.get(key) ?? 0) + (1 - popularTotal) * weight * weights[i] / sum));
    }
    const channels = [...channelMass.entries()]
      .map(([key, value]) => ({ key, name: `Synthetic ${key}`, share: round(value) }))
      .sort((a, b) => b.share - a.share || a.key.localeCompare(b.key));
    // Legacy topics: shares of total watch time; unclassified time lowers coverage.
    const coverage = round(between(primary.topicCoverage));
    const topicMass = new Map<string, number>();
    for (const [community, weight] of mix) {
      for (const [key, value] of community.topics) {
        topicMass.set(key, (topicMass.get(key) ?? 0) + weight * value * (0.8 + 0.4 * random()));
      }
    }
    const topicSum = [...topicMass.values()].reduce((a, b) => a + b, 0);
    const topics = [...topicMass.entries()]
      .map(([key, value]) => ({ key, share: round(coverage * value / topicSum) }))
      .sort((a, b) => b.share - a.share || a.key.localeCompare(b.key));
    // Tags: each person sees only part of their community's vocabulary, so
    // exact tag overlap is partial even within a community.
    const tagCounts = new Map<string, number>();
    const draws = sparse ? 25 : 80 + Math.floor(random() * 80);
    for (let i = 0; i < draws; i++) {
      const community = random() < (mix[1]?.[1] ?? 0) ? mix[1][0] : mix[0][0];
      const pool = tagPool.get(community.key)!;
      const text = pool[Math.floor(pool.length * random() ** 1.6)];
      tagCounts.set(text, (tagCounts.get(text) ?? 0) + 1);
    }
    const tags = [...tagCounts.entries()].map(([text, count]) => {
      const truth = tagGenre.get(text)!;
      const genre = random() < params.genreNoise ? pick(CONTENT_GENRES.filter((g) => g !== truth)) : truth;
      return { text, count, genre };
    }).sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
    return {
      watchEvents: sparse ? 60 + Math.floor(random() * 90) : 220 + Math.floor(random() * 500),
      activeDays: sparse ? 4 + Math.floor(random() * 8) : 15 + Math.floor(random() * 60),
      topicCoverage: coverage,
      channels,
      topics,
      tags,
    };
  }

  const users: CorpusUser[] = [];
  const primaryOf = new Map<string, Community>();
  const secondaryOf = new Map<string, Community | null>();
  for (const community of COMMUNITIES) {
    for (let i = 0; i < params.usersPerCommunity; i++) {
      const id = `${community.key}-${String(i + 1).padStart(2, '0')}`;
      const others = COMMUNITIES.filter((other) => other.key !== community.key);
      const secondary = random() < params.secondaryRate ? pick(others) : null;
      const drifted = random() < params.driftRate;
      const sparse = random() < params.sparseRate;
      const priorPrimary = drifted ? pick(others) : community;
      primaryOf.set(id, community);
      secondaryOf.set(id, secondary);
      const genres = [...new Set([...community.genres, ...(secondary?.genres ?? [])])].sort();
      users.push({
        id,
        windows: { recent: windowFor(community, secondary, sparse), prior: windowFor(priorPrimary, null, false) },
        genres,
        annotations: { community: community.key, secondary: secondary?.key ?? null, priorCommunity: priorPrimary.key, drifted, sparse },
      });
    }
  }
  // Planted relevance from the CURRENT (recent) interests only:
  // 2 = same primary community; 1 = one person's secondary is the other's primary.
  const grade = (query: string, candidate: string) => {
    const qp = primaryOf.get(query)!, cp = primaryOf.get(candidate)!;
    if (qp.key === cp.key) return 2;
    if (secondaryOf.get(query)?.key === cp.key || secondaryOf.get(candidate)?.key === qp.key) return 1;
    return 0;
  };
  const queries = users.map((query) => ({
    queryUserId: query.id,
    judgments: users.filter((candidate) => candidate.id !== query.id)
      .map((candidate) => ({ candidateUserId: candidate.id, grade: grade(query.id, candidate.id), raterId: 'planted' })),
  }));
  return parseCorpus({
    schema: CORPUS_SCHEMA,
    schemaVersion: CORPUS_SCHEMA_VERSION,
    corpusId: 'synthetic-communities',
    corpusVersion: `synthetic-v1+seed.${seed}`,
    kind: 'synthetic',
    relevanceSource: 'planted',
    relevanceVerified: false,
    generator: { name: SYNTHETIC_GENERATOR, version: SYNTHETIC_GENERATOR_VERSION, seed, params: { ...params } },
    tagVectors,
    users,
    queries,
  });
}
