import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { load } from 'cheerio';
import { Repository } from '../src/data/database.js';
import { createApp } from '../src/index.js';
import { UserRegistry } from '../src/users.js';
import { fetchYoutubeChannelMetadata } from '../src/youtube/metadata.js';
import type { YoutubeChannelMetadata } from '../src/youtube/types.js';

const ID = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const metadata: YoutubeChannelMetadata = {
  channelId: ID, name: 'Music Channel', thumbnailUrl: '',
  statistics: {
    subscriberCount: 3680000, hiddenSubscriberCount: false, videoCount: 81,
    viewCount: 2000000000, publishedAt: '2017-01-01T00:00:00Z',
    topicCategories: ['https://en.wikipedia.org/wiki/Rock_music', 'javascript:alert(1)', 'https://evil.test/wiki/Music'],
  },
};
function seed(repository: Repository, key: string) {
  repository.ingestYoutubeArchive({ archiveHash: key, source: 'takeout', searches: [], watches: [{
    eventId: key, videoId: 'AAAAAAAAAA1', title: 'Music video', url: 'https://www.youtube.com/watch?v=AAAAAAAAAA1',
    channelId: ID, channelTitle: 'Music Channel', channelUrl: '', watchedAt: '2026-09-01T00:00:00Z', actualWatchedSeconds: 600, activityType: 'video',
  }] });
}

test('channel statistics preserve missing, hidden and zero values distinctly', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({ items: [
    { id: 'hidden', statistics: { subscriberCount: '999', hiddenSubscriberCount: true, videoCount: '0', viewCount: '0' } },
    { id: 'invalid', statistics: { subscriberCount: '-1', videoCount: '', viewCount: '9007199254740992' } },
  ] }))) as typeof fetch;
  const [hidden, invalid, missing] = await fetchYoutubeChannelMetadata(['hidden', 'invalid', 'missing'], 'test-key', fetchImpl);
  assert.equal(hidden.statistics?.subscriberCount, null);
  assert.equal(hidden.statistics?.hiddenSubscriberCount, true);
  assert.equal(hidden.statistics?.videoCount, 0);
  assert.equal(hidden.statistics?.viewCount, 0);
  for (const row of [invalid, missing]) {
    assert.equal(row.statistics?.subscriberCount, null);
    assert.equal(row.statistics?.videoCount, null);
    assert.equal(row.statistics?.viewCount, null);
  }
});

test('version 11 channel metadata upgrades without losing history and refreshes stale statistics', () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-channel-migration-'));
  const path = join(root, 'archive.sqlite');
  try {
    const initial = new Repository(path);
    seed(initial, 'migration');
    initial.upsertYoutubeVideoMetadata([{
      videoId: 'AAAAAAAAAA1', channelId: ID, channelTitle: 'Music Channel', title: 'Music video',
      description: '', tags: [], thumbnailUrl: '', durationSeconds: 600, publishedAt: null,
      categoryId: '10', availability: 'available', metadataHash: 'm',
    }]);
    initial.upsertYoutubeChannelMetadata([{ channelId: ID, name: 'Legacy name', thumbnailUrl: 'https://example.test/avatar.png' }]);
    initial.close();
    const old = new DatabaseSync(path);
    old.exec('ALTER TABLE youtube_channels DROP COLUMN statistics_json; ALTER TABLE youtube_channels DROP COLUMN statistics_fetched_at; PRAGMA user_version=11;');
    old.close();
    const upgraded = new Repository(path);
    try {
      assert.equal(upgraded.youtubeCounts().watches, 1);
      assert.equal(upgraded.youtubeChannelMetadata(ID)?.name, 'Legacy name');
      assert.equal(upgraded.youtubeChannelMetadata(ID)?.statistics, undefined);
      assert.deepEqual(upgraded.youtubeChannelsNeedingMetadata(), [ID]);
      upgraded.upsertYoutubeChannelMetadata([metadata], '2026-09-05T00:00:00Z');
      assert.equal(upgraded.youtubeChannelDetail(ID, 'all').channel?.statistics?.subscriberCount, 3680000);
      assert.deepEqual(upgraded.youtubeChannelsNeedingMetadata(10, new Date('2026-09-06T00:00:00Z')), []);
      assert.equal(upgraded.youtubeProcessingCounts(new Date('2026-09-06T00:00:00Z')).channelsPendingMetadata, 0);
      assert.deepEqual(upgraded.youtubeChannelsNeedingMetadata(10, new Date('2026-09-13T00:00:00Z')), [ID]);
      assert.equal(upgraded.youtubeProcessingCounts(new Date('2026-09-13T00:00:00Z')).channelsPendingMetadata, 1);
      upgraded.upsertYoutubeChannelMetadata([{ channelId: ID, name: 'Updated avatar', thumbnailUrl: '' }]);
      assert.equal(upgraded.youtubeChannelMetadata(ID)?.statistics?.subscriberCount, 3680000, 'older avatar-only writes preserve statistics');
    } finally { upgraded.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('channel page refreshes public data, distinguishes YouTube and member counts, and places personal data last', async () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-channel-public-'));
  const registry = new UserRegistry(join(root, 'users.sqlite'), join(root, 'users'));
  try {
    const user = registry.createUser('public-stats', 'Viewer');
    registry.setMatchingPreferences(user.handle, true, 'topics_and_channel');
    seed(registry.repositoryFor(user), 'public');
    let calls = 0;
    const app = createApp(registry, { loadChannelMetadata: async (id) => { assert.equal(id, ID); calls++; return metadata; } });
    const headers = { cookie: `urtube_session=${registry.createSession(user)}` };
    const response = await app.request(`/channel/${ID}?range=all`, { headers });
    assert.equal(response.status, 200);
    const body = await response.text();
    const $ = load(body);
    assert.match($('.ch-subscribers').text(), /3,680,000.*subscribers/);
    assert.match($('.ch-public').text(), /81 public videos/);
    assert.match($('.ch-public').text(), /2,000,000,000 views on YouTube/);
    assert.equal($('.ch-tags a').length, 1);
    assert.equal($('.ch-tags a').text(), 'Rock music');
    assert.doesNotMatch(body, /javascript:alert|evil\.test/);
    assert.deepEqual($('.ch-community-summary .yt-stat strong').map((_, el) => $(el).text()).get(), ['1', '1', '0.2h', '1']);
    const headings = $('h2').map((_, el) => $(el).text()).get();
    assert.ok(headings.indexOf('Most watched by members') < headings.indexOf('Your stats'));
    assert.ok(headings.indexOf('Top viewers on urtube') < headings.indexOf('Your stats'));
    await app.request(`/channel/${ID}?range=28d&sort=watches`, { headers });
    assert.equal(calls, 1, 'fresh channel data survives cached history and range changes');
    registry.repositoryFor(user).upsertYoutubeChannelMetadata([{ ...metadata, statistics: { ...metadata.statistics!, subscriberCount: null, hiddenSubscriberCount: true } }]);
    const hidden = await (await app.request(`/channel/${ID}`, { headers })).text();
    assert.match(load(hidden)('.ch-subscribers').text(), /Hidden subscribers/);
    assert.doesNotMatch(load(hidden)('.ch-subscribers').text(), /3,680,000/);
  } finally { registry.close(); rmSync(root, { recursive: true, force: true }); }
});

test('failed public metadata requests back off and leave channel histories usable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-channel-failure-'));
  const registry = new UserRegistry(join(root, 'users.sqlite'), join(root, 'users'));
  try {
    const user = registry.createUser('failed-public', 'Viewer');
    seed(registry.repositoryFor(user), 'failure');
    let calls = 0;
    const app = createApp(registry, { loadChannelMetadata: async () => { calls++; throw new Error('API unavailable'); } });
    const headers = { cookie: `urtube_session=${registry.createSession(user)}` };
    for (const range of ['all', '365d']) {
      const response = await app.request(`/channel/${ID}?range=${range}`, { headers });
      assert.equal(response.status, 200);
      assert.match(load(await response.text())('.ch-subscribers').text(), /— subscribers/);
    }
    assert.equal(calls, 1);
  } finally { registry.close(); rmSync(root, { recursive: true, force: true }); }
});

for (const preview of [false, true]) test(`membership is rechecked when a public metadata request finishes (preview=${preview})`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-channel-recheck-'));
  const registry = new UserRegistry(join(root, 'users.sqlite'), join(root, 'users'));
  try {
    const user = registry.createUser('recheck-public', 'Viewer');
    const peer = registry.createUser('recheck-peer', 'Private Peer');
    for (const member of [user, peer]) { registry.setMatchingPreferences(member.handle, true, 'topics_and_channel'); seed(registry.repositoryFor(member), member.handle); }
    let release!: (value: YoutubeChannelMetadata) => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const app = createApp(registry, { loadChannelMetadata: async () => { started(); return new Promise((resolve) => { release = resolve; }); } });
    const request = app.request(`/channel/${ID}${preview ? '?preview=1' : ''}`, { headers: { cookie: `urtube_session=${registry.createSession(user)}` } });
    await startedPromise;
    registry.setMatchingPreferences(user.handle, false, 'topics_and_channel');
    release(metadata);
    const response = await request;
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /Private Peer|Most watched by members/);
  } finally { registry.close(); rmSync(root, { recursive: true, force: true }); }
});

test('channel preview returns an escaped, authenticated fragment and rechecks community opt-in', async () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-channel-preview-'));
  const registry = new UserRegistry(join(root, 'users.sqlite'), join(root, 'users'));
  try {
    const user = registry.createUser('preview-viewer', 'Viewer');
    const peer = registry.createUser('preview-peer', 'Peer <script>alert(1)</script>');
    for (const member of [user, peer]) {
      registry.setMatchingPreferences(member.handle, true, 'topics_and_channel');
      seed(registry.repositoryFor(member), member.handle);
    }
    const app = createApp(registry, { loadChannelMetadata: async () => metadata });
    const token = registry.createSession(user);
    const headers = { cookie: `urtube_session=${token}` };
    const path = `/channel/${ID}?preview=1&range=28d&sort=watches&lang=zh`;
    assert.equal((await app.request(path)).status, 401);
    assert.equal((await app.request('/channel/invalid?preview=1', { headers })).status, 404);
    const response = await app.request(path, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-urtube-fragment'), 'channel-preview');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
    const markup = await response.text();
    const $ = load(markup);
    assert.equal($('[data-channel-preview-fragment]').length, 1);
    assert.equal($('script, style, .site-header, .site-footer').length, 0);
    assert.match($('.ch-subscribers').text(), /3,680,000/);
    assert.match($('.cp-note').text(), /最近 28 天.*觀看次數/);
    assert.match($('.cp-members').text(), /Peer <script>alert\(1\)<\/script>/);
    assert.ok(markup.indexOf('urtube 成員合計') < markup.indexOf('你的統計'));
    registry.setMatchingPreferences(peer.handle, false, 'topics_and_channel');
    const after = await (await app.request(path, { headers })).text();
    assert.doesNotMatch(after, /preview-peer|Peer/);
    registry.setMatchingPreferences(user.handle, false, 'topics_and_channel');
    const left = load(await (await app.request(path, { headers })).text());
    assert.equal(left('.cp-members, .cp-content>section').length, 0);
    assert.match(left('.cp-personal').text(), /你的統計/);
    registry.deleteSession(token);
    assert.equal((await app.request(path, { headers })).status, 401);
  } finally { registry.close(); rmSync(root, { recursive: true, force: true }); }
});

test('dormant channels refresh statistics quarterly while recently watched channels refresh weekly', () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-channel-refresh-'));
  const path = join(root, 'archive.sqlite');
  try {
    const repository = new Repository(path);
    try {
      seed(repository, 'refresh'); // watched 2026-09-01
      repository.upsertYoutubeChannelMetadata([metadata], '2026-09-05T00:00:00Z');
      const pending = (iso: string) => ({
        needing: repository.youtubeChannelsNeedingMetadata(10, new Date(iso)),
        count: repository.youtubeProcessingCounts(new Date(iso)).channelsPendingMetadata,
      });
      // Watched 12 days ago: weekly cadence applies.
      assert.deepEqual(pending('2026-09-13T00:00:00Z'), { needing: [ID], count: 1 });
      // Watched 49 days ago, statistics 45 days old: dormant, wait for the quarterly refresh.
      assert.deepEqual(pending('2026-10-20T00:00:00Z'), { needing: [], count: 0 });
      // Statistics 96 days old: quarterly refresh is due even for dormant channels.
      assert.deepEqual(pending('2026-12-10T00:00:00Z'), { needing: [ID], count: 1 });
    } finally {
      repository.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
