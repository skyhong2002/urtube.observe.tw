import assert from 'node:assert/strict';
import test from 'node:test';
import { communityStatsProvider, MIN_RANKED_MEMBERS } from '../src/youtube/community.js';
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
    return { youtubeChannelTotals: (range, now) => {
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
  const provider = communityStatsProvider({ listUsers: () => [{ id: 1, dashboardPublic: true }], repositoryFor: () => ({ youtubeChannelTotals: () => { if (fail) throw new Error('unavailable'); return [row(id, 1)]; } }) }, () => now);
  assert.equal((await provider()).status, 'ready');
  fail = true; now = 300001;
  assert.deepEqual((await provider()).topChannels, []);
  assert.equal((await provider()).status, 'unavailable');
  fail = false;
  assert.equal((await provider()).status, 'ready');
});

test('channel names are escaped and empty/unavailable states do not invent metrics', async () => {
  const provider = communityStatsProvider({ listUsers: () => [1, 2, 3].map(id => ({ id, dashboardPublic: true })), repositoryFor: () => ({ youtubeChannelTotals: () => [row(id, 1, '<script>alert(1)</script>')] }) });
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
  const provider = communityStatsProvider({ listUsers: () => members, repositoryFor: () => ({ youtubeChannelTotals: () => [
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

test('landing and allowlisted screenshots are served through the production app', async () => {
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
    // The hero sample is translated HTML; only the tour uses screenshots.
    assert.ok(!page.includes('/landing-assets/dashboard.png'));
    for (const name of ['dashboard.png', 'channel.png', 'matching.png']) {
      if (name !== 'dashboard.png') assert.ok(page.includes(`/landing-assets/${name}`));
      const image = await app.request(`/landing-assets/${name}`);
      assert.equal(image.status, 200);
      assert.equal(image.headers.get('content-type'), 'image/png');
      assert.deepEqual([...new Uint8Array(await image.arrayBuffer()).slice(0, 8)], [137,80,78,71,13,10,26,10]);
    }
    assert.equal((await app.request('/landing-assets/.env')).status, 404);
    assert.equal((await app.request('/landing-assets/missing.png')).status, 404);
  } finally { registry.close(); }
});


test('public profile projection reflects renames and revokes private identities', async () => {
  const users = [
    { id: 1, dashboardPublic: true, handle: 'alice', displayName: 'Alice' },
    { id: 2, dashboardPublic: false, handle: 'private-user', displayName: 'Private Person' },
  ];
  const provider = communityStatsProvider({ listUsers: () => users, repositoryFor: () => ({ youtubeChannelTotals: () => [] }) });
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
 assert.ok(anonymous.includes('href="/matches"'));
 assert.ok(!anonymous.includes('href="/landing-assets/'));
 const closed = landingContent('en', '', data);
 assert.ok(!closed.includes('href="/channel/'), 'signups closed is still anonymous');
 const signedIn = landingContent('zh', '<a class="lp-primary" href="/alex">x</a>', data);
 assert.ok(signedIn.includes('href="/channel/UCRIgIJQWuBJ0Cv_VlU3USNA?range=90d"'));
});

test('a slow refresh never holds the landing request and still enforces current visibility', async () => {
  const users = [{ id: 1, dashboardPublic: true, handle: 'alice', displayName: 'Alice' }, { id: 2, dashboardPublic: true, handle: 'bob', displayName: 'Bob' }];
  let now = 0;
  let calls = 0;
  let release!: () => void;
  const provider = communityStatsProvider({ listUsers: () => users, repositoryFor: (u) => ({ youtubeChannelTotals: () => {
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
  const provider = communityStatsProvider({ listUsers: () => users, repositoryFor: u => ({ youtubeChannelTotals: () => rows[u.id] }) });
  const stats = await provider();
  for (const shelf of [stats.topChannels, stats.topWatchedChannels ?? [], stats.topDurationChannels ?? []]) {
    assert.deepEqual(shelf.map(x => [x.id, x.members]), [[id, 4]]);
  }
  assert.equal(stats.channels, 3);
  assert.equal(stats.watches, 604);
  users[2].dashboardPublic = false; users[3].dashboardPublic = false;
  assert.deepEqual((await provider()).topChannels, []);
});
