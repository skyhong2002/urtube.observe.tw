import assert from 'node:assert/strict';
import test from 'node:test';
import { communityStatsProvider } from '../src/youtube/community.js';
import { landingContent } from '../src/output/landing.js';
const id = 'UC' + 'a'.repeat(22);
const otherId = 'UC' + 'b'.repeat(22);
const row = (channelId: string | null, watches: number, name = 'Channel') => ({ channelId, watches, name, estimatedWatchSeconds: watches * 60, thumbnailUrl: '' });

test('public-only aggregates deduplicate members and revoke visibility without waiting for cache TTL', () => {
  const users = [{ id: 1, dashboardPublic: true }, { id: 2, dashboardPublic: true }, { id: 3, dashboardPublic: false }];
  const read: number[] = [];
  const provider = communityStatsProvider({ listUsers: () => users, repositoryFor: (u) => {
    read.push(u.id);
    assert.notEqual(u.id, 3);
    return { youtubeChannelTotals: (range, now) => {
      assert.equal(range, '28d');
      assert.equal(now.toISOString(), '2026-09-05T00:00:00.000Z');
      return u.id === 1 ? [row(id, 2), row(id, 3), row(null, 4)] : [row(id, 1), row(otherId, 100)];
    } };
  } }, () => Date.parse('2026-09-05T00:00:00Z'));
  const stats = provider();
  assert.equal(stats.publicMembers, 2);
  assert.equal(stats.activeMembers, 2);
  assert.equal(stats.watches, 110);
  assert.equal(stats.channels, 2);
  assert.equal(stats.estimatedWatchSeconds, 110 * 60);
  assert.equal(stats.topWatchedChannels?.[0].id, otherId);
  assert.deepEqual(stats.topChannels.map(x => [x.id, x.members]), [[id, 2], [otherId, 1]]);
  assert.equal(provider(), stats);
  assert.deepEqual(read, [1, 2]);
  users[0].dashboardPublic = false;
  const after = provider();
  assert.equal(after.publicMembers, 1);
  assert.equal(after.watches, 101);
  assert.equal(after.estimatedWatchSeconds, 101 * 60);
  assert.equal(after.topWatchedChannels?.find(x => x.id === id)?.members, 1);
  assert.equal(after.topChannels[0].id, otherId);
  users.splice(1, 1);
  assert.equal(provider().publicMembers, 0);
  assert.deepEqual(provider().topChannels, []);
});

test('failed queries hide partial totals and do not serve stale data', () => {
  let fail = false;
  let now = 0;
  const provider = communityStatsProvider({ listUsers: () => [{ id: 1, dashboardPublic: true }], repositoryFor: () => ({ youtubeChannelTotals: () => { if (fail) throw new Error('unavailable'); return [row(id, 1)]; } }) }, () => now);
  assert.equal(provider().status, 'ready');
  fail = true; now = 300001;
  assert.deepEqual(provider().topChannels, []);
  assert.equal(provider().status, 'unavailable');
  fail = false;
  assert.equal(provider().status, 'ready');
});

test('channel names are escaped and empty/unavailable states do not invent metrics', () => {
  const provider = communityStatsProvider({ listUsers: () => [{ id: 1, dashboardPublic: true }], repositoryFor: () => ({ youtubeChannelTotals: () => [row(id, 1, '<script>alert(1)</script>')] }) });
  const stats = provider();
  const page = landingContent('zh', '', stats);
  assert.ok(page.includes('&lt;script&gt;'));
  assert.ok(!page.includes('<script>alert'));
  assert.ok(page.includes('近 28 天觀看紀錄'));
  assert.ok(landingContent('en', '', stats).includes('Public members'));
  const unavailable = landingContent('zh', '', { ...stats, status: 'unavailable' });
  assert.ok(unavailable.includes('社群統計暫時無法載入'));
  assert.ok(!unavailable.includes('class="lp-stat"'));
});
