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

test('overview routes load stable topics and both races with scoped topic frames', async () => {
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
      channelTitle: 'Fixture channel', description: '', tags: ['astronomy', 'telescope'], thumbnailUrl: '', durationSeconds: 300,
      publishedAt: null, categoryId: '10', availability: 'available' as const, metadataHash: `metadata-${index}`,
    })));
    const [topic] = repository.replaceYoutubeTaxonomy([{ version: 1, slug: 'fixture-topic', name: 'Fixture topic', description: 'Music' }]);
    dates.forEach((_, index) => repository.saveYoutubeVideoTopics(`OVERVIEW00${index}`, [{ topicId: topic.id, rank: 1, confidence: 1 }], 'test', 'test', `metadata-${index}`));
    const app = createApp(registry);
    const all = await app.request('/overview-fixture?range=all&sort=duration&lang=zh');
    assert.equal(all.status, 200);
    const $ = load(await all.text());
    assert.equal($('.yt-stable-topics h2').text(), '穩定主題');
    assert.equal($('.yt-keywords').length, 1);
    assert.match($('.yt-keywords').text(), /astronomy/);
    assert.match($('.yt-stable-topics').text(), /Fixture topic/);
    assert.equal($('.yt-overview-dynamics [data-rank-race]').length, 2);
    for (const kind of ['channels', 'topics']) {
      const root = $(`[data-rank-race="${kind}"]`);
      assert.equal(root.find('[data-chase-play]').length, 1);
      assert.equal(root.find('[data-chase-range]').length, 1);
      assert.ok(JSON.parse(root.find('[data-chase-data]').text()).frames.length > 1);
    }
    assert.equal($('.yt-topic-details').attr('open'), undefined);
    const recent = load(await (await app.request('/overview-fixture?range=7d&lang=zh')).text());
    const frames = JSON.parse(recent('[data-rank-race="topics"] [data-chase-data]').text()).frames;
    assert.ok(frames.length <= 9);
    assert.ok(frames.every((frame: { period: string }) => /^\d{4}-\d{2}-\d{2}$/.test(frame.period)));
    const insights = load(youtubeDashboardPage('Fixture', repository.youtubeDashboard('all'), 'duration', { page: 'insights', lang: 'zh' }));
    assert.equal(insights('[data-rank-race="topics"]').length, 1);
    assert.equal(insights('[data-rank-race="channels"],.yt-stable-topics').length, 0);
    assert.equal(insights('.yt-topic-details').length, 1);
    assert.equal(insights('.yt-keywords').length, 1);
    assert.match(insights('.yt-keywords').text(), /astronomy/);
    assert.equal(insights('.yt-watch-time').length, 1);
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
