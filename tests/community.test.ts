import assert from 'node:assert/strict';
import test from 'node:test';
import { communityStatsProvider } from '../src/youtube/community.js';
import { landingContent } from '../src/output/landing.js';
const id = 'UC' + 'a'.repeat(22);
const otherId = 'UC' + 'b'.repeat(22);
const row = (channelId: string | null, watches: number, name = 'Channel') => ({ channelId, watches, name, estimatedWatchSeconds: watches * 60, thumbnailUrl: '' });

test('public-only aggregates deduplicate members and revoke visibility without waiting for cache TTL', async () => {
  const users = [{ id: 1, dashboardPublic: true }, { id: 2, dashboardPublic: true }, { id: 3, dashboardPublic: false }];
  const read: number[] = [];
  const provider = communityStatsProvider({ listUsers: () => users, repositoryFor: (u) => {
    read.push(u.id);
    assert.notEqual(u.id, 3);
    return { youtubeChannelTotals: (range, now) => {
      assert.equal(range, '90d');
      assert.equal(now.toISOString(), '2026-09-05T00:00:00.000Z');
      return u.id === 1 ? [row(id, 2), row(id, 3), row(null, 4)] : [row(id, 1), row(otherId, 100)];
    } };
  } }, () => Date.parse('2026-09-05T00:00:00Z'));
  const stats = await provider();
  assert.equal(stats.publicMembers, 2);
  assert.equal(stats.activeMembers, 2);
  assert.equal(stats.watches, 110);
  assert.equal(stats.channels, 2);
  assert.equal(stats.estimatedWatchSeconds, 110 * 60);
  assert.equal(stats.topWatchedChannels?.[0].id, otherId);
  assert.deepEqual(stats.topChannels.map(x => [x.id, x.members]), [[id, 2], [otherId, 1]]);
  assert.equal((await provider()), stats);
  assert.deepEqual(read, [1, 2]);
  users[0].dashboardPublic = false;
  const after = await provider();
  assert.equal(after.publicMembers, 1);
  assert.equal(after.watches, 101);
  assert.equal(after.estimatedWatchSeconds, 101 * 60);
  assert.equal(after.topWatchedChannels?.find(x => x.id === id)?.members, 1);
  assert.equal(after.topChannels[0].id, otherId);
  users.splice(1, 1);
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
  const provider = communityStatsProvider({ listUsers: () => [{ id: 1, dashboardPublic: true }], repositoryFor: () => ({ youtubeChannelTotals: () => [row(id, 1, '<script>alert(1)</script>')] }) });
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
  const member = { id: 1, dashboardPublic: true };
  const provider = communityStatsProvider({ listUsers: () => [member], repositoryFor: () => ({ youtubeChannelTotals: () => [
    { ...row(id, 2), estimatedWatchSeconds: 7200 },
    { ...row(otherId, 100), estimatedWatchSeconds: 600 },
  ] }) });
  const value = await provider();
  assert.equal(value.topDurationChannels?.[0].id, id);
  assert.equal(value.topWatchedChannels?.[0].id, otherId);
  assert.equal(value.topDurationChannels?.[0].estimatedWatchSeconds, 7200);
  member.dashboardPublic = false;
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
    for (const name of ['dashboard.png', 'channel.png', 'matching.png']) {
      assert.ok(page.includes(`/landing-assets/${name}`));
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


test('product screenshots navigate to actual pages instead of image files', () => {
 const data = { status: 'ready' as const, generatedAt: new Date().toISOString(), publicMembers: 0, activeMembers: 0, watches: 0, channels: 0, topChannels: [] };
 const page = landingContent('zh', '', data);
 assert.ok(page.includes('href="/skyhong.tw"'));
 assert.ok(page.includes('href="/channel/UCRIgIJQWuBJ0Cv_VlU3USNA?range=90d"'));
 assert.ok(page.includes('href="/matches"'));
 assert.ok(!page.includes('href="/landing-assets/'));
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
