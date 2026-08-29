import assert from 'node:assert/strict';
import test from 'node:test';
import { Repository } from '../src/data/database.js';
import { createApp } from '../src/index.js';
import { UserRegistry } from '../src/users.js';
import { buildYoutubeCrystal, compareCrystals } from '../src/youtube/crystal.js';
import type { YoutubeParsedArchive } from '../src/youtube/types.js';

const NOW = new Date('2026-08-14T00:00:00.000Z');

function watch(
  id: string,
  videoId: string,
  channel: string,
  watchedAt: string,
  seconds: number,
): YoutubeParsedArchive['watches'][number] {
  return {
    eventId: id,
    videoId,
    title: `Video ${videoId}`,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    channelId: `channel-${channel}`,
    channelTitle: `Channel ${channel.toUpperCase()}`,
    channelUrl: `https://www.youtube.com/channel/channel-${channel}`,
    watchedAt,
    actualWatchedSeconds: seconds,
    activityType: 'video',
  };
}

function seed(repository: Repository, events: YoutubeParsedArchive['watches']): void {
  repository.ingestYoutubeArchive({
    archiveHash: `crystal-fixture-${events[0]?.eventId ?? 'empty'}`,
    source: 'takeout',
    watches: events,
    searches: [],
  });
}

test('crystal windows compute shares and shifts between recent and prior periods', () => {
  const repository = new Repository(':memory:');
  try {
    seed(repository, [
      // Prior window (~40 days ago): all attention on channel A.
      watch('p1', 'AAAAAAAAAA1', 'a', '2026-07-05T10:00:00Z', 1800),
      watch('p2', 'AAAAAAAAAA2', 'a', '2026-07-06T10:00:00Z', 1800),
      // Recent window: channel B takes over, A shrinks.
      watch('r1', 'BBBBBBBBBB1', 'b', '2026-08-10T10:00:00Z', 2700),
      watch('r2', 'BBBBBBBBBB2', 'b', '2026-08-11T10:00:00Z', 2700),
      watch('r3', 'AAAAAAAAAA3', 'a', '2026-08-12T10:00:00Z', 600),
    ]);
    const crystal = buildYoutubeCrystal(repository, { handle: 'tester', displayName: 'Tester' }, NOW);

    assert.equal(crystal.prior.watchEvents, 2);
    assert.equal(crystal.recent.watchEvents, 3);
    assert.equal(crystal.recent.estimatedWatchSeconds, 6000);
    const recentB = crystal.recent.channels.find((channel) => channel.key === 'channel-b')!;
    assert.ok(Math.abs(recentB.share - 0.9) < 1e-9);
    const priorA = crystal.prior.channels.find((channel) => channel.key === 'channel-a')!;
    assert.equal(priorA.share, 1);

    const rising = crystal.shifts.find((shift) => shift.key === 'channel-b');
    assert.equal(rising?.status, 'new');
    assert.ok(rising!.delta > 0.8);
    const falling = crystal.shifts.find((shift) => shift.key === 'channel-a');
    assert.equal(falling?.status, 'falling');
    assert.ok(crystal.volumeChange! > 0.5);

    const topics = repository.replaceYoutubeTaxonomy([
      { version: 1, slug: 'prior', name: 'Prior topic', description: 'Prior' },
      { version: 1, slug: 'recent', name: 'Recent topic', description: 'Recent' },
    ]);
    const priorTopic = topics.find((topic) => topic.slug === 'prior')!;
    const recentTopic = topics.find((topic) => topic.slug === 'recent')!;
    for (const videoId of ['BBBBBBBBBB1', 'BBBBBBBBBB2', 'AAAAAAAAAA3']) {
      repository.saveYoutubeVideoTopics(
        videoId, [{ topicId: recentTopic.id, rank: 1, confidence: 1 }],
        'test-model', 'test-prompt', '',
      );
    }
    const partialTopics = buildYoutubeCrystal(
      repository, { handle: 'tester', displayName: 'Tester' }, NOW,
    );
    assert.ok(!partialTopics.shifts.some((shift) => shift.kind === 'topic'));
    for (const videoId of ['AAAAAAAAAA1', 'AAAAAAAAAA2']) {
      repository.saveYoutubeVideoTopics(
        videoId, [{ topicId: priorTopic.id, rank: 1, confidence: 1 }],
        'test-model', 'test-prompt', '',
      );
    }
    const completeTopics = buildYoutubeCrystal(
      repository, { handle: 'tester', displayName: 'Tester' }, NOW,
    );
    assert.ok(completeTopics.shifts.some((shift) => shift.kind === 'topic'));

    // Crystals carry aggregates only: no event ids, timestamps, or searches.
    const serialized = JSON.stringify(crystal);
    assert.doesNotMatch(serialized, /eventId|watchedAt|queryCiphertext|raw_url/);
  } finally {
    repository.close();
  }
});

test('crystal comparison finds shared ground and one-sided gaps', () => {
  const left = new Repository(':memory:');
  const right = new Repository(':memory:');
  try {
    seed(left, [
      watch('l1', 'SHAREDVID01', 'shared', '2026-08-01T10:00:00Z', 3000),
      watch('l2', 'LEFTONLY001', 'left', '2026-08-02T10:00:00Z', 3000),
    ]);
    seed(right, [
      watch('r1', 'SHAREDVID02', 'shared', '2026-08-01T11:00:00Z', 3000),
      watch('r2', 'RIGHTONLY01', 'right', '2026-08-02T11:00:00Z', 3000),
    ]);
    const comparison = compareCrystals(
      buildYoutubeCrystal(left, { handle: 'left', displayName: 'Left' }, NOW),
      buildYoutubeCrystal(right, { handle: 'right', displayName: 'Right' }, NOW),
    );
    assert.ok(comparison.channelSimilarity > 0.4 && comparison.channelSimilarity < 0.6);
    assert.deepEqual(comparison.sharedChannels.map((channel) => channel.name), ['Channel SHARED']);
    assert.ok(comparison.onlyA.some((item) => item.name === 'Channel LEFT'));
    assert.ok(comparison.onlyB.some((item) => item.name === 'Channel RIGHT'));
    assert.ok(!comparison.onlyA.some((item) => item.name === 'Channel SHARED'));
  } finally {
    left.close();
    right.close();
  }
});

test('crystal.json and /compare enforce dashboard access', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const alice = registry.createUser('alice', 'Alice');
    const bob = registry.createUser('bob', 'Bob', { dashboardPublic: true });
    seed(registry.repositoryFor(registry.userByHandle('alice')!), [
      watch('a1', 'ALICEVID001', 'alice', '2026-08-01T10:00:00Z', 1200),
    ]);
    seed(registry.repositoryFor(registry.userByHandle('bob')!), [
      watch('b1', 'BOBVIDEO001', 'bob', '2026-08-01T10:00:00Z', 1200),
    ]);

    assert.equal((await app.request('/u/alice/crystal.json')).status, 404);
    const crystal = await app.request(`/u/alice/crystal.json?key=${alice.dashboardToken}`);
    assert.equal(crystal.status, 200);
    assert.equal(((await crystal.json()) as Record<string, unknown>).handle, 'alice');

    // Public bob is visible; private alice needs her key.
    assert.equal((await app.request('/compare?a=alice&b=bob')).status, 404);
    const compared = await app.request(`/compare?a=alice&b=bob&keyA=${alice.dashboardToken}`);
    assert.equal(compared.status, 200);
    const compareHtml = await compared.text();
    assert.match(compareHtml, /Alice × Bob/);
    assert.match(compareHtml, /channel similarity/);
    assert.equal((await app.request('/compare?a=alice&b=alice')).status, 400);
  } finally {
    registry.close();
  }
});

test('renaming a user keeps tokens and encryption key, moves the dashboard', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const created = registry.createUser('oldname', 'Renamed Person');
    const keyBefore = registry.dataKeyFor(registry.userByHandle('oldname')!);
    const renamed = registry.renameUser('oldname', 'new.name.tw');
    assert.equal(renamed.handle, 'new.name.tw');
    assert.equal(renamed.keySeed, 'oldname');
    assert.equal(registry.dataKeyFor(renamed), keyBefore);
    assert.equal(registry.userByHandle('oldname'), null);

    assert.equal((await app.request('/oldname?key=' + created.dashboardToken)).status, 404);
    assert.equal((await app.request('/new.name.tw?key=' + created.dashboardToken)).status, 200);
    assert.throws(() => registry.renameUser('missing', 'other'), /Unknown user/);
  } finally {
    registry.close();
  }
});
