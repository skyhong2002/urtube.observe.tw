import assert from 'node:assert/strict';
import test from 'node:test';
import { messages } from '../src/output/i18n.js';
import { buildTopicTrendModel, topicTrendSection } from '../src/output/topic-trend.js';
import type { YoutubeDashboardData, YoutubeTopicTrendMonth } from '../src/youtube/types.js';

function trendFixture(): YoutubeTopicTrendMonth[] {
  return Array.from({ length: 12 }, (_, monthIndex) => ({
    month: `2025-${String(monthIndex + 1).padStart(2, '0')}`,
    classifiableWatchEvents: 100,
    processedWatchEvents: 100,
    classifiedWatchEvents: monthIndex === 9 ? 50 : 100,
    unknownWatchEvents: monthIndex === 9 ? 50 : 0,
    classificationCoverage: monthIndex === 9 ? 0.5 : 1,
    processedCoverage: 1,
    unknownShare: monthIndex === 9 ? 0.5 : 0,
    classifiedWatchSeconds: 10_000,
    topics: Array.from({ length: 20 }, (_, topicIndex) => ({
      slug: `topic-${topicIndex + 1}`,
      name: `Topic ${String(topicIndex + 1).padStart(2, '0')}`,
      estimatedWatchSeconds: (topicIndex + 1) * 60,
      share: (topicIndex + 1) / 100,
      movingAverageShare: (topicIndex + 1) / 100,
    })),
  }));
}

test('topic trend views share one 12-month, 20-topic model', () => {
  const t = messages('en');
  const months = trendFixture();
  const model = buildTopicTrendModel(months, t);
  assert.equal(model.frames.length, 12);
  assert.equal(model.topics.length, 20);
  assert.equal(model.frames[11].values.find((value) => value.slug === 'topic-20')?.share, 0.2);
  assert.equal(model.frames[9].provisional, true);

  const output = topicTrendSection({ topicTrend: months } as YoutubeDashboardData, t);
  assert.match(output, /Monthly rank/);
  assert.match(output, /All topics/);
  assert.match(output, /Other/);
  assert.match(output, /Select up to 3 topics to compare/);
  assert.match(output, /follows the page range/);
  assert.match(output, /data-trend-smoothing="raw"/);
  assert.match(output, /data-trend-smoothing="smoothed"/);
  assert.match(output, /rawShare/);
  assert.match(output, /smoothedShare/);
  assert.match(output, /cell\.setAttribute\('aria-label',detail\)/);
  assert.match(output, /data-trend-summary/);
  assert.match(output, /data-trend-table-body/);
  assert.match(output, /current taxonomy/);
  assert.match(output, /prefers-reduced-motion:reduce/);
  assert.match(output, /play\.hidden=true;play\.disabled=true/);
  assert.match(output, /data-race-previous/);
  assert.match(output, /data-race-next/);
  assert.match(output, /data-race-range/);
  assert.equal(output.match(/class="yt-trend-heat-row" data-topic-row/g)?.length, 20);
  assert.equal(output.match(/<button type="button" class="yt-trend-heat-cell/g)?.length, 240);
  assert.ok((output.match(/20\.0%/g)?.length ?? 0) >= 4);
  assert.match(output, /50% classified · provisional/);
});

test('months without classified time stay unknown instead of becoming zero', () => {
  const months = trendFixture();
  months[4] = { ...months[4], classifiedWatchEvents: 0, classificationCoverage: 0, classifiedWatchSeconds: 0 };
  const model = buildTopicTrendModel(months, messages('en'));
  assert.equal(model.frames[4].values[0].share, null);

  const output = topicTrendSection({ topicTrend: months } as YoutubeDashboardData, messages('en'));
  assert.match(output, /not enough classified data/);
  assert.doesNotMatch(output, /Topic 01 · May 2025 · 0\.0%/);
});
