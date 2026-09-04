import assert from 'node:assert/strict';
import test from 'node:test';
import { Repository } from '../src/data/database.js';
import { tagLeanPage, tagLeanSection } from '../src/output/taglean.js';
import { normalizeYoutubeCapture } from '../src/youtube/capture.js';
import {
  computeTagLean,
  fetchTagLists,
  resetTagListsCache,
  TAG_POLICY,
  type TagLists,
  type TagListSnapshot,
} from '../src/youtube/taglists.js';
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

function snapshot(partial: Partial<Record<keyof TagLists, string[]>>): TagListSnapshot {
  return {
    lists: lists(partial),
    provenance: {
      sourceUrl: 'https://urtubeapi.analysis.tw/api/channels_list.php',
      sourceUpdatedAt: '2026-09-05 01:58:34',
      fetchedAt: '2026-09-05T01:58:35.000Z',
      membershipVersion: 'sha256:0123456789ab',
      policyVersion: TAG_POLICY.version,
      policyUrl: TAG_POLICY.url,
      reportUrl: TAG_POLICY.reportUrl,
    },
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
  const data = computeTagLean('28d', channels, snapshot({
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

test('tagLeanPage renders governed channel distributions without assigning the viewer an identity', () => {
  const data = computeTagLean('28d', [
    channel('UCgreen-news', '綠媒新聞', 10, 3600),
    channel('UCblue-talk', '藍營談話', 5, 1800),
  ], snapshot({
    news: ['UCgreen-news'],
    green: ['UCgreen-news'],
    blue: ['UCblue-talk'],
  }));
  const zh = tagLeanPage('Sky', data, { basePath: '/sky/tags', dashboardPath: '/sky', lang: 'zh' });
  // Canonical is the bare path — no ?range/?lang/?key query survives.
  assert.match(zh, /<link rel="canonical" href="http:\/\/localhost:3000\/sky\/tags">/);
  // Title and h1 carry the page name and range so every ?range variant (and
  // the dashboard page for the same owner) is uniquely named.
  assert.match(zh, /<h1>Sky<em class="h1-scope">頻道分類 · 最近 28 天<\/em><\/h1>/);
  assert.match(zh, /<title>Sky · 頻道分類 · 最近 28 天 · urtube<\/title>/);
  assert.match(zh, /泛綠/);
  assert.match(zh, /政治標籤頻道觀看分布/);
  assert.match(zh, /67%/); // 3600 of 5400 politically tagged seconds
  assert.match(zh, /綠媒新聞/);
  assert.match(zh, /標籤描述頻道內容傾向，不代表你的政治立場/);
  assert.match(zh, /政策 2026-09-05/);
  assert.match(zh, /清單 sha256:0123456789ab/);
  assert.match(zh, /來源時間 2026-09-05 01:58:34/);
  assert.match(zh, /docs\/channel-tag-policy\.md/);
  assert.match(zh, /issues\/new/);
  assert.match(zh, /不會用於配對/);
  assert.doesNotMatch(zh, /tl-hero-figure"><strong><span style="align-items:center/);
  const embedded = tagLeanSection(data, 'zh');
  assert.match(embedded, /政治標籤頻道觀看分布/);
  assert.match(embedded, /\.tl-groups\{display:grid;gap:20px;grid-template-columns:1fr/);
  assert.match(embedded, /\.tl-groups\{grid-template-columns:repeat\(auto-fit,minmax\(210px,1fr\)\)\}/);
  assert.doesNotMatch(embedded, /repeat\(auto-fit,minmax\(190px,1fr\)\)/);
  const en = tagLeanPage('Sky', data, { basePath: '/sky/tags', dashboardPath: '/sky', lang: 'en' });
  assert.match(en, /Pan-Green/);
  assert.match(en, /Political-channel watch distribution/);
  assert.match(en, /Labels describe channel content, not your political identity/);
});

test('tag-list snapshots are versioned by membership and never reuse an expired fallback', async () => {
  const realFetch = globalThis.fetch;
  let variant = 'a';
  let reverse = false;
  let mode: 'ok' | 'fail' | 'missing-time' | 'invalid-id' = 'ok';
  globalThis.fetch = async (input) => {
    if (mode === 'fail') throw new Error('upstream unavailable');
    const url = new URL(String(input));
    const suffix = `${variant}${Buffer.from(url.search).toString('hex')}`.padEnd(21, '0').slice(0, 21);
    const ids = [`UC${suffix}0`, `UC${suffix}1`];
    if (reverse) ids.reverse();
    const body = {
      result: mode === 'invalid-id' ? [{ youtube_id: 'not-a-channel' }] : ids.map((youtube_id) => ({ youtube_id })),
      ...(mode === 'missing-time' ? {} : { time: '2026-09-05 01:58:34' }),
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    resetTagListsCache();
    const first = await fetchTagLists(0);
    assert.equal(first.provenance.policyVersion, '2026-09-05');
    assert.equal(first.provenance.sourceUpdatedAt, '2026-09-05 01:58:34');
    assert.match(first.provenance.membershipVersion, /^sha256:[a-f0-9]{12}$/);

    resetTagListsCache();
    reverse = true;
    const same = await fetchTagLists(0);
    assert.equal(same.provenance.membershipVersion, first.provenance.membershipVersion);

    variant = 'b';
    reverse = false;
    resetTagListsCache();
    const changed = await fetchTagLists(0);
    assert.notEqual(changed.provenance.membershipVersion, first.provenance.membershipVersion);

    mode = 'fail';
    await assert.rejects(fetchTagLists(6 * 3600_000 + 1), /upstream unavailable/);

    mode = 'missing-time';
    resetTagListsCache();
    await assert.rejects(fetchTagLists(0), /unexpected payload/);

    mode = 'invalid-id';
    resetTagListsCache();
    await assert.rejects(fetchTagLists(0), /unexpected payload/);
  } finally {
    globalThis.fetch = realFetch;
    resetTagListsCache();
  }
});
