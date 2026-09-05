import type { UserRegistry } from '../users.js';
import type { Compute } from './compute.js';
import { CONTENT_GENRES, version, type Classification, type Profile, type Settings, type SourceSnapshot, type TagPoint } from './model.js';
import { aggregateTags, classificationKey, embeddingKey } from './pipeline.js';
import type { MatchingStore } from './store.js';

// No provider calls: preview uses only committed cache from the bounded source.
export async function cachedPreview(source: SourceSnapshot, store: MatchingStore, s: Settings, compute: Compute): Promise<Profile> {
  const classifications = new Map<string, Classification>();
  for (const video of source.videos) {
    const value = store.cache<Classification>(classificationKey(s, video));
    if (value) classifications.set(video.id, value);
  }
  const genres: Profile['genres'] = {};
  for (const genre of CONTENT_GENRES) {
    const { tags, videoCount } = aggregateTags(source.videos, classifications, genre);
    const points: TagPoint[] = [];
    let expectedMass = 0;
    for (const [text, counts] of tags) {
      expectedMass += counts.count;
      const vector = store.cache<number[]>(embeddingKey(s, text));
      if (vector) points.push({ text, ...counts, vector });
    }
    if (!points.length || points.length > 10000) continue;
    const result = await compute.cluster(points);
    const availableMass = points.reduce((sum, point) => sum + point.count, 0);
    genres[genre] = { ...result, videoCount, status: 'insufficient',
      retainedCoverage: expectedMass ? result.retainedCoverage * availableMass / expectedMass : 0 };
  }
  return { version: version(s), sourceFingerprint: source.fingerprint, builtAt: new Date().toISOString(),
    complete: false, totalVideos: source.videos.length, processedVideos: classifications.size, genres };
}

export async function publishCachedPreviews(registry: UserRegistry, s: Settings, compute: Compute) {
  const store = registry.matchingV3Store();
  let published = 0, skipped = 0;
  for (const user of registry.listUsers()) {
    const current = registry.listUsers().find(candidate => candidate.id === user.id);
    if (!current) { skipped++; continue; }
    const previous = store.profile(current.id);
    if (previous?.version === version(s)) { skipped++; continue; }
    const source = registry.repositoryFor(current).matchingV3Source(s.backfillVideoLimit);
    const profile = await cachedPreview(source, store, s, compute);
    const fresh = registry.listUsers().find(candidate => candidate.id === current.id);
    if (!fresh || fresh.handle !== current.handle) { skipped++; continue; }
    if (!Object.values(profile.genres).some(g => g.clusters.length)
      || registry.repositoryFor(fresh).matchingV3Source(s.backfillVideoLimit).fingerprint !== source.fingerprint) { skipped++; continue; }
    if (store.publishPreview(fresh.id, profile, previous)) published++; else skipped++;
  }
  return { published, skipped };
}
