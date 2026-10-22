import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { mergeQueue, retryDelayMs } from '../chrome-extension/queue.js';
import {
  buildDeepHistoryRanges,
  myActivityRangeUrl,
  splitDeepHistoryRange,
} from '../chrome-extension/history-ranges.js';
import { extensionDownloadName } from '../src/extension-bundle.ts';

await import('../chrome-extension/history.js');
await import('../chrome-extension/myactivity.js');

test('Chrome extension manifest is least-privilege and captures YouTube SPA pages', () => {
  const manifest = JSON.parse(readFileSync(
    new URL('../chrome-extension/manifest.json', import.meta.url),
    'utf8',
  ));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '2.1.0');
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
  // Chrome signed into several accounts serves My Activity from an
  // account-indexed path, so both shapes must be matched or the sync tab
  // loads without a content script to talk to.
  assert.deepEqual(manifest.content_scripts[2].matches, [
    'https://myactivity.google.com/product/youtube*',
    'https://myactivity.google.com/u/*/product/youtube*',
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

test('successful provisioning clears the install-time missing-token error immediately', () => {
  const background = readFileSync(
    new URL('../chrome-extension/background.js', import.meta.url),
    'utf8',
  );
  const popup = readFileSync(
    new URL('../chrome-extension/popup.js', import.meta.url),
    'utf8',
  );
  const settingsHandler = background.slice(
    background.indexOf("message?.type === 'settings-updated'"),
    background.indexOf("message?.type === 'history-import-start'"),
  );
  assert.match(settingsHandler, /\.then\(\(\) => flushQueue\(\)\)/);
  assert.match(popup, /configured && status\.lastError === 'Capture token is not configured'/);
});

test('popup and options name the running build and re-check for updates on open', () => {
  const read = (name) => readFileSync(
    new URL(`../chrome-extension/${name}`, import.meta.url),
    'utf8',
  );
  const manifest = JSON.parse(read('manifest.json'));
  for (const page of ['popup.html', 'options.html']) {
    assert.match(read(page), /<span id="version" class="version"><\/span>/);
  }
  // Both pages read the version from the manifest, so it can never drift from
  // the build that is actually loaded.
  assert.match(read('popup.js'), /chrome\.runtime\.getManifest\(\)\.version/);
  assert.match(read('options.js'), /chrome\.runtime\.getManifest\(\)\.version/);
  assert.match(read('popup.js'), /extension-update-check/);
  assert.match(read('background.js'), /message\?\.type === 'extension-update-check'/);
  assert.match(read('styles.css'), /\.version\.outdated \{/);
  // The downloadable artifact is named after that same manifest version.
  assert.equal(extensionDownloadName(), `urtube-youtube-capture-${manifest.version}.zip`);
});

test('My Activity sync accepts the account-indexed path a pinned account lands on', () => {
  const { isActivityPath } = globalThis.urtubeYoutubeActivity;
  assert.equal(isActivityPath('/product/youtube'), true);
  assert.equal(isActivityPath('/product/youtube/'), true);
  // authuser=<email> for a non-default account redirects here; before 1.6.2
  // the content script never matched it and the sync tab had no receiver.
  assert.equal(isActivityPath('/u/1/product/youtube'), true);
  assert.equal(isActivityPath('/u/23/product/youtube'), true);
  assert.equal(isActivityPath('/product/search'), false);
  assert.equal(isActivityPath('/u/1/product/search'), false);
  assert.equal(isActivityPath('/product/youtube/extra'), false);
  assert.equal(isActivityPath(''), false);
});

test('sync tabs retry the no-receiver failure and back off after a failed auto sync', () => {
  const background = readFileSync(
    new URL('../chrome-extension/background.js', import.meta.url),
    'utf8',
  );
  // Both sync tabs go through sendToTab, so a content script that is not
  // listening yet is retried instead of failing the whole sync.
  assert.doesNotMatch(background, /chrome\.tabs\.sendMessage\(tab\.id/);
  assert.match(background, /sendToTab\(tab\.id, \{\s*type: 'start-activity-sync'/);
  assert.match(background, /sendToTab\(tab\.id, \{\s*type: 'start-history-import'/);
  assert.match(background, /Receiving end does not exist\|Could not establish connection/);
  assert.match(background, /the sync tab stopped at/);
  // An hourly alarm must not re-run a sync that just failed for a standing
  // reason; that rewrote the same popup error every hour.
  assert.match(background, /status\.state === 'error'\s*&& Number\.isFinite\(lastFailure\)/);
  assert.match(background, /const DAILY_SYNC_RETRY_MS = 4 \* 60 \* 60_000;/);
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

test('history import waits for content, ends on a real signal, and reports how it ended', () => {
  const source = readFileSync(
    new URL('../chrome-extension/content.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /new MutationObserver/);
  assert.match(source, /collectProgressFromRoots\(roots\)/);
  assert.match(source, /pendingRoots\.clear\(\)/);
  assert.match(source, /compactHistorySections\(document\)/);
  // The list renders after the tab reports complete: nothing is judged until
  // the first lockup shows up, and a page that never shows one is reported
  // as such instead of as an empty success.
  assert.match(source, /HISTORY_CONTENT_WAIT_MS = 60_000/);
  assert.match(source, /endReason = 'no-content'/);
  // The end of the page is a time window without new lockups, not a fixed
  // handful of 700 ms passes that a slow continuation would trip.
  assert.match(source, /HISTORY_IDLE_MS = 30_000/);
  assert.match(source, /now - lastContentAt >= HISTORY_IDLE_MS/);
  assert.match(source, /historyCompletionReason\(document\)/);
  // Daily syncs stop at dates the server already covers; there is no fixed
  // video cap standing in for that knowledge any more.
  assert.match(source, /coverageCutoffDay\(options\.coveredSince\)/);
  assert.match(source, /bounds\.oldest < coverageCutoff/);
  assert.match(source, /endReason = 'covered'/);
  assert.doesNotMatch(source, /1_200/);
  assert.doesNotMatch(source, /idlePasses/);
  // Every exit, including failures, tells the server how the scan ended.
  assert.match(source, /sendProgressBatch\(scanId, observedAt, \[\], true, completed\)/);
  assert.match(source, /endReason = 'error'/);
  assert.match(source, /endReason: result\.endReason/);
  assert.doesNotMatch(source, /urtubeYoutubeHistory\.collectProgress\(\)/);
});

test('history helper derives the coverage cutoff day and tracks date bounds', () => {
  const helper = globalThis.urtubeYoutubeHistory;
  // Two days of overlap before the covering scan's local day.
  const coveredSince = new Date(2026, 8, 4, 21, 30).toISOString();
  assert.equal(helper.coverageCutoffDay(coveredSince), '2026-09-02');
  assert.equal(helper.coverageCutoffDay(null), null);
  assert.equal(helper.coverageCutoffDay('not a date'), null);
  const bounds = helper.trackDateBounds({ oldest: null, newest: null }, [
    { watchedDate: '2026-08-30' },
    { watchedDate: null },
    { watchedDate: '2026-09-03' },
    { watchedDate: '2026-07-17' },
  ]);
  assert.deepEqual(bounds, { oldest: '2026-07-17', newest: '2026-09-03' });
  assert.equal(helper.dayTimestamp('2026-07-17'), new Date(2026, 6, 17, 12).toISOString());
  assert.equal(helper.dayTimestamp(null), null);
});

test('history helper distinguishes a stalled continuation from the verified history start', () => {
  const helper = globalThis.urtubeYoutubeHistory;
  assert.equal(helper.historyCompletionReason({
    querySelector: () => ({ nodeName: 'YTD-CONTINUATION-ITEM-RENDERER' }),
  }), 'stalled');
  assert.equal(helper.historyCompletionReason({ querySelector: () => null }), 'history-start');
});

test('history helper recognizes signed-out and paused-history empty states', () => {
  const helper = globalThis.urtubeYoutubeHistory;
  assert.equal(helper.historyPageProblem({ body: { textContent: 'Watch history is off' } }), 'history-paused');
  assert.equal(helper.historyPageProblem({ body: { textContent: '觀看紀錄已暫停' } }), 'history-paused');
  assert.equal(helper.historyPageProblem({ body: { textContent: 'Sign in to see your watch history' } }), 'signed-out');
  assert.equal(helper.historyPageProblem({ body: { textContent: '載入中' } }), null);
});

test('every content-script scan result carries an actionable diagnosis and landed URL', () => {
  const content = readFileSync(new URL('../chrome-extension/content.js', import.meta.url), 'utf8');
  const background = readFileSync(new URL('../chrome-extension/background.js', import.meta.url), 'utf8');
  const popup = readFileSync(new URL('../chrome-extension/popup.js', import.meta.url), 'utf8');
  assert.match(content, /historyPageProblem\(document\)/);
  assert.match(content, /historyLandedUrl\(location\)/);
  assert.match(content, /historyScanDiagnostic\(endReason\)/);
  assert.match(content, /error: result\.error/);
  assert.match(content, /landedUrl: result\.landedUrl/);
  assert.match(background, /historyScanFailed\(message\.endReason\)/);
  assert.match(background, /lastError: diagnosis/);
  assert.match(popup, /historyResult\(history\.endReason/);
});

test('first sync reads the whole history page; later syncs stop at server coverage', () => {
  const background = readFileSync(
    new URL('../chrome-extension/background.js', import.meta.url),
    'utf8',
  );
  assert.match(background, /const historyCoverage = remote\.coverage \?\? null/);
  assert.match(background, /coveredSince: coverage\.coveredSince/);
  assert.match(background, /mode: 'incremental'/);
  // A user-initiated first read takes the foreground (hidden tabs get their
  // timers throttled after five minutes); the automatic hourly one does not.
  assert.match(background, /active: !status\.automatic,\s+mode: 'full'/);
  // Failures the content script cannot report are reported from here.
  assert.match(background, /reportScanEnd\(account, status, 'no-receiver', \{ error, landedUrl \}\)/);
  assert.match(background, /reportScanEnd\(await currentAccount\(\), status, 'cancelled'\)/);
  // A foreground read that saw no video keeps its tab open as the diagnosis.
  assert.match(background, /if \(!\(active && failed\)\) void closeHistoryImportTab\(tabId\)/);
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

test('deep history ranges cover the whole YouTube lifetime with bounded, gapless windows', () => {
  const now = new Date('2026-09-05T12:00:00.000Z');
  const earliest = new Date('2021-09-05T12:00:00.000Z');
  const ranges = buildDeepHistoryRanges(now, earliest, 90);
  assert.equal(ranges[0].end, now.toISOString());
  assert.equal(ranges.at(-1).start, earliest.toISOString());
  for (let index = 0; index < ranges.length; index++) {
    assert.ok(Date.parse(ranges[index].end) - Date.parse(ranges[index].start) <= 90 * 86_400_000);
    if (index) assert.equal(ranges[index - 1].start, ranges[index].end);
  }
  const url = new URL(myActivityRangeUrl(ranges[0], 'demo@example.invalid'));
  assert.equal(url.pathname, '/product/youtube');
  assert.equal(url.searchParams.get('authuser'), 'demo@example.invalid');
  assert.equal(Number(url.searchParams.get('min')), Date.parse(ranges[0].start) * 1000);
  assert.equal(Number(url.searchParams.get('max')), Date.parse(ranges[0].end) * 1000 - 1);
});

test('an overloaded deep-history range splits without gaps or overlap', () => {
  const range = { start: '2026-01-01T00:00:00.000Z', end: '2026-04-01T00:00:00.000Z' };
  const halves = splitDeepHistoryRange(range);
  assert.equal(halves.length, 2);
  assert.equal(halves[0].start, range.start);
  assert.equal(halves[0].end, halves[1].start);
  assert.equal(halves[1].end, range.end);
  assert.deepEqual(splitDeepHistoryRange({
    start: '2026-01-01T00:00:00.000Z',
    end: '2026-01-02T00:00:00.000Z',
  }), []);
  assert.deepEqual(splitDeepHistoryRange({ start: 'invalid', end: range.end }), []);
});

test('recursive date splitting keeps a synthetic 50k-event history below the per-tab cap', () => {
  const start = Date.parse('2021-01-01T00:00:00.000Z');
  const end = Date.parse('2026-01-01T00:00:00.000Z');
  const events = Array.from({ length: 50_000 }, (_, index) =>
    start + Math.floor((end - start) * index / 50_000));
  const pending = buildDeepHistoryRanges(new Date(end), new Date(start), 90);
  let completed = 0;
  while (pending.length) {
    const range = pending.shift();
    const count = events.filter((at) => at >= Date.parse(range.start) && at < Date.parse(range.end)).length;
    if (count > 2_000) {
      const split = splitDeepHistoryRange(range);
      assert.equal(split.length, 2);
      pending.unshift(...split);
    } else {
      assert.ok(count <= 2_000);
      completed += count;
    }
  }
  assert.equal(completed, 50_000);
});

test('deep history uses capped date windows and restarts tabs between segments', () => {
  const activity = readFileSync(new URL('../chrome-extension/myactivity.js', import.meta.url), 'utf8');
  const background = readFileSync(new URL('../chrome-extension/background.js', import.meta.url), 'utf8');
  assert.match(activity, /DEEP_HISTORY_EVENT_LIMIT = 2_000/);
  assert.match(activity, /DEEP_HISTORY_EVENT_LIMIT - sent\.size/);
  assert.match(activity, /endReason = 'segment-limit'/);
  assert.match(background, /startDeepHistoryImport/);
  assert.match(background, /splitDeepHistoryRange/);
  assert.match(background, /closeActivitySyncTab/);
  assert.match(background, /myActivityRangeUrl/);
  assert.match(background, /reportScanEnd\(account, completedStatus, 'history-start'/);
  assert.match(background, /response does not match the active range/);
});

// --- Behavioural harness -------------------------------------------------
// The tests below run the real background worker, YouTube content script and
// provisioning bridge against an in-memory chrome.* and fetch. Every token,
// account and video is synthetic; nothing touches the network.

const ENDPOINT = 'https://urtube.observe.tw/api/ingest/youtube/capture';
const TOKEN_A = 'synthetic-capture-token-account-a-000000000001';
const TOKEN_A2 = 'synthetic-capture-token-account-a-000000000002';
const TOKEN_B = 'synthetic-capture-token-account-b-000000000001';
let backgroundInstance = 0;

const clone = (value) => value === undefined ? undefined : structuredClone(value);

async function settle(rounds = 40) {
  for (let index = 0; index < rounds; index++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function fakeNetwork() {
  const network = {
    online: true,
    calls: [],
    // Synthetic server identity per token; anything else is rejected as 401.
    accounts: new Map(),
    gate: null,
    async fetch(url, init = {}) {
      const target = new URL(String(url));
      if (target.pathname === '/extension-version.json') {
        return new Response('{}', { status: 404 });
      }
      const call = {
        path: target.pathname,
        method: init.method ?? 'GET',
        token: String(init.headers?.authorization ?? '').replace(/^Bearer /, ''),
        body: init.body ? JSON.parse(init.body) : null,
      };
      network.calls.push(call);
      if (network.gate) await network.gate(call, init.signal);
      if (!network.online) throw new TypeError('Failed to fetch');
      const account = network.accounts.get(call.token);
      if (!account) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      call.accepted = true;
      if (call.path.endsWith('/capture/status')) {
        return Response.json({ status: 'ready', user: account.handle });
      }
      if (call.path.endsWith('/history/status')) return Response.json(account.historyStatus ?? {});
      return Response.json({ ok: true }, { status: call.path.endsWith('/capture') ? 201 : 200 });
    },
    sent(path) {
      return network.calls.filter((call) => call.accepted && call.path.endsWith(path));
    },
  };
  return network;
}

function fakeChrome(initial = {}) {
  const data = clone(initial);
  const lists = {
    message: [], changed: [], installed: [], startup: [], alarm: [], tabRemoved: [], tabUpdated: [],
  };
  const event = (list) => ({
    addListener: (listener) => list.push(listener),
    removeListener: (listener) => {
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    },
  });
  const pick = (keys) => {
    const names = keys == null
      ? Object.keys(data)
      : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    return Object.fromEntries(names.filter((name) => name in data).map((name) => [name, clone(data[name])]));
  };
  const tabs = new Map();
  let nextTabId = 100;
  const fake = {
    data,
    lists,
    tabMessages: [],
    removedTabs: [],
    // Content scripts in tabs the extension opens; tests reply for them.
    tabReplies: () => ({ ok: true, started: true }),
    dispatch(message, sender = {}) {
      return new Promise((resolve) => {
        let pending = false;
        for (const listener of [...lists.message]) {
          if (listener(message, sender, resolve) === true) pending = true;
        }
        if (!pending) resolve(undefined);
      });
    },
    restartWorker() {
      for (const name of ['message', 'installed', 'startup', 'alarm', 'tabRemoved', 'tabUpdated']) {
        lists[name].length = 0;
      }
    },
  };
  fake.chrome = {
    storage: {
      local: {
        async get(keys) { return pick(keys); },
        async set(items) {
          const changes = {};
          for (const [name, value] of Object.entries(items)) {
            changes[name] = { oldValue: clone(data[name]), newValue: clone(value) };
            data[name] = clone(value);
          }
          for (const listener of [...lists.changed]) listener(clone(changes), 'local');
        },
        async remove(keys) {
          for (const name of [].concat(keys)) delete data[name];
        },
      },
      onChanged: event(lists.changed),
    },
    runtime: {
      onMessage: event(lists.message),
      onInstalled: event(lists.installed),
      onStartup: event(lists.startup),
      getManifest: () => ({ version: '0.0.0' }),
      sendMessage: (message) => fake.dispatch(message, { url: 'https://urtube.observe.tw/extension-setup' }),
      openOptionsPage: async () => {},
    },
    tabs: {
      async create({ url, active }) {
        const tab = { id: nextTabId++, url, active, status: 'complete' };
        tabs.set(tab.id, tab);
        return tab;
      },
      async get(id) {
        if (!tabs.has(id)) throw new Error('No tab with id');
        return tabs.get(id);
      },
      async remove(id) {
        fake.removedTabs.push(id);
        tabs.delete(id);
      },
      async sendMessage(id, message) {
        fake.tabMessages.push({ id, message });
        return fake.tabReplies(id, message);
      },
      onUpdated: event(lists.tabUpdated),
      onRemoved: event(lists.tabRemoved),
    },
    alarms: { async create() {}, onAlarm: event(lists.alarm) },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
  };
  return fake;
}

async function startWorker(fake, network) {
  globalThis.chrome = fake.chrome;
  globalThis.fetch = network.fetch;
  await import(new URL(`../chrome-extension/background.js?instance=${++backgroundInstance}`, import.meta.url).href);
  await settle();
}

async function restartWorker(fake, network) {
  fake.restartWorker();
  await startWorker(fake, network);
}

const provisionSource = readFileSync(new URL('../chrome-extension/provision.js', import.meta.url), 'utf8');

// Runs the real provision.js the way /extension-setup drives it.
async function provision(fake, payload) {
  const root = { dataset: {} };
  const listeners = {};
  let finished;
  const done = new Promise((resolve) => { finished = resolve; });
  const context = vm.createContext({
    chrome: fake.chrome,
    document: { querySelector: (selector) => selector === '[data-urtube-provision]' ? root : null },
    window: {
      addEventListener: (type, listener) => { listeners[type] = listener; },
      dispatchEvent: (event) => {
        if (event.type === 'urtube-provision-done' || event.type === 'urtube-provision-error') finished(event.type);
      },
    },
    Event: class { constructor(type) { this.type = type; } },
  });
  vm.runInContext(provisionSource, context);
  root.dataset.provisionPayload = JSON.stringify(payload);
  void listeners['urtube-provision-request']();
  const outcome = await done;
  await settle();
  return { outcome, error: root.dataset.provisionError ?? '' };
}

function capturePayload(sessionId, seconds, watchedAt = new Date().toISOString()) {
  return {
    sessionId,
    videoId: 'SYNTHETIC01',
    title: 'Synthetic video',
    url: 'https://www.youtube.com/watch?v=SYNTHETIC01',
    channelTitle: null,
    watchedAt,
    actualWatchedSeconds: seconds,
    durationSeconds: 600,
  };
}

function capturedSessions(network, token) {
  return network.sent('/capture')
    .filter((call) => call.method === 'POST' && (!token || call.token === token))
    .map((call) => call.body.sessionId);
}

function queuedSessions(fake) {
  return (fake.data.captureQueue ?? []).map((item) => item.payload.sessionId);
}

const accountA = { endpoint: ENDPOINT, token: TOKEN_A, accountId: '101', handle: 'synthetic-a', googleAccount: '' };
const accountB = { endpoint: ENDPOINT, token: TOKEN_B, accountId: '202', handle: 'synthetic-b', googleAccount: '' };

function networkFor(...entries) {
  const network = fakeNetwork();
  for (const [token, handle] of entries) network.accounts.set(token, { handle });
  return network;
}

async function saveSettings(fake, patch) {
  const current = fake.data.captureSettings ?? {};
  return fake.dispatch({
    type: 'settings-save',
    settings: {
      endpoint: current.endpoint ?? ENDPOINT,
      token: current.token ?? '',
      enabled: current.enabled ?? true,
      autoSync: current.autoSync ?? true,
      googleAccount: current.googleAccount ?? '',
      ...patch,
    },
  });
}

test('R02: a paused worker stores nothing, even after a service-worker restart', async () => {
  const network = networkFor([TOKEN_A, 'synthetic-a']);
  const fake = fakeChrome({
    captureSettings: { endpoint: ENDPOINT, token: TOKEN_A, enabled: false, autoSync: false },
  });
  await startWorker(fake, network);
  const paused = await fake.dispatch({ type: 'capture', payload: capturePayload('paused-session-0001', 40) });
  assert.equal(paused?.queued, false);
  assert.deepEqual(queuedSessions(fake), []);
  await restartWorker(fake, network);
  const afterRestart = await fake.dispatch({ type: 'capture', payload: capturePayload('paused-session-0002', 40) });
  assert.equal(afterRestart?.queued, false);
  assert.deepEqual(queuedSessions(fake), []);

  // Re-enabling counts only what starts afterwards: a late update from a
  // session that began before the resume is refused, a fresh one is kept.
  const before = new Date(Date.now() - 60_000).toISOString();
  assert.equal((await saveSettings(fake, { enabled: true }))?.ok, true);
  await settle();
  const stale = await fake.dispatch({ type: 'capture', payload: capturePayload('paused-session-0001', 95, before) });
  assert.equal(stale?.queued, false);
  const fresh = await fake.dispatch({ type: 'capture', payload: capturePayload('resumed-session-0001', 12) });
  assert.equal(fresh?.queued, true);
  await fake.dispatch({ type: 'flush' });
  assert.deepEqual(capturedSessions(network), ['resumed-session-0001']);
});

test('R02: items queued before pausing are kept and sent after resuming; nothing from the pause is', async () => {
  const network = networkFor([TOKEN_A, 'synthetic-a']);
  network.online = false;
  const fake = fakeChrome({
    captureSettings: { endpoint: ENDPOINT, token: TOKEN_A, enabled: true, autoSync: false },
  });
  await startWorker(fake, network);
  await fake.dispatch({ type: 'capture', payload: capturePayload('before-pause-0001', 45) });
  assert.deepEqual(queuedSessions(fake), ['before-pause-0001']);
  assert.equal((await saveSettings(fake, { enabled: false }))?.ok, true);
  await fake.dispatch({ type: 'capture', payload: capturePayload('during-pause-0001', 50) });
  assert.deepEqual(queuedSessions(fake), ['before-pause-0001']);
  network.online = true;
  await fake.dispatch({ type: 'flush' });
  assert.deepEqual(capturedSessions(network), [], 'paused recording also holds uploads');
  assert.equal((await saveSettings(fake, { enabled: true }))?.ok, true);
  await fake.dispatch({ type: 'flush' });
  assert.deepEqual(capturedSessions(network), ['before-pause-0001']);
  assert.deepEqual(queuedSessions(fake), []);
});

const contentSource = readFileSync(new URL('../chrome-extension/content.js', import.meta.url), 'utf8');

// Runs content.js in a YouTube watch tab that is already playing.
function youtubeTab(recording) {
  const stored = { captureRecording: clone(recording) };
  const changed = [];
  const sent = [];
  const intervals = [];
  const session = new Map();
  let clock = 1_000;
  const video = {
    currentTime: 0, paused: false, ended: false, playbackRate: 1, duration: 600,
    addEventListener() {},
  };
  let sessionCounter = 0;
  const context = vm.createContext({
    performance: { now: () => clock },
    location: { href: 'https://www.youtube.com/watch?v=SYNTHETIC01', pathname: '/watch' },
    document: {
      title: 'Synthetic video - YouTube',
      visibilityState: 'visible',
      documentElement: {},
      querySelector: (selector) => selector === 'video' ? video : null,
      querySelectorAll: () => [],
      addEventListener() {},
    },
    window: { addEventListener() {}, setTimeout },
    sessionStorage: {
      get length() { return session.size; },
      key: (index) => [...session.keys()][index] ?? null,
      getItem: (key) => session.get(key) ?? null,
      setItem: (key, value) => session.set(key, String(value)),
      removeItem: (key) => session.delete(key),
    },
    crypto: { randomUUID: () => `synthetic-tab-session-${++sessionCounter}` },
    chrome: {
      runtime: {
        sendMessage: async (message) => { sent.push(clone(message)); return { queued: true }; },
        onMessage: { addListener() {} },
      },
      storage: {
        local: { get: async (keys) => Object.fromEntries([].concat(keys).filter((key) => key in stored).map((key) => [key, clone(stored[key])])) },
        onChanged: { addListener: (listener) => changed.push(listener) },
      },
    },
    MutationObserver: class { observe() {} disconnect() {} },
    Element: class {},
    URL,
    setInterval: (callback) => intervals.push(callback),
  });
  vm.runInContext(contentSource, context);
  return {
    sent,
    captures: () => sent.filter((message) => message.type === 'capture').map((message) => message.payload),
    async play(seconds) {
      for (let index = 0; index < seconds; index++) {
        clock += 1_000;
        video.currentTime += 1;
        for (const callback of intervals) callback();
        await settle(2);
      }
    },
    async setRecording(next) {
      const oldValue = stored.captureRecording;
      stored.captureRecording = clone(next);
      for (const listener of changed) listener({ captureRecording: { oldValue, newValue: clone(next) } }, 'local');
      await settle(4);
    },
  };
}

test('R02: an open YouTube tab stops counting while paused and restarts from zero on resume', async () => {
  const tab = youtubeTab({ enabled: true, accountKey: 'synthetic-account', since: null });
  await settle(4);
  await tab.play(35);
  const recorded = tab.captures();
  assert.equal(recorded.length, 1);
  const firstSession = recorded[0].sessionId;
  await tab.setRecording({ enabled: false, accountKey: 'synthetic-account', since: null });
  await tab.play(120);
  assert.equal(tab.captures().length, 1, 'no capture while paused');
  await tab.setRecording({ enabled: true, accountKey: 'synthetic-account', since: new Date().toISOString() });
  await tab.play(35);
  const resumed = tab.captures().slice(1);
  assert.equal(resumed.length, 1);
  assert.notEqual(resumed[0].sessionId, firstSession);
  assert.ok(resumed[0].actualWatchedSeconds <= 35, `counted ${resumed[0].actualWatchedSeconds}s`);
  assert.ok(Date.parse(resumed[0].watchedAt) >= Date.parse(new Date(Date.now() - 5_000).toISOString()));
});

test('R03: an offline queue of account A is never uploaded with account B credentials', async () => {
  const network = networkFor([TOKEN_A, 'synthetic-a'], [TOKEN_B, 'synthetic-b'], [TOKEN_A2, 'synthetic-a']);
  const fake = fakeChrome({});
  await startWorker(fake, network);
  assert.equal((await provision(fake, accountA)).outcome, 'urtube-provision-done');
  network.online = false;
  await fake.dispatch({ type: 'capture', payload: capturePayload('account-a-offline-0001', 60) });
  assert.deepEqual(queuedSessions(fake), ['account-a-offline-0001']);

  assert.equal((await provision(fake, accountB)).outcome, 'urtube-provision-done');
  network.online = true;
  await fake.dispatch({ type: 'flush' });
  assert.deepEqual(capturedSessions(network, TOKEN_B), [], 'B received an item captured for A');
  assert.deepEqual(queuedSessions(fake), []);
  await fake.dispatch({ type: 'capture', payload: capturePayload('account-b-0001', 20) });
  await fake.dispatch({ type: 'flush' });
  assert.deepEqual(capturedSessions(network, TOKEN_B), ['account-b-0001']);

  // B goes offline with its own item, A reconnects (its token rotated on the
  // server): A resumes its own queue only, then B resumes its own.
  network.online = false;
  await fake.dispatch({ type: 'capture', payload: capturePayload('account-b-offline-0002', 25) });
  network.accounts.delete(TOKEN_A);
  network.online = true;
  assert.equal((await provision(fake, { ...accountA, token: TOKEN_A2 })).outcome, 'urtube-provision-done');
  await fake.dispatch({ type: 'flush' });
  assert.deepEqual(capturedSessions(network, TOKEN_A2), ['account-a-offline-0001']);
  assert.deepEqual(capturedSessions(network, TOKEN_A), []);
  assert.equal(capturedSessions(network, TOKEN_B).includes('account-b-offline-0002'), false);
  network.accounts.delete(TOKEN_B);
  const TOKEN_B2 = 'synthetic-capture-token-account-b-000000000002';
  network.accounts.set(TOKEN_B2, { handle: 'synthetic-b' });
  assert.equal((await provision(fake, { ...accountB, token: TOKEN_B2 })).outcome, 'urtube-provision-done');
  await fake.dispatch({ type: 'flush' });
  assert.deepEqual(capturedSessions(network, TOKEN_B2), ['account-b-offline-0002']);
  assert.deepEqual(capturedSessions(network, TOKEN_A2), ['account-a-offline-0001']);
});

test('R03: a same-account token rotation keeps the pending queue', async () => {
  const network = networkFor([TOKEN_A, 'synthetic-a']);
  const fake = fakeChrome({});
  await startWorker(fake, network);
  await provision(fake, accountA);
  network.online = false;
  await fake.dispatch({ type: 'capture', payload: capturePayload('rotation-0001', 30) });
  network.accounts.delete(TOKEN_A);
  network.accounts.set(TOKEN_A2, { handle: 'synthetic-a' });
  network.online = true;
  await provision(fake, { ...accountA, token: TOKEN_A2 });
  await fake.dispatch({ type: 'flush' });
  assert.deepEqual(capturedSessions(network, TOKEN_A2), ['rotation-0001']);
  assert.deepEqual(queuedSessions(fake), []);
});

test('R03: a flush in flight during an account switch stays with the original account', async () => {
  const network = networkFor([TOKEN_A, 'synthetic-a'], [TOKEN_B, 'synthetic-b']);
  const fake = fakeChrome({});
  await startWorker(fake, network);
  await provision(fake, accountA);
  network.online = false;
  await fake.dispatch({ type: 'capture', payload: capturePayload('in-flight-0001', 30) });
  network.online = true;
  let release;
  network.gate = (call, signal) => {
    if (!(call.path.endsWith('/capture') && call.method === 'POST')) return undefined;
    network.gate = null;
    return new Promise((resolve, reject) => {
      release = () => reject(new TypeError('Failed to fetch'));
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
  };
  const inFlight = fake.dispatch({ type: 'flush' });
  await settle();
  assert.ok(release, 'the flush is waiting on the network');
  const switching = provision(fake, accountB);
  await settle();
  release();
  await inFlight;
  await switching;
  await fake.dispatch({ type: 'flush' });
  for (const alarm of fake.lists.alarm) alarm({ name: 'flush-captures' });
  await settle();
  assert.deepEqual(capturedSessions(network, TOKEN_B), []);
  assert.deepEqual(queuedSessions(fake), []);
});

test('R03: a history scan in flight during a switch is cancelled and B starts from its own checkpoint', async () => {
  const network = networkFor([TOKEN_A, 'synthetic-a'], [TOKEN_B, 'synthetic-b']);
  const fake = fakeChrome({});
  await startWorker(fake, network);
  await provision(fake, accountA);
  // A finished one daily sync (checkpoint) and is now in its next one.
  await fake.chrome.storage.local.set({
    lifelogSyncStatus: {
      ...(fake.data.lifelogSyncStatus ?? {}),
      state: 'complete',
      lastEventAt: '2026-10-20T08:00:00.000Z',
      lastSuccessAt: '2026-10-20T09:00:00.000Z',
    },
  });
  const started = await fake.dispatch({ type: 'lifelog-sync-start' });
  assert.equal(started?.ok, true);
  const syncA = fake.data.lifelogSyncStatus.syncId;
  const tabA = fake.data.lifelogSyncStatus.activityTabId;
  assert.equal(fake.data.lifelogSyncStatus.state, 'running');

  fake.tabMessages.length = 0;
  await provision(fake, accountB);
  assert.ok(fake.removedTabs.includes(tabA), "A's sync tab is closed");
  assert.ok(fake.tabMessages.some(({ id, message }) => id === tabA && message.type === 'cancel-activity-sync'));
  const startB = fake.tabMessages.find(({ message }) => message.type === 'start-activity-sync');
  assert.ok(startB, 'provisioning starts B’s first sync');
  assert.notEqual(startB.message.syncId, syncA);
  assert.ok(
    Date.parse(startB.message.since) < Date.parse('2026-10-20T06:00:00.000Z') - 86_400_000,
    `B reused A's checkpoint: since=${startB.message.since}`,
  );

  // A's still-open tab reports a batch after the switch: it must not be
  // uploaded under B, nor change B's sync status.
  const before = network.sent('/history').length;
  const late = await fake.dispatch({
    type: 'activity-history-batch',
    payload: { syncId: syncA, observedAt: new Date().toISOString(), events: [{ kind: 'watch', occurredAt: '2026-10-21T08:00:00.000Z', url: 'https://www.youtube.com/watch?v=SYNTHETIC01' }] },
  });
  assert.equal(late?.ok, false);
  assert.equal(network.sent('/history').length, before);
  await fake.dispatch({ type: 'activity-sync-progress', syncId: syncA, events: 9, pass: 3, newestEventAt: '2026-10-21T08:00:00.000Z' });
  assert.notEqual(fake.data.lifelogSyncStatus.latestEventAt, '2026-10-21T08:00:00.000Z');
  assert.equal(fake.data.lifelogSyncStatus.events, 0);
});

test('R03: existing single-account storage migrates into the configured account without loss', async () => {
  const network = networkFor([TOKEN_A, 'synthetic-a']);
  network.online = false;
  const legacyQueue = [{ payload: capturePayload('legacy-0001', 40), attempts: 2, nextAttemptAt: 0 }];
  const fake = fakeChrome({
    captureSettings: { endpoint: ENDPOINT, token: TOKEN_A, enabled: true, autoSync: true, googleAccount: '' },
    captureQueue: legacyQueue,
    lifelogSyncStatus: { state: 'complete', lastEventAt: '2026-10-19T10:00:00.000Z' },
    historyImportStatus: { state: 'complete', mode: 'deep', events: 12 },
  });
  await startWorker(fake, network);
  assert.ok(fake.data.captureSettings.accountKey, 'the configured account gets a partition key');
  assert.deepEqual(queuedSessions(fake), ['legacy-0001']);
  assert.equal(fake.data.captureQueue[0].account, fake.data.captureSettings.accountKey);
  assert.equal(fake.data.lifelogSyncStatus.lastEventAt, '2026-10-19T10:00:00.000Z');
  assert.equal(fake.data.historyImportStatus.events, 12);
  assert.equal(fake.data.captureRecording?.enabled, true);

  // Once the server confirms who the legacy token belongs to, re-provisioning
  // that same account (token rotated) adopts the legacy queue.
  network.online = true;
  await fake.dispatch({ type: 'flush' });
  assert.equal(fake.data.captureSettings.handle, 'synthetic-a');
  network.online = false;
  await fake.dispatch({ type: 'capture', payload: capturePayload('legacy-0002', 41) });
  network.accounts.delete(TOKEN_A);
  network.accounts.set(TOKEN_A2, { handle: 'synthetic-a' });
  network.online = true;
  await provision(fake, { ...accountA, token: TOKEN_A2 });
  await fake.dispatch({ type: 'flush' });
  assert.deepEqual(capturedSessions(network, TOKEN_A), ['legacy-0001']);
  assert.deepEqual(capturedSessions(network, TOKEN_A2), ['legacy-0002']);
  assert.equal(fake.data.lifelogSyncStatus.lastEventAt, '2026-10-19T10:00:00.000Z');
});
