import assert from 'node:assert/strict';
import test from 'node:test';
import { timelineWindow, timelineBounds } from '../src/youtube/timeline.js';
import { buildChannelRace, Repository } from '../src/data/database.js';
import { youtubeDashboardPage } from '../src/output/youtube.js';
import { load } from 'cheerio';

test('timeline buckets retain Taiwan boundaries across years and do not skip quiet weeks', () => {
  const now = new Date('2026-01-05T17:00:00Z');
  for (const range of ['7d', '28d', '90d', '365d', 'all'] as const) {
    const window = timelineWindow(range, now, '2023-05-03T02:00:00Z');
    assert.equal(timelineBounds(window, window.periods.at(-1)!).end, '2026-01-06');
    assert.equal(window.weekly, !['7d', '28d'].includes(range));
    for (let i = 1; i < window.periods.length; i++) {
      assert.equal(Date.parse(window.periods[i]) - Date.parse(window.periods[i - 1]), (window.weekly ? 7 : 1) * 86400000);
    }
  }
  const window = timelineWindow('7d', now, null);
  assert.equal(timelineBounds(window, window.periods[0]).start, '2025-12-30');
  const race = buildChannelRace([
    { week: '2025-12-23', name: 'Earlier channel', channelId: 'earlier', thumbnailUrl: '', estimatedWatchSeconds: 3600 },
  ], 7, window);
  assert.deepEqual(race.frames.map(f => f.period), window.periods);
  assert.equal(race.frames[0].entries[0][1], 1800, 'earlier history still feeds half-life decay');
  assert.equal(race.frames.at(-1)!.entries[0][1], 900);
});

test('both overview timelines follow selected ranges even with no watches', () => {
  const repository = new Repository(':memory:');
  try {
    for (const range of ['7d', '28d', '90d', '365d', 'all'] as const) {
      const now = new Date('2026-09-06T04:00:00Z');
      const data = repository.youtubeDashboard(range, now);
      assert.deepEqual(data.channelRace.frames.map(f => f.period), data.topicTrend.map(f => f.month));
      const $ = load(youtubeDashboardPage('Synthetic', data, 'duration', { lang: 'zh', page: 'overview' }));
      const timelines = $('.yt-chase-timeline');
      assert.equal(timelines.length, 2);
      assert.equal(timelines.eq(0).text(), timelines.eq(1).text());
      assert.match(timelines.eq(0).text(), /2026-09-06/);
      assert.match(timelines.eq(0).text(), ['7d', '28d'].includes(range) ? /每日/ : /每週/);
    }
  } finally { repository.close(); }
});
