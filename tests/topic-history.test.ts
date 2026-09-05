import assert from 'node:assert/strict';
import test from 'node:test';
import { Repository } from '../src/data/database.js';
import { buildTopicTrendModel, topicTrendSection } from '../src/output/topic-trend.js';
import { youtubeDashboardPage } from '../src/output/youtube.js';
import { messages } from '../src/output/i18n.js';
import { load } from 'cheerio';

test('topic history includes dated backfills, preserves estimates and explains empty periods', () => {
  const repository = new Repository(':memory:');
  const now = new Date('2026-09-06T04:00:00Z');
  const watch = (id: string, at: string, precision: 'day' | 'exact', seconds: number | null) => ({
    eventId: id, videoId: id, title: 'Synthetic', url: `https://www.youtube.com/watch?v=${id}`,
    channelId: null, channelTitle: 'Synthetic', channelUrl: null, watchedAt: at,
    actualWatchedSeconds: seconds, activityType: 'video' as const, precision,
  });
  const archive = { archiveHash: 'topic-history', source: 'history-page' as const, searches: [], watches: [
    watch('SYNTHETIC01', '2018-11-20T04:00:00Z', 'day', null),
    watch('SYNTHETIC02', '2018-11-21T04:00:00Z', 'exact', 300),
    watch('SYNTHETIC03', '2025-09-10T04:00:00Z', 'day', null),
    watch('SYNTHETIC04', '2025-10-10T04:00:00Z', 'day', null),
    watch('SYNTHETIC05', '2025-11-10T04:00:00Z', 'exact', 0),
  ] };
  try {
    repository.ingestYoutubeArchive({ ...archive, archiveHash: 'day-only', watches: archive.watches.slice(0, 1) });
    assert.equal(repository.youtubeTopicTrend('all', now)[0].month, '2018-11-19');
    repository.ingestYoutubeArchive(archive);
    repository.ingestYoutubeArchive(archive);
    repository.upsertYoutubeVideoMetadata(archive.watches.map(w => ({
      videoId: w.videoId, title: 'Synthetic', channelId: null, channelTitle: 'Synthetic',
      description: '', tags: [], thumbnailUrl: '', durationSeconds: 7200,
      publishedAt: null, categoryId: null, availability: 'available' as const, metadataHash: w.videoId,
    })));
    const [alpha, beta] = repository.replaceYoutubeTaxonomy([
      { version: 1, slug: 'alpha', name: 'Alpha', description: 'Synthetic' },
      { version: 1, slug: 'beta', name: 'Beta', description: 'Synthetic' },
    ]);
    for (const w of archive.watches.filter(w => w.videoId !== 'SYNTHETIC04')) {
      repository.saveYoutubeVideoTopics(w.videoId, [{ topicId: w.videoId === 'SYNTHETIC02' ? beta.id : alpha.id, rank: 1, confidence: 1 }], 'test', 'test', w.videoId);
    }
    const data = repository.youtubeDashboard('all', now);
    const first = data.topicTrend[0];
    assert.equal(first.month, '2018-11-19');
    assert.equal(first.classifiedWatchEvents, 2);
    assert.equal(first.classifiedWatchSeconds, 900);
    assert.equal(first.topics.find(t => t.slug === 'alpha')?.share, 2 / 3);
    assert.equal(data.rhythmCoverage.exactWatches, 2);
    const year = repository.youtubeDashboard('365d', now);
    assert.equal(year.topicTrend[0].month, '2025-09-01');
    assert.equal(year.topicTrend[0].periodStart, '2025-09-06');
    assert.equal(year.topicTrend[1].classifiedWatchSeconds, 600);
    const model = buildTopicTrendModel(year.topicTrend, messages('zh'));
    assert.match(model.frames[0].label, /部分期間/);
    assert.match(model.frames.at(-1)!.label, /部分期間/);
    assert.equal(model.frames.find(frame => frame.month === '2025-10-06')!.empty, '本期尚無可用分類');
    assert.equal(model.frames.find(frame => frame.month === '2025-11-10')!.empty, '缺少可估算的觀看時間');
    assert.equal(model.frames[3].empty, '本期沒有觀看紀錄');
    for (const page of ['overview', 'insights'] as const) {
      const $ = load(youtubeDashboardPage('Synthetic', year, 'duration', { lang: 'zh', page }));
      const race = JSON.parse($('[data-rank-race="topics"] [data-chase-data]').text());
      assert.equal(race.frames[1].entries[0][1], 1);
      assert.equal(race.frames[1].empty, model.frames[1].empty);
      assert.match(race.frames[0].note, /部分期間/);
    }
    const emptyData = { ...year, topicTrend: year.topicTrend.map(period => ({
      ...period, watchEvents: 0, classifiableWatchEvents: 0, classifiedWatchEvents: 0,
      classifiedWatchSeconds: 0, topics: [],
    })) };
    const emptyDetails = load(topicTrendSection(emptyData, messages('zh')));
    assert.equal(emptyDetails('[data-race-empty]').text(), '本期沒有觀看紀錄');
    assert.equal(emptyDetails('[data-race-range]').attr('max'), String(year.topicTrend.length - 1));
    const detail = topicTrendSection(year, messages('zh'));
    assert.match(detail, /本期沒有觀看紀錄/);
    for (const script of detail.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => Function(script[1]));
    // Exact imports replace same-video/day placeholders rather than double-counting.
    repository.ingestYoutubeArchive({ ...archive, archiveHash: 'exact-replacement', source: 'takeout', watches: [watch('SYNTHETIC03', '2025-09-10T06:00:00Z', 'exact', 120)] });
    const september = repository.youtubeTopicTrend('365d', now)[1];
    assert.equal(september.classifiedWatchEvents, 1);
    assert.equal(september.classifiedWatchSeconds, 120);
  } finally { repository.close(); }
});
