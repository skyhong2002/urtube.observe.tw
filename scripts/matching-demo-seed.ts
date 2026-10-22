import { createHash } from 'node:crypto';
import type { UserRegistry, User } from '../src/users.js';
import { MATCHING_TAXONOMY } from '../src/youtube/matching.js';
import {
  REGISTRY_CRYSTAL_VERSION,
  type RegistryMatchingCrystal,
} from '../src/youtube/registry-crystal.js';
import type { YoutubeParsedArchive } from '../src/youtube/types.js';
import type { Compute } from '../src/matching-v3/compute.js';
import { CHANNEL_TYPES, CONTENT_GENRES, classificationInput, settings, type Classification, type Cluster, type Settings, type TagPoint, type VideoInput } from '../src/matching-v3/model.js';
import { runCycle } from '../src/matching-v3/pipeline.js';
import type { Provider } from '../src/matching-v3/provider.js';

// Credential-free synthetic data for `npm run demo:matching`. No real account,
// video history or API key is used: v3 profiles are built by the real worker
// pipeline with a deterministic stand-in provider and an in-process stand-in
// for the Python compute service.

export const demoMatchingV3Settings = (): Settings => settings({
  MATCHING_V3_ENABLED: 'true',
  MATCHING_V3_CLASSIFICATION_CACHE_NAMESPACE: 'synthetic-local-demo',
  MATCHING_V3_DIMENSIONS: '128',
  // The synthetic libraries are small; production keeps its own minimum.
  MATCHING_V3_MIN_SAMPLES: '2',
  MATCHING_V3_CALLS_PER_CYCLE: '0',
  MATCHING_V3_DAILY_API_CALLS: '0',
  MATCHING_V3_COMPUTE_URL: 'http://synthetic-demo.invalid',
});

const topic = (key: string, share: number) => ({
  key,
  name: MATCHING_TAXONOMY.topics.find((item) => item.key === key)?.name ?? key,
  share,
});

function crystal(topics: RegistryMatchingCrystal['topics']): RegistryMatchingCrystal {
  return {
    kind: 'matching',
    version: REGISTRY_CRYSTAL_VERSION,
    taxonomyVersion: MATCHING_TAXONOMY.version,
    generatedAt: new Date().toISOString(),
    windowDays: 90,
    data: {
      watchEvents: 240,
      uniqueVideos: 90,
      estimatedWatchSeconds: 140_000,
      activeDays: 20,
      topicCoverage: 1,
    },
    topics,
    channels: [{ key: 'shared-studio', name: 'Shared Studio', share: 1 }],
  };
}

interface DemoVideo { id: string; title: string; tags: string[]; channelId: string; channelTitle: string; watchedAt: string; seconds: number }
const video = (id: string, title: string, tags: string[], channelId: string, channelTitle: string, watchedAt: string, seconds = 900): DemoVideo =>
  ({ id, title, tags, channelId, channelTitle, watchedAt, seconds });

// Shared fixtures keep the legacy video IDs so the legacy crystal and Blend
// views still refer to the same synthetic watches.
const library: Record<'alice' | 'bob' | 'carol', DemoVideo[]> = {
  alice: [
    video('DEMOALICE01', 'Songwriting basics', ['songwriting', 'chords'], 'shared-studio', 'Shared Studio', '2026-09-01T01:00:00Z', 1_800),
    video('DEMOSHARED1', 'Build a tiny synthesizer', ['synthesizer', 'diy electronics'], 'shared-studio', 'Shared Studio', '2026-09-03T13:00:00Z', 1_200),
    video('DEMOALICE02', 'TypeScript patterns lesson', ['typescript', 'programming'], 'alice-lab', 'Alice Lab', '2026-09-04T01:00:00Z'),
    video('DEMOALICE03', 'Modular synth patching basics', ['modular synth', 'synth'], 'shared-studio', 'Shared Studio', '2026-08-28T12:00:00Z'),
    video('DEMOALICE04', 'Lyrics workshop', ['lyrics', 'songwriting'], 'alice-lab', 'Alice Lab', '2026-08-27T12:00:00Z'),
    video('DEMOALICE05', 'JavaScript tutorial for beginners', ['javascript', 'programming'], 'alice-lab', 'Alice Lab', '2026-08-26T12:00:00Z'),
    video('DEMOALICE06', 'Note taking for learning', ['note taking', 'study tips'], 'alice-lab', 'Alice Lab', '2026-08-25T12:00:00Z'),
    // Genre known, no original tags: the intended "missing tags" state.
    video('DEMOALICE07', 'Evening news bulletin', [], 'demo-news', 'Demo News Desk', '2026-08-24T12:00:00Z'),
  ],
  bob: [
    video('DEMOSHARED1', 'Build a tiny synthesizer', ['synthesizer', 'diy electronics'], 'shared-studio', 'Shared Studio', '2026-09-01T13:00:00Z', 1_500),
    video('DEMOBOB0001', 'Live looping techniques', ['live looping', 'looper'], 'shared-studio', 'Shared Studio', '2026-09-02T13:00:00Z', 1_800),
    video('DEMOBOB0002', 'Learning in public', ['learning in public', 'study tips'], 'bob-lab', 'Bob Lab', '2026-09-04T13:00:00Z', 600),
    video('DEMOBOB0003', 'Synth sound design lesson', ['synth', 'synthesizer'], 'shared-studio', 'Shared Studio', '2026-08-29T12:00:00Z'),
    video('DEMOBOB0004', 'Chord progressions lesson', ['chords', 'songwriting'], 'bob-lab', 'Bob Lab', '2026-08-28T12:00:00Z'),
    video('DEMOBOB0005', 'Programming tutorial: TypeScript', ['typescript', 'programming'], 'bob-lab', 'Bob Lab', '2026-08-27T12:00:00Z'),
    video('DEMOBOB0006', 'Speedrun commentary', ['speedrun'], 'bob-lab', 'Bob Lab', '2026-08-26T12:00:00Z'),
  ],
  // History sync never completed: a provisional profile with sparse evidence.
  carol: [
    video('DEMOCAROL01', 'Piano lesson for beginners', [], 'carol-keys', 'Carol Keys', '2026-09-02T12:00:00Z'),
    video('DEMOCAROL02', 'Synth jam session', ['synth'], 'carol-keys', 'Carol Keys', '2026-09-01T12:00:00Z'),
    video('DEMOCAROL03', 'Lyrics study', ['lyrics', 'songwriting'], 'carol-keys', 'Carol Keys', '2026-08-31T12:00:00Z'),
  ],
};

// Deterministic stand-in for the gateway classifier: genres from title words.
const genreWords: [typeof CONTENT_GENRES[number], RegExp][] = [
  ['Music', /\b(song|songwriting|synth|synthesizer|lyrics|chord|looping|piano|music)/i],
  ['Education', /\b(lesson|tutorial|basics|learning|study|patterns)\b/i],
  ['Video gaming', /\bspeedrun|game/i],
  ['News', /\bnews|bulletin/i],
];
function demoClassification(input: VideoInput): Classification {
  const { tags } = classificationInput(input);
  const genres = genreWords.filter(([, words]) => words.test(input.title)).map(([genre]) => genre);
  return { tagSource: 'original', tags, assignments: CONTENT_GENRES.filter(g => genres.includes(g)).map(genre => ({ genre, tags })) };
}

// Deterministic stand-in embeddings: related tags share concept axes, unknown
// tags get an isolated axis, and a small hash jitter keeps vectors distinct.
const concepts: Record<string, [number, number][]> = {
  synthesizer: [[0, 1]], synth: [[0, 1]], 'modular synth': [[0, 1]], 'diy electronics': [[0, .85], [7, .5]],
  'live looping': [[0, .8], [2, .6]], looper: [[0, .8], [2, .6]],
  songwriting: [[1, 1]], chords: [[1, 1]], lyrics: [[1, 1]],
  typescript: [[3, 1]], javascript: [[3, 1]], programming: [[3, 1]],
  'note taking': [[4, 1]], 'study tips': [[4, 1]], 'learning in public': [[4, 1]],
  speedrun: [[5, 1]],
};
export function demoEmbedding(text: string, dimensions: number): number[] {
  const hash = createHash('sha256').update(text).digest();
  const vector = Array.from({ length: dimensions }, (_, i) => i >= dimensions - 32 ? (hash[i % hash.length] / 255 - .5) * .06 : 0);
  for (const [axis, weight] of concepts[text] ?? [[16 + hash.readUInt16BE(0) % (dimensions - 48), 1]]) vector[axis] += weight;
  const length = Math.hypot(...vector);
  return vector.map(v => v / length);
}

export function demoProvider(s: Settings): Provider {
  const channelTypes: Record<string, typeof CHANNEL_TYPES[number][]> = {
    'shared-studio': ['personal creator'], 'alice-lab': ['personal creator'], 'bob-lab': ['personal creator'],
    'demo-news': ['media team'], 'carol-keys': ['personal creator'],
  };
  return {
    classify: async input => demoClassification(input),
    classifyBatch: async inputs => inputs.map(demoClassification),
    embed: async tags => tags.map(text => demoEmbedding(text, s.dimensions)),
    channel: async id => ({ types: channelTypes[id] ?? [], evidenceAvailable: id in channelTypes }),
  };
}

const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const unit = (v: number[]) => { const n = Math.hypot(...v); return v.map(x => x / n); };

// In-process stand-in for services/matching-compute (compact-medoid-v1 groups
// and coverage-padded transport). Comparison uses a greedy transport plan,
// which is exact for these tiny fixtures but is not the production LP solver.
export function demoCompute(s: Settings): Compute {
  return {
    async cluster(points: TagPoint[]) {
      if (!points.length) return { clusters: [], totalMass: 0, retainedCoverage: 0 };
      const ordered = [...points].sort((a, b) => a.text < b.text ? -1 : a.text > b.text ? 1 : 0);
      const x = ordered.map(p => unit(p.vector)), w = ordered.map(p => p.count);
      const near = (i: number, j: number) => dot(x[i], x[j]) >= 1 - s.compactDistance - 1e-12;
      const active = ordered.map(() => true), total = w.reduce((a, b) => a + b, 0);
      const groups: Cluster[] = [];
      for (let attempts = 0; active.some(Boolean) && groups.length < 10 && attempts < 200; attempts++) {
        const support = x.map((_, i) => active[i] ? x.reduce((sum, _v, j) => sum + (active[j] && near(i, j) ? w[j] : 0), 0) : -1);
        const anchor = support.indexOf(Math.max(...support));
        if (support[anchor] < s.minSamples) break;
        const candidates = x.map((_, i) => i).filter(i => active[i] && near(anchor, i))
          .sort((a, b) => w[b] - w[a] || (ordered[a].text < ordered[b].text ? -1 : 1));
        const members = [anchor];
        for (const i of candidates) if (i !== anchor && members.every(m => near(m, i))) members.push(i);
        for (const i of members) active[i] = false;
        const mass = members.reduce((sum, i) => sum + w[i], 0);
        if (mass < s.minSamples) continue;
        const mean = x[0].map((_, d) => members.reduce((sum, i) => sum + x[i][d] * w[i], 0) / mass);
        const representative = members.reduce((best, i) => dot(x[i], mean) > dot(x[best], mean) ? i : best, members[0]);
        const tagIds = [representative, ...members.filter(i => i !== representative).sort((a, b) => w[b] - w[a] || (ordered[a].text < ordered[b].text ? -1 : 1))];
        groups.push({ centroid: unit(mean), representative: x[representative], mass, memberCount: members.length, share: 0,
          tags: tagIds.slice(0, 5).map(i => ({ text: ordered[i].text, count: w[i], generatedCount: ordered[i].generatedCount })) });
      }
      groups.sort((a, b) => b.mass - a.mass || (a.tags[0].text < b.tags[0].text ? -1 : 1));
      const retained = groups.reduce((sum, g) => sum + g.mass, 0);
      for (const g of groups) g.share = g.mass / retained;
      return { clusters: groups, totalMass: total, retainedCoverage: retained / total };
    },
    async compare(left, right) {
      if (!left.clusters.length || !right.clusters.length) return { score: 0, transport: [] };
      const floor = s.similarityFloor;
      const kernel = left.clusters.map(a => right.clusters.map(b =>
        Math.min(1, Math.max(0, (dot(unit(a.representative ?? a.centroid), unit(b.representative ?? b.centroid)) - floor) / (1 - floor)))));
      // Uncovered mass has no similarity, as in the compute service.
      const wa = left.clusters.map(c => c.share * left.retainedCoverage), wb = right.clusters.map(c => c.share * right.retainedCoverage);
      const pairs = kernel.flatMap((row, i) => row.map((k, j) => ({ i, j, k }))).filter(p => p.k > 0)
        .sort((a, b) => b.k - a.k || a.i - b.i || a.j - b.j);
      const transport = [];
      for (const { i, j, k } of pairs) {
        const mass = Math.min(wa[i], wb[j]);
        if (mass <= 1e-9) continue;
        wa[i] -= mass; wb[j] -= mass;
        transport.push({ left: i, right: j, mass, similarity: k, contribution: mass * k });
      }
      transport.sort((a, b) => b.contribution - a.contribution || a.left - b.left || a.right - b.right);
      return { score: Math.min(1, transport.reduce((sum, t) => sum + t.contribution, 0)), transport };
    },
  };
}

function watches(user: User, videos: DemoVideo[]): YoutubeParsedArchive['watches'] {
  return videos.map(v => ({
    eventId: `${user.handle}-${v.id}`, videoId: v.id, title: v.title, url: `https://www.youtube.com/watch?v=${v.id}`,
    channelId: v.channelId, channelTitle: v.channelTitle, channelUrl: `https://www.youtube.com/channel/${v.channelId}`,
    watchedAt: v.watchedAt, actualWatchedSeconds: v.seconds, activityType: 'video',
  }));
}

function seedHistory(registry: UserRegistry, user: User, videos: DemoVideo[], historyComplete: boolean): void {
  const repository = registry.repositoryFor(user);
  repository.ingestYoutubeArchive({ archiveHash: `synthetic-demo-${user.handle}`, source: 'takeout', watches: watches(user, videos), searches: [] });
  repository.upsertYoutubeVideoMetadata(videos.map(v => ({
    videoId: v.id, title: v.title, channelId: v.channelId, channelTitle: v.channelTitle, description: '', tags: v.tags,
    thumbnailUrl: '', durationSeconds: 1_800, publishedAt: '2026-08-01T00:00:00Z', categoryId: null,
    availability: 'available' as const, isLivestream: false, metadataHash: `synthetic-${v.id}`,
  })), '2026-09-05T00:00:00Z');
  // A completed full-history scan marks the bounded source complete.
  if (historyComplete) repository.ingestYoutubeProgress({
    scanId: `synthetic-demo-scan-${user.handle}`, observedAt: '2026-09-05T00:00:00Z', complete: true, items: [],
    summary: { mode: 'full', videos: videos.length, passes: 1, endReason: 'history-start', oldestWatchedAt: null, newestWatchedAt: null, error: null, landedUrl: null },
  }, '2026-09-05T00:00:00Z');
}

export interface MatchingDemo {
  alice: User; bob: User; carol: User; newcomer: User;
  matchingV3: { settings: Settings; compute: Compute };
}

// Seeds legacy crystals, synthetic watch libraries, v3 interests/topics and
// v3 profiles. Profiles come from the real runCycle/buildProfile path.
export async function seedMatchingDemo(registry: UserRegistry): Promise<MatchingDemo> {
  const s = demoMatchingV3Settings(), compute = demoCompute(s);
  const alice = registry.createUser('alice-demo', 'Alice');
  const bob = registry.createUser('bob-demo', 'Bob');
  const carol = registry.createUser('carol-demo', 'Carol');
  const newcomer = registry.createUser('new-demo', 'New member');
  registry.setMatchingOptIn(newcomer.handle, true);
  for (const [user, topics] of [
    [alice, [topic('music', 0.65), topic('learning', 0.35)]],
    [bob, [topic('music', 0.55), topic('learning', 0.45)]],
  ] as const) {
    registry.upsertMatchingCrystal(user, crystal([...topics]));
  }
  for (const user of [alice, bob, carol]) registry.setMatchingPreferences(user.handle, true, 'topics_and_channel');
  seedHistory(registry, alice, library.alice, true);
  seedHistory(registry, bob, library.bob, true);
  seedHistory(registry, carol, library.carol, false);
  const store = registry.matchingV3Store();
  const topicId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  store.savePreferences(alice.id, { genres: ['Music', 'Education', 'News'], topics: [
    { id: topicId(1), name: 'Music & learning', genres: ['Music', 'Education'] },
    { id: topicId(2), name: 'Music', genres: ['Music'] },
    { id: topicId(3), name: 'News', genres: ['News'] },
  ] });
  store.savePreferences(bob.id, { genres: ['Music', 'Education', 'Video gaming'], topics: [
    { id: topicId(4), name: 'Music & learning', genres: ['Music', 'Education'] },
  ] });
  store.savePreferences(carol.id, { genres: ['Music', 'Education'], topics: [
    { id: topicId(5), name: 'Music', genres: ['Music'] },
  ] });
  await runCycle(registry, s, demoProvider(s), compute);
  return { alice, bob, carol, newcomer, matchingV3: { settings: s, compute } };
}
