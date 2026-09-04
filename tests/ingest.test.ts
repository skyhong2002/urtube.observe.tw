import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { config } from '../src/config.js';
import { createIngestApp } from '../src/ingest.js';
import { UserRegistry } from '../src/users.js';

const INGEST_TOKEN = process.env.INGEST_TOKEN!;
const CAPTURE_TOKEN = process.env.YOUTUBE_CAPTURE_TOKEN!;

function fixtureZip(): Uint8Array {
  const watch = [
    {
      header: 'YouTube', title: 'Watched Long Technical Talk',
      titleUrl: 'https://www.youtube.com/watch?v=video-one',
      subtitles: [{ name: 'Channel One', url: 'https://www.youtube.com/channel/channel-one' }],
      time: '2026-07-28T01:00:00Z', products: ['YouTube'],
      activityControls: ['YouTube watch history'],
    },
  ];
  const search = [
    {
      header: 'YouTube', title: 'Searched for private search term',
      titleUrl: 'https://www.youtube.com/results?search_query=private+search+term',
      time: '2026-07-28T00:30:00Z', products: ['YouTube'],
      activityControls: ['YouTube search history'],
    },
  ];
  return zipSync({
    'Takeout/YouTube and YouTube Music/history/watch-history.json': strToU8(JSON.stringify(watch)),
    'Takeout/YouTube and YouTube Music/history/search-history.json': strToU8(JSON.stringify(search)),
  });
}

const CAPTURE_WATCHED_AT = new Date(Date.now() - 60_000).toISOString();

function capturePayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    sessionId: '12345678-1234-4123-8123-123456789abc',
    videoId: 'dQw4w9WgXcQ',
    title: 'Captured YouTube Video',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    channelTitle: 'Captured Channel',
    watchedAt: CAPTURE_WATCHED_AT,
    actualWatchedSeconds: 30,
    durationSeconds: 213,
    ...overrides,
  });
}

test('every ingest endpoint rejects missing, malformed, and wrong tokens', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createIngestApp(registry);
  const wrong = { authorization: 'Bearer wrong-token-that-is-at-least-32-characters' };
  const endpoints: Array<[string, RequestInit]> = [
    ['/api/ingest/youtube/takeout', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: fixtureZip() as unknown as RequestInit['body'] }],
    ['/api/ingest/youtube/capture', { method: 'POST', body: capturePayload() }],
    ['/api/ingest/youtube/progress', { method: 'POST', body: '{}' }],
    ['/api/ingest/youtube/history', { method: 'POST', body: '{}' }],
    ['/api/ingest/youtube/capture/status', {}],
    ['/api/ingest/youtube/history/status', {}],
    ['/api/ingest/youtube/oauth/start', { method: 'POST' }],
  ];
  try {
    for (const [path, init] of endpoints) {
      const missing = await app.request(path, init);
      assert.equal(missing.status, 401, `${path} without token`);
      const bad = await app.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), ...wrong } });
      assert.equal(bad.status, 401, `${path} with wrong token`);
      const malformed = await app.request(path, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), authorization: `Token ${CAPTURE_TOKEN}` },
      });
      assert.equal(malformed.status, 401, `${path} with non-bearer header`);
    }
  } finally {
    registry.close();
  }
});

test('Takeout upload works with the admin token and is idempotent', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createIngestApp(registry);
  const headers = { authorization: `Bearer ${INGEST_TOKEN}`, 'content-type': 'application/zip' };
  try {
    const first = await app.request('/api/ingest/youtube/takeout', {
      method: 'POST', headers, body: fixtureZip() as unknown as RequestInit['body'],
    });
    assert.equal(first.status, 201);
    const firstBody = await first.json() as Record<string, unknown>;
    assert.equal(firstBody.watchesInserted, 1);
    assert.equal(firstBody.searchesInserted, 1);

    const again = await app.request('/api/ingest/youtube/takeout', {
      method: 'POST', headers, body: fixtureZip() as unknown as RequestInit['body'],
    });
    assert.equal(again.status, 201);
    const againBody = await again.json() as Record<string, unknown>;
    assert.equal(againBody.watchesInserted, 0);
    assert.equal(againBody.searchesInserted, 0);

    const wrongType = await app.request('/api/ingest/youtube/takeout', {
      method: 'POST',
      headers: { authorization: `Bearer ${INGEST_TOKEN}`, 'content-type': 'text/plain' },
      body: 'zip',
    });
    assert.equal(wrongType.status, 415);
  } finally {
    registry.close();
  }
});

test('capture over HTTP is idempotent and only grows measured seconds', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createIngestApp(registry);
  const headers = { authorization: `Bearer ${CAPTURE_TOKEN}`, 'content-type': 'application/json' };
  try {
    const inserted = await app.request('/api/ingest/youtube/capture', {
      method: 'POST', headers, body: capturePayload(),
    });
    assert.equal(inserted.status, 201);

    const duplicate = await app.request('/api/ingest/youtube/capture', {
      method: 'POST', headers, body: capturePayload(),
    });
    assert.equal(duplicate.status, 200);
    const duplicateBody = await duplicate.json() as Record<string, unknown>;
    assert.equal(duplicateBody.inserted, false);
    assert.equal(duplicateBody.updated, false);

    const grown = await app.request('/api/ingest/youtube/capture', {
      method: 'POST', headers, body: capturePayload({ actualWatchedSeconds: 95 }),
    });
    assert.equal(grown.status, 200);
    const grownBody = await grown.json() as Record<string, unknown>;
    assert.equal(grownBody.updated, true);
    assert.equal(grownBody.actualWatchedSeconds, 95);

    const user = registry.ensureDefaultUser();
    assert.equal(registry.repositoryFor(user).youtubeCounts().videoWatches, 1);
  } finally {
    registry.close();
  }
});

test('progress batches over HTTP are idempotent and refuse post-completion writes', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createIngestApp(registry);
  const headers = { authorization: `Bearer ${CAPTURE_TOKEN}`, 'content-type': 'application/json' };
  const observedAt = new Date(Date.now() - 60_000).toISOString();
  const batch = (complete: boolean) => JSON.stringify({
    scanId: 'scan-http-1234567890',
    observedAt,
    complete,
    items: [{ videoId: 'AAAAAAAAAAA', progressPercent: 50, resumeSeconds: 120, durationSeconds: 600 }],
  });
  try {
    const first = await app.request('/api/ingest/youtube/progress', { method: 'POST', headers, body: batch(false) });
    assert.equal(first.status, 202);
    assert.equal(((await first.json()) as Record<string, unknown>).stored, 1);

    const repeat = await app.request('/api/ingest/youtube/progress', { method: 'POST', headers, body: batch(false) });
    assert.equal(repeat.status, 202);
    assert.equal(((await repeat.json()) as Record<string, unknown>).stored, 0);

    const complete = await app.request('/api/ingest/youtube/progress', { method: 'POST', headers, body: batch(true) });
    assert.equal(complete.status, 200);

    const late = await app.request('/api/ingest/youtube/progress', { method: 'POST', headers, body: batch(false) });
    assert.equal(late.status, 400);
  } finally {
    registry.close();
  }
});

test('history batches dedupe overlapping checkpoint windows across syncs', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createIngestApp(registry);
  const headers = { authorization: `Bearer ${CAPTURE_TOKEN}`, 'content-type': 'application/json' };
  const occurredAt = new Date(Date.now() - 3600_000).toISOString();
  const events = [
    {
      kind: 'watch', occurredAt, videoId: 'OjgytNhTjtI',
      title: 'Overlap Video', url: 'https://www.youtube.com/watch?v=OjgytNhTjtI',
      channelId: 'UCEevYX4rCcfF0ZrxmnnONXA', channelTitle: 'Faz',
      durationSeconds: 63, activityType: 'video',
    },
    { kind: 'search', occurredAt, query: 'overlap private query', activityType: 'search' },
  ];
  const payload = (syncId: string) => JSON.stringify({
    syncId, observedAt: new Date().toISOString(), events,
  });
  try {
    const status = await app.request('/api/ingest/youtube/history/status', { headers });
    assert.equal(status.status, 200);
    const statusBody = (await status.json()) as Record<string, unknown>;
    assert.equal(statusBody.latestEventAt, null);
    assert.equal(statusBody.coverage, null);

    // The extension reports how a scan ended even when it never sent a
    // single progress row; a full read that reached the end becomes the
    // coverage the next sync stops at.
    const summary = (patch: Record<string, unknown>) => JSON.stringify({
      scanId: 'scan-coverage-000000001', observedAt: new Date().toISOString(),
      complete: true, items: [],
      summary: {
        mode: 'full', videos: 3, passes: 2, endReason: 'end-of-history',
        oldestWatchedAt: '2026-07-17T04:00:00.000Z', newestWatchedAt: occurredAt,
        error: null, landedUrl: null, ...patch,
      },
    });
    const reported = await app.request('/api/ingest/youtube/progress', { method: 'POST', headers, body: summary({}) });
    assert.equal(reported.status, 200);
    const covered = await app.request('/api/ingest/youtube/history/status', { headers });
    const coverage = ((await covered.json()) as Record<string, any>).coverage;
    assert.equal(coverage.scanId, 'scan-coverage-000000001');
    assert.equal(coverage.oldestWatchedAt, '2026-07-17T04:00:00.000Z');
    const rejected = await app.request('/api/ingest/youtube/progress', { method: 'POST', headers, body: summary({ endReason: 'whatever' }) });
    assert.equal(rejected.status, 400);

    const first = await app.request('/api/ingest/youtube/history', { method: 'POST', headers, body: payload('history-sync-aaaaaaaaaa') });
    assert.equal(first.status, 200);
    const firstBody = await first.json() as Record<string, any>;
    assert.equal(firstBody.watchesInserted, 1);
    assert.equal(firstBody.searchesInserted, 1);

    // A later sync re-sends the overlap window (same events, new syncId):
    // nothing duplicates, and the checkpoint advances to the newest event.
    const overlap = await app.request('/api/ingest/youtube/history', { method: 'POST', headers, body: payload('history-sync-bbbbbbbbbb') });
    assert.equal(overlap.status, 200);
    const overlapBody = await overlap.json() as Record<string, any>;
    assert.equal(overlapBody.watchesInserted, 0);
    assert.equal(overlapBody.searchesInserted, 0);
    assert.equal(overlapBody.history.watches, 1);
    assert.equal(overlapBody.history.searches, 1);
    assert.equal(overlapBody.history.latestEventAt, new Date(occurredAt).toISOString());
  } finally {
    registry.close();
  }
});

test('backfill batches create per-day events, rescan idempotently, and yield to exact events', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createIngestApp(registry);
  const headers = { authorization: `Bearer ${CAPTURE_TOKEN}`, 'content-type': 'application/json' };
  const payload = (items: unknown[]) => JSON.stringify({
    scanId: 'history-scan-aaaaaaaaaa', observedAt: new Date().toISOString(), items,
  });
  const item = (watchedAt: string, videoId = 'OjgytNhTjtI') => ({
    videoId, title: 'Backfilled Video', channelId: 'UCEevYX4rCcfF0ZrxmnnONXA',
    channelTitle: 'Faz', durationSeconds: 600, watchedAt,
  });
  try {
    // Years-old events are accepted (no 90-day window) and land day-precise.
    const first = await app.request('/api/ingest/youtube/backfill', {
      method: 'POST', headers,
      body: payload([item('2019-03-01T04:00:00.000Z'), item('2019-03-02T04:00:00.000Z')]),
    });
    assert.equal(first.status, 201);
    assert.equal((await first.json() as Record<string, any>).watchesInserted, 2);

    // A rescan of the same page re-sends the same days: nothing duplicates.
    const rescan = await app.request('/api/ingest/youtube/backfill', {
      method: 'POST', headers, body: payload([item('2019-03-01T04:00:00.000Z')]),
    });
    assert.equal((await rescan.json() as Record<string, any>).watchesInserted, 0);

    // An exact event replaces the day placeholder for the same Taipei day
    // (different second, as in reality: backfill stamps noon, exact is real).
    const recentDay = new Date(Date.now() - 3600_000);
    const exactTime = new Date(recentDay.getTime() + 60_000);
    await app.request('/api/ingest/youtube/backfill', {
      method: 'POST', headers, body: payload([item(recentDay.toISOString())]),
    });
    const owner = registry.ensureDefaultUser();
    const before = registry.repositoryFor(owner).youtubeCounts().watches;
    const exact = await app.request('/api/ingest/youtube/history', {
      method: 'POST', headers,
      body: JSON.stringify({
        syncId: 'history-sync-cccccccccc', observedAt: new Date().toISOString(),
        events: [{
          kind: 'watch', occurredAt: exactTime.toISOString(), videoId: 'OjgytNhTjtI',
          title: 'Backfilled Video', url: 'https://www.youtube.com/watch?v=OjgytNhTjtI',
          channelId: 'UCEevYX4rCcfF0ZrxmnnONXA', channelTitle: 'Faz',
          durationSeconds: 600, activityType: 'video',
        }],
      }),
    });
    assert.equal(exact.status, 200);
    assert.equal((await exact.json() as Record<string, any>).watchesInserted, 1);
    // Placeholder deleted, exact inserted: net count unchanged.
    assert.equal(registry.repositoryFor(owner).youtubeCounts().watches, before);

    // Malformed and ancient timestamps are rejected.
    const tooOld = await app.request('/api/ingest/youtube/backfill', {
      method: 'POST', headers, body: payload([item('2004-01-01T04:00:00.000Z')]),
    });
    assert.equal(tooOld.status, 400);
  } finally {
    registry.close();
  }
});

test('per-user capture tokens isolate data and admin token maps to the owner', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createIngestApp(registry);
  try {
    const dad = registry.createUser('dad', 'Dad');
    const dadHeaders = { authorization: `Bearer ${dad.captureToken}`, 'content-type': 'application/json' };
    const status = await app.request('/api/ingest/youtube/capture/status', { headers: dadHeaders });
    assert.equal(status.status, 200);
    assert.equal(((await status.json()) as Record<string, unknown>).user, 'dad');

    const capture = await app.request('/api/ingest/youtube/capture', {
      method: 'POST', headers: dadHeaders, body: capturePayload(),
    });
    assert.equal(capture.status, 201);

    assert.equal(registry.repositoryFor(registry.userByHandle('dad')!).youtubeCounts().videoWatches, 1);
    assert.equal(registry.repositoryFor(registry.ensureDefaultUser()).youtubeCounts().videoWatches, 0);

    const rotated = registry.rotateTokens('dad');
    const stale = await app.request('/api/ingest/youtube/capture/status', { headers: dadHeaders });
    assert.equal(stale.status, 401);
    const fresh = await app.request('/api/ingest/youtube/capture/status', {
      headers: { authorization: `Bearer ${rotated.captureToken}` },
    });
    assert.equal(fresh.status, 200);
  } finally {
    registry.close();
  }
});

test('ingest enforces per-user request and database-size limits', async () => {
  const requestRegistry = new UserRegistry(':memory:');
  const requestApp = createIngestApp(requestRegistry);
  const previousRequests = config.ingestRequestsPerMinute;
  const headers = { authorization: `Bearer ${CAPTURE_TOKEN}`, 'content-type': 'application/json' };
  try {
    config.ingestRequestsPerMinute = 1;
    assert.equal((await requestApp.request('/api/ingest/youtube/capture', {
      method: 'POST', headers, body: capturePayload(),
    })).status, 201);
    assert.equal((await requestApp.request('/api/ingest/youtube/capture', {
      method: 'POST', headers,
      body: capturePayload({ sessionId: '22345678-1234-4123-8123-123456789abc' }),
    })).status, 429);
  } finally {
    config.ingestRequestsPerMinute = previousRequests;
    requestRegistry.close();
  }

  const dir = mkdtempSync(join(tmpdir(), 'urtube-ingest-quota-'));
  const storageRegistry = new UserRegistry(join(dir, 'users.sqlite'));
  const previousBytes = config.maxUserDatabaseBytes;
  try {
    const user = storageRegistry.createUser('storage-user', 'Storage User');
    storageRegistry.repositoryFor(user).youtubeCounts();
    config.maxUserDatabaseBytes = 1;
    const response = await createIngestApp(storageRegistry).request('/api/ingest/youtube/capture', {
      method: 'POST',
      headers: { authorization: `Bearer ${user.captureToken}`, 'content-type': 'application/json' },
      body: capturePayload(),
    });
    assert.equal(response.status, 507);
  } finally {
    config.maxUserDatabaseBytes = previousBytes;
    storageRegistry.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
