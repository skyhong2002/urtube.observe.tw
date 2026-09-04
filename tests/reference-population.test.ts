import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { UserRegistry, type User } from '../src/users.js';
import { normalizeYoutubeCapture } from '../src/youtube/capture.js';
import {
  REFERENCE_POPULATION_METHOD_VERSION,
  referencePopulation,
  type ReferenceContribution,
} from '../src/youtube/reference-population.js';
import {
  computeTagLean,
  TAG_POLICY,
  type TagLists,
  type TagListSnapshot,
  type TagLeanData,
} from '../src/youtube/taglists.js';
import type { YoutubeChannelSummary } from '../src/youtube/types.js';

const GREEN_CHANNEL = 'UCreference-green';
const BLUE_CHANNEL = 'UCreference-blue';

function snapshot(): TagListSnapshot {
  const empty = () => new Set<string>();
  const lists: TagLists = {
    news: new Set([GREEN_CHANNEL]),
    editorial: empty(),
    editorialShows: empty(),
    blue: new Set([BLUE_CHANNEL]),
    green: new Set([GREEN_CHANNEL]),
    white: empty(),
    red: empty(),
  };
  return {
    lists,
    provenance: {
      sourceUrl: 'https://urtubeapi.analysis.tw/api/channels_list.php',
      sourceUpdatedAt: '2026-09-05 01:58:34',
      fetchedAt: '2026-09-05T01:58:35.000Z',
      membershipVersion: 'sha256:reference123',
      policyVersion: TAG_POLICY.version,
      policyUrl: TAG_POLICY.url,
      reportUrl: TAG_POLICY.reportUrl,
    },
  };
}

function channel(
  channelId: string,
  name: string,
  seconds: number,
): YoutubeChannelSummary {
  return { channelId, name, thumbnailUrl: '', watches: 1, estimatedWatchSeconds: seconds };
}

function tagData(greenSeconds: number, blueSeconds: number): TagLeanData {
  return computeTagLean('all', [
    channel(GREEN_CHANNEL, 'Green reference channel', greenSeconds),
    channel(BLUE_CHANNEL, 'Blue reference channel', blueSeconds),
  ], snapshot(), new Date('2026-09-05T02:00:00.000Z'));
}

function contribution(subjectId: number, greenSeconds: number): ReferenceContribution {
  return {
    subjectId,
    dataUpdatedAt: `2026-09-0${subjectId}T02:00:00.000Z`,
    data: tagData(greenSeconds, 100 - greenSeconds),
  };
}

test('reference population uses equal-user aggregates and stable bounded output', () => {
  const contributions = [0, 25, 50, 75, 100]
    .map((green, index) => contribution(index + 1, green));
  const result = referencePopulation(
    tagData(75, 25),
    contributions,
    new Date('2026-09-06T00:00:00.000Z'),
  );
  assert.equal(result.methodVersion, REFERENCE_POPULATION_METHOD_VERSION);
  assert.equal(result.dataUpdatedAt, '2026-09-05T02:00:00.000Z');
  assert.match(result.version, /^sha256:[a-f0-9]{12}$/);
  assert.equal(result.content.status, 'ready');
  assert.equal(result.political.status, 'ready');
  if (result.political.status !== 'ready') return;
  const green = result.political.metrics.find((metric) => metric.key === 'green')!;
  assert.deepEqual(green, {
    key: 'green',
    viewerPct: 75,
    meanPct: 50,
    medianPct: 50,
    lift: 1.5,
    percentile: 70,
  });
  assert.equal(
    referencePopulation(tagData(75, 25), [...contributions].reverse()).version,
    result.version,
  );
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('subjectId'));
  assert.ok(!serialized.includes('Green reference channel'));
});

test('small groups and viewers without comparable data never receive a percentile', () => {
  const four = [10, 20, 30, 40].map((green, index) => contribution(index + 1, green));
  const insufficient = referencePopulation(tagData(50, 50), four);
  assert.deepEqual(insufficient.content, { status: 'insufficient', sampleSize: 4 });
  assert.deepEqual(insufficient.political, { status: 'insufficient', sampleSize: 4 });
  assert.ok(!JSON.stringify(insufficient).includes('percentile'));

  const five = [...four, contribution(5, 50)];
  const emptyViewer = computeTagLean('all', [], snapshot());
  const unavailable = referencePopulation(emptyViewer, five);
  assert.deepEqual(unavailable.content, { status: 'viewer-unavailable', sampleSize: 5 });
  assert.deepEqual(unavailable.political, { status: 'viewer-unavailable', sampleSize: 5 });

  const incompatible = { ...five[0], data: { ...five[0].data, range: '90d' as const } };
  assert.throws(
    () => referencePopulation(tagData(50, 50), [incompatible, ...five.slice(1)]),
    /not comparable/,
  );
});

function addViewingData(
  registry: UserRegistry,
  user: User,
  index: number,
  greenSeconds: number,
): void {
  const repository = registry.repositoryFor(user);
  const rows = [
    {
      videoId: `green${String(index).padStart(6, '0')}`,
      channelId: GREEN_CHANNEL,
      channelTitle: 'Green reference channel',
      seconds: greenSeconds,
      sessionId: `00000000-0000-4000-8000-${String(index * 2 + 1).padStart(12, '0')}`,
    },
    {
      videoId: `blue00${String(index).padStart(5, '0')}`,
      channelId: BLUE_CHANNEL,
      channelTitle: 'Blue reference channel',
      seconds: 600 - greenSeconds,
      sessionId: `00000000-0000-4000-8000-${String(index * 2 + 2).padStart(12, '0')}`,
    },
  ];
  for (const row of rows) {
    repository.upsertYoutubeCapture(normalizeYoutubeCapture({
      sessionId: row.sessionId,
      videoId: row.videoId,
      title: `Video ${row.videoId}`,
      url: `https://www.youtube.com/watch?v=${row.videoId}`,
      channelTitle: row.channelTitle,
      watchedAt: '2026-09-04T12:00:00.000Z',
      actualWatchedSeconds: row.seconds,
      durationSeconds: 600,
    }), '2026-09-04T12:00:00.000Z');
    repository.upsertYoutubeVideoMetadata([{
      videoId: row.videoId,
      title: `Video ${row.videoId}`,
      channelId: row.channelId,
      channelTitle: row.channelTitle,
      description: '',
      tags: [],
      thumbnailUrl: '',
      durationSeconds: 600,
      publishedAt: null,
      categoryId: null,
      availability: 'available',
      metadataHash: `hash-${row.videoId}`,
    }]);
  }
}

test('reference consent is separate, owner-only, withdrawable, and rendered with provenance', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry, { loadTagLists: async () => snapshot() });
  try {
    const contributors = Array.from({ length: 5 }, (_, index) => {
      const user = registry.createUser(`reference-${index}`, `Private Contributor ${index}`);
      addViewingData(registry, user, index, 100 + index * 80);
      registry.setReferenceOptIn(user.handle, true);
      return user;
    });
    const viewer = registry.createUser('reference-viewer', 'Reference Viewer');
    addViewingData(registry, viewer, 9, 450);
    registry.setMatchingOptIn(viewer.handle, true);
    assert.equal(registry.userByHandle(viewer.handle)?.referenceOptIn, false);
    assert.equal(registry.listReferencePopulationUsers().length, 5);

    const cookie = `urtube_session=${registry.createSession(viewer)}`;
    const page = await (await app.request(`/${viewer.handle}/insights?range=all`, {
      headers: { cookie },
    })).text();
    assert.match(page, /This site’s reference population/);
    assert.match(page, /5 consenting accounts/);
    assert.match(page, /Reference mean/);
    assert.match(page, /method channel-tags-equal-user-v1/);
    assert.match(page, /version sha256:[a-f0-9]{12}/);
    for (const contributor of contributors) {
      assert.ok(!page.includes(contributor.displayName));
      assert.ok(!page.includes(contributor.handle));
    }

    const account = await (await app.request('/account', { headers: { cookie } })).text();
    assert.match(account, /Anonymous reference population/);
    assert.doesNotMatch(account, /name="referenceOptIn" value="1" checked/);
    assert.equal((await app.request('/account/reference-population', { method: 'POST' })).status, 302);

    const enabled = await app.request('/account/reference-population', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'referenceOptIn=1',
    });
    assert.equal(enabled.status, 302);
    assert.equal(registry.userByHandle(viewer.handle)?.referenceOptIn, true);
    assert.equal(registry.listReferencePopulationUsers().length, 6);

    const firstCookie = `urtube_session=${registry.createSession(contributors[0])}`;
    await app.request('/account/reference-population', {
      method: 'POST',
      headers: { cookie: firstCookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    await app.request('/account/reference-population', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    assert.equal(registry.listReferencePopulationUsers().length, 4);
    const insufficient = await (await app.request(`/${viewer.handle}/insights?range=all`, {
      headers: { cookie },
    })).text();
    assert.match(insufficient, /No reliable reference population yet/);
    assert.doesNotMatch(insufficient, /Reference mean/);

    const privacy = await (await app.request('/privacy')).text();
    assert.match(privacy, /separate opt-in/);
    assert.match(privacy, /at least five consenting accounts/);
  } finally {
    registry.close();
  }
});

test('registry migration adds reference consent as disabled', () => {
  const root = mkdtempSync(join(tmpdir(), 'urtube-reference-upgrade-'));
  const registryPath = join(root, 'users.sqlite');
  try {
    const current = new UserRegistry(registryPath, join(root, 'users'));
    current.createUser('before-reference', 'Before Reference');
    current.close();
    const old = new DatabaseSync(registryPath);
    old.exec('ALTER TABLE users DROP COLUMN reference_opt_in');
    old.close();

    const upgraded = new UserRegistry(registryPath, join(root, 'users'));
    assert.equal(upgraded.userByHandle('before-reference')?.referenceOptIn, false);
    upgraded.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
