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
    assert.equal(user.matchingDisclosure, 'topics_only');
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

    // Every matching switch starts on; the dashboard stays private.
    assert.equal(candidate.dashboardPublic, false);
    assert.equal(candidate.matchingOptIn, true);
    assert.equal(candidate.matchingDisclosure, 'topics_and_channel');
    assert.equal(candidate.matchingRhythm, true);
    assert.equal(registry.listMatchableCrystals().length, 2);
    assert.equal((await app.request('/account/matching', { method: 'POST' })).status, 302);

    const account = await (await app.request('/account', { headers: { cookie: session } })).text();
    assert.ok(account.indexOf('/account/matching') > account.indexOf('/account/takeout'));
    assert.match(account, /Matching and dashboard visibility are independent/);
    for (const name of ['matchingOptIn', 'matchingTopics', 'matchingChannels', 'matchingRhythm']) {
      assert.match(account, new RegExp(`name="${name}" value="1" checked`));
    }
    assert.doesNotMatch(account, /name="selectedTopicKeys"|name="excludedTopicKeys"|<select/);
    assert.doesNotMatch(await (await app.request('/signup')).text(), /Join the matching pool/);

    // Turning channels and rhythm off keeps the person in the pool.
    const narrowed = await app.request('/account/matching', {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'matchingOptIn=1&matchingTopics=1',
    });
    assert.equal(narrowed.status, 302);
    const narrowedUser = registry.userByHandle(candidate.handle)!;
    assert.equal(narrowedUser.matchingOptIn, true);
    assert.equal(narrowedUser.matchingDisclosure, 'topics_only');
    assert.equal(narrowedUser.matchingRhythm, false);
    assert.equal(registry.listMatchableCrystals().find(({ handle }) => handle === candidate.handle)?.rhythmDisclosure, false);
    assert.equal((await app.request(`/${candidate.handle}`)).status, 404);
    assert.equal((await app.request(`/u/${candidate.handle}/crystal.json`)).status, 404);

    assert.deepEqual(
      registry.listMatchingCandidatesFor(viewer).map(({ handle }) => handle),
      [candidate.handle],
    );
    const crystalBefore = registry.matchingCrystalFor(candidate.handle);
    registry.setMatchingPreferences(candidate.handle, true, 'topics_and_channel');
    assert.deepEqual(registry.matchingCrystalFor(candidate.handle), crystalBefore);
    assert.equal(registry.userByHandle(candidate.handle)?.matchingRhythm, false, 'omitted rhythm keeps the stored value');

    const disabled = await app.request('/account/matching', {
      method: 'POST',
      headers: { cookie: session, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'matchingTopics=1&matchingChannels=1&matchingRhythm=1',
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
    assert.match(english, /Matching starts on for new accounts/);
    assert.match(english, /mutual consent unlocks more broad, mutually allowed comparison clues/);
    assert.match(english, /never introductions or contact details/);
    assert.match(english, /Every read rechecks the token, relationship/);
    assert.match(english, /Turning matching off withdraws requests and connections immediately/);
    assert.match(english, /separate from making a dashboard public/);
    const chinese = await (await app.request('/privacy?lang=zh')).text();
    assert.match(chinese, /新帳號的配對預設開啟/);
    assert.match(chinese, /雙向同意後只解鎖更多雙方允許的概括比較線索/);
    assert.match(chinese, /不顯示自介或聯絡資訊/);
    assert.match(chinese, /每次讀取都會重新確認 token、關係狀態/);
    assert.match(chinese, /關閉配對會立即撤銷邀請與連結/);
    assert.match(chinese, /公開儀表板是兩個獨立設定/);
  } finally {
    registry.close();
  }
});
