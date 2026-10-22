import { createHash } from 'node:crypto';
import type { UserRegistry, User } from '../src/users.js';
import { registryMatchingCrystal } from '../src/youtube/registry-crystal.js';
import { youtubeMatchingCrystalSection } from '../src/youtube/crystal.js';
import type { YoutubeParsedArchive } from '../src/youtube/types.js';
import type { Compute } from '../src/matching-v3/compute.js';
import { CHANNEL_TYPES, CONTENT_GENRES, classificationInput, settings, version, type Classification, type Cluster, type Settings, type TagPoint, type VideoInput } from '../src/matching-v3/model.js';
import { runCycle } from '../src/matching-v3/pipeline.js';
import type { Provider } from '../src/matching-v3/provider.js';

// Credential-free synthetic data for `npm run demo:matching`. No real account,
// video history or API key is used: v3 profiles are built by the real worker
// pipeline with a deterministic stand-in provider. The interactive demo injects
// real Python compute; the fast unit fixture defaults to the stand-in below.

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

interface DemoVideo { id: string; title: string; tags: string[]; channelId: string; channelTitle: string; seconds: number }
const video = (id: string, title: string, tags: string[], channelId: string, channelTitle: string, seconds = 900): DemoVideo =>
  ({ id, title, tags, channelId, channelTitle, seconds });

// Shared fixtures keep the legacy video IDs so the legacy crystal and Blend
// views still refer to the same synthetic watches.
const library: Record<'alice' | 'bob' | 'carol', DemoVideo[]> = {
  alice: [
    video('DEMOALICE01', 'Songwriting basics', ['songwriting', 'chords'], 'shared-studio', 'Shared Studio', 1_800),
    video('DEMOSHARED1', 'Build a tiny synthesizer', ['synthesizer', 'diy electronics'], 'shared-studio', 'Shared Studio', 1_200),
    video('DEMOALICE02', 'TypeScript patterns lesson', ['typescript', 'programming'], 'alice-lab', 'Alice Lab'),
    video('DEMOALICE03', 'Modular synth patching basics', ['modular synth', 'synth'], 'shared-studio', 'Shared Studio'),
    video('DEMOALICE04', 'Lyrics workshop', ['lyrics', 'songwriting'], 'alice-lab', 'Alice Lab'),
    video('DEMOALICE05', 'JavaScript tutorial for beginners', ['javascript', 'programming'], 'alice-lab', 'Alice Lab'),
    video('DEMOALICE06', 'Note taking for learning', ['note taking', 'study tips'], 'alice-lab', 'Alice Lab'),
    // Genre known, no original tags: the intended "missing tags" state.
    video('DEMOALICE07', 'Evening news bulletin', [], 'demo-news', 'Demo News Desk'),
  ],
  bob: [
    video('DEMOSHARED1', 'Build a tiny synthesizer', ['synthesizer', 'diy electronics'], 'shared-studio', 'Shared Studio', 1_500),
    video('DEMOBOB0001', 'Live looping techniques', ['live looping', 'looper'], 'shared-studio', 'Shared Studio', 1_800),
    video('DEMOBOB0002', 'Learning in public', ['learning in public', 'study tips'], 'bob-lab', 'Bob Lab', 600),
    video('DEMOBOB0003', 'Synth sound design lesson', ['synth', 'synthesizer'], 'shared-studio', 'Shared Studio'),
    video('DEMOBOB0004', 'Chord progressions lesson', ['chords', 'songwriting'], 'bob-lab', 'Bob Lab'),
    video('DEMOBOB0005', 'Programming tutorial: TypeScript', ['typescript', 'programming'], 'bob-lab', 'Bob Lab'),
    video('DEMOBOB0006', 'Speedrun commentary', ['speedrun'], 'bob-lab', 'Bob Lab'),
  ],
  // History sync never completed: a provisional profile with sparse evidence.
  carol: [
    video('DEMOCAROL01', 'Piano lesson for beginners', [], 'carol-keys', 'Carol Keys'),
    video('DEMOCAROL02', 'Synth jam session', ['synth'], 'carol-keys', 'Carol Keys'),
    video('DEMOCAROL03', 'Lyrics study', ['lyrics', 'songwriting'], 'carol-keys', 'Carol Keys'),
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

function watches(user: User, videos: DemoVideo[], now: Date, days: number): YoutubeParsedArchive['watches'] {
  return Array.from({ length: days }, (_, day) => videos.map((v, index) => ({
    eventId: `${user.handle}-${v.id}-${day}`, videoId: v.id, title: v.title, url: `https://www.youtube.com/watch?v=${v.id}`,
    channelId: v.channelId, channelTitle: v.channelTitle, channelUrl: `https://www.youtube.com/channel/${v.channelId}`,
    watchedAt: new Date(now.getTime() - (day + 1) * 86400_000 + index * 3600_000).toISOString(),
    actualWatchedSeconds: v.seconds, activityType: 'video' as const,
  }))).flat();
}

function seedHistory(registry: UserRegistry, user: User, videos: DemoVideo[], historyComplete: boolean, now: Date): void {
  const repository = registry.repositoryFor(user);
  const at = now.toISOString();
  repository.ingestYoutubeArchive({ archiveHash: `synthetic-demo-${user.handle}`, source: 'takeout', watches: watches(user, videos, now, historyComplete ? 32 : 1), searches: [] });
  const ids = [...new Set(Object.values(library).flat().map(v => v.id))];
  repository.upsertYoutubeVideoMetadata(videos.map(v => ({
    videoId: v.id, title: v.title, channelId: v.channelId, channelTitle: v.channelTitle, description: '', tags: v.tags,
    thumbnailUrl: '', durationSeconds: 1_800, publishedAt: new Date(now.getTime() - 90 * 86400_000).toISOString(), categoryId: null,
    availability: 'available' as const, isLivestream: false, metadataHash: `synthetic-${v.id}`,
    viewCount: [0, 999, 1000, 9999, 10000, 100000, 1000000, null][ids.indexOf(v.id) % 8], statisticsFetchedAt: at,
  })), at);
  repository.upsertYoutubeChannelMetadata([...new Map(videos.map(v => [v.channelId, v])).values()].map((v, index) => ({
    channelId: v.channelId, name: v.channelTitle, thumbnailUrl: '',
    statistics: { subscriberCount: index === 1 ? null : 10000, hiddenSubscriberCount: index === 1,
      videoCount: null, viewCount: null, publishedAt: null, topicCategories: [] },
  })), at);
  // A completed full-history scan marks the bounded source complete.
  if (historyComplete) repository.ingestYoutubeProgress({
    scanId: `synthetic-demo-scan-${user.handle}`, observedAt: at, complete: true, items: [],
    summary: { mode: 'full', videos: videos.length, passes: 1, endReason: 'history-start', oldestWatchedAt: null, newestWatchedAt: null, error: null, landedUrl: null },
  }, at);
  registry.upsertMatchingCrystal(user, registryMatchingCrystal({ generatedAt: at,
    matching: youtubeMatchingCrystalSection(repository, now) }));
}

export interface MatchingDemo {
  alice: User; bob: User; carol: User; newcomer: User;
  pending: User; failed: User;
  directory: User[];
  matchingV3: { settings: Settings; compute: Compute };
}

// Seeds legacy crystals, synthetic watch libraries, v3 interests/topics and
// v3 profiles. Profiles come from the real runCycle/buildProfile path.
export async function seedMatchingDemo(registry: UserRegistry, options: { now?: Date; settings?: Settings; compute?: Compute; directoryMembers?: number } = {}): Promise<MatchingDemo> {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid demo clock');
  const directoryMembers = options.directoryMembers ?? 0;
  if (!Number.isInteger(directoryMembers) || directoryMembers < 0 || directoryMembers > 30) throw new Error('Demo directory members must be 0..30');
  const s = options.settings ?? demoMatchingV3Settings(), compute = options.compute ?? demoCompute(s);
  const alice = registry.createUser('alice-demo', 'Alice');
  const bob = registry.createUser('bob-demo', 'Bob');
  const carol = registry.createUser('carol-demo', 'Carol');
  const newcomer = registry.createUser('new-demo', 'New member');
  registry.setMatchingOptIn(newcomer.handle, true);
  for (const user of [alice, bob, carol]) registry.setMatchingPreferences(user.handle, true, 'topics_and_channel');
  seedHistory(registry, alice, library.alice, true, now);
  seedHistory(registry, bob, library.bob, true, now);
  seedHistory(registry, carol, library.carol, false, now);
  registry.setDashboardPublic(carol.handle, true);
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
  // Deliberate lifecycle fixtures, created after the bounded synthetic cycle.
  // They never start workers or retry real providers.
  const failed = registry.createUser('failed-demo', 'Failed processing');
  seedHistory(registry, failed, library.carol, false, now);
  store.schedule(failed.id, 'synthetic-failure', version(s));
  const job = store.claim();
  if (!job || job.userId !== failed.id) throw new Error('Unexpected demo job');
  store.defer(job, 'Synthetic provider unavailable', true);
  const pending = registry.createUser('pending-demo', 'Pending processing');
  seedHistory(registry, pending, library.carol, false, now);
  store.schedule(pending.id, 'synthetic-pending', version(s));
  const directory = Array.from({ length: directoryMembers }, (_, i) => {
    const member = registry.createUser(`directory-${String(i + 1).padStart(2, '0')}`, `Directory ${String(i + 1).padStart(2, '0')}`);
    registry.setMatchingOptIn(member.handle, true);
    return member;
  });
  return { alice, bob, carol: registry.userByHandle(carol.handle)!, newcomer, pending, failed, directory, matchingV3: { settings: s, compute } };
}
