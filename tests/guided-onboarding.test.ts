import assert from 'node:assert/strict';
import test from 'node:test';
import { guidedOnboardingState } from '../src/onboarding-flow.js';
import { createApp } from '../src/index.js';
import { matchesPage } from '../src/output/matches.js';
import { guidedOnboardingPage } from '../src/output/onboarding.js';
import { UserRegistry, type User } from '../src/users.js';
import { MATCHING_TAXONOMY } from '../src/youtube/matching.js';
import {
  REGISTRY_CRYSTAL_VERSION,
  type RegistryMatchingCrystal,
} from '../src/youtube/registry-crystal.js';
import type {
  YoutubeProcessingStatus,
} from '../src/youtube/processing.js';
import type { YoutubeProgressImportRow } from '../src/youtube/types.js';

const idleProcessing: YoutubeProcessingStatus = {
  stage: 'done',
  pending: 0,
  metadata: null,
  topics: null,
  estimatedMinutes: null,
  lastImportAt: null,
  lastCycleAt: null,
  lastError: null,
};

function eligibleCrystal(): RegistryMatchingCrystal {
  const name = (key: string) =>
    MATCHING_TAXONOMY.topics.find((topic) => topic.key === key)?.name ?? key;
  return {
    kind: 'matching',
    version: REGISTRY_CRYSTAL_VERSION,
    taxonomyVersion: MATCHING_TAXONOMY.version,
    generatedAt: '2026-09-05T12:00:00.000Z',
    windowDays: 90,
    data: {
      watchEvents: 240,
      uniqueVideos: 90,
      estimatedWatchSeconds: 120_000,
      activeDays: 20,
      topicCoverage: 1,
    },
    topics: [
      { key: 'music', name: name('music'), share: 0.65 },
      { key: 'gaming', name: name('gaming'), share: 0.35 },
    ],
    channels: [{ key: 'shared', name: 'Shared Channel', share: 1 }],
  };
}

function seedWatch(registry: UserRegistry, user: User): void {
  registry.repositoryFor(user).ingestYoutubeArchive({
    archiveHash: `guided-${user.handle}`,
    source: 'takeout',
    watches: [{
      eventId: `guided-${user.handle}`,
      videoId: 'GUIDE000001',
      title: 'Guided fixture',
      url: 'https://www.youtube.com/watch?v=GUIDE000001',
      channelId: 'UCguided',
      channelTitle: 'Guided Channel',
      channelUrl: 'https://www.youtube.com/channel/UCguided',
      watchedAt: '2026-09-05T10:00:00.000Z',
      actualWatchedSeconds: null,
      activityType: 'video',
    }],
    searches: [],
  });
  registry.upsertMatchingCrystal(user, eligibleCrystal());
}

function form(values: Record<string, string | string[]>): RequestInit {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) body.append(key, item);
  }
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  };
}

test('guided onboarding resumes from stored data and records either matching choice', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const privateUser = registry.createUser('guided-private', 'Private Guide');
    seedWatch(registry, privateUser);
    const privateCookie = `urtube_session=${registry.createSession(privateUser)}`;

    const interests = await app.request('/onboarding', { headers: { cookie: privateCookie } });
    assert.equal(interests.headers.get('cache-control'), 'no-store');
    assert.equal(interests.headers.get('x-robots-tag'), 'noindex');
    const interestsHtml = await interests.text();
    assert.match(interestsHtml, /Review what should help you meet people/);
    assert.match(interestsHtml, /Music/);
    assert.match(interestsHtml, /Gaming/);
    assert.match(interestsHtml, /guided-private\/insights/);
    assert.equal((interestsHtml.match(/name="selectedTopicKeys"/g) ?? []).length, 2);
    assert.doesNotMatch(interestsHtml, /watchEvents|estimatedWatchSeconds|topicCoverage/);

    const confirmed = await app.request('/onboarding/interests', {
      ...form({ taxonomyVersion: String(MATCHING_TAXONOMY.version), selectedTopicKeys: 'music' }),
      headers: { ...form({}).headers, cookie: privateCookie },
    });
    assert.equal(confirmed.status, 302);
    assert.equal(confirmed.headers.get('location'), '/onboarding');
    assert.deepEqual(registry.matchingDimensionsFor(privateUser).selectedTopicKeys, ['music']);
    assert.deepEqual(registry.matchingDimensionsFor(privateUser).excludedTopicKeys, ['gaming']);

    const consentHtml = await (await app.request('/onboarding', {
      headers: { cookie: privateCookie },
    })).text();
    assert.match(consentHtml, /Choose whether to enter matching/);
    assert.doesNotMatch(consentHtml, /name="choice"[^>]*checked/);

    const finishedPrivate = await app.request('/onboarding/finish', {
      ...form({ choice: 'private', matchingDisclosure: 'topics_only' }),
      headers: { ...form({}).headers, cookie: privateCookie },
    });
    assert.equal(finishedPrivate.headers.get('location'), '/guided-private');
    const savedPrivate = registry.userByHandle(privateUser.handle)!;
    assert.equal(savedPrivate.matchingOptIn, false);
    assert.ok(savedPrivate.onboardingCompletedAt);
    const resumed = await app.request('/signup', { headers: { cookie: privateCookie } });
    assert.equal(resumed.headers.get('location'), '/guided-private');

    const joinedUser = registry.createUser('guided-join', 'Join Guide');
    seedWatch(registry, joinedUser);
    const joinedCookie = `urtube_session=${registry.createSession(joinedUser)}`;
    await app.request('/onboarding/interests', {
      ...form({ taxonomyVersion: String(MATCHING_TAXONOMY.version), selectedTopicKeys: ['music', 'gaming'] }),
      headers: { ...form({}).headers, cookie: joinedCookie },
    });
    const joined = await app.request('/onboarding/finish', {
      ...form({ choice: 'join', matchingDisclosure: 'topics_only' }),
      headers: { ...form({}).headers, cookie: joinedCookie },
    });
    assert.equal(joined.headers.get('location'), '/matches');
    assert.equal(registry.userByHandle(joinedUser.handle)?.matchingOptIn, true);
    assert.ok(registry.userByHandle(joinedUser.handle)?.onboardingCompletedAt);
  } finally {
    registry.close();
  }
});

test('guided onboarding rejects skipped or forged steps', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    assert.equal((await app.request('/onboarding')).status, 302);
    assert.equal((await app.request('/onboarding/interests', { method: 'POST' })).status, 302);
    const user = registry.createUser('guided-guard', 'Guard');
    seedWatch(registry, user);
    const cookie = `urtube_session=${registry.createSession(user)}`;
    const skipped = await app.request('/onboarding/finish', {
      ...form({ choice: 'join', matchingDisclosure: 'topics_only' }),
      headers: { ...form({}).headers, cookie },
    });
    assert.equal(skipped.status, 409);
    const forged = await app.request('/onboarding/interests', {
      ...form({ taxonomyVersion: String(MATCHING_TAXONOMY.version), selectedTopicKeys: 'news' }),
      headers: { ...form({}).headers, cookie },
    });
    assert.equal(forged.status, 400);
    assert.equal(registry.matchingDimensionsFor(user).status, 'suggested');
  } finally {
    registry.close();
  }
});

test('scan diagnostics and provisional readiness are derived without a second state store', () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('guided-state', 'State');
    const dimensions = registry.matchingDimensionsFor(user);
    const scan = (endReason: YoutubeProgressImportRow['endReason'], completedAt: string | null) => ({
      scanId: 'guided-scan-0001',
      observedAt: '2026-09-05T10:00:00.000Z',
      startedAt: '2026-09-05T10:00:00.000Z',
      completedAt,
      mode: 'full' as const,
      videos: 0,
      passes: 1,
      endReason,
      oldestWatchedAt: null,
      newestWatchedAt: null,
      error: null,
      landedUrl: null,
    });
    const state = (latestScan: YoutubeProgressImportRow | null) => guidedOnboardingState({
      user,
      watchEvents: 0,
      processing: idleProcessing,
      dimensions,
      matchingCrystal: null,
      latestScan,
    });
    assert.equal(state(scan(null, null)).scanStatus, 'running');
    const paused = state(scan('history-paused', '2026-09-05T10:01:00.000Z'));
    assert.equal(paused.scanStatus, 'history-paused');
    assert.match(guidedOnboardingPage(user, paused), /YouTube watch history is paused/);
    assert.match(guidedOnboardingPage(user, paused, 'zh'), /YouTube 觀看紀錄目前暫停/);
    assert.equal(state(scan('signed-out', '2026-09-05T10:01:00.000Z')).scanStatus, 'signed-out');
    assert.equal(state(scan('no-receiver', '2026-09-05T10:01:00.000Z')).scanStatus, 'retry');

    const busy: YoutubeProcessingStatus = {
      ...idleProcessing,
      stage: 'metadata',
      pending: 4,
      metadata: { done: 1, total: 5, pending: 4 },
      estimatedMinutes: 5,
    };
    const processing = guidedOnboardingState({
      user,
      watchEvents: 1,
      processing: busy,
      dimensions,
      matchingCrystal: null,
      latestScan: null,
    });
    assert.equal(processing.step, 'processing');
    assert.equal(processing.provisional, true);
    assert.match(
      matchesPage('State', '/guided-state', { kind: 'empty' }, 'en', true),
      /candidate order may change/,
    );
  } finally {
    registry.close();
  }
});
