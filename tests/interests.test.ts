import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { UserRegistry } from '../src/users.js';
import type { Repository } from '../src/data/database.js';
import { embeddingContract, type EmbeddingClient } from '../src/youtube/embeddings.js';
import { buildSemanticInterests, clusterInterestCategory, currentInterests, interestSamples,
  INTEREST_POLICY, weightedDbscan, type InterestVideo, type WeightedInterestPoint } from '../src/youtube/interests.js';

const NOW = new Date('2026-09-05T12:00:00Z');
const client: EmbeddingClient = { baseUrl: 'http://127.0.0.1:8000/v1', apiKey: '', model: 'fixture', revision: 'v1' };
const modelContract = embeddingContract(client);
const tagsContract = 'fixture-tags';
const unit = (axis = 0) => Array.from({ length: 1024 }, (_, index) => Number(index === axis));
const angle = (degrees: number) => [Math.cos(degrees * Math.PI / 180), Math.sin(degrees * Math.PI / 180), ...Array(1022).fill(0)];
const video = (id: string, labels = ['Basketball'], watchedAt = '2026-09-01T12:00:00.000Z'): InterestVideo => ({
  videoId: id, watchedAt, metadataHash: 'hash', status: 'ready', tags: labels.map(label => ({
    categoryKey: 'sports-fitness', label, source: 'tag', evidence: label, confidence: 0.9,
  })),
});
const point = (key: string, weight: number, vector = unit(), videoIds = ['v1', 'v2', 'v3']): WeightedInterestPoint => ({ key, label: key, weight, vector, videoIds });

function seed(repository: Repository, videos: InterestVideo[]) {
  repository.ingestYoutubeArchive({ archiveHash: `fixture-${videos.map(item => item.videoId + item.watchedAt).join('-')}`,
    source: 'takeout', searches: [], watches: videos.map(item => ({
      eventId: `${item.videoId}-${item.watchedAt}`, videoId: item.videoId, title: 'Public sports fixture',
      url: `https://www.youtube.com/watch?v=${item.videoId}`, channelId: null, channelTitle: null, channelUrl: null,
      watchedAt: item.watchedAt, actualWatchedSeconds: 60, activityType: 'video',
    })) });
  repository.upsertYoutubeVideoMetadata(videos.map(item => ({ videoId: item.videoId, title: 'Public sports fixture',
    channelId: null, channelTitle: null, description: '', tags: item.tags.map(tag => tag.label), thumbnailUrl: '',
    durationSeconds: 60, publishedAt: null, categoryId: '17', availability: 'available', metadataHash: item.metadataHash! })));
  for (const item of videos) repository.saveYoutubeSemanticTagResult({ videoId: item.videoId,
    metadataHash: item.metadataHash!, contract: tagsContract, status: 'ready', tags: item.tags, error: null });
}

function cache(registry: UserRegistry, labels: string[], vector = unit()) {
  for (const label of labels) {
    registry.claimEmbedding(modelContract, label, 'fixture-token', '2027-01-01', NOW.toISOString());
    registry.finishEmbedding(modelContract, label, 'fixture-token', vector, NOW.toISOString(), NOW.toISOString());
  }
}

test('weighted DBSCAN preserves core, border and noise without border bridges or input-order effects', () => {
  const samples = [point('a-core', 3, angle(0)), point('a-edge', 0.4, angle(35)),
    point('border', 0.1, angle(55)), point('z-core', 3, angle(110)), point('z-edge', 0.4, angle(75)),
    point('noise', 0.1, angle(180))];
  const clusters = weightedDbscan(samples).map(group => group.map(item => item.key));
  assert.deepEqual(clusters, [['a-core', 'a-edge', 'border'], ['z-core', 'z-edge']]);
  assert.deepEqual(weightedDbscan([...samples].reverse()).map(group => group.map(item => item.key)), clusters);
  assert.deepEqual(weightedDbscan([]), []);
  assert.deepEqual(weightedDbscan([point('noise', 2)]), []);
  assert.throws(() => weightedDbscan([point('bad', 3, [1, 0])]), /dimensions/);
  assert.throws(() => weightedDbscan([point('bad', 3, Array(1024).fill(0))]), /norm/);
  assert.throws(() => weightedDbscan(Array.from({ length: 257 }, (_, index) => point(String(index), 1))), /limit/);
});

test('distinct videos contribute one unit per category, dedupe labels, and yield at most five normalized supported groups', () => {
  const videos = ['a', 'b', 'c'].map(id => video(id, ['Basketball', 'Shooting', 'basketball']));
  const samples = interestSamples([...videos, videos[0]]).get('sports-fitness')!;
  assert.deepEqual(samples.map(item => [item.key, item.weight]), [['basketball', 1.5], ['shooting', 1.5]]);
  const groups = clusterInterestCategory('sports-fitness', samples.map(item => ({ ...item, vector: unit() })), modelContract);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].mass, 3);
  assert.deepEqual(groups[0].supportingVideoIds, ['a', 'b', 'c']);
  assert.ok(Math.abs(Math.hypot(...groups[0].centroid) - 1) < 1e-12);
  assert.deepEqual(interestSamples([...videos].reverse()), interestSamples(videos));
  const oneVideo = interestSamples([video('solo', ['One', 'Two', 'Three', 'Four', 'Five'])]).get('sports-fitness')!;
  assert.deepEqual(clusterInterestCategory('sports-fitness', oneVideo.map(item => ({ ...item, vector: unit() })), modelContract), []);
  assert.deepEqual(clusterInterestCategory('sports-fitness', [point('same-video', 3, unit(), ['one'])], modelContract), []);
  const separate = Array.from({ length: 6 }, (_, index) => point(`topic-${index}`, 3 + index, unit(index)));
  const five = clusterInterestCategory('sports-fitness', separate, modelContract);
  assert.equal(five.length, 5);
  assert.deepEqual(five.map(group => group.mass), [8, 7, 6, 5, 4]);
  assert.deepEqual(five, clusterInterestCategory('sports-fitness', separate.reverse(), modelContract));
  const multi = video('multi', ['Basketball']); multi.tags.push({ ...multi.tags[0], categoryKey: 'learning' });
  assert.deepEqual([...interestSamples([multi]).values()].map(points => points[0].weight), [1, 1]);
  assert.throws(() => interestSamples(Array.from({ length: 2001 }, (_, index) => video(String(index)))), /limit/);
});

test('owner groups persist, export and invalidate on deletion, metadata, expiry and version changes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'urtube-interests-'));
  const registryPath = join(directory, 'registry.sqlite');
  let registry = new UserRegistry(registryPath);
  try {
    const owner = registry.createUser('interests-owner', 'Owner');
    let repository = registry.repositoryFor(owner);
    const sources = ['one', 'two', 'three'].map(id => video(id));
    seed(repository, [...sources, video('expired', ['Basketball'], '2026-01-01T00:00:00.000Z'),
      video('future', ['Basketball'], '2026-12-01T00:00:00.000Z')]);
    cache(registry, ['basketball']);
    registry.close();
    const previous = new DatabaseSync(join(directory, 'users', `${owner.handle}.sqlite`));
    previous.exec('DROP TABLE youtube_interests; PRAGMA user_version=14;');
    previous.close();
    registry = new UserRegistry(registryPath);
    repository = registry.repositoryFor(registry.userByHandle(owner.handle)!);
    assert.equal(buildSemanticInterests(registry, repository, client, tagsContract, NOW), 1);
    const first = currentInterests(registry, repository, client, tagsContract, NOW)!;
    assert.equal(first.status, 'ready');
    assert.equal(first.groups[0].mass, 3);
    assert.deepEqual(first.groups[0].supportingVideoIds, ['one', 'three', 'two']);
    assert.equal(buildSemanticInterests(registry, repository, client, tagsContract, new Date(NOW.getTime() + 60_000)), 0);
    assert.equal(currentInterests(registry, repository, { ...client, revision: 'v2' }, tagsContract, NOW), null);
    assert.equal(currentInterests(registry, repository, client, 'tags-v2', NOW), null);
    const exported = repository.openPortableExport('fixture-secret-with-at-least-32-characters');
    assert.equal(exported.tables.find(table => table.source === 'youtube_interests')?.rowCount, 1);
    exported.close();
    registry.close(); registry = new UserRegistry(registryPath);
    repository = registry.repositoryFor(registry.userByHandle(owner.handle)!);
    assert.equal(currentInterests(registry, repository, client, tagsContract, NOW)?.inputHash, first.inputHash);
    const writer = new DatabaseSync(join(directory, 'users', `${owner.handle}.sqlite`));
    writer.prepare('DELETE FROM youtube_watch_events WHERE video_id=?').run('three');
    writer.close();
    assert.equal(currentInterests(registry, repository, client, tagsContract, NOW), null);
    assert.equal(buildSemanticInterests(registry, repository, client, tagsContract, NOW), 1);
    assert.equal(currentInterests(registry, repository, client, tagsContract, NOW)?.groups.length, 0);
    seed(repository, sources);
    buildSemanticInterests(registry, repository, client, tagsContract, NOW);
    seed(repository, [{ ...sources[0], metadataHash: 'changed' }]);
    assert.equal(currentInterests(registry, repository, client, tagsContract, NOW), null);
    buildSemanticInterests(registry, repository, client, tagsContract, NOW);
    const later = new Date('2026-12-01T00:00:00.000Z');
    assert.equal(currentInterests(registry, repository, client, tagsContract, later), null);
    buildSemanticInterests(registry, repository, client, tagsContract, later);
    assert.equal(currentInterests(registry, repository, client, tagsContract, later)?.groups.length, 0);
    assert.equal(currentInterests(registry, repository, client, tagsContract, later)?.coverage.windowVideos, 1);
    registry.deleteUser(owner.handle);
    assert.equal(registry.listUsers().length, 0);
  } finally { registry.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('caps and missing vectors expose coverage instead of inflating the remaining support', () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('bounded-owner', 'Bounded');
    const repository = registry.repositoryFor(user);
    const sources = Array.from({ length: 257 }, (_, index) => video(`video-${index}`, [`Label ${index}`]));
    seed(repository, sources);
    cache(registry, sources.map(item => item.tags[0].label.toLowerCase()));
    buildSemanticInterests(registry, repository, client, tagsContract, NOW);
    const snapshot = currentInterests(registry, repository, client, tagsContract, NOW)!;
    assert.equal(snapshot.status, 'partial');
    assert.equal(snapshot.coverage.categories[0].totalLabels, 257);
    assert.equal(snapshot.coverage.categories[0].usedLabels, INTEREST_POLICY.maxLabelsPerCategory);
    assert.equal(snapshot.coverage.categories[0].usedMass, 256);
    const missing = registry.repositoryFor(registry.createUser('missing-owner', 'Missing'));
    seed(missing, ['a', 'b', 'c'].map(id => video(id, ['Known', 'Missing'])));
    cache(registry, ['known']);
    buildSemanticInterests(registry, missing, client, tagsContract, NOW);
    const partial = currentInterests(registry, missing, client, tagsContract, NOW)!;
    assert.equal(partial.status, 'processing');
    assert.equal(partial.coverage.categories[0].usedMass, 1.5);
    assert.equal(partial.groups.length, 0);
    const bounded = registry.repositoryFor(registry.createUser('video-bound', 'Video bound'));
    seed(bounded, Array.from({ length: 2001 }, (_, index) => video(`cap-${index}`, [])));
    buildSemanticInterests(registry, bounded, client, tagsContract, NOW);
    const cap = currentInterests(registry, bounded, client, tagsContract, NOW)!;
    assert.equal(cap.status, 'partial');
    assert.equal(cap.coverage.windowVideos, 2001);
    assert.equal(cap.coverage.consideredVideos, 2000);
    const unknown = registry.repositoryFor(registry.createUser('unknown-owner', 'Unknown'));
    unknown.ingestYoutubeArchive({ archiveHash: 'unidentified', source: 'takeout', searches: [], watches: [{
      eventId: 'unknown-event', videoId: null, title: 'Deleted video', url: 'https://www.youtube.com/',
      channelId: null, channelTitle: null, channelUrl: null, watchedAt: NOW.toISOString(),
      actualWatchedSeconds: null, activityType: 'video',
    }] });
    buildSemanticInterests(registry, unknown, client, tagsContract, NOW);
    const unidentified = currentInterests(registry, unknown, client, tagsContract, NOW)!;
    assert.equal(unidentified.status, 'ready');
    assert.equal(unidentified.coverage.windowVideos, 0);
    assert.equal(unidentified.coverage.unidentifiedEvents, 1);
  } finally { registry.close(); }
});
