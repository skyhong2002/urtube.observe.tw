import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from 'cheerio';
import { createApp } from '../src/index.js';
import { UserRegistry } from '../src/users.js';
import { GENRES, settings, version, type Profile } from '../src/matching-v3/model.js';
import { computeClient } from '../src/matching-v3/compute.js';
import { TAG_POLICY, type TagListSnapshot } from '../src/youtube/taglists.js';

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

test('owner dashboard keeps v3 interests alongside range-based analysis without exposing invalid legacy topics', async () => {
  const f = fixture();
  try {
    const response = await f.app.request('/v3-dashboard?lang=zh', { headers: f.headers });
    assert.equal(response.status, 200);
    const $ = load(await response.text());
    assert.equal($('[data-v3-interests] .yt-v3-genre').length, 9);
    assert.equal($('[data-processing-monitor]').length, 1);
    assert.match($('[data-v3-interests]').text(), /興趣分析|2,000/);
    assert.match($('[data-v3-interests]').text(), /不隨上方日期範圍切換/);
    assert.equal($('.yt-stable-topics').length, 1);
    assert.equal($('.yt-topic-details').length, 1);
    assert.ok($('.yt-stat').length > 0);
    assert.equal($('[data-rank-race="channels"]').length, 1);
    assert.doesNotMatch($.text(), /Legacy classification|120 分鐘/);
    assert.match($('.yt-v3-cloud').text(), /private-profile-tag/);
    assert.equal(f.repository.youtubeTopics()[0]?.name, 'Legacy classification');
  } finally { f.registry.close(); }
});

test('public v3 interests respect selected genres, opt-out, profile visibility and version freshness', async () => {
  const f = fixture();
  try {
    let $ = load(await (await f.app.request('/v3-dashboard?lang=en')).text());
    assert.equal($('[data-v3-interests] .yt-v3-genre').length, 1);
    assert.equal($('[data-processing-monitor]').length, 0, 'visitor cannot load owner monitoring');
    assert.equal($('[data-v3-interests] .yt-v3-genre strong').text(), 'Music');
    assert.doesNotMatch($.text(), /31,337|private-profile-tag/);
    f.store.schedule(f.user.id, 'changed', 'old-v3-version');
    const job = f.store.claim()!;
    f.store.finish(job, { ...f.profile, version: 'old-v3-version' });
    $ = load(await (await f.app.request('/v3-dashboard')).text());
    assert.equal($('[data-v3-interests] .yt-v3-genre').length, 0);
    assert.match($('[data-v3-interests]').text(), /Waiting for interest analysis/);
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
    assert.equal($('#processing [data-processing-monitor]').length, 1);
    assert.equal($('#processing a[href="/matching-v3/admin"]').length, 0);
    assert.match($('#processing').text(), /17 \/ 250 部影片/);
    assert.doesNotMatch($.text(), /120 分鐘|預計還需|AI 主題|檢查個人主題版本/);
    assert.equal($('a[href="/account/taxonomy"],form[action^="/account/taxonomy"]').length, 0);
    assert.equal((await f.app.request('/account')).status, 302);
    assert.equal(f.store.processingStatus(f.user.id)?.state, 'running');
    const dashboard = load(await (await f.app.request('/v3-dashboard?lang=zh', { headers: f.headers })).text());
    assert.equal(dashboard('[data-v3-interests] .section-head span').text(), '暫定結果', 'previous ready profile remains provisional during a rebuild');
  } finally { f.registry.close(); }
});


test('Insights restores all channel groups and keywords alongside v3, and isolates upstream failure', async () => {
  const f = fixture();
  try {
    const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa';
    f.repository.upsertYoutubeVideoMetadata([{
      videoId: 'AAAAAAAAAA1', title: 'Fixture music lesson', channelId, channelTitle: 'Fixture tagged channel',
      description: '', tags: ['fixture-music'], thumbnailUrl: '', durationSeconds: 600,
      publishedAt: null, categoryId: '10', availability: 'available', metadataHash: 'tags-fixture',
    }]);
    const snapshot: TagListSnapshot = {
      lists: {
        news: new Set([channelId]), editorial: new Set([channelId]), editorialShows: new Set([channelId]),
        blue: new Set([channelId]), green: new Set([channelId]), white: new Set([channelId]), red: new Set([channelId]),
      },
      provenance: {
        sourceUrl: 'https://example.test/channel-tags', sourceUpdatedAt: '2026-09-05 01:58:34',
        fetchedAt: '2026-09-05T01:58:35.000Z', membershipVersion: 'sha256:fixture',
        policyVersion: TAG_POLICY.version, policyUrl: TAG_POLICY.url, reportUrl: TAG_POLICY.reportUrl,
      },
    };
    let fail = false;
    let calls = 0;
    const app = createApp(f.registry, {
      matchingV3: { settings: f.s, compute: computeClient(f.s) },
      loadTagLists: async () => { calls++; if (fail) throw new Error('fixture source unavailable'); return snapshot; },
    });
    for (const range of ['365d', 'all']) {
      const response = await app.request(`/v3-dashboard/insights?range=${range}&sort=duration&lang=zh`, { headers: f.headers });
      assert.equal(response.status, 200);
      const $ = load(await response.text());
      assert.equal($('[data-v3-interests] .yt-v3-genre').length, 9);
      assert.equal($('.tl-hero').length, 1);
      for (const label of ['泛藍', '泛綠', '泛白', '泛紅', '新聞', '個人社論', '社論節目']) {
        assert.ok($('.tl-groups').text().includes(label), label);
      }
      assert.match($('.tl-groups').text(), /Fixture tagged channel/);
      assert.equal($('.yt-keywords').length, 1);
    }
    assert.equal(calls, 2);
    fail = true;
    const unavailable = await app.request('/v3-dashboard/insights?range=all&lang=zh', { headers: f.headers });
    assert.equal(unavailable.status, 200);
    const $ = load(await unavailable.text());
    assert.match($('body').text(), /目前無法驗證頻道標籤來源/);
    assert.equal($('.tl-hero').length, 0);
    assert.equal($('[data-v3-interests] .yt-v3-genre').length, 9);
    assert.equal($('.yt-keywords').length, 1);
    await app.request('/v3-dashboard?range=all', { headers: f.headers });
    assert.equal(calls, 3, 'overview does not wait on the external channel-label API');
  } finally { f.registry.close(); }
});

test('cached preview displays actual clusters without confusing provisional status with absent data', async () => {
  const { v3DashboardSection } = await import('../src/output/v3-dashboard.js');
  const f = fixture();
  try {
    const profile = structuredClone(f.profile);
    profile.complete = false;
    for (const item of Object.values(profile.genres)) item.status = 'insufficient';
    profile.genres.Music!.retainedCoverage = 0.42;
    profile.genres.Sport!.clusters = [];
    delete profile.genres['channel type'];
    for (const lang of ['zh', 'en'] as const) {
      const $ = load(v3DashboardSection(profile, { enabled: true, currentVersion: profile.version, backfillVideoLimit: 2000, genres: GENRES.slice(), lang }));
      const cards = $('.yt-v3-genre');
      assert.match(cards.eq(1).text(), lang === 'zh' ? /已建立 1 個興趣群/ : /1 interest clusters/);
      assert.doesNotMatch(cards.eq(1).text(), /資料不足|Limited data/);
      assert.match(cards.eq(2).text(), /資料不足|Limited data/);
      assert.match(cards.eq(8).text(), /尚未建立|Pending/);
      assert.doesNotMatch($.text(), /private-profile-tag/);
    }
  } finally { f.registry.close(); }
});

 test('tag clouds escape original tags and omit generated evidence and visitor detail', async () => {
  const { v3DashboardSection } = await import('../src/output/v3-dashboard.js');
  const f = fixture();
  try {
    f.profile.genres.Music!.clusters[0].tags = [
      {text:'<script>alert(1)</script>', count:4, generatedCount:0},
      {text:'generated-only',count:3,generatedCount:3},
    ];
    const options = {enabled:true,currentVersion:f.profile.version,backfillVideoLimit:2000,genres:['Music'] as const,lang:'zh' as const};
    const render = (ownerDetails:boolean) => load(v3DashboardSection(f.profile,{...options,genres:[...options.genres],ownerDetails}));
    const owner=render(true);
    assert.equal(owner('.yt-v3-cloud script').length,0);
    assert.match(owner('.yt-v3-cloud').text(), /<script>/);
    assert.doesNotMatch(owner('.yt-v3-cloud').text(), /generated-only/);
    assert.equal(owner('.yt-v3-cloud span').attr('title'),'4 部不同影片');
    assert.equal(render(false)('.yt-v3-cloud').length,0);
  } finally { f.registry.close(); }
});
