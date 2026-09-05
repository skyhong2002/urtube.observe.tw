import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from 'cheerio';
import { createApp } from '../src/index.js';
import { UserRegistry } from '../src/users.js';
import { GENRES, settings, version, type Profile } from '../src/matching-v3/model.js';
import { computeClient } from '../src/matching-v3/compute.js';

function fixture() {
  const registry = new UserRegistry(':memory:');
  const user = registry.createUser('v3-dashboard', 'V3 viewer', { dashboardPublic: true });
  registry.setMatchingOptIn(user.handle, true);
  const s = settings({ MATCHING_V3_ENABLED: 'true' });
  const app = createApp(registry, { matchingV3: { settings: s, compute: computeClient(s) } });
  const repository = registry.repositoryFor(user);
  repository.ingestYoutubeArchive({ archiveHash: 'v3-dashboard', source: 'takeout', searches: [], watches: [{
    eventId: 'watch', videoId: 'AAAAAAAAAA1', title: 'Raw video', url: 'https://www.youtube.com/watch?v=AAAAAAAAAA1',
    channelId: null, channelTitle: '', channelUrl: '', watchedAt: '2026-09-04T01:23:45Z',
    actualWatchedSeconds: 321, activityType: 'video',
  }] });
  repository.replaceYoutubeTaxonomy([{ version: 1, slug: 'old-topic', name: 'Legacy classification', description: '' }]);
  const store = registry.matchingV3Store();
  const profile: Profile = { version: version(s), sourceFingerprint: 'v3-dashboard', builtAt: '2026-09-06T00:00:00Z',
    complete: true, processedVideos: 250, totalVideos: 250,
    genres: Object.fromEntries(GENRES.map(genre => [genre, { status: 'ready', videoCount: genre === 'Sport' ? 31337 : 25,
      retainedCoverage: 1, totalMass: 1, clusters: [{ centroid: [0.1, 0.2], mass: 1, share: 1,
        tags: [{ text: 'private-profile-tag', count: 1, generatedCount: 0 }] }] }])) };
  store.schedule(user.id, profile.sourceFingerprint, profile.version);
  const job = store.claim()!;
  store.finish(job, profile);
  store.savePreferences(user.id, { genres: ['Music'], topics: [] });
  const headers = { cookie: `urtube_session=${registry.createSession(user)}` };
  return { registry, user, store, profile, repository, app, headers, s };
}

test('owner dashboard displays only current v3 interests while preserving basic stats and legacy data', async () => {
  const f = fixture();
  try {
    const response = await f.app.request('/v3-dashboard?lang=zh', { headers: f.headers });
    assert.equal(response.status, 200);
    const $ = load(await response.text());
    assert.equal($('[data-v3-interests] .yt-v3-genre').length, 9);
    assert.match($('[data-v3-interests]').text(), /v3 興趣分析|2,000/);
    assert.match($('[data-v3-interests]').text(), /不隨上方日期範圍切換/);
    assert.equal($('.yt-stable-topics,[data-rank-race="topics"],[data-topic-trend]').length, 0);
    assert.ok($('.yt-stat').length > 0);
    assert.equal($('[data-rank-race="channels"]').length, 1);
    assert.doesNotMatch($.text(), /Legacy classification|AI 主題涵蓋|120 分鐘|private-profile-tag/);
    assert.equal(f.repository.youtubeTopics()[0]?.name, 'Legacy classification');
  } finally { f.registry.close(); }
});

test('public v3 interests respect selected genres, opt-out, profile visibility and version freshness', async () => {
  const f = fixture();
  try {
    let $ = load(await (await f.app.request('/v3-dashboard?lang=en')).text());
    assert.equal($('[data-v3-interests] .yt-v3-genre').length, 1);
    assert.equal($('[data-v3-interests] .yt-v3-genre strong').text(), 'Music');
    assert.doesNotMatch($.text(), /31,337|private-profile-tag/);
    f.store.schedule(f.user.id, 'changed', 'old-v3-version');
    const job = f.store.claim()!;
    f.store.finish(job, { ...f.profile, version: 'old-v3-version' });
    $ = load(await (await f.app.request('/v3-dashboard')).text());
    assert.equal($('[data-v3-interests] .yt-v3-genre').length, 0);
    assert.match($('[data-v3-interests]').text(), /Waiting for v3/);
    f.registry.setMatchingOptIn(f.user.handle, false);
    $ = load(await (await f.app.request('/v3-dashboard')).text());
    assert.equal($('[data-v3-interests]').length, 0);
    f.registry.setDashboardPublic(f.user.handle, false);
    assert.equal((await f.app.request('/v3-dashboard')).status, 404);
  } finally { f.registry.close(); }
});

test('account progress uses actual bounded v3 job counts and exposes no legacy ETA or audit controls', async () => {
  const f = fixture();
  try {
    f.store.schedule(f.user.id, 'new-source', version(f.s));
    const job = f.store.claim()!;
    f.store.progress(job, { phase: 'classification', processed: 17, total: 250 });
    const $ = load(await (await f.app.request('/account?lang=zh', { headers: f.headers })).text());
    assert.equal($('#processing [data-v3-processing="running"]').length, 1);
    assert.match($('#processing').text(), /17 \/ 250 部影片/);
    assert.doesNotMatch($.text(), /120 分鐘|預計還需|AI 主題|檢查個人主題版本/);
    assert.equal($('a[href="/account/taxonomy"],form[action^="/account/taxonomy"]').length, 0);
    assert.equal((await f.app.request('/account')).status, 302);
    assert.equal(f.store.processingStatus(f.user.id)?.state, 'running');
    const dashboard = load(await (await f.app.request('/v3-dashboard?lang=zh', { headers: f.headers })).text());
    assert.equal(dashboard('[data-v3-interests] .section-head span').text(), '暫定結果', 'previous ready profile remains provisional during a rebuild');
  } finally { f.registry.close(); }
});
