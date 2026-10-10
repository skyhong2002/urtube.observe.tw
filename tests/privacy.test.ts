import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { config } from '../src/config.js';
import { Repository } from '../src/data/database.js';
import { createApp } from '../src/index.js';
import { UserRegistry } from '../src/users.js';
import { decryptPrivateValue } from '../src/youtube/crypto.js';
import { normalizeYoutubeCapture } from '../src/youtube/capture.js';
import { parseYoutubeArchive } from '../src/youtube/takeout.js';

const SECRET = process.env.YOUTUBE_PRIVATE_DATA_KEY!;
const PLAINTEXT_QUERY = 'extremely private search term';

test('default owner bootstrap is silent, idempotent, and keeps legacy capture auth', () => {
  const registry = new UserRegistry(':memory:');
  const logged: unknown[][] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => { logged.push(values); };
  try {
    const first = registry.ensureDefaultUser();
    const repeated = registry.ensureDefaultUser();
    assert.equal(repeated.id, first.id);
    assert.equal('captureToken' in first, false);
    assert.equal('dashboardToken' in first, false);
    assert.equal(registry.listUsers().length, 1);
    assert.equal(registry.userByCaptureToken(config.youtube.captureToken)?.id, first.id);
  } finally {
    console.log = originalLog;
    registry.close();
  }
  assert.deepEqual(logged, [], 'unattended bootstrap must never emit credentials');
});

function fixtureZip(): Uint8Array {
  return zipSync({
    'Takeout/YouTube and YouTube Music/history/watch-history.json': strToU8(JSON.stringify([{
      header: 'YouTube', title: 'Watched Privacy Fixture Video',
      titleUrl: 'https://www.youtube.com/watch?v=privacyvid1',
      subtitles: [{ name: 'Privacy Channel', url: 'https://www.youtube.com/channel/privacy-channel' }],
      time: '2026-07-28T01:00:00Z', products: ['YouTube'],
      activityControls: ['YouTube watch history'],
    }])),
    'Takeout/YouTube and YouTube Music/history/search-history.json': strToU8(JSON.stringify([{
      header: 'YouTube', title: `Searched for ${PLAINTEXT_QUERY}`,
      time: '2026-07-28T00:30:00Z', products: ['YouTube'],
      activityControls: ['YouTube search history'],
    }])),
  });
}

test('search queries reach the database only as authenticated ciphertext', () => {
  const dir = mkdtempSync(join(tmpdir(), 'urtube-privacy-'));
  const path = join(dir, 'privacy.sqlite');
  const repository = new Repository(path);
  try {
    repository.ingestYoutubeArchive(parseYoutubeArchive(fixtureZip(), SECRET));
  } finally {
    repository.close();
  }
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = raw.prepare('SELECT query_ciphertext FROM youtube_search_events').all() as
      Array<{ query_ciphertext: string }>;
    assert.equal(rows.length, 1);
    assert.match(rows[0].query_ciphertext, /^v1\./);
    assert.ok(!rows[0].query_ciphertext.includes(PLAINTEXT_QUERY));
    assert.equal(decryptPrivateValue(rows[0].query_ciphertext, SECRET), PLAINTEXT_QUERY);
    // The plaintext must not appear in ANY column of ANY table.
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    for (const { name } of tables) {
      const all = JSON.stringify(raw.prepare(`SELECT * FROM "${name}"`).all());
      assert.ok(!all.includes(PLAINTEXT_QUERY), `plaintext leaked into ${name}`);
    }
  } finally {
    raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('YouTube events never surface on public activity queries', () => {
  const repository = new Repository(':memory:');
  try {
    repository.ingestYoutubeArchive(parseYoutubeArchive(fixtureZip(), SECRET));
    assert.ok(repository.countActivities() > 0);
    assert.equal(repository.queryActivities({}).total, 0);
    assert.equal(repository.queryActivities({ source: 'youtube' }).total, 0);
    assert.equal(repository.countPublicActivities(), 0);
  } finally {
    repository.close();
  }
});

test('public JSON APIs expose aggregates but no timestamps, searches, or progress rows', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const user = registry.ensureDefaultUser();
    const repository = registry.repositoryFor(user);
    repository.ingestYoutubeArchive(parseYoutubeArchive(fixtureZip(), SECRET));
    repository.ingestYoutubeProgress({
      scanId: 'scan-privacy-1234567890',
      observedAt: new Date().toISOString(),
      complete: true,
      items: [{ videoId: 'privacyvid1', progressPercent: 50, resumeSeconds: 90, durationSeconds: 600 }],
    });

    const recent = await app.request('/api/youtube/recent.json');
    assert.equal(recent.status, 200);
    const recentText = await recent.text();
    assert.ok(!recentText.includes('watchedAt'));
    assert.ok(!recentText.includes('actualWatchedSeconds'));
    assert.ok(!recentText.includes(PLAINTEXT_QUERY));

    const summary = await app.request('/api/youtube/summary.json');
    assert.equal(summary.status, 200);
    const summaryBody = await summary.json() as Record<string, unknown>;
    assert.equal(summaryBody.recent, undefined);
    const summaryText = JSON.stringify(summaryBody);
    assert.ok(!summaryText.includes(PLAINTEXT_QUERY));
    assert.ok(!summaryText.includes('resumeSeconds'));
    assert.ok(!summaryText.includes('query_ciphertext'));

    const status = await app.request('/status');
    assert.ok(!(await status.text()).includes(PLAINTEXT_QUERY));
  } finally {
    registry.close();
  }
});

test('private dashboards need their dashboard token; users cannot see each other', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const dad = registry.createUser('dad', 'Dad');
    assert.equal((await app.request('/dad')).status, 404);
    assert.equal((await app.request('/dad?key=wrong-key')).status, 404);
    assert.equal((await app.request('/nobody')).status, 404);
    assert.equal((await app.request(`/dad?key=${dad.dashboardToken}`)).status, 200);
    assert.equal((await app.request(`/dad/insights?key=${dad.dashboardToken}`)).status, 200);
    assert.equal((await app.request(`/dad/history?key=${dad.dashboardToken}`)).status, 302);
    assert.equal((await app.request(`/dad/recap?key=${dad.dashboardToken}`)).status, 200);
    assert.equal((await app.request(`/u/dad/summary.json?key=${dad.dashboardToken}`)).status, 200);

    // Legacy paths redirect to the top-level handle, keeping the query string.
    const legacy = await app.request(`/u/dad?key=${dad.dashboardToken}`);
    assert.equal(legacy.status, 301);
    assert.equal(new URL(legacy.headers.get('location')!, 'http://x').pathname, '/dad');
    assert.match(legacy.headers.get('location')!, new RegExp(`key=${dad.dashboardToken}`));
    assert.equal((await app.request('/youtube')).status, 301);

    const sky = registry.createUser('sky2', 'Second');
    assert.equal((await app.request(`/dad?key=${sky.dashboardToken}`)).status, 404);

    // Distinct users have distinct derived data keys.
    assert.notEqual(
      registry.dataKeyFor(registry.userByHandle('dad')!),
      registry.dataKeyFor(registry.userByHandle('sky2')!),
    );
  } finally {
    registry.close();
  }
});

test('intervals.json serves clock intervals only behind the dashboard token', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const user = registry.createUser('feed', 'Feed', { dashboardPublic: true });
    const repository = registry.repositoryFor(user);
    repository.ingestYoutubeArchive(parseYoutubeArchive(fixtureZip(), SECRET));
    const now = new Date();
    const watchedAt = new Date(now.getTime() - 3_600_000).toISOString();
    repository.upsertYoutubeCapture(normalizeYoutubeCapture({
      sessionId: 'feed-session-000001', videoId: 'feedvideo01', title: 'Feed fixture',
      url: 'https://www.youtube.com/watch?v=feedvideo01', channelTitle: 'Feed Channel',
      watchedAt, actualWatchedSeconds: 420, durationSeconds: 900,
    }, now));

    // Public dashboard flag does not expose timestamps.
    assert.equal((await app.request('/u/feed/intervals.json')).status, 404);
    assert.equal((await app.request('/u/feed/intervals.json?key=wrong')).status, 404);
    const other = registry.createUser('other', 'Other');
    assert.equal((await app.request('/u/feed/intervals.json', {
      headers: { authorization: `Bearer ${other.dashboardToken}` },
    })).status, 404);

    const keyed = await app.request('/u/feed/intervals.json?key=' + user.dashboardToken);
    assert.equal(keyed.status, 200);
    assert.equal(keyed.headers.get('cache-control'), 'no-store');
    const body = await keyed.json() as {
      nextSince: string | null;
      intervals: Array<Record<string, unknown>>;
    };
    assert.equal(body.nextSince, null);
    assert.ok(body.intervals.length >= 2);
    const measured = body.intervals.find((row) => row.videoId === 'feedvideo01')!;
    assert.equal(measured.watchedAt, watchedAt);
    assert.equal(measured.precision, 'exact');
    assert.equal(measured.actualWatchedSeconds, 420);
    assert.equal(measured.estimatedWatchSeconds, 420);
    assert.equal(measured.durationSeconds, 900);
    for (let i = 1; i < body.intervals.length; i += 1) {
      assert.ok(String(body.intervals[i - 1]!.watchedAt) <= String(body.intervals[i]!.watchedAt));
    }
    assert.ok(!JSON.stringify(body).includes(PLAINTEXT_QUERY));

    const bearer = await app.request('/u/feed/intervals.json?since=' + encodeURIComponent(watchedAt) + '&limit=1', {
      headers: { authorization: `Bearer ${user.dashboardToken}` },
    });
    assert.equal(bearer.status, 200);
    const page = await bearer.json() as { nextSince: string | null; intervals: Array<Record<string, unknown>> };
    assert.equal(page.intervals.length, 1);
    assert.equal(page.intervals[0]!.videoId, 'feedvideo01');
    assert.equal(page.nextSince, watchedAt);

    assert.equal((await app.request('/u/feed/intervals.json?since=nope&key=' + user.dashboardToken)).status, 400);
  } finally {
    registry.close();
  }
});

test('public dashboards expose aggregates but keep individual recent watches private', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const publicUser = registry.createUser('public-view', 'Public View', { dashboardPublic: true });
    registry.repositoryFor(publicUser).ingestYoutubeArchive(parseYoutubeArchive(fixtureZip(), SECRET));

    const anonymous = await app.request('/public-view?range=all');
    assert.equal(anonymous.status, 200);
    const anonymousHtml = await anonymous.text();
    assert.ok(!anonymousHtml.includes('<h2>Recently watched</h2>'));
    const publicHistory = await app.request('/public-view/history?range=all');
    assert.equal(publicHistory.status, 404);
    assert.equal((await app.request('/public-view/recap?range=all')).status, 404);
    const oldTags = await app.request('/public-view/tags?range=all&lang=zh');
    assert.equal(oldTags.status, 301);
    assert.equal(oldTags.headers.get('location'), '/public-view/insights?range=all&lang=zh');

    const keyed = await app.request(`/public-view?range=all&key=${publicUser.dashboardToken}`);
    assert.equal(keyed.status, 200);
    const keyedHtml = await keyed.text();
    assert.ok(keyedHtml.includes('<h2>Recently watched</h2>'));
    assert.ok(keyedHtml.includes('<h3>Privacy Fixture Video</h3>'));
    const keyedHistory = await app.request(`/public-view/history?range=all&key=${publicUser.dashboardToken}`);
    assert.equal(keyedHistory.status, 302);
    const historyResponse = await app.request(keyedHistory.headers.get('location')!, {
      headers: { cookie: keyedHistory.headers.get('set-cookie')!.split(';')[0] },
    });
    const keyedHistoryHtml = await historyResponse.text();
    assert.ok(keyedHistoryHtml.includes('<h2>Watch history</h2>'));
    assert.ok(keyedHistoryHtml.includes('Privacy Fixture Video'));
  } finally {
    registry.close();
  }
});

test('legacy owner JSON APIs honor owner dashboard visibility', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const owner = registry.ensureDefaultUser();
    registry.setDashboardPublic(owner.handle, false);
    const ownerSession = `urtube_session=${registry.createSession(owner)}`;

    assert.equal((await app.request('/api/youtube/summary.json')).status, 404);
    assert.equal((await app.request('/api/youtube/recent.json')).status, 404);
    assert.equal((await app.request('/api/youtube/summary.json', { headers: { cookie: ownerSession } })).status, 200);
    assert.equal((await app.request('/api/youtube/recent.json', { headers: { cookie: ownerSession } })).status, 200);
  } finally {
    registry.close();
  }
});

test('browser responses carry launch security headers', async () => {
  const registry = new UserRegistry(':memory:');
  const app = createApp(registry);
  try {
    const response = await app.request('/');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  } finally {
    registry.close();
  }
});
