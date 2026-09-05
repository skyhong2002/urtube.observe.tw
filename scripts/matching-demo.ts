import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { createApp } from '../src/index.js';
import { UserRegistry, type User } from '../src/users.js';
import { MATCHING_TAXONOMY } from '../src/youtube/matching.js';
import {
  REGISTRY_CRYSTAL_VERSION,
  type RegistryMatchingCrystal,
} from '../src/youtube/registry-crystal.js';
import type { TagListSnapshot } from '../src/youtube/taglists.js';
import type { YoutubeParsedArchive } from '../src/youtube/types.js';

const host = '127.0.0.1';
const requestedPort = Number.parseInt(process.env.DEMO_PORT ?? '4317', 10);
if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65_535) {
  throw new Error('DEMO_PORT must be an integer from 1024 to 65535');
}

const root = mkdtempSync(join(tmpdir(), 'urtube-matching-demo-'));
const registry = new UserRegistry(join(root, 'users.sqlite'), join(root, 'users'));

const topic = (key: string, share: number) => ({
  key,
  name: MATCHING_TAXONOMY.topics.find((item) => item.key === key)?.name ?? key,
  share,
});

function crystal(topics: RegistryMatchingCrystal['topics']): RegistryMatchingCrystal {
  return {
    kind: 'matching',
    version: REGISTRY_CRYSTAL_VERSION,
    taxonomyVersion: MATCHING_TAXONOMY.version,
    generatedAt: new Date().toISOString(),
    windowDays: 90,
    data: {
      watchEvents: 240,
      uniqueVideos: 90,
      estimatedWatchSeconds: 140_000,
      activeDays: 20,
      topicCoverage: 1,
    },
    topics,
    channels: [{ key: 'shared-studio', name: 'Shared Studio', share: 1 }],
  };
}

function watch(
  eventId: string,
  videoId: string,
  title: string,
  channelId: string,
  channelTitle: string,
  watchedAt: string,
  actualWatchedSeconds: number,
): YoutubeParsedArchive['watches'][number] {
  return {
    eventId,
    videoId,
    title,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    channelId,
    channelTitle,
    channelUrl: `https://www.youtube.com/channel/${channelId}`,
    watchedAt,
    actualWatchedSeconds,
    activityType: 'video',
  };
}

function seed(
  user: User,
  topics: RegistryMatchingCrystal['topics'],
  watches: YoutubeParsedArchive['watches'],
): void {
  registry.upsertMatchingCrystal(user, crystal(topics));
  registry.setMatchingPreferences(user.handle, true, 'topics_and_channel');
  registry.repositoryFor(user).ingestYoutubeArchive({
    archiveHash: `synthetic-demo-${user.handle}`,
    source: 'takeout',
    watches,
    searches: [],
  });
}

const alice = registry.createUser('alice-demo', 'Alice');
const bob = registry.createUser('bob-demo', 'Bob');
const newcomer = registry.createUser('new-demo', 'New member');
registry.setMatchingOptIn(newcomer.handle, true);
assert.equal(registry.matchingCrystalFor(newcomer.handle), null, 'newcomer must not receive an invented matching signal');

seed(alice, [topic('music', 0.65), topic('learning', 0.35)], [
  watch('alice-1', 'DEMOALICE01', 'Songwriting basics', 'shared-studio', 'Shared Studio', '2026-09-01T01:00:00Z', 1_800),
  watch('alice-2', 'DEMOSHARED1', 'Build a tiny synthesizer', 'shared-studio', 'Shared Studio', '2026-09-03T13:00:00Z', 1_200),
  watch('alice-3', 'DEMOALICE02', 'TypeScript patterns', 'alice-lab', 'Alice Lab', '2026-09-04T01:00:00Z', 900),
]);
seed(bob, [topic('music', 0.55), topic('learning', 0.45)], [
  watch('bob-1', 'DEMOSHARED1', 'Build a tiny synthesizer', 'shared-studio', 'Shared Studio', '2026-09-01T13:00:00Z', 1_500),
  watch('bob-2', 'DEMOBOB0001', 'Live looping techniques', 'shared-studio', 'Shared Studio', '2026-09-02T13:00:00Z', 1_800),
  watch('bob-3', 'DEMOBOB0002', 'Learning in public', 'bob-lab', 'Bob Lab', '2026-09-04T13:00:00Z', 600),
]);

const sessions = new Map([
  [randomBytes(24).toString('base64url'), registry.createSession(alice)],
  [randomBytes(24).toString('base64url'), registry.createSession(bob)],
  [randomBytes(24).toString('base64url'), registry.createSession(newcomer)],
]);
const [aliceAccess, bobAccess, newcomerAccess] = sessions.keys();

const noTaggedChannels = async (): Promise<TagListSnapshot> => ({
  lists: {
    news: new Set(), editorial: new Set(), editorialShows: new Set(),
    blue: new Set(), green: new Set(), white: new Set(), red: new Set(),
  },
  provenance: {
    sourceUrl: 'synthetic-local-demo',
    sourceUpdatedAt: '2026-09-05 00:00:00',
    fetchedAt: new Date().toISOString(),
    membershipVersion: 'synthetic-local-demo',
    policyVersion: 'synthetic-local-demo',
    policyUrl: '/docs/channel-tag-policy.md',
    reportUrl: 'https://github.com/skyhong2002/urtube.observe.tw/issues',
  },
});

const demo = new Hono();
demo.get('/__demo/session/:access', (c) => {
  const session = sessions.get(c.req.param('access'));
  if (!session) return c.notFound();
  setCookie(c, 'urtube_session', session, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
  });
  return c.redirect('/matches');
});
demo.route('/', createApp(registry, { loadTagLists: noTaggedChannels }));

const server = serve({ fetch: demo.fetch, hostname: host, port: requestedPort }, (info) => {
  const base = `http://${host}:${info.port}`;
  console.log('Synthetic matching demo ready. Open each URL in a separate browser profile:');
  console.log(`Alice: ${base}/__demo/session/${aliceAccess}`);
  console.log(`Bob:   ${base}/__demo/session/${bobAccess}`);
  console.log(`New member (no history): ${base}/__demo/session/${newcomerAccess}`);
  console.log('Restart this command to reset every request and connection. Press Ctrl-C to stop.');
});

function close(): void {
  server.close(() => {
    registry.close();
    rmSync(root, { recursive: true, force: true });
    process.exit(0);
  });
}

process.once('SIGINT', close);
process.once('SIGTERM', close);
