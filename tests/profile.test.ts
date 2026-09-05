import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createIngestApp } from '../src/ingest.js';
import { createApp } from '../src/index.js';
import { UserRegistry } from '../src/users.js';
import { RESERVED_HANDLES, type ProfileInput } from '../src/profile.js';
import { profileDetails } from '../src/output/profile.js';

const draft: ProfileInput = { handle: 'alice', displayName: 'Alice', bio: '第一行\nSecond line', socialLinks: [{name: 'GitHub', url: 'https://github.com/alice'}, {name: 'Website', url: 'http://example.com'}] };

async function formFor(app: ReturnType<typeof createApp>, session: string, value = draft) {
  const page = await app.request('/account/profile', { headers: {cookie: `urtube_session=${session}`} });
  const csrf = (await page.text()).match(/name="csrf" value="([^"]+)"/)![1];
  const form = new URLSearchParams({csrf, displayName: value.displayName, handle: value.handle, bio: value.bio});
  for (const link of value.socialLinks) { form.append('linkName', link.name); form.append('linkUrl', link.url); }
  return form;
}
function post(app: ReturnType<typeof createApp>, session: string, form: URLSearchParams, headers = {}) {
  return app.request('/account/profile', {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded', cookie: `urtube_session=${session}`, ...headers}, body: form.toString()});
}

test('profile form enforces session ownership, CSRF, explicit rename confirmation and atomic conflicts', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const alice = registry.createUser('alice', 'Alice'), bob = registry.createUser('bob', 'Bob');
    const session = registry.createSession(alice), bobSession = registry.createSession(bob);
    const app = createApp(registry);
    const form = await formFor(app, session);
    assert.equal((await post(app, '', form)).status, 401);
    assert.equal((await post(app, bobSession, form)).status, 403);
    assert.equal((await post(app, session, form, {origin: 'https://attacker.example'})).status, 403);
    form.set('userId', String(bob.id));
    assert.equal((await post(app, session, form)).status, 303);
    assert.equal(registry.userByHandle('bob')!.bio, '');
    assert.equal(registry.userByHandle('alice')!.bio, draft.bio);
    form.set('handle', 'renamed');
    assert.equal((await post(app, session, form)).status, 400);
    form.set('confirmHandleChange', '1');
    form.set('handle', 'bob'); form.set('bio', 'must not save');
    const conflict = await post(app, session, form);
    assert.equal(conflict.status, 409);
    assert.match(await conflict.text(), /must not save/);
    assert.equal(registry.userByHandle('alice')!.bio, draft.bio);
    form.set('handle', 'new-alice');
    assert.equal((await post(app, session, form)).status, 303);
    assert.equal(registry.userBySession(session)!.handle, 'new-alice');
    const redirect = await app.request('/alice/history?range=all&key=' + alice.dashboardToken);
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), '/new-alice/history?range=all');
    assert.match(redirect.headers.get('set-cookie')!, /urtube_dash_id_/);
    assert.equal((await app.request('/alice')).status, 404);
    assert.equal((await app.request('/new-alice')).status, 404);
    assert.equal((await app.request('/new-alice?key=' + alice.dashboardToken)).status, 200);
    assert.equal((await app.request('/alice', {headers: {cookie: `urtube_dash_alice=${alice.dashboardToken}`}})).status, 302);
    assert.throws(() => registry.createUser('alice', 'Impostor'), /taken/);
    assert.equal(registry.userByDashboardToken('new-alice', alice.dashboardToken)!.id, alice.id);
    assert.equal(registry.userByCaptureToken(alice.captureToken)!.id, alice.id);
  } finally { registry.close(); }
});

test('profile validation covers Unicode bounds, reserved IDs, unsafe URLs, array size and persistence of ordering', () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('alice', 'Alice');
    for (const handle of [...RESERVED_HANDLES, '../escape', 'AlicE', 'a', 'a'.repeat(33)]) {
      assert.throws(() => registry.updateProfile(user.id, {...draft, handle}));
      assert.throws(() => registry.createUser(handle, 'Bad'));
    }
    for (const url of ['javascript:alert(1)', 'data:text/html,test', '//example.com', 'ftp://example.com', 'https://user:pass@example.com', 'not a url']) {
      assert.throws(() => registry.updateProfile(user.id, {...draft, socialLinks: [{name: 'Bad', url}]}));
    }
    for (const invalid of [{bio: '😀'.repeat(301)}, {displayName: ' '}, {displayName: '😀'.repeat(81)}, {socialLinks: Array(6).fill(draft.socialLinks[0])}, {socialLinks: [{name: '', url: 'https://example.com'}]}]) {
      assert.throws(() => registry.updateProfile(user.id, {...draft, ...invalid}));
    }
    const updated = registry.updateProfile(user.id, {...draft, bio: '😀'.repeat(300), socialLinks: [...draft.socialLinks].reverse()});
    assert.equal([...updated.bio].length, 300);
    assert.equal(updated.socialLinks[0].name, 'Website');
    assert.equal(updated.dashboardPublic, false);
    const cleared = registry.updateProfile(user.id, {...draft, bio: '', socialLinks: []});
    assert.equal(cleared.bio, ''); assert.deepEqual(cleared.socialLinks, []);
    assert.doesNotMatch(profileDetails(cleared, false, 'en'), /<ul|white-space/);
  } finally { registry.close(); }
});

test('stored profile text is escaped; public profile does not grant editing or reveal private history', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('alice', 'Alice', {dashboardPublic: true});
    const updated = registry.updateProfile(user.id, {...draft, bio: '<script>alert(1)</script>\nHello', displayName: '<b>Alice</b>'});
    const markup = profileDetails(updated, false, 'zh');
    assert.match(markup, /&lt;script&gt;/); assert.doesNotMatch(markup, /<script>|account\/profile/);
    assert.match(markup, /noopener noreferrer/);
    const app = createApp(registry);
    const publicPage = await (await app.request('/alice')).text();
    assert.match(publicPage, /@alice/); assert.match(publicPage, /&lt;b&gt;Alice/);
    assert.doesNotMatch(publicPage, /<a\b[^>]*href="\/account\/profile"/);
    assert.equal((await app.request('/account/profile')).status, 302);
    const session = registry.createSession(user);
    const editor = await (await app.request('/account/profile?lang=zh', {headers: {cookie: `urtube_session=${session}`}})).text();
    assert.match(editor, /編輯個人檔案/); assert.match(editor, /剩餘字數/);
    assert.match(editor, /&lt;script&gt;/);
  } finally { registry.close(); }
});

test('existing registry migrates idempotently; repeated renames keep data, encryption, owner and sessions across reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'urtube-profile-'));
  const path = join(dir, 'registry.sqlite');
  let registry = new UserRegistry(path);
  const user = registry.createUser('alice', 'Alice', {googleSub: 'permanent-google-id'});
  const session = registry.createSession(user), key = registry.dataKeyFor(user), dataPath = registry.databasePathFor(user);
  registry.repositoryFor(user).setYoutubeSyncState('fixture', 'preserved');
  registry.close();
  // Reproduce a registry from before this feature; user data remains on disk.
  const old = new DatabaseSync(path);
  old.exec('ALTER TABLE users DROP COLUMN bio; ALTER TABLE users DROP COLUMN social_links; ALTER TABLE users DROP COLUMN storage_name; DROP TABLE handle_aliases;');
  old.close();
  registry = new UserRegistry(path);
  try {
    const migrated = registry.userByHandle('alice')!;
    assert.equal(migrated.bio, ''); assert.deepEqual(migrated.socialLinks, []);
    const repo = registry.repositoryFor(migrated);
    registry.updateProfile(user.id, {...draft, handle: 'alice-two'});
    const renamed = registry.renameUser('alice-two', 'alice-three');
    assert.equal(registry.repositoryFor(renamed), repo);
    assert.equal(registry.databasePathFor(renamed), dataPath);
    assert.equal(registry.dataKeyFor(renamed), key);
    assert.equal(registry.userByAlias('alice')!.id, user.id);
    assert.equal(registry.userByAlias('alice-two')!.id, user.id);
    registry.close(); registry = new UserRegistry(path);
    const persisted = registry.userBySession(session)!;
    assert.equal(persisted.handle, 'alice-three'); assert.equal(persisted.bio, draft.bio);
    assert.deepEqual(persisted.socialLinks, draft.socialLinks);
    assert.equal(registry.userByGoogleSub('permanent-google-id')!.id, user.id);
    assert.equal(registry.repositoryFor(persisted).youtubeSyncState('fixture'), 'preserved');
    registry.renameUser('alice-three', 'alice');
    assert.equal(registry.userByAlias('alice'), null);
    assert.equal(registry.userByAlias('alice-three')!.handle, 'alice');
    const owner = registry.ensureDefaultUser(), ownerPath = registry.databasePathFor(owner);
    const renamedOwner = registry.renameUser(owner.handle, 'owner-new');
    assert.equal(registry.ensureDefaultUser().id, owner.id);
    assert.equal(registry.databasePathFor(renamedOwner), ownerPath);
    assert.throws(() => registry.deleteUser(renamedOwner.handle), /instance owner/);
  } finally { registry.close(); rmSync(dir, {recursive: true, force: true}); }
});


test('owner import authorization survives a handle edit', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const owner = registry.ensureDefaultUser();
    registry.renameUser(owner.handle, 'renamed-owner');
    const captureToken = registry.rotateCaptureToken('renamed-owner');
    const ingest = createIngestApp(registry);
    const response = await ingest.request('/api/ingest/youtube/oauth/start', {method: 'POST', headers: {authorization: `Bearer ${captureToken}`}});
    // OAuth may be unconfigured in tests, but the owner passes authorization.
    assert.notEqual(response.status, 401);
  } finally { registry.close(); }
});

test('platform usernames become URLs on the server without client JavaScript', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('alice', 'Alice'), session = registry.createSession(user);
    const app = createApp(registry);
    const platforms = ['instagram', 'threads', 'youtube', 'github'];
    const form = await formFor(app, session, {...draft, socialLinks: platforms.map(name => ({name, url: '@alice'}))});
    platforms.forEach(platform => form.append('linkPlatform', platform));
    assert.equal((await post(app, session, form)).status, 303);
    assert.deepEqual(registry.userByHandle('alice')!.socialLinks.map(link => link.url), [
      'https://www.instagram.com/alice', 'https://www.threads.com/@alice',
      'https://www.youtube.com/@alice', 'https://github.com/alice',
    ]);
    const invalid = await formFor(app, session, {...draft, socialLinks: [{name:'GitHub', url:'javascript:alert(1)'}]});
    invalid.append('linkPlatform', 'github');
    assert.equal((await post(app, session, invalid)).status, 400);
    invalid.set('linkUrl', 'alice/../../other');
    assert.equal((await post(app, session, invalid)).status, 400);
    invalid.set('linkUrl', 'https://github.com/alice?tab=repositories');
    assert.equal((await post(app, session, invalid)).status, 303);
    assert.equal(registry.userByHandle('alice')!.socialLinks[0].url, 'https://github.com/alice?tab=repositories');
  } finally { registry.close(); }
});
