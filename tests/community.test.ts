import assert from 'node:assert/strict';
import test from 'node:test';
import { communityStatsProvider, MIN_FRESHNESS_MEMBERS, MIN_RANKED_MEMBERS, RECENT_IMPORT_DAYS, recentImportsBand } from '../src/youtube/community.js';
import { Repository } from '../src/data/database.js';
import type { YoutubeParsedArchive } from '../src/youtube/types.js';
import { landingContent } from '../src/output/landing.js';
const id = 'UC' + 'a'.repeat(22);
const otherId = 'UC' + 'b'.repeat(22);
const row = (channelId: string | null, watches: number, name = 'Channel') => ({ channelId, watches, name, estimatedWatchSeconds: watches * 60, thumbnailUrl: '' });

test('public-only aggregates deduplicate members and revoke visibility without waiting for cache TTL', async () => {
  const users = [{ id: 1, dashboardPublic: true }, { id: 2, dashboardPublic: true }, { id: 3, dashboardPublic: false }, { id: 4, dashboardPublic: true }, { id: 5, dashboardPublic: true }];
  const read: number[] = [];
  const provider = communityStatsProvider({ listUsers: () => users, repositoryFor: (u) => {
    read.push(u.id);
    assert.notEqual(u.id, 3);
    return { lastWatchImportAt: () => null, youtubeChannelTotals: (range, now) => {
      assert.equal(range, '90d');
      assert.equal(now.toISOString(), '2026-09-05T00:00:00.000Z');
      return u.id === 1 ? [row(id, 2), row(id, 3), row(null, 4)] : u.id === 2 ? [row(id, 1), row(otherId, 100)] : [row(id, 1), row(otherId, 1)];
    } };
  } }, () => Date.parse('2026-09-05T00:00:00Z'));
  const stats = await provider();
  assert.equal(stats.publicMembers, 4);
  assert.equal(stats.activeMembers, 4);
  assert.equal(stats.watches, 114);
  assert.equal(stats.channels, 2);
  assert.equal(stats.estimatedWatchSeconds, 114 * 60);
  assert.equal(stats.topWatchedChannels?.[0].id, otherId);
  assert.deepEqual(stats.topChannels.map(x => [x.id, x.members]), [[id, 4], [otherId, 3]]);
  assert.equal((await provider()), stats);
  assert.deepEqual(read, [1, 2, 4, 5]);
  users[0].dashboardPublic = false;
  const after = await provider();
  assert.equal(after.publicMembers, 3);
  assert.equal(after.watches, 105);
  assert.equal(after.estimatedWatchSeconds, 105 * 60);
  assert.equal(after.topWatchedChannels?.find(x => x.id === id)?.members, 3);
  assert.equal(after.topChannels[0].id, otherId);
  users.splice(1);
  assert.equal((await provider()).publicMembers, 0);
  assert.deepEqual((await provider()).topChannels, []);
});

test('failed queries hide partial totals and do not serve stale data', async () => {
  let fail = false;
  let now = 0;
  const provider = communityStatsProvider({ listUsers: () => [{ id: 1, dashboardPublic: true }], repositoryFor: () => ({ lastWatchImportAt: () => null, youtubeChannelTotals: () => { if (fail) throw new Error('unavailable'); return [row(id, 1)]; } }) }, () => now);
  assert.equal((await provider()).status, 'ready');
  fail = true; now = 300001;
  assert.deepEqual((await provider()).topChannels, []);
  assert.equal((await provider()).status, 'unavailable');
  fail = false;
  assert.equal((await provider()).status, 'ready');
});

test('channel names are escaped and empty/unavailable states do not invent metrics', async () => {
  const provider = communityStatsProvider({ listUsers: () => [1, 2, 3].map(id => ({ id, dashboardPublic: true })), repositoryFor: () => ({ lastWatchImportAt: () => null, youtubeChannelTotals: () => [row(id, 1, '<script>alert(1)</script>')] }) });
  const stats = await provider();
  const page = landingContent('zh', '', stats);
  assert.ok(page.includes('&lt;script&gt;'));
  assert.ok(!page.includes('<script>alert'));
  assert.ok(page.includes('近 90 天'));
  assert.ok(landingContent('en', '', stats).includes('Public dashboard members'));
  const unavailable = landingContent('zh', '', { ...stats, status: 'unavailable' });
  assert.ok(unavailable.includes('社群統計暫時無法載入'));
  assert.ok(!unavailable.includes('class="lp-stat"'));
});


test('duration and watch-count shelves rank independently and revoke both projections', async () => {
  const members = [1, 2, 3].map(id => ({ id, dashboardPublic: true }));
  const provider = communityStatsProvider({ listUsers: () => members, repositoryFor: () => ({ lastWatchImportAt: () => null, youtubeChannelTotals: () => [
    { ...row(id, 2), estimatedWatchSeconds: 7200 },
    { ...row(otherId, 100), estimatedWatchSeconds: 600 },
  ] }) });
  const value = await provider();
  assert.equal(value.topDurationChannels?.[0].id, id);
  assert.equal(value.topWatchedChannels?.[0].id, otherId);
  assert.equal(value.topDurationChannels?.[0].estimatedWatchSeconds, 3 * 7200);
  for (const member of members) member.dashboardPublic = false;
  assert.deepEqual((await provider()).topDurationChannels, []);
  assert.deepEqual((await provider()).topWatchedChannels, []);
});

test('the landing page is served and the retired screenshot route is gone', async () => {
  const { createApp } = await import('../src/index.js');
  const { UserRegistry } = await import('../src/users.js');
  const registry = new UserRegistry(':memory:');
  try {
    const app = createApp(registry);
    const response = await app.request('/?lang=zh');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const page = await response.text();
    assert.ok(page.includes('你的 YouTube 人生'));
    assert.ok(page.includes('position:sticky;top:0'));
    assert.ok(!page.includes('/match-preview/landing/'));
    // The hero sample and the tour are translated HTML; no screenshots remain.
    assert.ok(!page.includes('/landing-assets/'));
    for (const name of ['dashboard.png', 'channel.png', 'matching.png', '.env', 'missing.png']) {
      const image = await app.request(`/landing-assets/${name}`);
      assert.equal(image.status, 404, name);
      assert.notEqual(image.headers.get('content-type'), 'image/png', name);
    }
    // The files themselves were removed from the repository and the image.
    const { existsSync, readFileSync } = await import('node:fs');
    assert.equal(existsSync(new URL('../public/landing', import.meta.url)), false);
    assert.doesNotMatch(readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8'), /public\/landing/);
  } finally { registry.close(); }
});


test('public profile projection reflects renames and revokes private identities', async () => {
  const users = [
    { id: 1, dashboardPublic: true, handle: 'alice', displayName: 'Alice' },
    { id: 2, dashboardPublic: false, handle: 'private-user', displayName: 'Private Person' },
  ];
  const provider = communityStatsProvider({ listUsers: () => users, repositoryFor: () => ({ lastWatchImportAt: () => null, youtubeChannelTotals: () => [] }) });
  assert.deepEqual((await provider()).profiles, [{ handle: 'alice', displayName: 'Alice' }]);
  assert.ok(!landingContent('zh', '', (await provider())).includes('private-user'));
  users[0].displayName = 'New Alice';
  assert.equal((await provider()).profiles?.[0].displayName, 'New Alice');
  users[0].dashboardPublic = false;
  assert.deepEqual((await provider()).profiles, []);
  assert.ok(!landingContent('zh', '', (await provider())).includes('class="lp-member"'));
});


test('product tour links point at pages the viewer can open, never at image files', () => {
 const data = { status: 'ready' as const, generatedAt: new Date().toISOString(), publicMembers: 0, activeMembers: 0, watches: 0, channels: 0, topChannels: [] };
 const anonymous = landingContent('zh', '<a class="lp-primary" href="/signup">x</a>', data);
 assert.ok(anonymous.includes('href="/skyhong.tw"'));
 // Channel pages require sign-in, so anonymous visitors get a labelled sign-up link.
 assert.ok(!anonymous.includes('href="/channel/'));
 assert.match(anonymous, /<a href="\/signup" aria-label="[^"]*需要登入[^"]*">登入後查看頻道頁 →<\/a>/);
 // Matching redirects anonymous visitors to Google too; they get sign-up instead.
 assert.match(anonymous, /<a href="\/signup" aria-label="[^"]*配對需要登入[^"]*">登入後探索配對 →<\/a>/);
 assert.ok(!anonymous.includes('href="/matches"'));
 assert.ok(!anonymous.includes('href="/landing-assets/'));
 const closed = landingContent('en', '', data);
 assert.ok(!closed.includes('href="/channel/'), 'signups closed is still anonymous');
 const signedIn = landingContent('zh', '<a class="lp-primary" href="/alex">x</a>', data);
 assert.ok(signedIn.includes('href="/channel/UCRIgIJQWuBJ0Cv_VlU3USNA?range=90d"'));
 assert.ok(signedIn.includes('href="/matches"'));
});

test('a slow refresh never holds the landing request and still enforces current visibility', async () => {
  const users = [{ id: 1, dashboardPublic: true, handle: 'alice', displayName: 'Alice' }, { id: 2, dashboardPublic: true, handle: 'bob', displayName: 'Bob' }];
  let now = 0;
  let calls = 0;
  let release!: () => void;
  const provider = communityStatsProvider({ listUsers: () => users, repositoryFor: (u) => ({ lastWatchImportAt: () => null, youtubeChannelTotals: () => {
    calls++;
    return calls <= 2 ? [row(u.id === 1 ? id : otherId, 1)]
      : new Promise(resolve => { release = () => resolve([row(u.id === 1 ? id : otherId, 5)]); });
  } }) }, () => now, 20);
  const fresh = await provider();
  assert.equal(fresh.watches, 2);
  now = 300_001;
  // Expired and the refresh is stuck: the same members get the last result.
  const started = Date.now();
  assert.equal(await provider(), fresh);
  assert.equal(await provider(), fresh);
  assert.ok(Date.now() - started < 1000);
  assert.equal(calls, 4, 'concurrent requests share one refresh');
  // A member going private never sees the previous aggregate, even while waiting.
  users[1].dashboardPublic = false;
  const revoked = await provider();
  assert.equal(revoked.status, 'unavailable');
  assert.equal(revoked.watches, 0);
  assert.deepEqual(revoked.profiles, [{ handle: 'alice', displayName: 'Alice' }]);
  // Its own refresh (Alice only) then completes and is served.
  release();
  await new Promise(resolve => setTimeout(resolve, 0));
  const settled = await provider();
  assert.equal(settled.status, 'ready');
  assert.equal(settled.publicMembers, 1);
  assert.equal(settled.watches, 5);
});

test('the sitemap lists only public dashboards and is revalidated on every fetch', async () => {
  const { createApp } = await import('../src/index.js');
  const { UserRegistry } = await import('../src/users.js');
  const registry = new UserRegistry(':memory:');
  try {
    const app = createApp(registry);
    const user = registry.createUser('sitemap-public', 'Public');
    registry.setDashboardPublic(user.handle, true);
    let response = await app.request('/sitemap.xml');
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    let body = await response.text();
    assert.match(body, /\/sitemap-public<\/loc>/);
    assert.match(body, /\/sitemap-public\/insights<\/loc>/);
    registry.setDashboardPublic(user.handle, false);
    body = await (await app.request('/sitemap.xml')).text();
    assert.doesNotMatch(body, /sitemap-public/);
    assert.equal((await app.request('/sitemap-public')).status, 404);
  } finally { registry.close(); }
});

test('rankings list only channels watched by at least three public members; totals count everyone', async () => {
  assert.equal(MIN_RANKED_MEMBERS, 3);
  const third = 'UC' + 'c'.repeat(22);
  const users = [1, 2, 3, 4].map(id => ({ id, dashboardPublic: true }));
  // id: watched by all four; otherId: by two; third: by one member only.
  const rows: Record<number, ReturnType<typeof row>[]> = {
    1: [row(id, 1), row(otherId, 50), row(third, 500)], 2: [row(id, 1), row(otherId, 50)], 3: [row(id, 1)], 4: [row(id, 1)],
  };
  const provider = communityStatsProvider({ listUsers: () => users, repositoryFor: u => ({ lastWatchImportAt: () => null, youtubeChannelTotals: () => rows[u.id] }) });
  const stats = await provider();
  for (const shelf of [stats.topChannels, stats.topWatchedChannels ?? [], stats.topDurationChannels ?? []]) {
    assert.deepEqual(shelf.map(x => [x.id, x.members]), [[id, 4]]);
  }
  assert.equal(stats.channels, 3);
  assert.equal(stats.watches, 604);
  users[2].dashboardPublic = false; users[3].dashboardPublic = false;
  assert.deepEqual((await provider()).topChannels, []);
});

// Data freshness band (approved 2026-11-13): the share of public members with
// new watch records in the last 7 days, as a band only.
test('recent-import bands have exact boundaries and need three public members', () => {
  assert.equal(RECENT_IMPORT_DAYS, 7);
  assert.equal(MIN_FRESHNESS_MEMBERS, 3);
  const cases: Array<[number, number, string]> = [
    [0, 0, 'too-few-members'], [2, 2, 'too-few-members'], [1, 1, 'too-few-members'],
    [0, 3, 'none'], [1, 3, 'about-quarter'], [2, 3, 'about-half'], [3, 3, 'most'],
    [1, 4, 'about-quarter'], [2, 4, 'about-half'], [3, 4, 'most'], [4, 4, 'most'],
    [1, 5, 'few'], [2, 5, 'about-quarter'], [3, 5, 'about-half'], [4, 5, 'most'],
    [0, 100, 'none'], [1, 100, 'few'], [24, 100, 'few'], [25, 100, 'about-quarter'], [49, 100, 'about-quarter'],
    [50, 100, 'about-half'], [74, 100, 'about-half'], [75, 100, 'most'], [100, 100, 'most'],
  ];
  for (const [recent, members, band] of cases) assert.equal(recentImportsBand(recent, members), band, `${recent}/${members}`);
});

const freshNow = Date.parse('2026-11-13T12:00:00Z');
function freshnessSource(imports: Record<number, string | null>, users: Array<{ id: number; dashboardPublic: boolean }>) {
  const reads: number[] = [];
  return {
    reads,
    source: { listUsers: () => users, repositoryFor: (u: { id: number }) => ({
      youtubeChannelTotals: () => [row(id, 1)],
      lastWatchImportAt: () => { reads.push(u.id); return imports[u.id] ?? null; },
    }) },
  };
}

test('only public members count toward the band, and the 7-day window compares UTC days', async () => {
  const users = [1, 2, 3, 4, 5].map(id => ({ id, dashboardPublic: id !== 5 }));
  const imports: Record<number, string | null> = {
    1: '2026-11-06T00:00:00.000Z', // the UTC day seven days before now: counts
    2: '2026-11-05T23:59:59.999Z', // the day before: does not
    3: '2026-11-06', // a durable copy keeps the day only
    4: null, // nothing imported yet
    5: '2026-11-13T11:00:00.000Z', // private: never read, never counted
  };
  const { source, reads } = freshnessSource(imports, users);
  const stats = await communityStatsProvider(source, () => freshNow)();
  assert.equal(stats.publicMembers, 4);
  assert.equal(stats.recentImports, 'about-half', '2 of 4 public members');
  assert.ok(!reads.includes(5), 'a private member’s archive is not read');
  // Nothing but the band leaves the provider.
  assert.deepEqual(Object.keys(stats).filter(key => /import/i.test(key)), ['recentImports']);
  assert.doesNotMatch(JSON.stringify(stats), /2026-11-0[56]/);
  imports[4] = 'garbage';
  assert.equal((await communityStatsProvider(source, () => freshNow)()).recentImports, 'about-half', 'an unparseable time is not recent');
});

test('fewer than three public members show no band; going private applies on the next request', async () => {
  const users = [1, 2, 3].map(id => ({ id, dashboardPublic: true }));
  const recent = '2026-11-12T00:00:00.000Z';
  const { source, reads } = freshnessSource({ 1: recent, 2: recent, 3: null }, users);
  const provider = communityStatsProvider(source, () => freshNow);
  assert.equal((await provider()).recentImports, 'about-half');
  users[2].dashboardPublic = false;
  const after = await provider();
  assert.equal(after.publicMembers, 2);
  assert.equal(after.recentImports, 'too-few-members');
  const zh = landingContent('zh', '', after, freshNow);
  assert.match(zh, /近 7 天有新匯入：<strong>成員太少，不顯示<\/strong>/);
  assert.doesNotMatch(zh, /半數/);
  assert.match(landingContent('en', '', after, freshNow), /New imports in the last 7 days: <strong>too few members to show<\/strong>/);
  // Private member 3 was read only while public.
  assert.equal(reads.filter(user => user === 3).length, 1);
  users[0].dashboardPublic = false;
  users[1].dashboardPublic = false;
  const none = await provider();
  assert.equal(none.recentImports, 'too-few-members');
});

test('the band is cached under the membership key and recomputed when membership changes', async () => {
  const users = [1, 2, 3, 4].map(id => ({ id, dashboardPublic: true, handle: `m${id}`, displayName: `M${id}` }));
  const imports: Record<number, string | null> = { 1: '2026-11-13T00:00:00Z', 2: null, 3: null, 4: null };
  const { source, reads } = freshnessSource(imports, users);
  let now = freshNow;
  const provider = communityStatsProvider(source, () => now);
  const first = await provider();
  assert.equal(first.recentImports, 'about-quarter');
  assert.equal(reads.length, 4);
  // Same members within the cache lifetime: the cached result, no new reads.
  imports[2] = imports[3] = imports[4] = '2026-11-13T00:00:00Z';
  assert.equal(await provider(), first);
  assert.equal(reads.length, 4);
  // A membership change is a new key: recomputed at once, without the private member.
  users[0].dashboardPublic = false;
  const changed = await provider();
  assert.equal(changed.recentImports, 'most', '3 of 3 remaining public members');
  assert.deepEqual(reads.slice(4).sort(), [2, 3, 4]);
  // A rename changes the public profile projection, and so the key, too.
  users[1].displayName = 'Renamed';
  await provider();
  assert.equal(reads.length, 10);
  // After the cache lifetime the same members are read again.
  now += 300_001;
  await provider();
  assert.equal(reads.length, 13);
});

test('an unreadable last import hides only the band', async () => {
  const users = [1, 2, 3].map(id => ({ id, dashboardPublic: true }));
  const provider = communityStatsProvider({ listUsers: () => users, repositoryFor: u => ({
    youtubeChannelTotals: () => [row(id, 1)],
    lastWatchImportAt: () => { if (u.id === 2) throw new Error('unavailable'); return '2026-11-13'; },
  }) }, () => freshNow);
  const stats = await provider();
  assert.equal(stats.status, 'ready');
  assert.equal(stats.recentImports, undefined);
  assert.equal(stats.topChannels[0].id, id);
  const page = landingContent('zh', '', stats, freshNow);
  assert.doesNotMatch(page, /近 7 天有新匯入/);
  assert.match(page, /不代表各成員最後匯入時間/);
});

test('the landing page shows the band beside the calculation time in both languages', () => {
  const base = { status: 'ready' as const, generatedAt: new Date(freshNow).toISOString(), publicMembers: 4, activeMembers: 4, watches: 0, channels: 0, topChannels: [] };
  const labels: Record<string, [RegExp, RegExp]> = {
    none: [/沒有公開成員/, /no public members/],
    few: [/少數公開成員（未滿 1\/4）/, /a few public members \(under a quarter\)/],
    'about-quarter': [/約四分之一公開成員/, /about a quarter of public members/],
    'about-half': [/約半數公開成員/, /about half of public members/],
    most: [/多數公開成員（3\/4 以上）/, /most public members \(three quarters or more\)/],
  };
  for (const [band, [zh, en]] of Object.entries(labels)) {
    const stats = { ...base, recentImports: band as never };
    const zhPage = landingContent('zh', '', stats, freshNow);
    assert.match(zhPage, /<p class="lp-updated">統計計算於 .*?不代表各成員最後匯入時間。<\/p><p class="lp-updated lp-recent-imports"[^>]*>近 7 天有新匯入：<strong>/);
    assert.match(zhPage, zh);
    assert.match(zhPage, /只顯示分級，不顯示人數或任何成員的匯入時間/);
    const enPage = landingContent('en', '', stats, freshNow);
    assert.match(enPage, /This is not each member’s last import time\.<\/p><p class="lp-updated lp-recent-imports"[^>]*>New imports in the last 7 days: <strong>/);
    assert.match(enPage, en);
  }
  // Unavailable statistics show neither the time nor a band.
  assert.doesNotMatch(landingContent('zh', '', { ...base, status: 'unavailable', recentImports: 'most' }, freshNow), /近 7 天有新匯入/);
});

test('the last watch import time moves only when new watch records are written', () => {
  const repository = new Repository(':memory:');
  try {
    assert.equal(repository.youtubeLastWatchImportAt(), null);
    const watch = (eventId: string, videoId: string, watchedAt: string) => ({
      eventId, videoId, title: 'Synthetic', url: `https://www.youtube.com/watch?v=${videoId}`, channelId: id, channelTitle: 'Synthetic channel',
      channelUrl: '', watchedAt, actualWatchedSeconds: null, activityType: 'video' as const,
    });
    const archive = (hash: string, watches: ReturnType<typeof watch>[]): YoutubeParsedArchive => ({ archiveHash: hash, source: 'takeout', searches: [], watches });
    const first = archive('fresh-1', [watch('e1', 'AAAAAAAAAA1', '2026-01-01T00:00:00Z')]);
    repository.ingestYoutubeArchive(first, '2026-11-01T00:00:00.000Z');
    assert.equal(repository.youtubeLastWatchImportAt(), '2026-11-01T00:00:00.000Z');
    // Re-importing the same records later writes nothing new.
    repository.ingestYoutubeArchive({ ...first, archiveHash: 'fresh-2' }, '2026-11-12T00:00:00.000Z');
    assert.equal(repository.youtubeLastWatchImportAt(), '2026-11-01T00:00:00.000Z');
    // Old viewing imported now is a new import: the write time counts, not the watch time.
    repository.ingestYoutubeArchive(archive('fresh-3', [watch('e2', 'AAAAAAAAAA2', '2020-01-01T00:00:00Z')]), '2026-11-12T00:00:00.000Z');
    assert.equal(repository.youtubeLastWatchImportAt(), '2026-11-12T00:00:00.000Z');
  } finally { repository.close(); }
});

test('the production landing page computes the band from public archives only', async () => {
  const { createApp } = await import('../src/index.js');
  const { UserRegistry } = await import('../src/users.js');
  const { clearReadCaches } = await import('../src/data/read-cache.js');
  clearReadCaches();
  const registry = new UserRegistry(':memory:');
  try {
    const members = ['fresh-a', 'fresh-b', 'fresh-c', 'fresh-d'].map(handle => registry.createUser(handle, handle));
    for (const user of members) registry.setDashboardPublic(user.handle, true);
    registry.setDashboardPublic('fresh-d', false);
    const recent = new Date().toISOString();
    // A recent import by one public member and by the private member.
    for (const user of [members[0], members[3]]) {
      registry.repositoryFor(user).ingestYoutubeArchive({ archiveHash: `fresh-${user.id}`, source: 'takeout', searches: [], watches: [{
        eventId: `fresh-${user.id}`, videoId: 'AAAAAAAAAA1', title: 'Synthetic', url: 'https://www.youtube.com/watch?v=AAAAAAAAAA1',
        channelId: id, channelTitle: 'Synthetic channel', channelUrl: '', watchedAt: recent, actualWatchedSeconds: 60, activityType: 'video',
      }] }, recent);
    }
    const app = createApp(registry);
    const page = await (await app.request('/?lang=en')).text();
    assert.match(page, /data-band="about-quarter"/, '1 of 3 public members');
    registry.setDashboardPublic('fresh-c', false);
    const fewer = await (await app.request('/?lang=zh')).text();
    assert.match(fewer, /data-band="too-few-members"/);
    assert.match(fewer, /成員太少，不顯示/);
  } finally { registry.close(); }
});
