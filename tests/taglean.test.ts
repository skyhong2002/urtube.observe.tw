import assert from 'node:assert/strict';
import test from 'node:test';
import { Repository } from '../src/data/database.js';
import { tagLeanPage } from '../src/output/taglean.js';
import { normalizeYoutubeCapture } from '../src/youtube/capture.js';
import { computeTagLean, type TagLists } from '../src/youtube/taglists.js';
import type { YoutubeChannelSummary } from '../src/youtube/types.js';

function lists(partial: Partial<Record<keyof TagLists, string[]>>): TagLists {
  const empty = () => new Set<string>();
  return {
    news: new Set(partial.news ?? []),
    editorial: new Set(partial.editorial ?? []),
    editorialShows: new Set(partial.editorialShows ?? []),
    blue: new Set(partial.blue ?? []),
    green: new Set(partial.green ?? []),
    white: new Set(partial.white ?? []),
    red: partial.red ? new Set(partial.red) : empty(),
  };
}

function channel(
  channelId: string | null, name: string, watches: number, seconds: number,
): YoutubeChannelSummary {
  return { channelId, name, thumbnailUrl: '', watches, estimatedWatchSeconds: seconds };
}

test('computeTagLean splits watch time per tag group and tracks coverage', () => {
  const channels = [
    channel('UCgreen-news', 'Green News', 10, 3600),
    channel('UCblue-talk', 'Blue Talkshow', 4, 1800),
    channel('UCneutral', 'Cooking', 20, 5400),
    channel(null, 'Unknown channel', 3, 600),
  ];
  const data = computeTagLean('28d', channels, lists({
    news: ['UCgreen-news'],
    editorial: ['UCblue-talk'],
    editorialShows: [],
    green: ['UCgreen-news'],
    blue: ['UCblue-talk'],
  }));
  assert.equal(data.totals.estimatedWatchSeconds, 11400);
  assert.equal(data.totals.watches, 37);
  assert.equal(data.matched.estimatedWatchSeconds, 5400);
  assert.equal(data.matched.channels, 2);
  const green = data.political.find((group) => group.key === 'green')!;
  assert.equal(green.estimatedWatchSeconds, 3600);
  assert.equal(green.watches, 10);
  assert.equal(green.topChannels[0].name, 'Green News');
  const blue = data.political.find((group) => group.key === 'blue')!;
  assert.equal(blue.estimatedWatchSeconds, 1800);
  const news = data.content.find((group) => group.key === 'news')!;
  assert.equal(news.watchedChannels, 1);
  const shows = data.content.find((group) => group.key === 'editorialShows')!;
  assert.equal(shows.estimatedWatchSeconds, 0);
  assert.equal(shows.topChannels.length, 0);
});

test('youtubeChannelTotals returns every watched channel, uncut and range-filtered', () => {
  const repository = new Repository(':memory:');
  const now = new Date('2026-07-28T12:30:00Z');
  try {
    const captures = [
      { videoId: 'dQw4w9WgXcQ', channel: 'Channel One', channelId: 'UCchannel-one', seconds: 120, watchedAt: '2026-07-28T12:00:00Z', sessionId: '12345678-1234-4123-8123-123456789abc' },
      { videoId: 'abcdefghijk', channel: 'Channel Two', channelId: 'UCchannel-two', seconds: 60, watchedAt: '2026-07-01T12:00:00Z', sessionId: '22345678-1234-4123-8123-123456789abc' },
    ];
    for (const { videoId, channel: channelTitle, channelId, seconds, watchedAt, sessionId } of captures) {
      repository.upsertYoutubeCapture(normalizeYoutubeCapture({
        sessionId,
        videoId,
        title: `Video ${videoId}`,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        channelTitle,
        watchedAt,
        actualWatchedSeconds: seconds,
        durationSeconds: 600,
      }, new Date(watchedAt)), watchedAt);
      repository.upsertYoutubeVideoMetadata([{
        videoId, title: `Video ${videoId}`, channelId, channelTitle,
        description: '', tags: [], thumbnailUrl: '', durationSeconds: 600,
        publishedAt: null, categoryId: null, availability: 'available',
        metadataHash: `hash-${videoId}`,
      }]);
    }
    const all = repository.youtubeChannelTotals('all', now);
    assert.equal(all.length, 2);
    assert.deepEqual(
      all.map((row) => [row.channelId, row.watches, row.estimatedWatchSeconds]),
      [['UCchannel-one', 1, 120], ['UCchannel-two', 1, 60]],
    );
    const recent = repository.youtubeChannelTotals('7d', now);
    assert.equal(recent.length, 1);
    assert.equal(recent[0].channelId, 'UCchannel-one');
  } finally {
    repository.close();
  }
});

test('tagLeanPage renders shares, camps, and the table view in both languages', () => {
  const data = computeTagLean('28d', [
    channel('UCgreen-news', '綠媒新聞', 10, 3600),
    channel('UCblue-talk', '藍營談話', 5, 1800),
  ], lists({
    news: ['UCgreen-news'],
    green: ['UCgreen-news'],
    blue: ['UCblue-talk'],
  }));
  const zh = tagLeanPage('Sky', data, { basePath: '/sky/tags', dashboardPath: '/sky', lang: 'zh' });
  // Canonical is the bare path — no ?range/?lang/?key query survives.
  assert.match(zh, /<link rel="canonical" href="http:\/\/localhost:3000\/sky\/tags">/);
  assert.match(zh, /<h1>Sky<\/h1>/);
  assert.match(zh, /<title>Sky · 頻道傾向 · urtube<\/title>/);
  assert.match(zh, /泛綠/);
  assert.match(zh, /政治光譜/);
  assert.match(zh, /67%/); // 3600 of 5400 politically tagged seconds
  assert.match(zh, /綠媒新聞/);
  const en = tagLeanPage('Sky', data, { basePath: '/sky/tags', dashboardPath: '/sky', lang: 'en' });
  assert.match(en, /Pan-Green/);
  assert.match(en, /Political spectrum/);
});
