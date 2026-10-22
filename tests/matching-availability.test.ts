import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { UserRegistry, type User } from '../src/users.js';
import { availabilityReason, settings, version, type GenreProfile, type Profile } from '../src/matching-v3/model.js';
import type { Compute } from '../src/matching-v3/compute.js';

// Synthetic accounts and videos only.
const config = settings({ MATCHING_V3_ENABLED: 'true', MATCHING_V3_BACKFILL_VIDEO_LIMIT: '2' });
const compute: Compute = {
  cluster: async () => { throw new Error('The status view must not cluster'); },
  compare: async () => ({ score: 0, transport: [] }),
};
const cluster = { centroid: [1, 0], mass: 4, share: 1, tags: [{ text: 'synthetic', count: 4, generatedCount: 0 }] };
const genre = (value: Partial<GenreProfile>): GenreProfile => ({ status: 'insufficient', clusters: [], totalMass: 0, retainedCoverage: 0, videoCount: 0, ...value });

test('availability reasons separate missing tags, sparse tags, low coverage, unclassified and empty', () => {
  assert.equal(availabilityReason(genre({ clusters: [cluster], totalMass: 4, retainedCoverage: 1, status: 'ready' })), 'ready');
  assert.equal(availabilityReason(genre({ clusters: [cluster], totalMass: 10, retainedCoverage: .4, status: 'partial' })), 'low_coverage');
  // Genre known (new videos get genres only) but none of its videos has a tag.
  assert.equal(availabilityReason(genre({ videoCount: 3 })), 'missing_tags');
  assert.equal(availabilityReason(genre({ videoCount: 3, totalMass: 2 })), 'sparse_tags');
  assert.equal(availabilityReason(genre({})), 'unclassified');
  assert.equal(availabilityReason(genre({ status: 'empty' })), 'empty');
});

const source = readFileSync(new URL('../src/matching-v3/client.js', import.meta.url), 'utf8');
function notes(lang: 'zh' | 'en', data: unknown, genres: string[]): string[] {
  const context: any = { lang, t: (zh: string, en: string) => lang === 'zh' ? zh : en, genreName: (g: string) => ({ Music: lang === 'zh' ? '音樂' : 'Music' } as Record<string, string>)[g] ?? g };
  runInNewContext(source.slice(source.indexOf('function availabilityNotes'), source.indexOf('// Keep one request in flight')) + '\nglobalThis.notes = availabilityNotes;', context);
  return Array.from(context.notes(data, genres));
}
const profile = {
  builtAt: '2026-09-06T00:00:00Z', complete: true, currentVersion: true, totalVideos: 10, processedVideos: 10,
  genres: {
    Music: { status: 'insufficient', reason: 'missing_tags', videoCount: 3, retainedCoverage: 0 },
    Sport: { status: 'partial', reason: 'low_coverage', videoCount: 5, retainedCoverage: .38 },
    News: { status: 'insufficient', reason: 'sparse_tags', videoCount: 2, retainedCoverage: 0 },
    Podcast: { status: 'empty', reason: 'empty', videoCount: 0, retainedCoverage: 0 },
    'channel type': { status: 'insufficient', reason: 'unclassified', videoCount: 0, retainedCoverage: 0 },
    Politic: { status: 'ready', reason: 'ready', videoCount: 4, retainedCoverage: .9 },
  },
};
const clean = { profile, job: { state: 'done' }, source: { videoLimit: 2000, limitReached: false, unavailableVideos: 0, pendingMetadataVideos: 0 } };

test('topic status explains each uncertain genre with a next step in zh and en', () => {
  const zh = notes('zh', clean, ['Music', 'Sport', 'News', 'Podcast', 'channel type', 'Education', 'Politic']);
  assert.equal(zh.length, 6, 'ready genres add no note');
  assert.match(zh[0], /^音樂：已辨識出 3 部相關影片，但它們沒有原始 tag.*此類別暫不計分.*不自動產生 tag/);
  assert.match(zh[1], /^Sport：只有 38% 的 tag 權重形成穩定主題群，分數為暫定/);
  assert.match(zh[2], /^News：相關 tag 太少或太分散/);
  assert.match(zh[3], /^Podcast：你的觀看紀錄中沒有這類影片/);
  assert.match(zh[4], /^channel type：.*沒有可用的公開說明/);
  assert.match(zh[5], /^Education：仍有影片尚未分類.*自動更新/);
  const en = notes('en', clean, ['Music', 'Sport']);
  assert.match(en[0], /^Music: 3 related videos were recognized, but they have no original tags.*tags are never generated/);
  assert.match(en[1], /only 38% of tag weight forms stable groups, so the score is provisional/);
  assert.deepEqual(notes('zh', clean, ['Politic']), []);
});

test('topic status explains source limit, deleted metadata and incomplete processing', () => {
  const data = { job: { state: 'running' },
    profile: { ...profile, complete: false, processedVideos: 7, totalVideos: 2000 },
    source: { videoLimit: 2000, limitReached: true, unavailableVideos: 12, pendingMetadataVideos: 5 } };
  const zh = notes('zh', data, ['Politic']);
  assert.equal(zh.length, 6);
  for (const [i, pattern] of [/^你的新資料正在處理中/, /^觀看紀錄尚未完整同步，分數為暫定/, /^已分類 7 \/ 2,000 部影片/,
    /^只分析最近觀看的 2,000 部不同影片.*不需要操作/, /^12 部影片已刪除或無法取得資訊，只能依標題判斷類別/, /^5 部影片的資訊仍在查詢/].entries()) assert.match(zh[i], pattern);
  const en = notes('en', data, ['Politic']);
  assert.ok(en.some(note => /Only your 2,000 most recently watched distinct videos are analyzed.*no action is needed/.test(note)));
  assert.ok(en.some(note => /^12 videos were deleted or their details are unavailable; they are classified from the title only/.test(note)));
  assert.match(notes('en', { profile: null, job: { state: 'queued' }, source: clean.source }, ['Music'])[0], /not finished yet.*check back later/);
  assert.match(notes('zh', { profile: null, job: { state: 'failed' }, source: clean.source }, ['Music'])[0], /自動重試，不需要重新匯入/);
});

function seed(registry: UserRegistry, user: User) {
  const repository = registry.repositoryFor(user);
  const watch = (videoId: string, watchedAt: string) => ({ eventId: `${user.handle}-${videoId}`, videoId, title: `Synthetic ${videoId}`,
    url: `https://www.youtube.com/watch?v=${videoId}`, channelId: 'synthetic-channel', channelTitle: 'Synthetic channel',
    channelUrl: 'https://www.youtube.com/channel/synthetic-channel', watchedAt, actualWatchedSeconds: 60, activityType: 'video' as const });
  repository.ingestYoutubeArchive({ archiveHash: `availability-${user.handle}`, source: 'takeout', searches: [], watches: [
    watch('AVAILOLD001', '2026-09-01T00:00:00Z'), watch('AVAILGONE01', '2026-09-03T00:00:00Z'), watch('AVAILPEND01', '2026-09-02T00:00:00Z'),
  ] });
  const metadata = (videoId: string, availability: 'available' | 'unavailable') => ({ videoId, title: `Synthetic ${videoId}`, channelId: 'synthetic-channel',
    channelTitle: 'Synthetic channel', description: '', tags: availability === 'available' ? ['synthetic'] : [], thumbnailUrl: '', durationSeconds: 60,
    publishedAt: null, categoryId: null, availability, metadataHash: videoId });
  repository.upsertYoutubeVideoMetadata([metadata('AVAILOLD001', 'available'), metadata('AVAILGONE01', 'unavailable')]);
  const store = registry.matchingV3Store();
  const value: Profile = { version: version(config), sourceFingerprint: user.handle, builtAt: '2026-09-06T00:00:00Z', complete: true,
    processedVideos: 2, totalVideos: 2, genres: { Music: genre({ videoCount: 2 }), Sport: genre({ clusters: [cluster], totalMass: 10, retainedCoverage: .4, status: 'ready' }) } };
  store.savePreferences(user.id, { genres: ['Music', 'Sport'], topics: [] });
  store.schedule(user.id, user.handle, version(config)); store.finish(store.claim()!, value);
}

test('the topic API reports only the viewer\'s own availability reasons and source counts', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const viewer = registry.createUser('availability-viewer', 'Viewer');
    const other = registry.createUser('availability-other', 'Other');
    for (const user of [viewer, other]) { registry.setMatchingOptIn(user.handle, true); seed(registry, user); }
    const app = createApp(registry, { matchingV3: { settings: config, compute } });
    const response = await app.request('/api/matching-v3', { headers: { cookie: `urtube_session=${registry.createSession(viewer)}` } });
    const body = await response.json() as any;
    assert.equal(body.profile.genres.Music.reason, 'missing_tags');
    assert.equal(body.profile.genres.Sport.reason, 'low_coverage');
    assert.equal(body.profile.genres.Sport.status, 'partial');
    assert.deepEqual(body.source, { videoLimit: 2, limitReached: true, unavailableVideos: 1, pendingMetadataVideos: 1 });
    assert.ok(!JSON.stringify(body).includes('availability-other'));
  } finally { registry.close(); }
});
