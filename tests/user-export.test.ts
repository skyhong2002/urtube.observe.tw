import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createApp } from '../src/index.js';
import { UserRegistry, type User } from '../src/users.js';
import { MATCHING_TAXONOMY } from '../src/youtube/matching.js';
import {
  REGISTRY_CRYSTAL_VERSION,
  type RegistryMatchingCrystal,
} from '../src/youtube/registry-crystal.js';
import { parseYoutubeArchive } from '../src/youtube/takeout.js';

const PRIVATE_QUERY = 'my private export query';
const OTHER_CONTACT = '@other-private-contact';

function takeoutFixture(): Uint8Array {
  return zipSync({
    'Takeout/YouTube and YouTube Music/history/watch-history.json': strToU8(JSON.stringify([{
      header: 'YouTube', title: 'Watched Export Fixture',
      titleUrl: 'https://www.youtube.com/watch?v=exportvid01',
      subtitles: [{ name: 'Export Channel', url: 'https://www.youtube.com/channel/export-channel' }],
      time: '2026-07-28T01:00:00Z', products: ['YouTube'],
      activityControls: ['YouTube watch history'],
    }])),
    'Takeout/YouTube and YouTube Music/history/search-history.json': strToU8(JSON.stringify([{
      header: 'YouTube', title: `Searched for ${PRIVATE_QUERY}`,
      time: '2026-07-28T00:30:00Z', products: ['YouTube'],
      activityControls: ['YouTube search history'],
    }])),
  });
}

function crystal(): RegistryMatchingCrystal {
  const music = MATCHING_TAXONOMY.topics.find((topic) => topic.key === 'music')!;
  return {
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
    topics: [{ key: music.key, name: music.name, share: 1 }],
    channels: [{ key: 'shared', name: 'Shared Channel', share: 1 }],
  };
}

function publish(registry: UserRegistry, user: User): void {
  registry.upsertMatchingCrystal(user, crystal());
  registry.setMatchingPreferences(user.handle, true, 'topics_and_channel');
}

async function postExport(app: ReturnType<typeof createApp>, cookie?: string, confirmed = true): Promise<Response> {
  return await app.request('/account/export', {
    method: 'POST',
    headers: {
      ...(cookie ? { cookie } : {}),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: confirmed ? 'confirmExport=1' : '',
  });
}

test('signed-in owner receives a streamed, readable, privacy-bounded ZIP', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const owner = registry.createUser('export-owner', 'Export Owner', {
      googleSub: 'google-export-owner',
      googleEmail: 'owner@example.test',
    });
    registry.setReferenceOptIn(owner.handle, true);
    const other = registry.createUser('export-other', 'Export Other');
    for (const user of [owner, other]) publish(registry, user);
    registry.setMatchingProfile(other.handle, 'Other private introduction', OTHER_CONTACT);
    const action = registry.issueMatchActionToken(owner, other.id, ['Music']);
    registry.createMatchRequest(owner, action);
    registry.respondToMatchRequest(
      other,
      registry.matchingInboxFor(other).incoming[0].requestToken,
      'accept',
    );

    const repository = registry.repositoryFor(owner);
    const dataKey = registry.dataKeyFor(owner);
    repository.ingestYoutubeArchive(parseYoutubeArchive(takeoutFixture(), dataKey));
    repository.ingestYoutubeProgress({
      scanId: 'export-scan-1234567890',
      observedAt: '2026-07-29T00:00:00.000Z',
      complete: true,
      items: [{ videoId: 'exportvid01', progressPercent: 50, resumeSeconds: 90, durationSeconds: 600 }],
    });

    const cookie = `urtube_session=${registry.createSession(owner)}`;
    const response = await postExport(app, cookie);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
    assert.equal(response.headers.get('content-type'), 'application/zip');
    assert.match(response.headers.get('content-disposition') ?? '', /urtube-export-owner-\d{4}-\d{2}-\d{2}\.zip/);
    assert.ok(response.body instanceof ReadableStream);

    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
    }
    assert.ok(chunks.length > 10, 'ZIP is emitted incrementally');
    const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const archive = unzipSync(bytes);
    const readJson = (name: string) => JSON.parse(strFromU8(archive[name]));
    const manifest = readJson('manifest.json') as {
      schemaVersion: number;
      files: Array<{ name: string; rowCount: number; fields: unknown[] }>;
      excluded: string[];
    };
    assert.equal(manifest.schemaVersion, 11);
    assert.ok(manifest.files.every((file) => file.fields.length > 0 || file.name === 'matching-crystal.json'));
    for (const file of manifest.files.filter((entry) => entry.name.startsWith('data/'))) {
      assert.equal(readJson(file.name).length, file.rowCount, `${file.name} row count`);
    }
    const searches = readJson('data/search-events.json');
    assert.equal(searches[0].query, PRIVATE_QUERY);
    assert.equal(searches[0].query_ciphertext, undefined);
    assert.equal(readJson('data/watch-events.json').length, 1);
    assert.equal(readJson('data/playback-progress.json').length, 1);
    assert.equal(readJson('data/scan-runs.json').length, 1);
    assert.equal(readJson('data/personal-taxonomy-runs.json').length, 0);
    assert.equal(readJson('data/personal-taxonomy-activations.json').length, 0);

    const matching = readJson('matching.json');
    assert.deepEqual(matching.connections.map((connection: { displayName: string }) => connection.displayName), ['Export Other']);
    const allText = Object.values(archive).map((value) => strFromU8(value)).join('\n');
    assert.ok(allText.includes(PRIVATE_QUERY));
    assert.ok(!allText.includes(OTHER_CONTACT));
    assert.ok(!allText.includes('Other private introduction'));
    assert.ok(!allText.includes(action));
    assert.ok(manifest.excluded.some((item) => item.includes('contact details')));
    assert.equal(readJson('account.json').googleAccountId, 'google-export-owner');
    assert.equal(readJson('account.json').referenceOptIn, true);
    assert.equal(repository.youtubeCounts().watches, 1, 'snapshot closes without changing the archive');

    const otherCookie = `urtube_session=${registry.createSession(other)}`;
    const otherArchive = unzipSync(new Uint8Array(await (await postExport(app, otherCookie)).arrayBuffer()));
    const otherAccount = JSON.parse(strFromU8(otherArchive['account.json']));
    const otherText = Object.values(otherArchive).map((value) => strFromU8(value)).join('\n');
    assert.equal(otherAccount.handle, 'export-other');
    assert.ok(!otherText.includes(PRIVATE_QUERY));
  } finally {
    registry.close();
  }
});

test('export requires the current user session and explicit confirmation', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const owner = registry.createUser('export-auth', 'Export Auth');
    const cookie = `urtube_session=${registry.createSession(owner)}`;
    assert.equal((await postExport(app)).status, 401);
    assert.equal((await postExport(app, cookie, false)).status, 400);
    assert.equal((await app.request('/account/export')).status, 404);
    const expired = `urtube_session=${registry.createSession(owner, -1)}`;
    assert.equal((await postExport(app, expired)).status, 401);

    const account = await app.request('/account', { headers: { cookie } });
    assert.equal(account.headers.get('cache-control'), 'no-store');
    assert.match(await account.text(), /Export my data/);
    assert.match(await (await app.request('/privacy')).text(), /export your saved data/);
  } finally {
    registry.close();
  }
});

test('canceling a download closes its database snapshot', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const owner = registry.createUser('cancel-owner', 'Cancel Owner');
    const repository = registry.repositoryFor(owner);
    const openPortableExport = repository.openPortableExport.bind(repository);
    let closes = 0;
    repository.openPortableExport = (dataKey) => {
      const snapshot = openPortableExport(dataKey);
      return {
        ...snapshot,
        close: () => {
          closes += 1;
          snapshot.close();
        },
      };
    };
    const cookie = `urtube_session=${registry.createSession(owner)}`;
    const response = await postExport(app, cookie);
    assert.equal(response.status, 200);
    await response.body!.cancel();
    assert.equal(closes, 1);
  } finally {
    registry.close();
  }
});

test('file-backed export keeps a consistent read snapshot while new writes continue', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'urtube-user-export-'));
  const registry = new UserRegistry(join(directory, 'registry.sqlite'));
  const app = createApp(registry);
  try {
    const owner = registry.createUser('snapshot-owner', 'Snapshot Owner');
    const repository = registry.repositoryFor(owner);
    repository.setYoutubeSyncState('before_export', 'included');
    const cookie = `urtube_session=${registry.createSession(owner)}`;
    const response = await postExport(app, cookie);
    assert.equal(response.status, 200);

    repository.setYoutubeSyncState('after_export_started', 'not-in-snapshot');
    const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const state = JSON.parse(strFromU8(archive['data/sync-state.json'])) as Array<{ key: string }>;
    assert.deepEqual(state.map((row) => row.key), ['before_export']);
    assert.equal(repository.youtubeSyncState('after_export_started'), 'not-in-snapshot');
  } finally {
    registry.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
