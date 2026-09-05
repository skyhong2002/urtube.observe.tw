import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createApp } from '../src/index.js';
import type { User } from '../src/users.js';
import { UserRegistry } from '../src/users.js';
import { matchingCardDisclosure } from '../src/youtube/disclosure.js';
import { MATCHING_TAXONOMY } from '../src/youtube/matching.js';
import {
  REGISTRY_CRYSTAL_VERSION,
  type RegistryMatchingCrystal,
} from '../src/youtube/registry-crystal.js';

function readyCrystal(channel: string): RegistryMatchingCrystal {
  return {
    kind: 'matching',
    version: REGISTRY_CRYSTAL_VERSION,
    taxonomyVersion: MATCHING_TAXONOMY.version,
    generatedAt: '2026-09-05T12:00:00.000Z',
    windowDays: 90,
    data: {
      watchEvents: 200,
      uniqueVideos: 80,
      estimatedWatchSeconds: 120_000,
      activeDays: 14,
      topicCoverage: 1,
    },
    topics: [{ key: 'learning', name: 'Learning', share: 1 }],
    channels: [{ key: channel, name: channel, share: 1 }],
  };
}

function publish(registry: UserRegistry, user: User, channel: string): void {
  registry.upsertMatchingCrystal(user, readyCrystal(channel));
}

test('registry upgrade preserves the #6 opt-in and defaults disclosure safely', () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-matching-preferences-upgrade-'));
  const registryPath = join(root, 'users.sqlite');
  try {
    const current = new UserRegistry(registryPath, join(root, 'users'));
    current.createUser('legacy', 'Legacy Matcher');
    current.setMatchingOptIn('legacy', true);
    current.close();

    const old = new DatabaseSync(registryPath);
    old.exec(`
      ALTER TABLE users DROP COLUMN onboarding_completed_at;
      ALTER TABLE users DROP COLUMN matching_disclosure;
      ALTER TABLE users DROP COLUMN matching_opt_in;
    `);
    old.close();

    const upgraded = new UserRegistry(registryPath, join(root, 'users'));
    const user = upgraded.userByHandle('legacy')!;
    assert.equal(user.matchingOptIn, true);
    // The retired disclosure column is normalized to "everything" on open.
    assert.equal(user.matchingDisclosure, 'topics_and_channel');
    assert.equal(user.onboardingCompletedAt, null);
    upgraded.close();

    const rolledBack = new DatabaseSync(registryPath);
    rolledBack.prepare('UPDATE matching_profiles SET opted_in=0 WHERE user_id=?').run(user.id);
    rolledBack.close();
    const reconciled = new UserRegistry(registryPath, join(root, 'users'));
    assert.equal(reconciled.userByHandle('legacy')?.matchingOptIn, false);
    reconciled.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('matching settings are session-only and independent from dashboard visibility', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const candidate = registry.createUser('private-match', 'Private Match');
    const viewer = registry.createUser('viewer', 'Viewer');
    publish(registry, candidate, 'Private aggregate channel');
    publish(registry, viewer, 'Viewer aggregate channel');
    const session = `urtube_session=${registry.createSession(candidate)}`;

    // Matching starts on; the dashboard stays private.
    assert.equal(candidate.dashboardPublic, false);
    assert.equal(candidate.matchingOptIn, true);
    assert.equal(candidate.matchingDisclosure, 'topics_and_channel');
    assert.equal(registry.listMatchableCrystals().length, 2);
    assert.equal((await app.request('/account/matching', { method: 'POST' })).status, 302);

    const account = await (await app.request('/account', { headers: { cookie: session } })).text();
    assert.match(account, /action="\/account\/matching"/);
    assert.match(account, /Matching and dashboard visibility are independent/);
    assert.match(account, /name="matchingOptIn" value="1" checked/);
    assert.doesNotMatch(account, /matchingTopics|matchingChannels|matchingRhythm|selectedTopicKeys|<select/);
    assert.doesNotMatch(await (await app.request('/signup')).text(), /Join matching/);
    assert.equal((await app.request(`/${candidate.handle}`)).status, 404);
    assert.equal((await app.request(`/u/${candidate.handle}/crystal.json`)).status, 404);

    assert.deepEqual(
      registry.listMatchingCandidatesFor(viewer).map(({ handle }) => handle),
      [candidate.handle],
    );
    const crystalBefore = registry.matchingCrystalFor(candidate.handle);
    registry.setMatchingPreferences(candidate.handle, true, 'topics_and_channel');
    assert.deepEqual(registry.matchingCrystalFor(candidate.handle), crystalBefore);
    // The retired finer settings are normalized to "everything" on write.
    assert.equal(registry.listMatchableCrystals().find(({ handle }) => handle === candidate.handle)?.disclosureLevel, 'topics_and_channel');

    const disabled = await app.request('/account/matching', {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'unrelated=1',
    });
    assert.equal(disabled.status, 302);
    assert.equal(registry.listMatchableCrystals().some(({ handle }) => handle === candidate.handle), false);
    assert.deepEqual(registry.listMatchingCandidatesFor(registry.userByHandle(candidate.handle)!), []);
  } finally {
    registry.close();
  }
});

test('candidate disclosure uses the restrictive intersection and bounded fields', () => {
  const topics = ['Learning', 'Music', 'Gaming'];
  const channels = ['Private aggregate channel', 'Another channel'];
  const restricted = matchingCardDisclosure(
    'topics_only', 'topics_and_channel', topics, channels,
  );
  assert.deepEqual(restricted, { topics: ['Learning', 'Music'] });
  assert.doesNotMatch(JSON.stringify(restricted), /Private aggregate channel/);

  const mutual = matchingCardDisclosure(
    'topics_and_channel', 'topics_and_channel', topics, channels,
  );
  assert.deepEqual(mutual, {
    topics: ['Learning', 'Music'],
    channel: 'Private aggregate channel',
  });
  assert.deepEqual(Object.keys(mutual).sort(), ['channel', 'topics']);
});

test('privacy page explains optional matching and withdrawal in both languages', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const english = await (await app.request('/privacy')).text();
    assert.match(english, /New accounts enable matching and public Overview and Insights by default/);
    assert.match(english, /Accepted friendships grant Overview, Insights and Blend access/);
    assert.match(english, /turning matching off withdraws requests and friendships/);
    assert.match(english, /independently of matching opt-in/);
    assert.match(english, /History and Recap require the owner session or dashboard key/);
    assert.match(english, /Searches, email addresses, full histories and contact details are not shared/);
    const chinese = await (await app.request('/privacy?lang=zh')).text();
    assert.match(chinese, /新帳號預設開啟配對/);
    assert.match(chinese, /接受後即可查看總覽、洞察與 Blend/);
    assert.match(chinese, /關閉配對會撤銷邀請與好友關係/);
    assert.match(chinese, /不受配對開關影響/);
    assert.match(chinese, /觀看紀錄與回顧需要本人登入或儀表板 key/);
    assert.match(chinese, /不分享搜尋詞、電子郵件、完整觀看紀錄或聯絡資訊/);
  } finally {
    registry.close();
  }
});
