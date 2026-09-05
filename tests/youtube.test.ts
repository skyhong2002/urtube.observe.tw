import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { buildChannelRace, Repository } from '../src/data/database.js';
import { youtubeDashboardPage } from '../src/output/youtube.js';
import {
  classifyYoutubeVideosWithClient,
  ensureYoutubeTaxonomyWithClient,
  youtubePublicMetadata,
  type YoutubeAiClient,
} from '../src/youtube/ai.js';
import { decryptPrivateValue, encryptPrivateValue } from '../src/youtube/crypto.js';
import { fetchYoutubeChannelMetadata, fetchYoutubeMetadata } from '../src/youtube/metadata.js';
import { extractYoutubeKeywords } from '../src/youtube/keywords.js';
import { normalizeYoutubeCapture } from '../src/youtube/capture.js';
import { normalizeYoutubeHistoryBatch } from '../src/youtube/history-sync.js';
import { runYoutubePortabilityStep } from '../src/youtube/portability.js';
import {
  PERSONAL_TAXONOMY_DEFINITION_VERSION,
  PERSONAL_TAXONOMY_PROMPT_VERSION,
  PERSONAL_TOPICS,
  samplePersonalTaxonomy,
} from '../src/youtube/personal-taxonomy.js';
import {
  normalizeYoutubeProgressBatch,
  progressSeconds,
} from '../src/youtube/progress.js';
import { parseYoutubeArchive } from '../src/youtube/takeout.js';
import type { YoutubeParsedArchive, YoutubeVideoMetadata } from '../src/youtube/types.js';

const SECRET = 'test-private-data-key-with-at-least-32-characters';

function fixtureZip(): Uint8Array {
  const watch = [
    {
      header: 'YouTube', title: 'Watched Long Technical Talk',
      titleUrl: 'https://www.youtube.com/watch?v=video-one',
      subtitles: [{ name: 'Channel One', url: 'https://www.youtube.com/channel/channel-one' }],
      time: '2026-07-28T01:00:00Z', products: ['YouTube'],
      activityControls: ['YouTube watch history'],
    },
    {
      header: 'YouTube', title: 'Watched Long Technical Talk',
      titleUrl: 'https://www.youtube.com/watch?v=video-one',
      subtitles: [{ name: 'Channel One', url: 'https://www.youtube.com/channel/channel-one' }],
      time: '2026-07-28T02:00:00Z', products: ['YouTube'],
      activityControls: ['YouTube watch history'],
    },
    {
      header: 'YouTube', title: 'Watched 已移除的影片',
      time: '2026-07-28T03:00:00Z', products: ['YouTube'],
      activityControls: ['YouTube watch history'],
    },
    {
      header: 'YouTube', title: 'Viewed a post',
      titleUrl: 'https://www.youtube.com/post/Ugkx-private-community-post',
      time: '2026-07-28T04:00:00Z', products: ['YouTube'],
      activityControls: ['YouTube watch history'],
    },
  ];
  const search = [
    {
      header: 'YouTube', title: 'Searched for private search term',
      titleUrl: 'https://www.youtube.com/results?search_query=private+search+term',
      time: '2026-07-28T00:30:00Z', products: ['YouTube'],
      activityControls: ['YouTube search history'],
    },
    {
      header: 'YouTube', title: 'Visited https://www.youtube.com/',
      titleUrl: 'https://www.youtube.com/',
      time: '2026-07-28T00:45:00Z', products: ['YouTube'],
      activityControls: ['YouTube search history'],
    },
  ];
  return zipSync({
    'Takeout/YouTube and YouTube Music/history/watch-history.json': strToU8(JSON.stringify(watch)),
    'Takeout/YouTube and YouTube Music/history/search-history.json': strToU8(JSON.stringify(search)),
  });
}

function htmlFixtureZip(): Uint8Array {
  const activity = (
    action: string,
    title: string,
    url: string,
    channel: string,
    channelUrl: string,
    time: string,
    control: string,
  ) => `<div class="outer-cell"><div class="content-cell">${action}
    ${url ? `<a href="${url}">${title}</a>` : title}<br>
    ${channelUrl ? `<a href="${channelUrl}">${channel}</a><br>` : ''}
    ${time}<br><b>Products:</b><br>YouTube<br><b>Activity controls:</b><br>
    This activity was saved because ${control} was on.
    <a href="https://myaccount.google.com/activitycontrols">settings</a>.
  </div></div>`;
  const watch = [
    activity(
      'Watched', 'Long Technical Talk', 'https://www.youtube.com/watch?v=video-one',
      'Channel One', 'https://www.youtube.com/channel/channel-one',
      'Jul 28, 2026, 9:00:00 AM CST', 'YouTube watch history',
    ),
    activity(
      'Viewed', 'a post', 'https://www.youtube.com/post/post-one',
      'Channel One', 'https://www.youtube.com/channel/channel-one',
      'Jul 28, 2026, 10:00:00 AM CST', 'YouTube watch history',
    ),
  ].join('');
  const search = [
    activity(
      'Searched for', 'private search term',
      'https://www.youtube.com/results?search_query=private+search+term',
      '', '', 'Jul 28, 2026, 8:30:00 AM CST', 'YouTube search history',
    ),
    activity(
      'Visited', 'Google', 'https://www.google.com/',
      '', '', 'Jul 28, 2026, 8:45:00 AM CST', 'YouTube search history',
    ),
  ].join('');
  return zipSync({
    'Takeout/YouTube and YouTube Music/history/watch-history.html': strToU8(watch),
    'Takeout/YouTube and YouTube Music/history/search-history.html': strToU8(search),
  });
}

test('Takeout parser accepts localized folder names and Chinese timestamps', () => {
  const activity = (time: string, videoId: string) =>
    `<div class="outer-cell"><div class="mdl-grid"><div class="content-cell">Watched&nbsp;<a href="https://www.youtube.com/watch?v=${videoId}">影片</a><br><a href="https://www.youtube.com/channel/channel-zh">頻道</a><br>${time}<br></div><div class="content-cell"></div><div class="content-cell"><b>產品：</b><br>&emsp;YouTube<br><b>為什麼有這項活動記錄？</b><br>&emsp;由於您開啟了下列設定，因此系統將這個活動儲存到您的 Google 帳戶中：&nbsp;YouTube watch history.&nbsp;您可以前往<a href="https://myaccount.google.com/activitycontrols">這裡</a>控管這些設定。</div></div></div>`;
  const html = `<html><body>${[
    activity('2026年9月4日 晚上9:45:27 CST', 'evening'),
    activity('2026年9月4日 凌晨12:10:00 CST', 'midnight'),
    activity('2026年9月4日 中午12:30:00 CST', 'noon'),
    activity('2026年9月4日 上午8:00:00 CST', 'morning'),
    activity('2026年9月4日 清晨5:15:00 GMT+08:00', 'dawn'),
    activity('2026年9月4日 下午1:00:00 CST', 'afternoon'),
  ].join('')}</body></html>`;
  const zip = zipSync({ 'Takeout/YouTube 和 YouTube Music/觀看記錄/watch-history.html': strToU8(html) });
  const parsed = parseYoutubeArchive(zip, SECRET);
  assert.deepEqual(
    parsed.watches.map(({ videoId, watchedAt }) => [videoId, watchedAt]),
    [
      ['evening', '2026-09-04T13:45:27.000Z'],
      ['midnight', '2026-09-03T16:10:00.000Z'],
      ['noon', '2026-09-04T04:30:00.000Z'],
      ['morning', '2026-09-04T00:00:00.000Z'],
      ['dawn', '2026-09-03T21:15:00.000Z'],
      ['afternoon', '2026-09-04T05:00:00.000Z'],
    ],
  );
  assert.equal(parsed.watches[0].title, '影片');
  assert.equal(parsed.watches[0].channelId, 'channel-zh');
});

test('Takeout parser accepts Japanese and Korean timestamps and diagnoses unsupported ones', () => {
  const activity = (time: string, videoId: string) =>
    `<div class="outer-cell"><div class="content-cell">Watched&nbsp;<a href="https://www.youtube.com/watch?v=${videoId}">Video</a><br>${time}<br>YouTube watch history</div></div>`;
  const zip = zipSync({
    'Takeout/YouTube と YouTube Music/履歴/watch-history.html': strToU8(
      activity('2026/09/04 21:45:27 JST', 'japanese01')
      + activity('2026年9月4日 08:10:00 JST', 'japanese02')
      + activity('2026. 9. 4. 오후 9:45:27 KST', 'korean00001')
      + activity('2026. 9. 4. 오전 12:10:00 KST', 'korean00002'),
    ),
  });
  assert.deepEqual(
    parseYoutubeArchive(zip, SECRET).watches.map(({ videoId, watchedAt }) => [videoId, watchedAt]),
    [
      ['japanese01', '2026-09-04T12:45:27.000Z'],
      ['japanese02', '2026-09-03T23:10:00.000Z'],
      ['korean00001', '2026-09-04T12:45:27.000Z'],
      ['korean00002', '2026-09-03T15:10:00.000Z'],
    ],
  );

  const unsupported = zipSync({
    'Takeout/YouTube/履歴/watch-history.html': strToU8(
      activity('令和8年9月4日 21時45分27秒 JST', 'unsupported'),
    ),
  });
  assert.throws(
    () => parseYoutubeArchive(unsupported, SECRET),
    /found 1 activity record, but 1 had unsupported timestamp formats and were skipped/,
  );
});

test('private-value encryption is randomized and authenticated', () => {
  const first = encryptPrivateValue('sensitive', SECRET);
  const second = encryptPrivateValue('sensitive', SECRET);
  assert.notEqual(first, second);
  assert.equal(decryptPrivateValue(first, SECRET), 'sensitive');
  const tampered = first.split('.');
  tampered[2] = `${tampered[2][0] === 'A' ? 'B' : 'A'}${tampered[2].slice(1)}`;
  assert.throws(() => decryptPrivateValue(tampered.join('.'), SECRET));
});

test('Takeout parser normalizes watch/search records and rejects unsafe archives', () => {
  const parsed = parseYoutubeArchive(fixtureZip(), SECRET);
  assert.equal(parsed.watches.length, 4);
  assert.equal(parsed.searches.length, 2);
  assert.equal(parsed.watches[0].videoId, 'video-one');
  assert.equal(parsed.watches[0].channelId, 'channel-one');
  assert.equal(parsed.watches[2].videoId, null);
  assert.equal(parsed.watches[3].activityType, 'post');
  assert.equal(parsed.watches[3].videoId, null);
  assert.equal(decryptPrivateValue(parsed.searches[0].queryCiphertext, SECRET), 'private search term');
  assert.equal(parsed.searches[1].activityType, 'visit');
  assert.equal(decryptPrivateValue(parsed.searches[1].queryCiphertext, SECRET), 'Visited https://www.youtube.com/');
  const unsafe = zipSync({ '../history/watch-history.json': strToU8('[]') });
  assert.throws(() => parseYoutubeArchive(unsafe, SECRET), /Unsafe archive entry/);
  assert.throws(
    () => parseYoutubeArchive(fixtureZip(), SECRET, 'takeout', { maxArchiveBytes: 1 }),
    /compressed size limit/,
  );
  assert.throws(
    () => parseYoutubeArchive(fixtureZip(), SECRET, 'takeout', { maxUncompressedBytes: 1 }),
    /uncompressed size limit/,
  );
  assert.throws(() => parseYoutubeArchive(fixtureZip(), 'too-short'), /at least 32 characters/);
});

test('Takeout parser accepts HTML history and preserves Taipei timestamps', () => {
  const parsed = parseYoutubeArchive(htmlFixtureZip(), SECRET);
  assert.equal(parsed.watches.length, 2);
  assert.equal(parsed.searches.length, 2);
  assert.equal(parsed.watches[0].videoId, 'video-one');
  assert.equal(parsed.watches[0].channelId, 'channel-one');
  assert.equal(parsed.watches[0].watchedAt, '2026-07-28T01:00:00.000Z');
  assert.equal(parsed.watches[1].activityType, 'post');
  assert.equal(parsed.searches[0].searchedAt, '2026-07-28T00:30:00.000Z');
  assert.equal(decryptPrivateValue(parsed.searches[0].queryCiphertext, SECRET), 'private search term');
  assert.equal(parsed.searches[1].activityType, 'visit');
});

test('HTML imports do not duplicate second-precision JSON events', () => {
  const repository = new Repository(':memory:');
  try {
    const json = parseYoutubeArchive(fixtureZip(), SECRET);
    const html = parseYoutubeArchive(htmlFixtureZip(), SECRET);
    repository.ingestYoutubeArchive(json);
    const result = repository.ingestYoutubeArchive(html);
    assert.equal(result.watchesInserted, 1);
    assert.equal(result.searchesInserted, 0);
    assert.equal(repository.youtubeCounts().videoWatches, 3);
  } finally {
    repository.close();
  }
});

test('YouTube imports are idempotent, aggregate-only, and preserve duration semantics', () => {
  const repository = new Repository(':memory:');
  try {
    const parsed = parseYoutubeArchive(fixtureZip(), SECRET);
    assert.deepEqual(repository.ingestYoutubeArchive(parsed), {
      archiveHash: parsed.archiveHash,
      watchesSeen: 4,
      watchesInserted: 4,
      searchesSeen: 2,
      searchesInserted: 2,
    });
    assert.deepEqual(repository.ingestYoutubeArchive(parsed), {
      archiveHash: parsed.archiveHash,
      watchesSeen: 4,
      watchesInserted: 0,
      searchesSeen: 2,
      searchesInserted: 0,
    });
    assert.deepEqual(repository.youtubeCounts(), {
      watches: 4,
      videoWatches: 3,
      videos: 1,
      searches: 2,
      searchQueries: 1,
      channels: 1,
    });
    assert.equal(repository.queryActivities({ source: 'youtube' }).total, 0);

    const metadata: YoutubeVideoMetadata = {
      videoId: 'video-one', title: 'Long Technical Talk', channelId: 'channel-one',
      channelTitle: 'Channel One', description: 'TypeScript systems engineering',
      tags: ['TypeScript', 'systems'], thumbnailUrl: 'https://i.ytimg.com/vi/video-one/hqdefault.jpg',
      durationSeconds: 600, publishedAt: '2026-07-20T00:00:00Z', categoryId: '28',
      availability: 'available', metadataHash: 'metadata-v1',
    };
    repository.upsertYoutubeVideoMetadata([metadata]);
    assert.deepEqual(repository.youtubeChannelsNeedingMetadata(), ['channel-one']);
    repository.upsertYoutubeChannelMetadata([{
      channelId: 'channel-one',
      name: 'Channel One',
      thumbnailUrl: 'https://yt3.ggpht.com/channel-one',
    }]);
    assert.deepEqual(repository.youtubeChannelsNeedingMetadata(), ['channel-one'], 'legacy avatar-only metadata still needs public statistics');
    const dashboard = repository.youtubeDashboard('all', new Date('2026-07-29T00:00:00Z'));
    assert.equal(dashboard.stats.watchEvents, 3);
    assert.equal(dashboard.stats.uniqueVideos, 2);
    assert.equal(dashboard.stats.openedDurationSeconds, 1200);
    assert.equal(dashboard.stats.actualWatchedSeconds, null);
    assert.deepEqual(dashboard.hourly.map(({ hour, watches }) => ({ hour, watches })), [
      { hour: 9, watches: 1 },
      { hour: 10, watches: 1 },
      { hour: 11, watches: 1 },
    ]);
    assert.deepEqual(dashboard.rhythmCoverage, { exactWatches: 3, dateOnlyWatches: 0 });
    assert.equal(dashboard.topChannels[0].name, 'Channel One');
    assert.equal(dashboard.topChannels[0].thumbnailUrl, 'https://yt3.ggpht.com/channel-one');
    assert.ok(dashboard.topChannels.every((channel) => channel.name !== 'Unknown channel'));
    const lastFrame = dashboard.channelRace.frames.at(-1);
    assert.ok(lastFrame);
    assert.equal(dashboard.channelRace.channels[lastFrame.entries[0][0]].name, 'Channel One');
    assert.equal(dashboard.recent.length, 2);
    assert.ok(dashboard.keywords.some((keyword) => keyword.term === 'typescript'));
  } finally {
    repository.close();
  }
});

test('Channel race decays by the half-life, densifies quiet weeks, and prunes faded channels', () => {
  const row = (week: string, name: string, seconds: number) => ({
    week, channelId: name.toLowerCase(), name, thumbnailUrl: '', estimatedWatchSeconds: seconds,
  });
  const race = buildChannelRace([
    row('2026-01-05', 'Alpha', 3600),
    row('2026-01-12', 'Beta', 3600),
  ], 7);
  assert.equal(race.channels[0].name, 'Alpha');
  assert.equal(race.channels[1].name, 'Beta');
  assert.deepEqual(race.frames.map((frame) => frame.period), ['2026-01-05', '2026-01-12']);
  // Eventual contenders are visible at zero before their first scored frame,
  // so early race frames do not collapse to only the channels active then.
  assert.deepEqual(race.frames[0].entries, [[0, 3600], [1, 0]]);
  // One week at a 7-day half-life halves Alpha; fresh Beta overtakes it.
  assert.deepEqual(race.frames[1].entries, [[1, 3600], [0, 1800]]);

  const sparse = buildChannelRace([
    row('2026-01-05', 'Alpha', 3600),
    row('2026-03-02', 'Beta', 3600),
  ], 7);
  // Quiet weeks still produce frames while Alpha fades; once it decays below
  // the 60s floor the empty weeks drop out, then Beta re-opens the race.
  assert.deepEqual(sparse.frames.map((frame) => frame.period), [
    '2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26',
    '2026-02-02', '2026-02-09', '2026-03-02',
  ]);
  assert.deepEqual(sparse.frames[4].entries, [[0, 225], [1, 0]]);
  assert.deepEqual(sparse.frames.at(-1)?.entries, [[1, 3600]]);
});

test('dashboard ranks individual videos and tracks short-form time using known durations', () => {
  const repository = new Repository(':memory:');
  const now = new Date('2026-07-29T12:00:00Z');
  const capture = (
    sessionId: string,
    videoId: string,
    title: string,
    watchedAt: string,
    actualWatchedSeconds: number,
    durationSeconds: number,
  ) => repository.upsertYoutubeCapture(normalizeYoutubeCapture({
    sessionId, videoId, title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    channelTitle: 'Fixture Channel', watchedAt, actualWatchedSeconds, durationSeconds,
  }, now));
  try {
    capture('short-session-0001', 'SHORTFORM01', 'Short fixture', '2026-07-28T12:00:00Z', 60, 90);
    capture('short-session-0002', 'SHORTFORM01', 'Short fixture', '2026-07-29T10:00:00Z', 30, 90);
    capture('long-session-00001', 'LONGFORM001', 'Long fixture', '2026-07-29T11:00:00Z', 120, 600);

    const dashboard = repository.youtubeDashboard('all', now);
    const short = dashboard.topVideos.find((video) => video.videoId === 'SHORTFORM01');
    const long = dashboard.topVideos.find((video) => video.videoId === 'LONGFORM001');
    assert.deepEqual(
      { watches: short?.watches, seconds: short?.estimatedWatchSeconds },
      { watches: 2, seconds: 90 },
    );
    assert.deepEqual(
      { watches: long?.watches, seconds: long?.estimatedWatchSeconds },
      { watches: 1, seconds: 120 },
    );
    assert.deepEqual(dashboard.shortFormDaily, [
      { day: '2026-07-28', shortWatchSeconds: 60, liveWatchSeconds: 0, regularWatchSeconds: 0, knownDurationWatchSeconds: 60 },
      { day: '2026-07-29', shortWatchSeconds: 30, liveWatchSeconds: 0, regularWatchSeconds: 120, knownDurationWatchSeconds: 150 },
    ]);
    const overviewPage = youtubeDashboardPage('Fixture', dashboard, 'duration', {
      lang: 'zh', profilePath: '/fixture', page: 'overview',
    });
    assert.match(overviewPage, /href="\/fixture\/insights\?range=all&sort=duration"/);
    assert.match(overviewPage, /data-youtube-sort="watches"/);
    assert.match(overviewPage, /data-youtube-sort-list="channels"/);
    assert.match(overviewPage, /history\.pushState/);
    assert.match(overviewPage, /\.yt-channels,\.yt-top-videos,\.yt-recent\{column-gap:28px;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
    assert.doesNotMatch(overviewPage, /data-rhythm-panel=/);
    const insightsPage = youtubeDashboardPage('Fixture', dashboard, 'duration', {
      lang: 'zh', profilePath: '/fixture', page: 'insights', dashboardPrivate: true,
    });
    assert.match(insightsPage, /預設私密/);
    assert.match(insightsPage, /aria-label="信任與資料界線"/);
    assert.match(insightsPage, /data-rhythm-panel="watches"/);
    assert.match(insightsPage, /data-rhythm-panel="estimatedWatchSeconds"/);
    assert.match(insightsPage, /data-rhythm-metric="watches"/);
    assert.match(insightsPage, /\.yt-rhythm-clocks\{display:grid;gap:34px;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);max-width:none\}/);
    assert.match(insightsPage, /toggle\.hidden=wide\.matches/);
    assert.match(insightsPage, /觀看時間趨勢/);
    assert.match(insightsPage, /yt-short-segment/);
    assert.match(insightsPage, /yt-regular-segment/);
    assert.doesNotMatch(insightsPage, /yt-short-line-chart/);
    const publicInsightsPage = youtubeDashboardPage('Fixture', dashboard, 'duration', {
      lang: 'zh', profilePath: '/fixture', page: 'insights', dashboardPrivate: false,
    });
    assert.doesNotMatch(publicInsightsPage, /預設私密/);
    const partialRhythmPage = youtubeDashboardPage('Fixture', {
      ...dashboard, rhythmCoverage: { exactWatches: 2, dateOnlyWatches: 1 },
    }, 'duration', { lang: 'zh', profilePath: '/fixture', page: 'insights' });
    assert.match(partialRhythmPage, /已排除只有日期的紀錄/);
    assert.match(partialRhythmPage, /data-rhythm-panel="watches"/);
    const blockedRhythmPage = youtubeDashboardPage('Fixture', {
      ...dashboard, rhythmCoverage: { exactWatches: 1, dateOnlyWatches: 2 },
    }, 'duration', { lang: 'zh', profilePath: '/fixture', page: 'insights' });
    assert.match(blockedRhythmPage, /12:00 是佔位值，不是真實習慣/);
    assert.doesNotMatch(blockedRhythmPage, /data-rhythm-panel=/);
    const recapPage = youtubeDashboardPage('Fixture', dashboard, 'duration', {
      lang: 'zh', profilePath: '/fixture', page: 'recap',
    });
    assert.match(recapPage, /class="yt-recap-figure"/);
    assert.match(recapPage, /\.yt-recap-chapter\{align-items:center;display:grid/);
    for (const script of insightsPage.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      assert.doesNotThrow(() => Function(script[1]));
    }
    assert.match(youtubeDashboardPage('Fixture', dashboard, 'duration', {
      lang: 'zh', page: 'insights', shortFormVariant: 'stacked',
    }), /方案 A · 100% 組成趨勢/);
    assert.match(youtubeDashboardPage('Fixture', dashboard, 'duration', {
      lang: 'zh', page: 'insights', shortFormVariant: 'compare',
    }), /方案 B · 前後期比較/);
    assert.match(youtubeDashboardPage('Fixture', dashboard, 'duration', {
      lang: 'zh', page: 'insights', shortFormVariant: 'heatmap',
    }), /方案 C · 年月熱圖/);
    assert.match(youtubeDashboardPage('Fixture', dashboard, 'duration', {
      lang: 'zh', page: 'insights', shortFormVariant: 'absolute',
    }), /觀看時間趨勢/);
    assert.match(youtubeDashboardPage('Fixture', dashboard, 'duration', {
      lang: 'zh', page: 'insights', shortFormVariant: 'dual',
    }), /方案 A2 · 組成＋總時數/);
  } finally {
    repository.close();
  }
});

test('Chrome captures validate YouTube URLs and idempotently increase measured watch time', () => {
  const repository = new Repository(':memory:');
  const now = new Date('2026-07-28T12:30:00Z');
  try {
    const first = normalizeYoutubeCapture({
      sessionId: '12345678-1234-4123-8123-123456789abc',
      videoId: 'dQw4w9WgXcQ',
      title: 'Captured YouTube Video',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share',
      channelTitle: 'Captured Channel',
      watchedAt: '2026-07-28T12:00:00Z',
      actualWatchedSeconds: 12,
      durationSeconds: 213,
    }, now);
    const inserted = repository.upsertYoutubeCapture(first, now.toISOString());
    assert.equal(inserted.inserted, true);
    assert.equal(inserted.updated, false);
    assert.equal(inserted.actualWatchedSeconds, 12);

    const duplicate = repository.upsertYoutubeCapture(first, now.toISOString());
    assert.equal(duplicate.inserted, false);
    assert.equal(duplicate.updated, false);
    assert.equal(repository.youtubeCounts().videoWatches, 1);
    assert.equal(repository.youtubeDashboard('all', now).stats.estimatedWatchSeconds, 12);

    const increased = repository.upsertYoutubeCapture({
      ...first,
      actualWatchedSeconds: 47,
    }, now.toISOString());
    assert.equal(increased.inserted, false);
    assert.equal(increased.updated, true);
    assert.equal(increased.actualWatchedSeconds, 47);
    const dashboard = repository.youtubeDashboard('all', now);
    assert.equal(dashboard.stats.watchEvents, 1);
    assert.equal(dashboard.stats.actualWatchedSeconds, 47);
    assert.equal(dashboard.stats.openedDurationSeconds, 213);
    assert.equal(repository.queryActivities({ source: 'youtube' }).total, 0);

    assert.throws(() => normalizeYoutubeCapture({
      sessionId: '12345678-1234-4123-8123-123456789abc',
      videoId: 'dQw4w9WgXcQ',
      title: 'Wrong host',
      url: 'https://example.test/watch?v=dQw4w9WgXcQ',
      watchedAt: '2026-07-28T12:00:00Z',
      actualWatchedSeconds: 5,
    }, now), /youtube\.com/);
    assert.throws(() => normalizeYoutubeCapture({
      sessionId: '12345678-1234-4123-8123-123456789abc',
      videoId: 'dQw4w9WgXcQ',
      title: 'Wrong video',
      url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA',
      watchedAt: '2026-07-28T12:00:00Z',
      actualWatchedSeconds: 5,
    }, now), /does not match/);
  } finally {
    repository.close();
  }
});

test('extension history batches canonicalize watches and encrypt searches server-side', () => {
  const now = new Date('2026-07-30T13:00:00.000Z');
  const parsed = normalizeYoutubeHistoryBatch({
    syncId: 'history-sync-123456789',
    observedAt: '2026-07-30T12:59:00.000Z',
    events: [
      {
        kind: 'watch',
        occurredAt: '2026-07-30T12:11:00.000Z',
        videoId: 'OjgytNhTjtI',
        title: 'Persona 5 Secret Egg Room',
        url: 'https://www.youtube.com/watch?v=OjgytNhTjtI&feature=share',
        channelId: 'UCEevYX4rCcfF0ZrxmnnONXA',
        channelTitle: 'Faz',
        durationSeconds: 63,
        activityType: 'video',
      },
      {
        kind: 'search',
        occurredAt: '2026-07-30T12:10:00.000Z',
        query: 'private account query',
        activityType: 'search',
      },
    ],
  }, SECRET, now);
  assert.equal(parsed.source, 'extension');
  assert.equal(parsed.watches[0].url, 'https://www.youtube.com/watch?v=OjgytNhTjtI');
  assert.equal(parsed.watches[0].durationSeconds, 63);
  assert.equal(decryptPrivateValue(parsed.searches[0].queryCiphertext, SECRET), 'private account query');
  assert.match(parsed.archiveHash, /^[a-f0-9]{64}$/);
  assert.throws(() => normalizeYoutubeHistoryBatch({
    syncId: 'history-sync-123456789',
    observedAt: '2026-07-30T12:59:00.000Z',
    events: [{
      kind: 'watch',
      occurredAt: '2026-07-30T12:11:00.000Z',
      videoId: 'OjgytNhTjtI',
      title: 'Wrong host',
      url: 'https://example.com/watch?v=OjgytNhTjtI',
      activityType: 'video',
    }],
  }, SECRET, now), /youtube\.com/);
});

test('deep extension history accepts old events but rejects dates before YouTube existed', () => {
  const base = {
    syncId: 'deep-history-0000000001',
    observedAt: '2026-09-05T12:00:00.000Z',
    events: [{
      kind: 'watch', occurredAt: '2008-03-10T12:00:00.000Z', videoId: 'OLDVIDEO001',
      title: 'Anonymous old video', url: 'https://www.youtube.com/watch?v=OLDVIDEO001',
      channelId: null, channelTitle: null, durationSeconds: null, activityType: 'video',
    }],
  };
  assert.equal(normalizeYoutubeHistoryBatch(base, SECRET, new Date(base.observedAt)).watches.length, 1);
  assert.throws(() => normalizeYoutubeHistoryBatch({
    ...base,
    events: [{ ...base.events[0], occurredAt: '2004-01-01T00:00:00.000Z' }],
  }, SECRET, new Date(base.observedAt)), /predates YouTube/);
});

test('YouTube progress validation prefers exact resume positions and rejects stale observations', () => {
  const now = new Date('2026-07-29T12:00:00Z');
  const batch = normalizeYoutubeProgressBatch({
    scanId: 'scan-1234567890123456',
    observedAt: '2026-07-29T11:55:00Z',
    complete: false,
    items: [
      {
        videoId: 'AAAAAAAAAAA',
        progressPercent: 80,
        resumeSeconds: 125,
        durationSeconds: 100,
      },
      {
        videoId: 'AAAAAAAAAAA',
        progressPercent: 50,
        resumeSeconds: 90,
        durationSeconds: 100,
      },
      {
        videoId: 'LONGSTREAM1',
        progressPercent: 12.5,
        resumeSeconds: null,
        durationSeconds: 1_802_839,
      },
    ],
  }, now);
  assert.equal(batch.items.length, 2);
  assert.equal(batch.items[0].resumeSeconds, 90);
  assert.equal(progressSeconds(batch.items[0]), 90);
  assert.equal(progressSeconds(batch.items[1]), 225_355);
  assert.equal(progressSeconds({
    videoId: 'BBBBBBBBBBB',
    progressPercent: 25,
    resumeSeconds: null,
    durationSeconds: 400,
  }), 100);
  assert.throws(() => normalizeYoutubeProgressBatch({
    scanId: 'scan-1234567890123456',
    observedAt: '2026-07-28T11:00:00Z',
    complete: false,
    items: [],
  }, now), /older than 24 hours/);
});

test('YouTube watch estimates, measured sessions, and content progress remain separate', () => {
  const repository = new Repository(':memory:');
  const now = new Date('2026-07-29T12:00:00Z');
  const archive: YoutubeParsedArchive = {
    archiveHash: 'progress-estimate-fixture',
    source: 'takeout',
    watches: [
      {
        eventId: 'estimate-watch-a',
        videoId: 'AAAAAAAAAAA',
        title: 'Estimated session',
        url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA',
        channelId: 'channel-a',
        channelTitle: 'Channel A',
        channelUrl: 'https://www.youtube.com/channel/channel-a',
        watchedAt: '2026-07-29T10:00:00Z',
        actualWatchedSeconds: null,
        activityType: 'video',
      },
      {
        eventId: 'takeout-shadow-b',
        videoId: 'BBBBBBBBBBB',
        title: 'Measured session shadow',
        url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB',
        channelId: 'channel-b',
        channelTitle: 'Channel B',
        channelUrl: 'https://www.youtube.com/channel/channel-b',
        watchedAt: '2026-07-29T11:00:00Z',
        actualWatchedSeconds: null,
        activityType: 'video',
      },
    ],
    searches: [
      {
        eventId: 'estimate-search-a',
        searchedAt: '2026-07-29T10:04:00Z',
        queryCiphertext: encryptPrivateValue('private interval marker', SECRET),
        activityType: 'search',
      },
      {
        eventId: 'estimate-search-b',
        searchedAt: '2026-07-29T11:10:00Z',
        queryCiphertext: encryptPrivateValue('private measured marker', SECRET),
        activityType: 'search',
      },
    ],
  };
  try {
    repository.ingestYoutubeArchive(archive);
    repository.upsertYoutubeCapture(normalizeYoutubeCapture({
      sessionId: '12345678-1234-4123-8123-123456789abc',
      videoId: 'BBBBBBBBBBB',
      title: 'Measured session',
      url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB',
      channelTitle: 'Channel B',
      watchedAt: '2026-07-29T11:02:00Z',
      actualWatchedSeconds: 100,
      durationSeconds: 1200,
    }, now));
    repository.upsertYoutubeVideoMetadata([
      {
        videoId: 'AAAAAAAAAAA',
        title: 'Estimated session',
        channelId: 'channel-a',
        channelTitle: 'Channel A',
        description: '',
        tags: [],
        thumbnailUrl: 'https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg',
        durationSeconds: 600,
        publishedAt: null,
        categoryId: null,
        availability: 'available',
        metadataHash: 'estimate-a',
      },
      {
        videoId: 'BBBBBBBBBBB',
        title: 'Measured session',
        channelId: 'channel-b',
        channelTitle: 'Channel B',
        description: '',
        tags: [],
        thumbnailUrl: 'https://i.ytimg.com/vi/BBBBBBBBBBB/hqdefault.jpg',
        durationSeconds: 1200,
        publishedAt: null,
        categoryId: null,
        availability: 'available',
        metadataHash: 'estimate-b',
      },
    ]);
    const imported = repository.ingestYoutubeProgress({
      scanId: 'scan-estimate-123456789',
      observedAt: '2026-07-29T11:55:00.000Z',
      complete: false,
      items: [
        {
          videoId: 'AAAAAAAAAAA',
          progressPercent: 50,
          resumeSeconds: 120,
          durationSeconds: 600,
        },
        {
          videoId: 'BBBBBBBBBBB',
          progressPercent: 50,
          resumeSeconds: null,
          durationSeconds: 1200,
        },
      ],
    });
    assert.equal(imported.stored, 2);
    assert.equal(repository.ingestYoutubeProgress({
      scanId: 'scan-estimate-123456789',
      observedAt: '2026-07-29T11:55:00.000Z',
      complete: false,
      items: [
        {
          videoId: 'AAAAAAAAAAA',
          progressPercent: 50,
          resumeSeconds: 120,
          durationSeconds: 600,
        },
        {
          videoId: 'BBBBBBBBBBB',
          progressPercent: 50,
          resumeSeconds: null,
          durationSeconds: 1200,
        },
      ],
    }).stored, 0);
    const complete = repository.ingestYoutubeProgress({
      scanId: 'scan-estimate-123456789',
      observedAt: '2026-07-29T11:55:00.000Z',
      complete: true,
      items: [],
    });
    assert.equal(complete.completed, true);
    assert.equal(complete.totalStored, 2);
    assert.throws(() => repository.ingestYoutubeProgress({
      scanId: 'scan-estimate-123456789',
      observedAt: '2026-07-29T11:55:00.000Z',
      complete: false,
      items: [],
    }), /already complete/);

    const dashboard = repository.youtubeDashboard('all', now);
    assert.equal(dashboard.stats.watchEvents, 3);
    assert.equal(dashboard.stats.estimatedWatchSeconds, 340);
    assert.equal(dashboard.stats.inferredWatchSeconds, 240);
    assert.equal(dashboard.stats.actualWatchedSeconds, 100);
    assert.equal(dashboard.stats.catalogDurationSeconds, 1800);
    assert.equal(dashboard.stats.contentCoveredSeconds, 720);
    assert.equal(dashboard.stats.progressCoverage, 1);
    const ranged = repository.youtubeDashboard('7d', now);
    assert.equal(ranged.stats.watchEvents, 3);
    assert.equal(ranged.stats.estimatedWatchSeconds, 340);
    assert.equal(ranged.stats.catalogDurationSeconds, 1800);
  } finally {
    repository.close();
  }
});

test('history coverage requires a verified history start and advances with each caught-up sync', () => {
  const repository = new Repository(':memory:');
  const scan = (scanId: string, observedAt: string, summary: Record<string, unknown>) =>
    repository.ingestYoutubeProgress({
      scanId, observedAt, complete: true, items: [],
      summary: {
        mode: 'full', videos: 0, passes: 1, endReason: 'end-of-history',
        oldestWatchedAt: null, newestWatchedAt: null, error: null, landedUrl: null,
        ...summary,
      } as never,
    });
  try {
    assert.equal(repository.youtubeHistoryStatus().coverage, null);

    // A background tab that never rendered the list covers nothing, and
    // neither does a read the account could not even start.
    scan('scan-no-content-000001', '2026-09-04T12:35:54.000Z', { mode: 'incremental', endReason: 'no-content' });
    scan('scan-no-receiver-00001', '2026-09-04T12:38:18.000Z', {
      endReason: 'no-receiver', error: 'YouTube History did not load — the sync tab stopped at https://accounts.google.com/',
      landedUrl: 'https://accounts.google.com/',
    });
    assert.equal(repository.youtubeHistoryStatus().coverage, null);

    // Legacy idle-only "end-of-history" and a time-limited scan both describe
    // intervals that were read, but neither proves the account's older history
    // is complete. They must not make a later incremental sync stop near today.
    scan('scan-shallow-idle-00001', '2026-09-04T12:40:00.000Z', {
      videos: 80, passes: 20, endReason: 'end-of-history',
      oldestWatchedAt: '2026-07-17T04:00:00.000Z', newestWatchedAt: '2026-09-04T04:00:00.000Z',
    });
    scan('scan-time-limit-000001', '2026-09-04T12:45:00.000Z', {
      videos: 1000, passes: 500, endReason: 'time-limit',
      oldestWatchedAt: '2025-06-01T04:00:00.000Z', newestWatchedAt: '2026-09-04T04:00:00.000Z',
    });
    assert.equal(repository.youtubeHistoryStatus().coverage, null);

    scan('scan-full-0000000000001', '2026-09-04T12:52:30.000Z', {
      videos: 51005, passes: 1500, endReason: 'history-start',
      oldestWatchedAt: '2018-11-25T04:00:00.000Z', newestWatchedAt: '2026-09-04T04:00:00.000Z',
    });
    let coverage = repository.youtubeHistoryStatus().coverage;
    assert.equal(coverage?.scanId, 'scan-full-0000000000001');
    assert.equal(coverage?.coveredSince, '2026-09-04T12:52:30.000Z');
    assert.equal(coverage?.oldestWatchedAt, '2018-11-25T04:00:00.000Z');
    assert.equal(coverage?.endReason, 'history-start');

    // A later sync that stopped at already-covered dates moves the frontier
    // forward while the deepest day stays the full read's.
    scan('scan-incremental-000001', '2026-09-05T13:00:00.000Z', {
      mode: 'incremental', videos: 40, passes: 3, endReason: 'covered',
      oldestWatchedAt: '2026-09-02T04:00:00.000Z', newestWatchedAt: '2026-09-05T04:00:00.000Z',
    });
    coverage = repository.youtubeHistoryStatus().coverage;
    assert.equal(coverage?.scanId, 'scan-incremental-000001');
    assert.equal(coverage?.coveredSince, '2026-09-05T13:00:00.000Z');
    assert.equal(coverage?.oldestWatchedAt, '2018-11-25T04:00:00.000Z');

    // A cancelled read after that does not roll the frontier back or forward.
    scan('scan-cancelled-0000001', '2026-09-06T13:00:00.000Z', { endReason: 'cancelled' });
    assert.equal(repository.youtubeHistoryStatus().coverage?.scanId, 'scan-incremental-000001');

    // The scan row keeps the diagnosis.
    const rows = repository.youtubeProgressImports();
    const failed = rows.find((row) => row.scanId === 'scan-no-receiver-00001');
    assert.equal(failed?.endReason, 'no-receiver');
    assert.equal(failed?.landedUrl, 'https://accounts.google.com/');
    assert.match(failed?.error ?? '', /did not load/);
  } finally {
    repository.close();
  }
});

test('a scan summary is only accepted on the completing batch', () => {
  assert.throws(() => normalizeYoutubeProgressBatch({
    scanId: 'scan-summary-0000000001', observedAt: new Date().toISOString(), complete: false, items: [],
    summary: {
      mode: 'full', videos: 0, passes: 0, endReason: 'end-of-history',
      oldestWatchedAt: null, newestWatchedAt: null, error: null, landedUrl: null,
    },
  }), /only accepted on the completing batch/);
  const batch = normalizeYoutubeProgressBatch({
    scanId: 'scan-summary-0000000001', observedAt: new Date().toISOString(), complete: true, items: [],
    summary: {
      mode: 'incremental', videos: 12, passes: 4, endReason: 'covered',
      oldestWatchedAt: '2026-09-02T04:00:00+08:00', newestWatchedAt: null, error: null, landedUrl: null,
    },
  });
  assert.equal(batch.summary?.oldestWatchedAt, '2026-09-01T20:00:00.000Z');
  const paused = normalizeYoutubeProgressBatch({
    scanId: 'scan-paused-00000000001', observedAt: new Date().toISOString(), complete: true, items: [],
    summary: {
      mode: 'full', videos: 0, passes: 1, endReason: 'history-paused',
      oldestWatchedAt: null, newestWatchedAt: null,
      error: 'YouTube watch history is paused.', landedUrl: 'https://www.youtube.com/feed/history',
    },
  });
  assert.equal(paused.summary?.endReason, 'history-paused');
  assert.throws(() => normalizeYoutubeProgressBatch({
    scanId: 'scan-summary-0000000001', observedAt: new Date().toISOString(), complete: true, items: [],
    summary: { mode: 'full', videos: 0, passes: 0, endReason: 'gave-up' },
  }));
});

test('saved progress bounds a full-length estimate across a long inactive gap', () => {
  const repository = new Repository(':memory:');
  const now = new Date('2026-08-17T12:00:00Z');
  try {
    repository.ingestYoutubeArchive({
      archiveHash: 'long-gap-progress-fixture',
      source: 'takeout',
      watches: [{
        eventId: 'long-gap-watch', videoId: 'LONGGAP0001', title: 'Long video',
        url: 'https://www.youtube.com/watch?v=LONGGAP0001', channelId: 'long-channel',
        channelTitle: 'Long Channel', channelUrl: null,
        watchedAt: '2026-08-16T13:35:00Z', actualWatchedSeconds: null,
        activityType: 'video', precision: 'exact',
      }],
      searches: [{
        eventId: 'long-gap-next-activity', searchedAt: '2026-08-17T07:00:00Z',
        queryCiphertext: encryptPrivateValue('next activity', SECRET), activityType: 'search',
      }],
    });
    repository.upsertYoutubeVideoMetadata([{
      videoId: 'LONGGAP0001', title: 'Long video', channelId: 'long-channel',
      channelTitle: 'Long Channel', description: '', tags: [], thumbnailUrl: '',
      durationSeconds: 5760, publishedAt: null, categoryId: null,
      availability: 'available', metadataHash: 'long-gap',
    }]);
    assert.equal(repository.youtubeDashboard('all', now).stats.estimatedWatchSeconds, 5760);

    repository.ingestYoutubeProgress({
      scanId: 'long-gap-progress-scan', observedAt: '2026-08-17T11:00:00Z',
      complete: true,
      items: [{
        videoId: 'LONGGAP0001', progressPercent: null,
        resumeSeconds: 1832, durationSeconds: 5760,
      }],
    });
    assert.equal(repository.youtubeDashboard('all', now).stats.estimatedWatchSeconds, 1832);
  } finally {
    repository.close();
  }
});

test('extension-only data combines measured captures with bounded day-history progress', () => {
  const repository = new Repository(':memory:');
  const now = new Date('2026-07-29T12:00:00Z');
  try {
    repository.ingestYoutubeArchive({
      archiveHash: 'day-progress-estimate-fixture',
      source: 'history-page',
      watches: [
        {
          eventId: 'day-progress-long',
          videoId: 'DAYLONG0001',
          title: 'Long live stream',
          url: 'https://www.youtube.com/watch?v=DAYLONG0001',
          channelId: 'channel-live',
          channelTitle: 'Live Channel',
          channelUrl: null,
          watchedAt: '2026-07-29T04:00:00Z',
          actualWatchedSeconds: null,
          activityType: 'video',
          precision: 'day',
        },
        {
          eventId: 'day-progress-short',
          videoId: 'DAYSHORT001',
          title: 'Short video',
          url: 'https://www.youtube.com/watch?v=DAYSHORT001',
          channelId: 'channel-short',
          channelTitle: 'Short Channel',
          channelUrl: null,
          watchedAt: '2026-07-29T04:00:00Z',
          actualWatchedSeconds: null,
          activityType: 'video',
          precision: 'day',
        },
      ],
      searches: [],
    });
    repository.upsertYoutubeVideoMetadata([
      {
        videoId: 'DAYLONG0001', title: 'Long live stream',
        channelId: 'channel-live', channelTitle: 'Live Channel',
        description: '', tags: [], thumbnailUrl: '', durationSeconds: 86_400,
        publishedAt: null, categoryId: null, availability: 'available', metadataHash: 'day-long',
      },
      {
        videoId: 'DAYSHORT001', title: 'Short video',
        channelId: 'channel-short', channelTitle: 'Short Channel',
        description: '', tags: [], thumbnailUrl: '', durationSeconds: 300,
        publishedAt: null, categoryId: null, availability: 'available', metadataHash: 'day-short',
      },
    ]);
    repository.upsertYoutubeCapture(normalizeYoutubeCapture({
      sessionId: '87654321-4321-4321-8321-cba987654321',
      videoId: 'EXACTEXT001',
      title: 'Measured by the extension',
      url: 'https://www.youtube.com/watch?v=EXACTEXT001',
      channelTitle: 'Measured Channel',
      watchedAt: '2026-07-29T11:30:00Z',
      actualWatchedSeconds: 120,
      durationSeconds: 600,
    }, now));

    // A user does not need Takeout: precise live captures retain their
    // measured seconds, while older day-history rows use bounded estimates.
    const extensionOnly = repository.youtubeDashboard('all', now);
    assert.equal(extensionOnly.stats.estimatedWatchSeconds, 1020);
    assert.deepEqual(extensionOnly.rhythmCoverage, { exactWatches: 1, dateOnlyWatches: 2 });
    assert.deepEqual(extensionOnly.hourly.map(({ hour, watches }) => ({ hour, watches })), [
      { hour: 19, watches: 1 },
    ]);
    repository.ingestYoutubeProgress({
      scanId: 'day-progress-scan-123456',
      observedAt: '2026-07-29T11:00:00.000Z',
      complete: true,
      items: [{
        videoId: 'DAYLONG0001', progressPercent: null,
        resumeSeconds: 60, durationSeconds: 86_400,
      }],
    });

    // A newly stored position invalidates the materialized estimate now,
    // rather than leaving the old number visible for five minutes.
    assert.equal(repository.youtubeDashboard('all', now).stats.estimatedWatchSeconds, 480);
  } finally {
    repository.close();
  }
});

test('AI taxonomy and classification queues prioritize recently watched videos', () => {
  const repository = new Repository(':memory:');
  try {
    repository.ingestYoutubeArchive({
      archiveHash: 'classification-recency-fixture',
      source: 'takeout',
      watches: [
        {
          eventId: 'classification-old', videoId: 'CLASSOLD001', title: 'Old',
          url: 'https://www.youtube.com/watch?v=CLASSOLD001', channelId: null,
          channelTitle: 'Channel', channelUrl: null, watchedAt: '2025-01-01T00:00:00Z',
          actualWatchedSeconds: null, activityType: 'video',
        },
        {
          eventId: 'classification-new', videoId: 'CLASSNEW001', title: 'New',
          url: 'https://www.youtube.com/watch?v=CLASSNEW001', channelId: null,
          channelTitle: 'Channel', channelUrl: null, watchedAt: '2026-07-29T00:00:00Z',
          actualWatchedSeconds: null, activityType: 'video',
        },
      ],
      searches: [],
    });
    repository.upsertYoutubeVideoMetadata([
      {
        videoId: 'CLASSOLD001', title: 'Old', channelId: null, channelTitle: 'Channel',
        description: '', tags: [], thumbnailUrl: '', durationSeconds: 300,
        publishedAt: null, categoryId: null, availability: 'available', metadataHash: 'old',
      },
      {
        videoId: 'CLASSNEW001', title: 'New', channelId: null, channelTitle: 'Channel',
        description: '', tags: [], thumbnailUrl: '', durationSeconds: 300,
        publishedAt: null, categoryId: null, availability: 'available', metadataHash: 'new',
      },
    ]);
    const [topic] = repository.replaceYoutubeTaxonomy([{
      version: 1, slug: 'recent-topic', name: 'Recent topic', description: 'Recent videos',
    }]);
    repository.saveYoutubeVideoTopics(
      'CLASSNEW001', [{ topicId: topic.id, rank: 1, confidence: 1 }],
      'test-model', 'test-prompt', 'new',
    );
    const partial = repository.youtubeDashboard('all');
    assert.equal(partial.stats.topicCoverage, 0.5);
    assert.equal(partial.topics[0]?.slug, 'recent-topic');
    const partialPage = youtubeDashboardPage('Fixture', partial, 'duration', {
      lang: 'en', page: 'overview',
    });
    assert.match(partialPage, /Processed 50% · effective 50% · Unknown 0%/);
    assert.match(partialPage, /Effective coverage is below 80%/);
    assert.doesNotMatch(partialPage, /<div class="yt-topic"><strong>Recent topic/);

    const sample = samplePersonalTaxonomy(repository.youtubePersonalTaxonomyCandidates(), 2);
    const run = repository.createPersonalTaxonomyRun({
      definitionVersion: PERSONAL_TAXONOMY_DEFINITION_VERSION,
      model: 'test-model',
      promptVersion: PERSONAL_TAXONOMY_PROMPT_VERSION,
      topics: PERSONAL_TOPICS.map(({ slug, name, description }) => ({ slug, name, description })),
      sample,
    });
    assert.equal(
      repository.youtubeVideosForPersonalClassification(run, 1)[0]?.videoId,
      'CLASSNEW001',
    );

    repository.upsertYoutubeVideoMetadata([{
      videoId: 'CLASSNEW001', title: 'New', channelId: null, channelTitle: 'Channel',
      description: 'changed', tags: [], thumbnailUrl: '', durationSeconds: 300,
      publishedAt: null, categoryId: null, availability: 'available', metadataHash: 'newer',
    }]);
    const stale = repository.youtubeDashboard('all');
    assert.equal(stale.stats.topicCoverage, 0);
    assert.deepEqual(stale.topics, []);
  } finally {
    repository.close();
  }
});

test('topic trend uses exact-time events, current classifications, and weighted moving shares', () => {
  const repository = new Repository(':memory:');
  const now = new Date('2026-05-15T00:00:00Z');
  const watch = (
    eventId: string,
    videoId: string,
    watchedAt: string,
    seconds: number,
    precision: 'exact' | 'day' = 'exact',
  ) => ({
    eventId, videoId, title: videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    channelId: null, channelTitle: 'Fixture Channel', channelUrl: null,
    watchedAt, actualWatchedSeconds: seconds, activityType: 'video' as const, precision,
  });
  try {
    repository.ingestYoutubeArchive({
      archiveHash: 'topic-trend-fixture', source: 'takeout', searches: [],
      watches: [
        watch('trend-jan', 'TRENDA00001', '2026-01-10T02:00:00Z', 100),
        watch('trend-feb', 'TRENDA00002', '2026-02-10T02:00:00Z', 100),
        watch('trend-mar', 'TRENDB00001', '2026-03-10T02:00:00Z', 300),
        watch('trend-mar-pending', 'PENDING0001', '2026-03-11T02:00:00Z', 100),
        watch('trend-apr', 'TRENDB00002', '2026-04-10T02:00:00Z', 100),
        watch('trend-day-only', 'TRENDB00003', '2026-04-11T04:00:00Z', 900, 'day'),
      ],
    });
    const metadata = (videoId: string): YoutubeVideoMetadata => ({
      videoId, title: videoId, channelId: null, channelTitle: 'Fixture Channel',
      description: '', tags: [], thumbnailUrl: '', durationSeconds: 1200,
      publishedAt: null, categoryId: null, availability: 'available', metadataHash: `${videoId}-v1`,
    });
    repository.upsertYoutubeVideoMetadata([
      'TRENDA00001', 'TRENDA00002', 'TRENDB00001', 'TRENDB00002', 'TRENDB00003', 'PENDING0001',
    ].map(metadata));
    const [alpha, beta] = repository.replaceYoutubeTaxonomy([
      { version: 1, slug: 'alpha', name: 'Alpha', description: 'Alpha fixture' },
      { version: 1, slug: 'beta', name: 'Beta', description: 'Beta fixture' },
    ]);
    for (const videoId of ['TRENDA00001', 'TRENDA00002']) {
      repository.saveYoutubeVideoTopics(videoId, [{ topicId: alpha.id, rank: 1, confidence: 1 }],
        'test-model', 'test-prompt', `${videoId}-v1`);
    }
    for (const videoId of ['TRENDB00001', 'TRENDB00002', 'TRENDB00003']) {
      repository.saveYoutubeVideoTopics(videoId, [{ topicId: beta.id, rank: 1, confidence: 1 }],
        'test-model', 'test-prompt', `${videoId}-v1`);
    }

    const trend = repository.youtubeTopicTrend('365d', now);
    assert.equal(trend.length, 13);
    assert.equal(trend[0].month, '2025-05');
    assert.equal(trend.at(-1)?.month, '2026-05');
    const march = trend.find((month) => month.month === '2026-03')!;
    assert.deepEqual(
      { classifiable: march.classifiableWatchEvents, classified: march.classifiedWatchEvents,
        coverage: march.classificationCoverage, seconds: march.classifiedWatchSeconds },
      { classifiable: 2, classified: 1, coverage: 0.5, seconds: 300 },
    );
    assert.equal(march.topics.find((topic) => topic.slug === 'alpha')?.movingAverageShare, 0.4);
    assert.equal(march.topics.find((topic) => topic.slug === 'beta')?.movingAverageShare, 0.6);
    const april = trend.find((month) => month.month === '2026-04')!;
    assert.equal(april.classifiableWatchEvents, 1);
    assert.equal(april.classifiedWatchSeconds, 100);
    assert.equal(april.topics.find((topic) => topic.slug === 'alpha')?.movingAverageShare, 0.2);
    assert.equal(april.topics.find((topic) => topic.slug === 'beta')?.movingAverageShare, 0.8);

    const sevenDays = repository.youtubeTopicTrend('7d', now);
    assert.equal(sevenDays.length, 8);
    assert.match(sevenDays[0].month, /^2026-05-0[78]$/);
    assert.equal(sevenDays.at(-1)?.month, '2026-05-15');
    const allTime = repository.youtubeTopicTrend('all', now);
    assert.deepEqual(allTime.map((period) => period.month), [
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05',
    ]);

    const html = youtubeDashboardPage('Fixture', repository.youtubeDashboard('all', now), 'duration', {
      lang: 'zh', page: 'overview',
    });
    assert.match(html, /主題動態/);
    assert.match(html, /依頁面範圍/);
    assert.match(html, /data-trend-smoothing="raw"/);
    assert.match(html, /已分類 50% · 暫定/);
    assert.match(html, /只納入精確時間紀錄/);
    assert.match(html, /\.yt-short-absolute\{[^}]*overflow:hidden/,
      'dense history columns stay contained instead of widening the mobile page');
  } finally {
    repository.close();
  }
});

test('365-day dashboard range excludes older watches', () => {
  const repository = new Repository(':memory:');
  try {
    repository.ingestYoutubeArchive({
      archiveHash: 'range-365-fixture',
      source: 'takeout',
      watches: [
        {
          eventId: 'range-365-inside',
          videoId: 'inside365aa',
          title: 'Inside the yearly range',
          url: 'https://www.youtube.com/watch?v=inside365aa',
          channelId: null,
          channelTitle: 'Yearly Channel',
          channelUrl: null,
          watchedAt: '2025-08-30T00:00:00.000Z',
          actualWatchedSeconds: null,
          activityType: 'video',
        },
        {
          eventId: 'range-365-outside',
          videoId: 'outside365a',
          title: 'Outside the yearly range',
          url: 'https://www.youtube.com/watch?v=outside365a',
          channelId: null,
          channelTitle: 'Yearly Channel',
          channelUrl: null,
          watchedAt: '2025-08-28T00:00:00.000Z',
          actualWatchedSeconds: null,
          activityType: 'video',
        },
      ],
      searches: [],
    });

    const now = new Date('2026-08-29T00:00:00.000Z');
    assert.equal(repository.youtubeDashboard('365d', now).stats.watchEvents, 1);
    assert.equal(repository.youtubeDashboard('all', now).stats.watchEvents, 2);
  } finally {
    repository.close();
  }
});

test('Data Portability combined activity JSON uses the same parser', () => {
  const combined = [
    {
      header: 'YouTube', title: 'Watched Combined Export',
      titleUrl: 'https://www.youtube.com/watch?v=combined-id',
      time: '2026-07-27T12:00:00Z',
    },
    {
      header: 'YouTube', title: 'Searched for combined private query',
      time: '2026-07-27T11:00:00Z',
    },
  ];
  const archive = zipSync({
    'My Activity/YouTube/MyActivity.json': strToU8(JSON.stringify(combined)),
  });
  const parsed: YoutubeParsedArchive = parseYoutubeArchive(archive, SECRET, 'dataportability');
  assert.equal(parsed.source, 'dataportability');
  assert.equal(parsed.watches[0].videoId, 'combined-id');
  assert.equal(parsed.searches.length, 1);
});

test('YouTube metadata fetches in batches of 50 and retains unavailable videos', async () => {
  const ids = Array.from({ length: 51 }, (_, index) => `video-${index + 1}`);
  const requests: string[][] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const requested = new URL(String(input)).searchParams.get('id')!.split(',');
    requests.push(requested);
    const foundId = requested[0];
    return new Response(JSON.stringify({
      items: [{
        id: foundId,
        snippet: {
          title: `Title ${foundId}`,
          channelId: 'channel-id',
          channelTitle: 'Channel',
          description: 'Public description',
          tags: ['tag'],
          thumbnails: { high: { url: `https://i.ytimg.com/vi/${foundId}/hqdefault.jpg` } },
          publishedAt: '2026-07-01T00:00:00Z',
          categoryId: '28',
        },
        contentDetails: { duration: 'PT1H2M3S' },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const metadata = await fetchYoutubeMetadata(ids, 'test-api-key', fetchImpl);
  assert.deepEqual(requests.map((batch) => batch.length), [50, 1]);
  assert.equal(metadata.length, 51);
  assert.equal(metadata.find((video) => video.videoId === 'video-1')?.durationSeconds, 3723);
  assert.equal(metadata.find((video) => video.videoId === 'video-2')?.availability, 'unavailable');
  assert.equal(metadata.find((video) => video.videoId === 'video-51')?.availability, 'available');

  const failingFetch = (async () => new Response('quota exhausted', { status: 403 })) as typeof fetch;
  await assert.rejects(
    fetchYoutubeMetadata(['video-1'], 'test-api-key', failingFetch),
    /YouTube Data API: HTTP 403: quota exhausted/,
  );
});

test('YouTube channel metadata fetches avatars in batches and caches missing channels', async () => {
  const ids = Array.from({ length: 51 }, (_, index) => `channel-${index + 1}`);
  const requests: string[][] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    assert.equal(new URL(String(input)).searchParams.get('part'), 'snippet,statistics,topicDetails');
    const requested = new URL(String(input)).searchParams.get('id')!.split(',');
    requests.push(requested);
    const foundId = requested[0];
    return new Response(JSON.stringify({
      items: [{
        id: foundId,
        snippet: {
          title: `Channel ${foundId}`,
          publishedAt: '2017-01-01T00:00:00Z',
          thumbnails: { high: { url: `https://yt3.ggpht.com/${foundId}` } },
        },
        statistics: { subscriberCount: '3680000', hiddenSubscriberCount: false, videoCount: '81', viewCount: '2000000000' },
        topicDetails: { topicCategories: ['https://en.wikipedia.org/wiki/Rock_music'] },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const metadata = await fetchYoutubeChannelMetadata(ids, 'test-api-key', fetchImpl);
  assert.deepEqual(requests.map((batch) => batch.length), [50, 1]);
  assert.equal(metadata.length, 51);
  assert.equal(metadata[0].thumbnailUrl, 'https://yt3.ggpht.com/channel-1');
  assert.deepEqual(metadata[0].statistics, { subscriberCount: 3680000, hiddenSubscriberCount: false, videoCount: 81, viewCount: 2000000000, publishedAt: '2017-01-01T00:00:00Z', topicCategories: ['https://en.wikipedia.org/wiki/Rock_music'] });
  assert.deepEqual(metadata[1], { channelId: 'channel-2', name: '', thumbnailUrl: '', statistics: {
    subscriberCount: null, hiddenSubscriberCount: false, videoCount: null, viewCount: null, publishedAt: null, topicCategories: [],
  } });

  const failingFetch = (async () => new Response('quota exhausted', { status: 403 })) as typeof fetch;
  await assert.rejects(
    fetchYoutubeChannelMetadata(['channel-1'], 'test-api-key', failingFetch),
    /YouTube Channels API: HTTP 403: quota exhausted/,
  );
});

test('YouTube keywords segment Unicode, ignore URLs, and count each video once', () => {
  const keywords = extractYoutubeKeywords([
    {
      title: 'TypeScript 系統設計 システム設計',
      description: 'See https://www.youtube.com/watch?v=private and build reliable systems',
      tags_json: '["TypeScript patterns","系統 設計"]',
    },
    {
      title: 'TypeScript 系統設計',
      description: 'Reliable systems in production',
      tags_json: '["TypeScript patterns"]',
    },
    {
      title: 'https://www.youtube.com/watch?v=deleted',
      description: null,
      tags_json: '[]',
    },
  ], 30);
  // v2 phrase dominance: every "typescript" video also carries the phrase,
  // so the phrase is kept and the bare unigram yields to it.
  assert.ok(!keywords.some((keyword) => keyword.term === 'typescript'));
  assert.ok(keywords.some((keyword) => keyword.term === 'typescript patterns'));
  assert.ok(keywords.some((keyword) => keyword.term.includes('系統')));
  assert.ok(!keywords.some((keyword) => /https|youtube|watch|private/.test(keyword.term)));
  assert.equal(keywords.find((keyword) => keyword.term === 'typescript patterns')?.videos, 2);

  const stopWords = extractYoutubeKeywords([
    { title: 'My full video', description: 'Get more of that here. Follow my Twitter and Discord link.', tags_json: '[]' },
    { title: 'My full video', description: 'Get more of that here. Follow my Twitter and Discord link.', tags_json: '[]' },
  ]);
  assert.deepEqual(stopWords, []);
});

test('classification feeds rejections back to the model and skips a stubborn batch', async () => {
  const repository = new Repository(':memory:');
  try {
    const metadata = Array.from({ length: 24 }, (_, index): YoutubeVideoMetadata => ({
      videoId: `RTRYVID${String(index).padStart(4, "0")}`,
      title: `Technical Video ${index + 1}`,
      channelId: `channel-${index % 12 + 1}`,
      channelTitle: `Channel ${index % 12 + 1}`,
      description: 'A public description about software and culture.',
      tags: ['software', 'culture'],
      thumbnailUrl: '',
      durationSeconds: 1200,
      publishedAt: '2026-07-01T00:00:00Z',
      categoryId: '28',
      availability: 'available',
      metadataHash: `hash-${index + 1}`,
    }));
    for (const [index, video] of metadata.entries()) {
      repository.upsertYoutubeCapture(normalizeYoutubeCapture({
        sessionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        videoId: video.videoId,
        title: video.title,
        url: `https://www.youtube.com/watch?v=${video.videoId}`,
        channelTitle: video.channelTitle,
        watchedAt: `2026-07-${String(index % 24 + 1).padStart(2, '0')}T00:00:00.000Z`,
        actualWatchedSeconds: 300,
        durationSeconds: 1200,
      }, new Date('2026-07-28T00:00:00Z')));
    }
    repository.upsertYoutubeVideoMetadata(metadata, '2026-07-28T00:00:00Z');

    const requests: Array<{ batch: number; feedback: string | null }> = [];
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
      const users = request.messages.filter((message) => message.role === 'user');
      const payload = JSON.parse(users[0]!.content) as { videos: Array<{ videoId: string }> };
      const feedback = users[1]?.content ?? null;
      requests.push({ batch: payload.videos.length, feedback });
      // The 20-video batch answers with unverifiable evidence once, then
      // correctly after feedback. The 4-video batch never gets it right.
      const attemptsForBatch = requests.filter((entry) => entry.batch === payload.videos.length).length;
      const good = payload.videos.length === 20 && attemptsForBatch >= 2;
      const content = {
        videos: payload.videos.map((video) => ({
          videoId: video.videoId,
          slug: 'technology',
          confidence: 0.9,
          alternativeSlug: null,
          alternativeConfidence: null,
          evidence: [{ text: good ? 'Technical Video' : 'Not in the metadata', source: 'title', score: 0.9 }],
        })),
      };
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const client: YoutubeAiClient = { baseUrl: 'https://ai.example.test/v1', apiKey: 'test-key', model: 'test-model', fetchImpl };
    await ensureYoutubeTaxonomyWithClient(repository, false, client);

    assert.equal(await classifyYoutubeVideosWithClient(repository, 100, client), 20);
    const shape = (entries: typeof requests) => entries
      .map((entry) => [entry.batch, entry.feedback === null ? null : /rejected: Personal classification evidence must occur/.test(entry.feedback)] as const)
      .sort((a, b) => b[0] - a[0] || Number(a[1]) - Number(b[1]));
    assert.deepEqual(shape(requests), [[20, null], [20, true], [4, null], [4, true], [4, true]]);
    // Only the skipped batch remains; it is retried on the next cycle and
    // the cycle reports the failure when nothing at all could be saved.
    await assert.rejects(classifyYoutubeVideosWithClient(repository, 100, client), /must occur in its declared metadata source/);
    assert.equal(requests.length, 8);
    assert.equal(requests.slice(5).every((entry) => entry.batch === 4), true);
  } finally {
    repository.close();
  }
});

test('personal taxonomy v2 is gated, versioned, restart-safe, and public-metadata only', async () => {
  const repository = new Repository(':memory:');
  try {
    const metadata = Array.from({ length: 24 }, (_, index): YoutubeVideoMetadata => ({
      videoId: `AIVIDEO${String(index).padStart(4, '0')}`,
      title: `Technical Video ${index + 1}`,
      channelId: `channel-${index % 12 + 1}`,
      channelTitle: `Channel ${index % 12 + 1}`,
      description: 'A public description about software and culture.',
      tags: ['software', 'culture'],
      thumbnailUrl: `https://i.ytimg.com/vi/ai-video-${index + 1}/hqdefault.jpg`,
      durationSeconds: 1200,
      publishedAt: '2026-07-01T00:00:00Z',
      categoryId: '28',
      availability: 'available',
      metadataHash: `hash-${index + 1}`,
    }));
    for (const [index, video] of metadata.entries()) {
      repository.upsertYoutubeCapture(normalizeYoutubeCapture({
        sessionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        videoId: video.videoId,
        title: video.title,
        url: `https://www.youtube.com/watch?v=${video.videoId}`,
        channelTitle: video.channelTitle,
        watchedAt: `2026-07-${String(index % 24 + 1).padStart(2, '0')}T00:00:00.000Z`,
        actualWatchedSeconds: 300,
        durationSeconds: 1200,
      }, new Date('2026-07-28T00:00:00Z')));
    }
    assert.equal((await ensureYoutubeTaxonomyWithClient(repository, false, {
      baseUrl: 'https://ai.example.test/v1', apiKey: 'test-key', model: 'test-model',
      fetchImpl: (async () => { throw new Error('must not run'); }) as typeof fetch,
    })).length, 0);
    repository.upsertYoutubeVideoMetadata(metadata, '2026-07-28T00:00:00Z');

    const payloads: unknown[] = [];
    let classificationCalls = 0;
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      const payload = JSON.parse(request.messages.find((message) => message.role === 'user')!.content) as any;
      payloads.push(payload);
      classificationCalls++;
      const content = {
        videos: payload.videos.map((video: { videoId: string; title: string }) => ({
          videoId: video.videoId,
          slug: 'technology',
          confidence: 0.9,
          alternativeSlug: 'learning',
          alternativeConfidence: 0.3,
          evidence: [{ text: 'Technical Video', source: 'title', score: 0.9 }],
        })),
      };
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(content) } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const client: YoutubeAiClient = {
      baseUrl: 'https://ai.example.test/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl,
    };

    assert.deepEqual(
      await ensureYoutubeTaxonomyWithClient(
        repository,
        false,
        { ...client, fetchImpl: undefined }
      ),
      [],
    );
    const firstTopics = await ensureYoutubeTaxonomyWithClient(repository, false, client);
    assert.equal(firstTopics.length, 14);
    assert.equal(firstTopics[0].version, 1);
    assert.equal(await classifyYoutubeVideosWithClient(repository, 100, client), 24);
    assert.equal(classificationCalls, 2);
    assert.equal(await classifyYoutubeVideosWithClient(repository, 100, client), 0);
    assert.equal(classificationCalls, 2);
    const firstRun = repository.youtubeTaxonomyRun(1)!;
    assert.equal(firstRun.status, 'ready');
    assert.equal(firstRun.quality?.passed, true);
    repository.activatePersonalTaxonomy(1, '2026-07-28T01:00:00Z');

    const rebuilt = await ensureYoutubeTaxonomyWithClient(repository, true, client);
    assert.equal(rebuilt[0].version, 2);
    assert.equal(await classifyYoutubeVideosWithClient(repository, 100, client), 24);
    assert.equal(classificationCalls, 4);
    repository.activatePersonalTaxonomy(2, '2026-07-28T02:00:00Z');
    assert.deepEqual(repository.youtubeTaxonomyActivations().map((entry) => entry.toVersion), [2, 1]);

    const serializedPayloads = JSON.stringify(payloads);
    assert.doesNotMatch(serializedPayloads, /watchedAt|searchedAt|queryCiphertext|actualWatchedSeconds/);
    assert.deepEqual(Object.keys(youtubePublicMetadata(metadata[0])).sort(), [
      'channel', 'description', 'tags', 'title', 'videoId',
    ]);

    repository.upsertYoutubeVideoMetadata([
      { ...metadata[0], metadataHash: 'changed-metadata-hash' },
    ], '2026-07-29T00:00:00Z');
    const invalidClient: YoutubeAiClient = {
      ...client,
      fetchImpl: (async () => new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          videos: [{
            videoId: metadata[0].videoId, slug: 'invented', confidence: 0.9,
            alternativeSlug: null, alternativeConfidence: null, evidence: [],
          }],
        }) } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch,
    };
    await assert.rejects(
      classifyYoutubeVideosWithClient(repository, 100, invalidClient),
      /unknown topic/,
    );

    let retryCalls = 0;
    const retryClient: YoutubeAiClient = {
      ...client,
      fetchImpl: (async (_input: string | URL | Request, init?: RequestInit) => {
        retryCalls++;
        const request = JSON.parse(String(init?.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        const payload = JSON.parse(
          request.messages.find((message) => message.role === 'user')!.content
        ) as any;
        const videos = retryCalls === 1 ? [] : payload.videos.map((video: { videoId: string }) => ({
          videoId: video.videoId,
          slug: 'technology', confidence: 0.9,
          alternativeSlug: null, alternativeConfidence: null,
          evidence: [{ text: 'Technical Video', source: 'title', score: 0.9 }],
        }));
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ videos }) } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch,
    };
    assert.equal(await classifyYoutubeVideosWithClient(repository, 100, retryClient), 1);
    assert.equal(retryCalls, 2);
  } finally {
    repository.close();
  }
});

function portabilityZip(videoId: string, title: string, time: string): Uint8Array {
  return zipSync({
    'My Activity/YouTube/MyActivity.json': strToU8(JSON.stringify([
      {
        header: 'YouTube',
        title: `Watched ${title}`,
        titleUrl: `https://www.youtube.com/watch?v=${videoId}`,
        time,
      },
      {
        header: 'YouTube',
        title: `Searched for query-${videoId}`,
        time,
      },
    ])),
  });
}

test('Data Portability enforces daily starts, polls jobs, and advances checkpoint after import', async () => {
  const repository = new Repository(':memory:');
  try {
    const startAt = new Date('2026-07-28T20:00:00.000Z');
    let initiateBody: Record<string, unknown> | null = null;
    const initiateFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      assert.match(String(input), /portabilityArchive:initiate$/);
      initiateBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response('{"archiveJobId":"job-1"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    assert.equal(await runYoutubePortabilityStep(repository, {
      now: startAt,
      fetchImpl: initiateFetch,
      accessToken: 'access-token',
    }), 'started');
    assert.deepEqual(initiateBody, {
      resources: ['myactivity.youtube'],
      end_time: startAt.toISOString(),
    });

    const inProgressFetch = (async () => new Response('{"state":"IN_PROGRESS"}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
    assert.equal(await runYoutubePortabilityStep(repository, {
      now: new Date(startAt.getTime() + 30 * 60_000),
      fetchImpl: inProgressFetch,
      accessToken: 'access-token',
    }), 'in_progress');

    const archive = portabilityZip('portable-video', 'Portable Video', '2026-07-28T19:30:00Z');
    const completeFetch = (async (input: string | URL | Request) => {
      if (String(input).includes('portabilityArchiveState')) {
        return new Response('{"state":"COMPLETE","urls":["https://download.example/archive.zip"]}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(Buffer.from(archive), { status: 200 });
    }) as typeof fetch;
    const completedAt = new Date(startAt.getTime() + 60 * 60_000);
    assert.equal(await runYoutubePortabilityStep(repository, {
      now: completedAt,
      fetchImpl: completeFetch,
      accessToken: 'access-token',
    }), 'imported');
    assert.equal(repository.youtubeSyncState('checkpoint'), startAt.toISOString());
    assert.deepEqual(repository.youtubeCounts(), {
      watches: 1,
      videoWatches: 1,
      videos: 1,
      searches: 1,
      searchQueries: 1,
      channels: 0,
    });

    const unexpectedFetch = (async () => {
      throw new Error('daily limit should avoid a network request');
    }) as typeof fetch;
    assert.equal(await runYoutubePortabilityStep(repository, {
      now: new Date(startAt.getTime() + 2 * 60 * 60_000),
      fetchImpl: unexpectedFetch,
      accessToken: 'access-token',
    }), 'idle');
  } finally {
    repository.close();
  }
});

test('Data Portability overlaps one day and retries failed downloads without moving checkpoint', async () => {
  const overlapRepository = new Repository(':memory:');
  try {
    overlapRepository.setYoutubeSyncState('checkpoint', '2026-07-20T00:00:00.000Z');
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response('{"archiveJobId":"overlap-job"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    assert.equal(await runYoutubePortabilityStep(overlapRepository, {
      now: new Date('2026-07-28T20:00:00.000Z'),
      fetchImpl,
      accessToken: 'access-token',
    }), 'started');
    assert.equal(body.start_time, '2026-07-19T00:00:00.000Z');
  } finally {
    overlapRepository.close();
  }

  const retryRepository = new Repository(':memory:');
  try {
    const endTime = '2026-07-28T20:00:00.000Z';
    retryRepository.setYoutubeSyncState('checkpoint', '2026-07-20T00:00:00.000Z');
    retryRepository.setYoutubeSyncState('active_job', JSON.stringify({ id: 'retry-job', endTime }));
    const firstArchive = portabilityZip('retry-video-1', 'First Download', '2026-07-28T18:00:00Z');
    const secondArchive = portabilityZip('retry-video-2', 'Second Download', '2026-07-28T19:00:00Z');
    let failSecond = true;
    const retryFetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('portabilityArchiveState')) {
        return new Response('{"state":"COMPLETE","urls":["https://download.example/one.zip","https://download.example/two.zip"]}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/one.zip')) return new Response(Buffer.from(firstArchive), { status: 200 });
      if (failSecond) return new Response('temporary failure', { status: 503 });
      return new Response(Buffer.from(secondArchive), { status: 200 });
    }) as typeof fetch;

    await assert.rejects(
      runYoutubePortabilityStep(retryRepository, {
        now: new Date('2026-07-28T21:00:00.000Z'),
        fetchImpl: retryFetch,
        accessToken: 'access-token',
      }),
      /Data Portability download: HTTP 503/,
    );
    assert.equal(retryRepository.youtubeCounts().watches, 1);
    assert.equal(retryRepository.youtubeSyncState('checkpoint'), '2026-07-20T00:00:00.000Z');
    assert.match(retryRepository.youtubeSyncState('active_job') ?? '', /retry-job/);

    failSecond = false;
    assert.equal(await runYoutubePortabilityStep(retryRepository, {
      now: new Date('2026-07-28T22:00:00.000Z'),
      fetchImpl: retryFetch,
      accessToken: 'access-token',
    }), 'imported');
    assert.equal(retryRepository.youtubeCounts().watches, 2);
    assert.equal(retryRepository.youtubeCounts().searches, 2);
    assert.equal(retryRepository.youtubeSyncState('checkpoint'), endTime);
    assert.equal(repositoryStateJson(retryRepository, 'last_result').watchesInserted, 1);
  } finally {
    retryRepository.close();
  }
});

function repositoryStateJson(repository: Repository, key: string): Record<string, any> {
  return JSON.parse(repository.youtubeSyncState(key) ?? '{}') as Record<string, any>;
}

test('OAuth state is single-use and expires', () => {
  const repository = new Repository(':memory:');
  try {
    repository.createYoutubeOAuthState('valid-state', '2026-07-28T00:10:00.000Z');
    assert.equal(repository.consumeYoutubeOAuthState('valid-state', '2026-07-28T00:05:00.000Z'), true);
    assert.equal(repository.consumeYoutubeOAuthState('valid-state', '2026-07-28T00:06:00.000Z'), false);
    repository.createYoutubeOAuthState('expired-state', '2026-07-28T00:01:00.000Z');
    assert.equal(repository.consumeYoutubeOAuthState('expired-state', '2026-07-28T00:02:00.000Z'), false);
  } finally {
    repository.close();
  }
});
