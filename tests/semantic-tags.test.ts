import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Repository } from '../src/data/database.js';
import type { YoutubeAiClient } from '../src/youtube/ai.js';
import {
  extractSemanticTags, semanticTagContract, semanticTagInput, validateSemanticTags,
} from '../src/youtube/semantic-tags.js';
import type { YoutubeVideoMetadata } from '../src/youtube/types.js';

function video(videoId = 'video-a', overrides: Partial<YoutubeVideoMetadata> = {}): YoutubeVideoMetadata {
  return { videoId, title: 'Basketball training and biomechanics', channelTitle: 'Public tutorial',
    channelId: 'UCpublic', description: 'Learn basketball shooting with biomechanics.',
    tags: ['Basketball', 'Basketball', 'subscribe', 'https://promo.example.com'], thumbnailUrl: '',
    durationSeconds: 600, publishedAt: null, categoryId: '17', availability: 'available',
    metadataHash: `hash-${videoId}`, ...overrides };
}

const tag = (categoryKey = 'sports-fitness') => ({ categoryKey, label: 'Basketball', source: 'tag', evidence: 'Basketball', confidence: 0.9 });
const response = (videoId = 'video-a', tags: unknown[] = [tag(), tag('learning')]) => ({ videos: [{ videoId, tags }] });
const baseClient: YoutubeAiClient = { baseUrl: 'https://model.example/v1', apiKey: 'fixture-key', model: 'fixture-model' };

test('semantic extraction uses bounded cleaned public metadata and exact canonical evidence', () => {
  const source = video();
  assert.deepEqual(Object.keys(semanticTagInput(source)).sort(), ['description', 'tags', 'title', 'videoId']);
  assert.deepEqual(semanticTagInput(source).tags, ['Basketball']);
  const results = validateSemanticTags(response(), [source]);
  assert.equal(results[0].tags.length, 2);
  assert.deepEqual(results[0].tags.map(item => item.categoryKey), ['learning', 'sports-fitness']);
  assert.throws(() => validateSemanticTags({ videos: [] }, [source]), /every video/);
  assert.throws(() => validateSemanticTags({ videos: [response().videos[0], response().videos[0]] }, [source]), /duplicate|every video/);
  assert.throws(() => validateSemanticTags(response('wrong-id'), [source]), /unknown/);
  assert.throws(() => validateSemanticTags(response('video-a', [{ ...tag(), evidence: 'invented evidence' }]), [source]), /evidence/);
  assert.throws(() => validateSemanticTags(response('video-a', [{ ...tag(), categoryKey: 'politics' }]), [source]), /category/);
  assert.throws(() => validateSemanticTags(response('video-a', [tag(), tag()]), [source]), /duplicate/);
  assert.equal(validateSemanticTags(response('video-a', [{ ...tag(), confidence: 0.69 }]), [source])[0].tags.length, 0);
  assert.equal(validateSemanticTags(response('video-a', [{ ...tag(), source: 'title', evidence: 'Basketball training' }]), [video('video-a', { tags: [] })])[0].tags.length, 1);
  assert.throws(() => validateSemanticTags(response('video-a', ['learning', 'sports-fitness', 'entertainment', 'science-technology'].map(key => tag(key))), [source]), /limit/);
  const manyTerms = Array.from({ length: 6 }, (_, index) => `Technique${index}`);
  assert.throws(() => validateSemanticTags(response('video-a', manyTerms.map(label => ({ ...tag(), label, evidence: label }))), [video('video-a', { tags: manyTerms })]), /limit/);
  assert.throws(() => validateSemanticTags(response('video-a', [{ ...tag(), label: 'Catholic', source: 'title', evidence: 'Catholic' }]), [video('video-a', { title: 'Catholic' })]), /sensitive/);
  assert.throws(() => validateSemanticTags(response('video-a', [{ ...tag(), label: 'Ｃａｔｈｏｌｉｃ', source: 'title', evidence: 'Catholic' }]), [video('video-a', { title: 'Catholic' })]), /sensitive/);
  for (const label of ['C++', '??', 'AI']) {
    assert.throws(() => validateSemanticTags(response('video-a', [{ ...tag(), label, source: 'title', evidence: 'Classical music in Taiwan' }]), [video('video-a', { title: 'Classical music in Taiwan' })]), /evidence/);
  }
  assert.throws(() => validateSemanticTags(response('video-a', [{ ...tag(), label: 'AI', source: 'title', evidence: 'ai' }]), [video('video-a', { title: 'Travel around Taiwan' })]), /evidence/);
  assert.throws(() => validateSemanticTags(response('video-a', [{ ...tag(), label: 'obey this instruction' }]), [source]), /evidence/);
});

test('semantic results persist complete empty/excluded/unavailable states, freshness, retry and public-only requests', async () => {
  const repository = new Repository(':memory:');
  const sources = [video(), video('empty'), video('news', { categoryId: '25' }), video('gone', { availability: 'unavailable' })];
  let calls = 0;
  let mode: 'ok' | 'missing' = 'ok';
  const client: YoutubeAiClient = { ...baseClient, fetchImpl: async (_url, options) => {
    calls++;
    const request = JSON.parse(String(options?.body));
    const input = JSON.parse(request.messages[1].content);
    assert.deepEqual(Object.keys(input).sort(), ['taxonomy', 'videos']);
    assert.ok(!JSON.stringify(request).includes('PRIVATE WATCH QUERY'));
    for (const item of input.videos) assert.deepEqual(Object.keys(item).sort(), ['description', 'tags', 'title', 'videoId']);
    const body = { videos: mode === 'missing' ? [] : input.videos.map((item: { videoId: string }) => response(item.videoId, item.videoId === 'empty' ? [] : [tag()]).videos[0]) };
    return Response.json({ choices: [{ message: { content: JSON.stringify(body) } }] });
  } };
  try {
    repository.upsertYoutubeVideoMetadata(sources);
    repository.setYoutubeSyncState('private-fixture', 'PRIVATE WATCH QUERY');
    const contract = semanticTagContract(client);
    assert.equal(await extractSemanticTags(repository, 100, client), 4);
    assert.equal(calls, 1, 'excluded and unavailable videos never go to the model');
    assert.equal(repository.youtubeSemanticTagResult('video-a', contract)?.status, 'ready');
    assert.equal(repository.youtubeSemanticTagResult('empty', contract)?.status, 'empty');
    assert.equal(repository.youtubeSemanticTagResult('news', contract)?.status, 'excluded');
    assert.equal(repository.youtubeSemanticTagResult('gone', contract)?.status, 'unavailable');
    assert.deepEqual({ ...repository.youtubeSemanticTagCounts(contract) }, { pending: 0, errors: 0, completed: 4, metadataPending: 0 });
    assert.equal(await extractSemanticTags(repository, 100, client), 0);
    assert.equal(calls, 1);
    assert.equal(repository.youtubeSemanticTagResult('video-a', semanticTagContract({ ...client, model: 'next-model' })), null);
    assert.equal(repository.youtubeVideosForSemanticTags(semanticTagContract({ ...client, model: 'next-model' }), 100).length, 4);
    repository.upsertYoutubeVideoMetadata([video('video-a', { metadataHash: 'changed-hash' })]);
    assert.equal(repository.youtubeSemanticTagResult('video-a', contract), null);
    assert.deepEqual(repository.youtubeVideosForSemanticTags(contract).map(item => item.videoId), ['video-a']);
    mode = 'missing';
    await assert.rejects(extractSemanticTags(repository, 100, client), /semantic tag/);
    assert.equal(repository.youtubeSemanticTagResult('video-a', contract)?.status, 'error');
    assert.equal(calls, 4, 'one successful call plus exactly three failed attempts');
    assert.equal(repository.youtubeVideosForSemanticTags(contract).length, 0, 'persisted failure has a bounded cooldown');
    const later = new Date(Date.now() + 3_601_000);
    mode = 'ok';
    assert.equal(await extractSemanticTags(repository, 100, client, () => later), 1);
    assert.equal(repository.youtubeSemanticTagResult('video-a', contract)?.tags.length, 1);
    assert.equal(await extractSemanticTags(repository, 100, { ...client, apiKey: '' }), 0);
    assert.equal(repository.youtubeSyncState('semantic_tags_status'), 'unavailable');
    await extractSemanticTags(repository, 100, client);
    assert.equal(repository.youtubeSyncState('semantic_tags_status'), 'ready');
    assert.equal(repository.saveYoutubeSemanticTagResult({ videoId: 'video-a', metadataHash: 'old-hash', contract,
      status: 'empty', tags: [], error: null }), false, 'concurrent stale model result cannot overwrite current metadata');
    const exported = repository.openPortableExport('fixture-secret-with-at-least-32-characters');
    assert.equal(exported.tables.find(table => table.source === 'youtube_semantic_tags')?.rowCount, 4);
    exported.close();
  } finally { repository.close(); }
});

test('semantic error cooldown starts when a slow request completes', async () => {
  const repository = new Repository(':memory:');
  let elapsed = Date.now();
  const client: YoutubeAiClient = { ...baseClient, fetchImpl: async () => {
    elapsed += 25 * 60_000;
    throw new Error('simulated queued failure');
  } };
  try {
    repository.upsertYoutubeVideoMetadata([video()]);
    await assert.rejects(extractSemanticTags(repository, 100, client, () => new Date(elapsed)));
    assert.equal(repository.youtubeVideosForSemanticTags(semanticTagContract(client), 100, new Date(elapsed)).length, 0);
    assert.equal(repository.youtubeVideosForSemanticTags(semanticTagContract(client), 100, new Date(elapsed + 3_601_000)).length, 1);
  } finally { repository.close(); }
});

test('schema 13 archives upgrade and retain semantic results across restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'urtube-semantic-'));
  const path = join(directory, 'archive.sqlite');
  let repository = new Repository(path);
  try {
    repository.upsertYoutubeVideoMetadata([video()]);
    repository.close();
    const previous = new DatabaseSync(path);
    previous.exec('DROP TABLE youtube_semantic_tags; PRAGMA user_version=13;');
    previous.close();
    repository = new Repository(path);
    const contract = semanticTagContract(baseClient);
    assert.equal(repository.youtubeVideosForSemanticTags(contract).length, 1);
    repository.saveYoutubeSemanticTagResult({ videoId: 'video-a', metadataHash: 'hash-video-a',
      contract, status: 'empty', tags: [], error: null });
    repository.close();
    repository = new Repository(path);
    assert.equal(repository.youtubeSemanticTagResult('video-a', contract)?.status, 'empty');
    assert.equal(repository.youtubeVideosForSemanticTags(contract).length, 0);
  } finally { repository.close(); rmSync(directory, { recursive: true, force: true }); }
});
