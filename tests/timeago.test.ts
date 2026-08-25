import assert from 'node:assert/strict';
import test from 'node:test';
import { timeAgo } from '../src/output/pages.js';

test('timeAgo tiers: minutes, hours, days, weeks, then calendar dates', () => {
  const now = Date.parse('2026-08-26T12:00:00Z');
  assert.equal(timeAgo('2026-08-26T11:59:40Z', 'zh', now), '1 分鐘前');
  assert.equal(timeAgo('2026-08-26T11:30:00Z', 'zh', now), '30 分鐘前');
  assert.equal(timeAgo('2026-08-26T05:00:00Z', 'zh', now), '7 小時前');
  assert.equal(timeAgo('2026-08-23T12:00:00Z', 'zh', now), '3 天前');
  assert.equal(timeAgo('2026-08-10T12:00:00Z', 'zh', now), '2 週前');
  // Over a month: same year drops the year, older years keep it.
  assert.equal(timeAgo('2026-07-20T12:00:00Z', 'zh', now), '7月20日');
  assert.equal(timeAgo('2026-07-20T12:00:00Z', 'en', now), 'Jul 20');
  assert.equal(timeAgo('2024-11-05T12:00:00Z', 'zh', now), '2024年11月5日');
  assert.equal(timeAgo('2024-11-05T12:00:00Z', 'en', now), 'Nov 5, 2024');
  // Dates are Taipei-local: 17:00Z on Dec 31 is already Jan 1 in Taipei.
  assert.equal(timeAgo('2025-12-31T17:00:00Z', 'zh', now), '1月1日');
  assert.equal(timeAgo('not-a-date', 'zh', now), '');
});
