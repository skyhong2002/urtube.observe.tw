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

test('private-value encryption is randomized and authenticated', () => {
  const first = encryptPrivateValue('sensitive', SECRET);
  const second = encryptPrivateValue('sensitive', SECRET);
  assert.notEqual(first, second);
  assert.equal(decryptPrivateValue(first, SECRET), 'sensitive');
  assert.throws(() => decryptPrivateValue(`${first.slice(0, -1)}x`, SECRET));
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
    assert.deepEqual(repository.youtubeChannelsNeedingMetadata(), []);
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
      { day: '2026-07-28', shortWatchSeconds: 60, knownDurationWatchSeconds: 60 },
      { day: '2026-07-29', shortWatchSeconds: 30, knownDurationWatchSeconds: 150 },
    ]);
    const defaultPage = youtubeDashboardPage('Fixture', dashboard, 'duration', {
      lang: 'zh',
    });
    assert.match(defaultPage, /yt-rhythm-clocks/);
    assert.match(defaultPage, /yt-rhythm-sector/);
    assert.match(defaultPage, /Shorts 與一般影片時間/);
    assert.match(defaultPage, /yt-short-segment/);
    assert.match(defaultPage, /yt-regular-segment/);
    assert.doesNotMatch(defaultPage, /yt-short-line-chart/);
    assert.match(defaultPage, /data-youtube-sort="watches"/);
    assert.match(defaultPage, /data-youtube-sort-list="channels"/);
    assert.match(defaultPage, /history\.pushState/);
    for (const script of defaultPage.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      assert.doesNotThrow(() => Function(script[1]));
    }
    assert.match(youtubeDashboardPage('Fixture', dashboard, 'duration', {
      lang: 'zh', shortFormVariant: 'stacked',
    }), /方案 A · 100% 組成趨勢/);
    assert.match(youtubeDashboardPage('Fixture', dashboard, 'duration', {
      lang: 'zh', shortFormVariant: 'compare',
    }), /方案 B · 前後期比較/);
    assert.match(youtubeDashboardPage('Fixture', dashboard, 'duration', {
      lang: 'zh', shortFormVariant: 'heatmap',
    }), /方案 C · 年月熱圖/);
    assert.match(youtubeDashboardPage('Fixture', dashboard, 'duration', {
      lang: 'zh', shortFormVariant: 'absolute',
    }), /Shorts 與一般影片時間/);
    assert.match(youtubeDashboardPage('Fixture', dashboard, 'duration', {
      lang: 'zh', shortFormVariant: 'dual',
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
    assert.equal(repository.youtubeDashboard('all', now).stats.estimatedWatchSeconds, 1020);
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
    assert.equal(repository.youtubeVideosForClassification(1)[0]?.videoId, 'CLASSNEW001');
    assert.equal(repository.youtubeVideosForTaxonomy(12)[0]?.videoId, 'CLASSNEW001');

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
    const requested = new URL(String(input)).searchParams.get('id')!.split(',');
    requests.push(requested);
    const foundId = requested[0];
    return new Response(JSON.stringify({
      items: [{
        id: foundId,
        snippet: {
          title: `Channel ${foundId}`,
          thumbnails: { high: { url: `https://yt3.ggpht.com/${foundId}` } },
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const metadata = await fetchYoutubeChannelMetadata(ids, 'test-api-key', fetchImpl);
  assert.deepEqual(requests.map((batch) => batch.length), [50, 1]);
  assert.equal(metadata.length, 51);
  assert.equal(metadata[0].thumbnailUrl, 'https://yt3.ggpht.com/channel-1');
  assert.deepEqual(metadata[1], { channelId: 'channel-2', name: '', thumbnailUrl: '' });

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
  assert.ok(keywords.some((keyword) => keyword.term === 'typescript'));
  assert.ok(keywords.some((keyword) => keyword.term === 'typescript patterns'));
  assert.ok(keywords.some((keyword) => keyword.term.includes('系統')));
  assert.ok(!keywords.some((keyword) => /https|youtube|watch|private/.test(keyword.term)));
  assert.equal(keywords.find((keyword) => keyword.term === 'typescript')?.videos, 2);

  const stopWords = extractYoutubeKeywords([
    { title: 'My full video', description: 'Get more of that here. Follow my Twitter and Discord link.', tags_json: '[]' },
    { title: 'My full video', description: 'Get more of that here. Follow my Twitter and Discord link.', tags_json: '[]' },
  ]);
  assert.deepEqual(stopWords, []);
});

test('AI taxonomy is versioned, validated, cached, and receives only public metadata', async () => {
  const repository = new Repository(':memory:');
  try {
    const metadata = Array.from({ length: 12 }, (_, index): YoutubeVideoMetadata => ({
      videoId: `ai-video-${index + 1}`,
      title: `Technical Video ${index + 1}`,
      channelId: `channel-${index + 1}`,
      channelTitle: `Channel ${index + 1}`,
      description: 'A public description about software and culture.',
      tags: ['software', 'culture'],
      thumbnailUrl: `https://i.ytimg.com/vi/ai-video-${index + 1}/hqdefault.jpg`,
      durationSeconds: 1200,
      publishedAt: '2026-07-01T00:00:00Z',
      categoryId: '28',
      availability: 'available',
      metadataHash: `hash-${index + 1}`,
    }));
    repository.upsertYoutubeVideoMetadata(metadata, '2026-07-28T00:00:00Z');

    const payloads: unknown[] = [];
    let taxonomyGeneration = 1;
    let classificationCalls = 0;
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      const payload = JSON.parse(request.messages.find((message) => message.role === 'user')!.content) as any;
      payloads.push(payload);
      const content = payload.topics
        ? (() => {
            classificationCalls++;
            return {
              videos: payload.videos.map((video: { videoId: string }) => ({
                videoId: video.videoId,
                topics: [{ slug: payload.topics[0].slug, confidence: 0.9 }],
              })),
            };
          })()
        : {
            topics: Array.from({ length: 12 }, (_, index) => ({
              slug: `topic-${taxonomyGeneration}-${index + 1}`,
              name: `Topic ${taxonomyGeneration}.${index + 1}`,
              description: `Stable topic ${taxonomyGeneration}.${index + 1}`,
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
    assert.equal(firstTopics.length, 12);
    assert.equal(firstTopics[0].version, 1);
    assert.equal(await classifyYoutubeVideosWithClient(repository, 100, client), 12);
    assert.equal(classificationCalls, 1);
    assert.equal(await classifyYoutubeVideosWithClient(repository, 100, client), 0);
    assert.equal(classificationCalls, 1);

    taxonomyGeneration = 2;
    const rebuilt = await ensureYoutubeTaxonomyWithClient(repository, true, client);
    assert.equal(rebuilt[0].version, 2);
    assert.equal(await classifyYoutubeVideosWithClient(repository, 100, client), 12);
    assert.equal(classificationCalls, 2);

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
        choices: [{ message: { content: '{"videos":[{"videoId":"ai-video-1","topics":[]}]}' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch,
    };
    await assert.rejects(
      classifyYoutubeVideosWithClient(repository, 100, invalidClient),
      /requires one to three topics/,
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
          topics: [{ slug: payload.topics[0].slug, confidence: 0.9 }],
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
