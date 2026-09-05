import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'cheerio';
import { createApp } from '../src/index.js';
import { UserRegistry } from '../src/users.js';
import { youtubeDashboardPage } from '../src/output/youtube.js';
import { rankRaceSection } from '../src/output/rank-race.js';

test('overview keeps channel history and v3 summaries without displaying retained legacy topics', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'urtube-overview-dynamics-'));
  const registry = new UserRegistry(join(directory, 'registry.sqlite'));
  try {
    const user = registry.createUser('overview-fixture', 'Overview viewer', { dashboardPublic: true });
    const repository = registry.repositoryFor(user);
    const now = new Date();
    const dates = [new Date(now.getTime() - 60 * 86400000), new Date(now.getTime() - 86400000)];
    repository.ingestYoutubeArchive({ archiveHash: 'overview', source: 'takeout', searches: [], watches: dates.map((date, index) => ({
      eventId: `overview-${index}`, videoId: `OVERVIEW00${index}`, title: `Video ${index}`,
      url: `https://www.youtube.com/watch?v=OVERVIEW00${index}`, channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
      channelTitle: 'Fixture channel', channelUrl: '', watchedAt: date.toISOString(), actualWatchedSeconds: 300,
      activityType: 'video' as const,
    })) });
    repository.upsertYoutubeVideoMetadata(dates.map((_, index) => ({
      videoId: `OVERVIEW00${index}`, title: `Video ${index}`, channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
      channelTitle: 'Fixture channel', description: '', tags: [], thumbnailUrl: '', durationSeconds: 300,
      publishedAt: null, categoryId: '10', availability: 'available' as const, metadataHash: `metadata-${index}`,
    })));
    const [topic] = repository.replaceYoutubeTaxonomy([{ version: 1, slug: 'fixture-topic', name: 'Fixture topic', description: 'Music' }]);
    dates.forEach((_, index) => repository.saveYoutubeVideoTopics(`OVERVIEW00${index}`, [{ topicId: topic.id, rank: 1, confidence: 1 }], 'test', 'test', `metadata-${index}`));
    const app = createApp(registry);
    const all = await app.request('/overview-fixture?range=all&sort=duration&lang=zh');
    assert.equal(all.status, 200);
    const $ = load(await all.text());
    assert.equal($('.yt-stable-topics,.yt-topic-details,[data-rank-race="topics"],[data-topic-trend]').length, 0);
    assert.doesNotMatch($('body').text(), /Fixture topic|AI 主題涵蓋/);
    const channelRace = $('[data-rank-race="channels"]');
    assert.equal(channelRace.length, 1);
    assert.equal(channelRace.find('[data-chase-play]').length, 1);
    assert.equal(channelRace.find('[data-chase-range]').length, 1);
    assert.ok(JSON.parse(channelRace.find('[data-chase-data]').text()).frames.length > 1);
    assert.match($('.yt-channels').text(), /Fixture channel/);
    const recent = load(await (await app.request('/overview-fixture?range=7d&lang=zh')).text());
    const frames = JSON.parse(recent('[data-rank-race="channels"] [data-chase-data]').text()).frames;
    assert.ok(frames.length <= 9);
    assert.ok(frames.every((frame: { period: string }) => /^\d{4}-\d{2}-\d{2}$/.test(frame.period)));
    const insights = load(youtubeDashboardPage('Fixture', repository.youtubeDashboard('all'), 'duration', { page: 'insights', lang: 'zh' }));
    assert.equal(insights('[data-rank-race],.yt-stable-topics,[data-topic-trend]').length, 0);
    assert.equal(insights('.yt-watch-time').length, 1);
    assert.equal(insights('.yt-keywords').length, 0);
    const summary = load(youtubeDashboardPage('Fixture', repository.youtubeDashboard('all'), 'duration', {
      v3Html: '<section data-v3-summary>Current v3 interests</section>',
    }));
    assert.equal(summary('[data-v3-summary]').text(), 'Current v3 interests');
    assert.equal(repository.youtubeTopics().find(value => value.id === topic.id)?.name, 'Fixture topic',
      'displaying v3 keeps stored legacy classifications available');
    registry.setDashboardPublic(user.handle, false);
    assert.notEqual((await app.request('/overview-fixture?range=all')).status, 200, 'private dashboard remains protected');
  } finally { registry.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('shared race preserves sub-one percentage scaling, empty periods and safe labels', () => {
  const output = rankRaceSection({
    kind: 'topics', title: 'Topics', subtitle: 'Shares', playLabel: 'Play', pauseLabel: 'Pause',
    empty: 'Unavailable', format: 'percent', channels: [{ name: '<script>bad()</script>', color: '#123456' }],
    frames: [{ period: '2026-01', entries: [] }, { period: '2026-02', entries: [[0, 0.25]] }],
  });
  const $ = load(output);
  assert.equal($('.yt-chase-value').text(), '25.0%');
  assert.match($('.yt-chase-track i').attr('style')!, /--share:1.0000/);
  assert.equal($('.yt-chase-label strong').text(), '<script>bad()</script>');
  assert.equal($('script').length, 2);
  for (const script of $('script:not([type])').toArray()) assert.doesNotThrow(() => Function($(script).text()));
});
