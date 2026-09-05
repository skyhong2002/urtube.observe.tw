import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { UserRegistry, type User } from '../src/users.js';
import { MATCHING_TAXONOMY } from '../src/youtube/matching.js';
import {
  REGISTRY_CRYSTAL_VERSION,
  type RegistryMatchingCrystal,
} from '../src/youtube/registry-crystal.js';

const crystal: RegistryMatchingCrystal = {
  kind: 'matching',
  version: REGISTRY_CRYSTAL_VERSION,
  taxonomyVersion: MATCHING_TAXONOMY.version,
  generatedAt: '2026-09-05T12:00:00.000Z',
  windowDays: 90,
  data: {
    watchEvents: 240,
    uniqueVideos: 90,
    estimatedWatchSeconds: 140_000,
    activeDays: 20,
    topicCoverage: 1,
  },
  topics: [{ key: 'music', name: 'Music', share: 1 }],
  channels: [{ key: 'shared', name: 'Shared Channel', share: 1 }],
};

function publish(registry: UserRegistry, user: User): void {
  registry.upsertMatchingCrystal(user, crystal);
  registry.setMatchingPreferences(user.handle, true, 'topics_and_channel');
}

function post(cookie: string, values: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values).toString(),
  };
}

test('matching opt-out and account deletion revoke every discovery path immediately', async () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-privacy-lifecycle-'));
  const registryPath = join(root, 'users.sqlite');
  const usersPath = join(root, 'users');
  const registry = new UserRegistry(registryPath, usersPath);
  const app = createApp(registry);
  try {
    const alice = registry.createUser('privacy-alice', 'Alice');
    const bob = registry.createUser('privacy-bob', 'Bob');
    publish(registry, alice);
    publish(registry, bob);
    const aliceCookie = `urtube_session=${registry.createSession(alice)}`;
    const bobCookie = `urtube_session=${registry.createSession(bob)}`;

    const oldActionToken = registry.issueMatchActionToken(alice, bob.id, ['Music']);
    registry.createMatchRequest(alice, oldActionToken);
    assert.ok(registry.listMatchingCandidatesFor(alice).some(({ userId }) => userId === bob.id));
    assert.equal(registry.matchingInboxFor(alice).sent.length, 1);

    const disabled = await app.request('/account/matching', post(bobCookie, {}));
    assert.equal(disabled.status, 302, 'the account UI accepts the opt-out');
    assert.equal(registry.userByHandle(bob.handle)?.matchingOptIn, false);
    assert.ok(!registry.listMatchingCandidatesFor(alice).some(({ userId }) => userId === bob.id));
    assert.equal(registry.matchingInboxFor(alice).sent.length, 0, 'pending relationships are withdrawn');
    assert.equal(registry.matchingCandidateForAction(alice, oldActionToken), null);
    assert.equal((await app.request('/privacy-alice/compare/privacy-bob', {
      headers: { cookie: aliceCookie },
    })).status, 404);
    assert.equal((await app.request('/matches/request', post(aliceCookie, {
      actionToken: oldActionToken,
    }))).status, 400, 'an action token minted before opt-out cannot be replayed');

    const gone = registry.createUser('privacy-gone', 'Gone', {
      googleSub: 'synthetic-google-sub',
      googleEmail: 'privacy-gone@example.invalid',
    });
    publish(registry, gone);
    const goneCookie = `urtube_session=${registry.createSession(gone)}`;
    const goneRepository = registry.repositoryFor(gone);
    goneRepository.ingestYoutubeArchive({
      archiveHash: 'synthetic-privacy-deletion',
      source: 'takeout',
      watches: [{
        eventId: 'synthetic-watch',
        videoId: 'SYNTHETIC01',
        title: 'Synthetic deletion fixture',
        url: 'https://www.youtube.com/watch?v=SYNTHETIC01',
        channelId: 'synthetic-channel',
        channelTitle: 'Synthetic Channel',
        channelUrl: 'https://www.youtube.com/channel/synthetic-channel',
        watchedAt: '2026-09-05T10:00:00.000Z',
        actualWatchedSeconds: 60,
        activityType: 'video',
      }],
      searches: [],
    });
    const goneDatabase = join(usersPath, `${gone.handle}.sqlite`);
    assert.equal(existsSync(goneDatabase), true);

    const deleted = await app.request('/account/delete', post(goneCookie, {
      confirmHandle: gone.handle,
    }));
    assert.equal(deleted.status, 302);
    assert.equal(deleted.headers.get('location'), '/');
    assert.match(deleted.headers.get('set-cookie') ?? '', /urtube_session=;/);
    assert.equal(registry.userByHandle(gone.handle), null);
    assert.equal(registry.userByGoogleSub('synthetic-google-sub'), null);
    assert.equal(existsSync(goneDatabase), false, 'the isolated archive is removed');
    assert.equal((await app.request('/account', { headers: { cookie: goneCookie } })).status, 302);

    const db = new DatabaseSync(registryPath, { readOnly: true });
    for (const table of ['crystals', 'matching_profiles', 'crystal_refresh_queue']) {
      const count = Number((db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE user_id=?`)
        .get(gone.id) as { count: number } | undefined)?.count ?? 0);
      assert.equal(count, 0, `${table} must not retain a row for the deleted user`);
    }
    for (const table of ['match_requests', 'match_action_tokens']) {
      const count = Number((db.prepare(`
        SELECT COUNT(*) count FROM ${table}
        WHERE sender_user_id=? OR recipient_user_id=?
      `).get(gone.id, gone.id) as { count: number } | undefined)?.count ?? 0);
      assert.equal(count, 0, `${table} must not retain a row for the deleted user`);
    }
    db.close();
  } finally {
    registry.close();
    rmSync(root, { recursive: true, force: true });
  }
});
