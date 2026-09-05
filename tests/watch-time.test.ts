import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { load } from 'cheerio';
import { Repository } from '../src/data/database.js';
import { normalizeYoutubeCapture } from '../src/youtube/capture.js';
import { fetchYoutubeMetadata } from '../src/youtube/metadata.js';
import { youtubeDashboardPage } from '../src/output/youtube.js';

const now = new Date('2026-09-05T12:00:00Z');

test('broadcast metadata distinguishes completed streams, current streams, regular videos and unavailable data', async () => {
  const result = await fetchYoutubeMetadata(['replay', 'live', 'regular', 'missing'], 'fixture', (async (input) => {
    assert.ok(new URL(String(input)).searchParams.get('part')?.includes('liveStreamingDetails'));
    return Response.json({ items: [
      { id: 'replay', snippet: { title: 'Replay', liveBroadcastContent: 'none' }, liveStreamingDetails: { actualStartTime: '2026-09-01T12:00:00Z', actualEndTime: '2026-09-01T13:00:00Z' } },
      { id: 'live', snippet: { title: 'Stream', liveBroadcastContent: 'live' } },
      { id: 'regular', snippet: { title: 'Live concert recording', liveBroadcastContent: 'none' } },
    ] });
  }) as typeof fetch);
  assert.deepEqual(result.map((video) => video.isLivestream ?? null), [true, true, false, null]);
});

test('watch-time categories conserve measured time, including short streams and unknown durations', () => {
  const repository = new Repository(':memory:');
  try {
    const fixtures = [
      { id: 'SHORTFORM01', duration: 90, seconds: 30, live: false },
      { id: 'LIVESTREAM1', duration: 90, seconds: 40, live: true },
      { id: 'LONGFORM001', duration: 600, seconds: 120, live: false },
      { id: 'UNKNOWN0001', duration: null, seconds: 50, live: false },
      { id: 'LIVEUNKN001', duration: null, seconds: 70, live: true },
    ];
    for (const [index, row] of fixtures.entries()) {
      repository.upsertYoutubeCapture(normalizeYoutubeCapture({
        sessionId: `watch-time-session-${index}`, videoId: row.id, title: row.id,
        url: `https://www.youtube.com/watch?v=${row.id}`, channelTitle: 'Fixture',
        watchedAt: `2026-09-05T0${index}:00:00Z`, actualWatchedSeconds: row.seconds, durationSeconds: row.duration,
      }, now));
      repository.upsertYoutubeVideoMetadata([{
        videoId: row.id, title: row.id, channelId: null, channelTitle: 'Fixture',
        description: '', tags: [], thumbnailUrl: '', durationSeconds: row.duration,
        publishedAt: null, categoryId: null, availability: 'available', metadataHash: row.id, isLivestream: row.live,
      }]);
    }
    const data = repository.youtubeDashboard('all', now);
    assert.deepEqual(data.shortFormDaily, [{ day: '2026-09-05', shortWatchSeconds: 30, liveWatchSeconds: 110, regularWatchSeconds: 120, knownDurationWatchSeconds: 190 }]);
    assert.equal(data.daily[0].estimatedWatchSeconds, 310);
    assert.deepEqual(repository.youtubeVideosNeedingMetadata(), []);
    const $ = load(youtubeDashboardPage('Fixture', data, 'duration', { lang: 'zh', page: 'insights' }));
    const chart = $('.yt-watch-time');
    assert.equal(chart.find('h2').text(), '觀看時間趨勢');
    assert.match(chart.text(), /直播／回放/);
    assert.match(chart.text(), /片長未知/);
    const segments = chart.find('.yt-short-absolute-col>span>i').toArray();
    const percentages = segments.map((segment) => Number($(segment).attr('style')?.match(/height:([\d.]+)/)?.[1]));
    assert.ok(Math.abs(percentages.reduce((sum, share) => sum + share, 0) - 100) < 0.01);
    assert.ok(Math.abs(percentages[2] - 110 / 310 * 100) < 0.001);
    const unknownOnly = { ...data, shortFormDaily: [{ day: '2026-09-05', shortWatchSeconds: 0, knownDurationWatchSeconds: 0 }], daily: [{ day: '2026-09-05', watches: 1, estimatedWatchSeconds: 50 }] };
    const unknownPage = load(youtubeDashboardPage('Fixture', unknownOnly, 'duration', { page: 'insights' }));
    assert.equal(unknownPage('.yt-watch-time .yt-watch-unknown').first().attr('style'), 'height:100.000%');
  } finally { repository.close(); }
});

test('version 12 upgrade preserves history and queues available legacy metadata for broadcast identification', () => {
  const directory = mkdtempSync(join(tmpdir(), 'urtube-live-migration-'));
  const path = join(directory, 'archive.sqlite');
  try {
    const initial = new Repository(path);
    initial.upsertYoutubeVideoMetadata([{
      videoId: 'LEGACY00001', title: 'Legacy', channelId: null, channelTitle: null, description: '',
      tags: [], thumbnailUrl: '', durationSeconds: 600, publishedAt: null, categoryId: null,
      availability: 'available', metadataHash: 'legacy',
    }]);
    initial.close();
    const legacy = new DatabaseSync(path);
    legacy.exec('ALTER TABLE youtube_videos DROP COLUMN is_livestream; PRAGMA user_version=12;');
    legacy.close();
    const upgraded = new Repository(path);
    try { assert.deepEqual(upgraded.youtubeVideosNeedingMetadata(), ['LEGACY00001']); }
    finally { upgraded.close(); }
    const migrated = new DatabaseSync(path);
    assert.equal(migrated.prepare('PRAGMA user_version').get()?.user_version, 15);
    assert.equal(migrated.prepare('SELECT title FROM youtube_videos').get()?.title, 'Legacy');
    migrated.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
