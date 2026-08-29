import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mergeQueue, retryDelayMs } from '../chrome-extension/queue.js';

await import('../chrome-extension/history.js');
await import('../chrome-extension/myactivity.js');

test('Chrome extension manifest is least-privilege and captures YouTube SPA pages', () => {
  const manifest = JSON.parse(readFileSync(
    new URL('../chrome-extension/manifest.json', import.meta.url),
    'utf8',
  ));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '1.5.0');
  assert.deepEqual(Object.keys(manifest.icons ?? {}).sort(), ['128', '16', '32', '48']);
  assert.deepEqual(manifest.permissions.sort(), ['alarms', 'storage']);
  assert.deepEqual(manifest.host_permissions, [
    'https://urtube.observe.tw/*',
    'https://myactivity.google.com/*',
    'https://www.youtube.com/*',
  ]);
  // Dashboards live at top-level /<handle> since 2026-08-25, so the dashboard
  // bridge matches the whole site; dashboard.js no-ops without its DOM hook.
  assert.deepEqual(manifest.content_scripts[0].matches, [
    'https://urtube.observe.tw/*',
  ]);
  // Token-bearing pages are excluded at the manifest layer, not just by
  // dashboard.js's early return.
  assert.deepEqual(manifest.content_scripts[0].exclude_matches, [
    'https://urtube.observe.tw/account*',
    'https://urtube.observe.tw/signup*',
    'https://urtube.observe.tw/auth/*',
  ]);
  assert.deepEqual(manifest.content_scripts[0].js, ['dashboard.js']);
  // One-click provisioning bridge only lives on the setup page.
  assert.deepEqual(manifest.content_scripts[1].matches, [
    'https://urtube.observe.tw/extension-setup*',
  ]);
  assert.deepEqual(manifest.content_scripts[1].js, ['provision.js']);
  assert.deepEqual(manifest.content_scripts[2].matches, [
    'https://myactivity.google.com/product/youtube*',
  ]);
  assert.deepEqual(manifest.content_scripts[2].js, ['myactivity.js']);
  assert.deepEqual(manifest.content_scripts[3].matches, ['https://www.youtube.com/*']);
  assert.deepEqual(manifest.content_scripts[3].js, ['history.js', 'content.js']);
  assert.equal(manifest.background.type, 'module');
});

test('dashboard bridge exposes import status without exposing capture credentials', () => {
  const source = readFileSync(
    new URL('../chrome-extension/dashboard.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /lifelog-sync-start/);
  assert.match(source, /lifelog-sync-cancel/);
  assert.match(source, /lifelogSyncStatus/);
  assert.doesNotMatch(source, /captureSettings|captureToken|authorization|Bearer/);
  assert.match(source, /Extension was updated\. Reload this page and try again\./);
});

test('daily lifelog sync has startup catch-up, overlap, and an hourly due check', () => {
  const background = readFileSync(
    new URL('../chrome-extension/background.js', import.meta.url),
    'utf8',
  );
  assert.match(background, /DAILY_SYNC_DUE_MS = 20 \* 60 \* 60_000/);
  assert.match(background, /DAILY_SYNC_OVERLAP_MS = 2 \* 60 \* 60_000/);
  assert.match(background, /periodInMinutes: 60/);
  assert.match(background, /chrome\.runtime\.onStartup/);
  assert.match(background, /void maybeStartLifelogSync\(\)/);
  assert.match(background, /mode: 'incremental'/);
  assert.match(background, /active: false/);
});

test('My Activity helper parses cross-device watches, searches, and local timestamps', () => {
  const helper = globalThis.urtubeYoutubeActivity;
  const occurredAt = new Date(2026, 6, 30, 20, 11, 0).toISOString();
  const watch = helper.activityFromParts({
    dateValue: '20260730',
    timeText: '8:11\u202fPM • Details',
    durationText: '1:03',
    links: [
      {
        href: 'https://www.youtube.com/watch?v=OjgytNhTjtI',
        text: 'Persona 5 Secret Egg Room',
        ariaLabel: 'Persona 5 Secret Egg Room (Opens in new tab)',
      },
      {
        href: 'https://www.youtube.com/channel/UCEevYX4rCcfF0ZrxmnnONXA',
        text: 'Faz',
        ariaLabel: 'Faz (Opens in new tab)',
      },
      {
        href: 'https://www.youtube.com/watch?v=OjgytNhTjtI',
        text: '1:03',
        ariaLabel: 'Play video Persona 5 Secret Egg Room (Opens in new tab)',
      },
    ],
  });
  assert.deepEqual(watch, {
    kind: 'watch',
    occurredAt,
    videoId: 'OjgytNhTjtI',
    title: 'Persona 5 Secret Egg Room',
    url: 'https://www.youtube.com/watch?v=OjgytNhTjtI',
    channelId: 'UCEevYX4rCcfF0ZrxmnnONXA',
    channelTitle: 'Faz',
    durationSeconds: 63,
    activityType: 'video',
  });
  const search = helper.activityFromParts({
    dateValue: '20260730',
    timeText: '20:10 • Details',
    durationText: '',
    links: [{
      href: 'https://www.youtube.com/results?search_query=private+term',
      text: 'private term',
      ariaLabel: 'private term (Opens in new tab)',
    }],
  });
  assert.deepEqual(search, {
    kind: 'search',
    occurredAt: new Date(2026, 6, 30, 20, 10, 0).toISOString(),
    query: 'private term',
    activityType: 'search',
  });
});

test('history import reports long-running completion without holding the start message open', () => {
  const background = readFileSync(
    new URL('../chrome-extension/background.js', import.meta.url),
    'utf8',
  );
  const content = readFileSync(
    new URL('../chrome-extension/content.js', import.meta.url),
    'utf8',
  );
  assert.match(content, /history-import-complete/);
  assert.match(content, /history-import-error/);
  assert.match(content, /sendResponse\(\{ ok: true, started: true \}\)/);
  assert.match(background, /status\.scanId !== scanId \|\| status\.state !== 'running'/);
  assert.match(background, /finishHistoryImport\(message\.scanId/);
  assert.doesNotMatch(background, /videos: result\.videos/);
});

test('history progress uploads time out and retry instead of stalling the scan', () => {
  const background = readFileSync(
    new URL('../chrome-extension/background.js', import.meta.url),
    'utf8',
  );
  assert.match(background, /PROGRESS_REQUEST_TIMEOUT_MS = 20_000/);
  assert.match(background, /new AbortController\(\)/);
  assert.match(background, /signal: controller\.signal/);
  assert.match(background, /controller\.abort\(\)/);
  assert.match(background, /clearTimeout\(timeout\)/);
  assert.match(background, /for \(let attempt = 0; attempt < 3; attempt\+\+\)/);
});

test('owned sync tabs close after completion, cancellation, errors, and extension reloads', () => {
  const background = readFileSync(
    new URL('../chrome-extension/background.js', import.meta.url),
    'utf8',
  );
  assert.match(background, /chrome\.tabs\.remove\(tabId\)/);
  assert.match(background, /void closeHistoryImportTab\(tabId\)/);
  assert.match(background, /await closeHistoryImportTab\(status\.tabId\)/);
  assert.match(background, /closeActivitySyncTab/);
  assert.doesNotMatch(background, /chrome\.tabs\.query\(\{\s+url: 'https:\/\/www\.youtube\.com\/feed\/history\*'/);
  assert.match(background, /historyImport\.state === 'running'/);
  assert.match(background, /await closeHistoryImportTab\(historyImport\.tabId\)/);
});

test('capture retry queue keeps only the newest cumulative session update', () => {
  const first = {
    sessionId: 'capture-session-123456',
    actualWatchedSeconds: 30,
  };
  const second = {
    sessionId: 'capture-session-123456',
    actualWatchedSeconds: 65,
  };
  const initial = mergeQueue([], first, 1_000);
  assert.equal(initial.length, 1);
  const replaced = mergeQueue(initial, second, 2_000);
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].payload.actualWatchedSeconds, 65);
  assert.equal(replaced[0].attempts, 0);
  assert.equal(replaced[0].nextAttemptAt, 2_000);
  assert.equal(retryDelayMs(1), 30_000);
  assert.equal(retryDelayMs(20), 6 * 60 * 60_000);
});

test('history helper parses duration and merges duplicate resume progress', () => {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { origin: 'https://www.youtube.com' },
  });
  const helper = globalThis.urtubeYoutubeHistory;
  assert.equal(helper.parseDurationText('9:35:04'), 34_504);
  assert.equal(helper.parseDurationText('12:34'), 754);
  assert.equal(helper.parseDurationText('LIVE'), null);

  const lockup = ({ progress, resume, duration }) => ({
    querySelector(selector) {
      if (selector.startsWith('h3 a')) {
        return { href: 'https://www.youtube.com/watch?v=ABCDEFGHIJK' };
      }
      if (selector.startsWith('.ytThumbnail')) {
        return { getAttribute: () => `width: ${progress}%` };
      }
      if (selector.includes('[href*="t="]')) {
        return { href: `https://www.youtube.com/watch?v=ABCDEFGHIJK&t=${resume}s` };
      }
      return null;
    },
    querySelectorAll(selector) {
      return selector === '.ytBadgeShapeText'
        ? [{ textContent: duration }]
        : [];
    },
  });
  const items = helper.collectProgress({
    querySelectorAll: () => [
      lockup({ progress: 30, resume: 90, duration: '10:00' }),
      lockup({ progress: 40, resume: 120, duration: '10:00' }),
    ],
  });
  assert.deepEqual(items, [{
    videoId: 'ABCDEFGHIJK',
    title: null,
    channelId: null,
    channelTitle: null,
    watchedDate: null,
    progressPercent: 40,
    resumeSeconds: 120,
    durationSeconds: 600,
  }]);
  assert.deepEqual(helper.collectProgressFromRoots([
    lockup({ progress: 25, resume: 75, duration: '10:00' }),
  ]), [{
    videoId: 'ABCDEFGHIJK',
    title: null,
    channelId: null,
    channelTitle: null,
    watchedDate: null,
    progressPercent: 25,
    resumeSeconds: 75,
    durationSeconds: 600,
  }]);

  // Date-group labels resolve across locales, relative names, and year ends.
  const now = new Date(2026, 7, 29); // 2026-08-29, a Saturday
  assert.equal(helper.parseHistoryDateLabel('今天', now), '2026-08-29');
  assert.equal(helper.parseHistoryDateLabel('Yesterday', now), '2026-08-28');
  assert.equal(helper.parseHistoryDateLabel('8月26日', now), '2026-08-26');
  assert.equal(helper.parseHistoryDateLabel('12月31日', now), '2025-12-31');
  assert.equal(helper.parseHistoryDateLabel('2024年1月5日', now), '2024-01-05');
  assert.equal(helper.parseHistoryDateLabel('Aug 26', now), '2026-08-26');
  assert.equal(helper.parseHistoryDateLabel('Nov 5, 2024', now), '2024-11-05');
  assert.equal(helper.parseHistoryDateLabel('Wednesday', now), '2026-08-26');
  assert.equal(helper.parseHistoryDateLabel('星期三', now), '2026-08-26');
  assert.equal(helper.parseHistoryDateLabel('Saturday', now), '2026-08-22');
  assert.equal(helper.parseHistoryDateLabel('random text', now), null);
});

test('history import processes only newly added lockups and stops after an idle window', () => {
  const source = readFileSync(
    new URL('../chrome-extension/content.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /new MutationObserver/);
  assert.match(source, /collectProgressFromRoots\(roots\)/);
  assert.match(source, /pendingRoots\.clear\(\)/);
  assert.match(source, /compactHistorySections\(document\)/);
  assert.match(source, /idlePasses >= idleLimit \|\| sent\.size >= videoLimit/);
  assert.match(source, /mode === 'incremental' \? 1_200/);
  assert.doesNotMatch(source, /urtubeYoutubeHistory\.collectProgress\(\)/);
});

test('history import compacts old sections without collapsing scroll geometry', () => {
  const helper = globalThis.urtubeYoutubeHistory;
  const compacted = [];
  const sections = Array.from({ length: 6 }, (_, index) => ({
    id: index,
    style: {},
    getBoundingClientRect() {
      return { height: 100 + index };
    },
    replaceChildren() {
      compacted.push(index);
    },
    setAttribute(name, value) {
      this[name] = value;
    },
  }));
  const documentRoot = {
    querySelectorAll(selector) {
      assert.equal(
        selector,
        'ytd-item-section-renderer:not([data-urtube-compacted])',
      );
      return sections;
    },
  };
  assert.equal(helper.compactHistorySections(documentRoot, 4), 2);
  assert.deepEqual(compacted, [0, 1]);
  assert.equal(sections[0]['data-urtube-compacted'], '');
  assert.deepEqual(sections[0].style, {
    height: '100px',
    minHeight: '100px',
    contain: 'strict',
  });
  assert.equal(sections[2]['data-urtube-compacted'], undefined);
});
