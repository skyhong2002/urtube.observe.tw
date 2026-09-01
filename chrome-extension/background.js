import { DEFAULT_ENDPOINT, mergeQueue, retryDelayMs } from './queue.js';

const QUEUE_KEY = 'captureQueue';
const SETTINGS_KEY = 'captureSettings';
const STATUS_KEY = 'captureStatus';
const HISTORY_STATUS_KEY = 'historyImportStatus';
const LIFELOG_STATUS_KEY = 'lifelogSyncStatus';
const PROGRESS_REQUEST_TIMEOUT_MS = 20_000;
const DAILY_SYNC_ALARM = 'sync-youtube-lifelog';
const FLUSH_ALARM = 'flush-captures';
const DAILY_SYNC_DUE_MS = 20 * 60 * 60_000;
const DAILY_SYNC_OVERLAP_MS = 2 * 60 * 60_000;
const DAILY_SYNC_RETRY_MS = 4 * 60 * 60_000;
const TAB_MESSAGE_RETRY_MS = 10_000;
const TAB_MESSAGE_POLL_MS = 500;
let queueMutation = Promise.resolve();
let flushPromise = null;

// When Chrome is signed into several Google accounts, Google pages open as
// the default account unless the URL pins one; authuser accepts an email.
function withAuthuser(url, googleAccount) {
  if (!googleAccount) return url;
  const pinned = new URL(url);
  pinned.searchParams.set('authuser', googleAccount);
  return pinned.toString();
}

async function settings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return {
    endpoint: DEFAULT_ENDPOINT,
    token: '',
    enabled: true,
    autoSync: true,
    googleAccount: '',
    ...(stored[SETTINGS_KEY] ?? {}),
  };
}

async function updateStatus(patch) {
  const stored = await chrome.storage.local.get([STATUS_KEY, QUEUE_KEY]);
  await chrome.storage.local.set({
    [STATUS_KEY]: {
      ...(stored[STATUS_KEY] ?? {}),
      ...patch,
      pending: (stored[QUEUE_KEY] ?? []).length,
    },
  });
}

async function updateBadge(pending) {
  await chrome.action.setBadgeBackgroundColor({ color: '#b9472e' });
  await chrome.action.setBadgeText({ text: pending ? String(Math.min(99, pending)) : '' });
}

async function enqueue(payload) {
  const operation = queueMutation.then(async () => {
    const stored = await chrome.storage.local.get(QUEUE_KEY);
    const queue = mergeQueue(stored[QUEUE_KEY], payload);
    await chrome.storage.local.set({ [QUEUE_KEY]: queue });
    await updateBadge(queue.length);
  });
  queueMutation = operation.catch(() => {});
  await operation;
  void flushQueue();
}

async function send(item, config) {
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(item.payload),
  });
  if (response.ok) return { ok: true };
  let detail = `HTTP ${response.status}`;
  try {
    const body = await response.json();
    if (body?.error) detail = `${detail}: ${body.error}`;
  } catch {
    // The status code is enough when the response is not JSON.
  }
  return {
    ok: false,
    permanent: response.status === 400,
    auth: response.status === 401 || response.status === 403,
    detail,
  };
}

async function runFlush() {
  const config = await settings();
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const queue = Array.isArray(stored[QUEUE_KEY]) ? stored[QUEUE_KEY] : [];
  if (!config.enabled || !config.token) {
    await updateStatus({
      configured: Boolean(config.token),
      lastError: config.enabled ? 'Capture token is not configured' : '',
    });
    await updateBadge(queue.length);
    return;
  }

  const remaining = [];
  let lastSuccessAt = null;
  let lastError = '';
  for (const item of queue) {
    if (item.nextAttemptAt > Date.now()) {
      remaining.push(item);
      continue;
    }
    try {
      const result = await send(item, config);
      if (result.ok) {
        lastSuccessAt = new Date().toISOString();
        continue;
      }
      lastError = result.detail;
      if (result.permanent) continue;
      const attempts = Number(item.attempts ?? 0) + 1;
      remaining.push({
        ...item,
        attempts,
        nextAttemptAt: Date.now() + retryDelayMs(attempts),
      });
      if (result.auth) {
        remaining.push(...queue.slice(queue.indexOf(item) + 1));
        break;
      }
    } catch (error) {
      const attempts = Number(item.attempts ?? 0) + 1;
      remaining.push({
        ...item,
        attempts,
        nextAttemptAt: Date.now() + retryDelayMs(attempts),
      });
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  await chrome.storage.local.set({
    [QUEUE_KEY]: remaining,
    [STATUS_KEY]: {
      configured: true,
      pending: remaining.length,
      lastSuccessAt: lastSuccessAt
        ?? (await chrome.storage.local.get(STATUS_KEY))[STATUS_KEY]?.lastSuccessAt
        ?? null,
      lastError,
    },
  });
  await updateBadge(remaining.length);
}

function flushQueue() {
  if (!flushPromise) {
    const operation = queueMutation.then(runFlush);
    queueMutation = operation.catch(() => {});
    flushPromise = operation.finally(() => {
      flushPromise = null;
    });
  }
  return flushPromise;
}

function progressEndpoint(endpoint) {
  return endpoint.replace(/\/capture$/, '/progress');
}

function historyEndpoint(endpoint, suffix = '') {
  return endpoint.replace(/\/capture$/, `/history${suffix}`);
}

async function sendProgressBatch(payload) {
  const config = await settings();
  if (!config.enabled || !config.token) throw new Error('Capture token is not configured');
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROGRESS_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(progressEndpoint(config.endpoint), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (response.ok) return await response.json();
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || `Progress import failed: HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** attempt)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function backfillEndpoint(endpoint) {
  return endpoint.replace(/\/capture$/, '/backfill');
}

async function sendBackfillBatch(payload) {
  const config = await settings();
  if (!config.enabled || !config.token) throw new Error('Capture token is not configured');
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROGRESS_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(backfillEndpoint(config.endpoint), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (response.ok) return await response.json();
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || `Backfill import failed: HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** attempt)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function sendHistoryBatch(payload) {
  const config = await settings();
  if (!config.enabled || !config.token) throw new Error('Capture token is not configured');
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROGRESS_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(historyEndpoint(config.endpoint), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (response.ok) return await response.json();
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || `History sync failed: HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** attempt)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function serverHistoryStatus() {
  const config = await settings();
  if (!config.enabled || !config.token) throw new Error('Capture token is not configured');
  const response = await fetch(historyEndpoint(config.endpoint, '/status'), {
    headers: { authorization: `Bearer ${config.token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `History status failed: HTTP ${response.status}`);
  return body;
}

async function historyStatus(patch) {
  const stored = await chrome.storage.local.get(HISTORY_STATUS_KEY);
  await chrome.storage.local.set({
    [HISTORY_STATUS_KEY]: {
      ...(stored[HISTORY_STATUS_KEY] ?? {}),
      ...patch,
    },
  });
}

async function waitForTab(tabId) {
  const current = await chrome.tabs.get(tabId);
  if (current.status === 'complete') return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for sync page'));
    }, 30_000);
    const cleanup = () => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(updatedListener);
      chrome.tabs.onRemoved.removeListener(removedListener);
    };
    const updatedListener = (updatedId, changeInfo) => {
      if (updatedId !== tabId || changeInfo.status !== 'complete') return;
      cleanup();
      resolve();
    };
    const removedListener = (removedId) => {
      if (removedId !== tabId) return;
      cleanup();
      reject(new Error('Sync page was closed before it loaded'));
    };
    chrome.tabs.onUpdated.addListener(updatedListener);
    chrome.tabs.onRemoved.addListener(removedListener);
  });
}

// A tab reports "complete" before its content script has registered a
// listener, and Google's account redirects can park it on a page no content
// script matches at all. Retry that one failure briefly, then say which page
// the tab actually stopped on instead of Chrome's opaque wording.
function isMissingReceiver(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Receiving end does not exist|Could not establish connection/i.test(message);
}

async function missingReceiverError(tabId, page) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  let landed = null;
  try {
    if (tab?.url) {
      const url = new URL(tab.url);
      landed = `${url.origin}${url.pathname}`;
    }
  } catch {
    landed = null;
  }
  return new Error(landed
    ? `${page} did not load — the sync tab stopped at ${landed}`
    : `${page} did not load in the sync tab`);
}

async function sendToTab(tabId, message, page) {
  const deadline = Date.now() + TAB_MESSAGE_RETRY_MS;
  for (;;) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      if (!isMissingReceiver(error)) throw error;
      if (Date.now() >= deadline) throw await missingReceiverError(tabId, page);
      await new Promise((resolve) => setTimeout(resolve, TAB_MESSAGE_POLL_MS));
    }
  }
}

async function closeHistoryImportTab(tabId) {
  if (!Number.isInteger(tabId)) return;
  await chrome.tabs.remove(tabId).catch(() => {});
}

async function startHistoryImport({
  active = true,
  mode = 'full',
  parentSyncId = null,
} = {}) {
  const config = await settings();
  if (!config.enabled || !config.token) throw new Error('Capture token is not configured');
  const stored = await chrome.storage.local.get(HISTORY_STATUS_KEY);
  if (stored[HISTORY_STATUS_KEY]?.state === 'running') {
    throw new Error('A history import is already running');
  }
  const scanId = crypto.randomUUID();
  const observedAt = new Date().toISOString();
  const tab = await chrome.tabs.create({
    active,
    url: withAuthuser('https://www.youtube.com/feed/history', config.googleAccount),
  });
  if (!tab.id) throw new Error('Could not open YouTube History');
  await historyStatus({
    state: 'running',
    scanId,
    observedAt,
    tabId: tab.id,
    videos: 0,
    pass: 0,
    mode,
    parentSyncId,
    lastError: '',
  });
  void (async () => {
    try {
      await waitForTab(tab.id);
      const result = await sendToTab(tab.id, {
        type: 'start-history-import',
        scanId,
        observedAt,
        mode,
      }, 'YouTube History');
      if (!result?.ok) throw new Error(result?.error || 'YouTube History import failed');
    } catch (error) {
      const storedStatus = await chrome.storage.local.get(HISTORY_STATUS_KEY);
      if (storedStatus[HISTORY_STATUS_KEY]?.state === 'cancelled') return;
      await historyStatus({
        state: 'error',
        completedAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : String(error),
      });
      await closeHistoryImportTab(tab.id);
      if (parentSyncId) await failLifelogSync(parentSyncId, error);
    }
  })();
  return { scanId, observedAt, tabId: tab.id };
}

async function cancelHistoryImport() {
  const stored = await chrome.storage.local.get(HISTORY_STATUS_KEY);
  const status = stored[HISTORY_STATUS_KEY] ?? {};
  if (status.tabId) {
    await chrome.tabs.sendMessage(status.tabId, { type: 'cancel-history-import' }).catch(() => {});
  }
  await closeHistoryImportTab(status.tabId);
  await historyStatus({
    state: 'cancelled',
    completedAt: new Date().toISOString(),
    lastError: '',
  });
}

async function finishHistoryImport(scanId, patch) {
  const stored = await chrome.storage.local.get(HISTORY_STATUS_KEY);
  const status = stored[HISTORY_STATUS_KEY] ?? {};
  if (status.scanId !== scanId || status.state !== 'running') {
    return { updated: false, tabId: null, parentSyncId: null };
  }
  await historyStatus({
    ...patch,
    completedAt: new Date().toISOString(),
  });
  return {
    updated: true,
    tabId: status.tabId ?? null,
    parentSyncId: status.parentSyncId ?? null,
  };
}

async function lifelogStatus(patch) {
  const stored = await chrome.storage.local.get(LIFELOG_STATUS_KEY);
  await chrome.storage.local.set({
    [LIFELOG_STATUS_KEY]: {
      ...(stored[LIFELOG_STATUS_KEY] ?? {}),
      ...patch,
    },
  });
}

async function closeActivitySyncTab(tabId) {
  if (!Number.isInteger(tabId)) return;
  await chrome.tabs.remove(tabId).catch(() => {});
}

async function failLifelogSync(syncId, error) {
  const stored = await chrome.storage.local.get(LIFELOG_STATUS_KEY);
  const status = stored[LIFELOG_STATUS_KEY] ?? {};
  if (status.syncId !== syncId || status.state !== 'running') return;
  await closeActivitySyncTab(status.activityTabId);
  await closeHistoryImportTab(status.historyTabId);
  await lifelogStatus({
    state: 'error',
    stage: 'idle',
    completedAt: new Date().toISOString(),
    activityTabId: null,
    historyTabId: null,
    lastError: error instanceof Error ? error.message : String(error),
  });
}

async function finishLifelogSync(syncId, videos) {
  const stored = await chrome.storage.local.get(LIFELOG_STATUS_KEY);
  const status = stored[LIFELOG_STATUS_KEY] ?? {};
  if (status.syncId !== syncId || status.state !== 'running') return;
  const completedAt = new Date().toISOString();
  await lifelogStatus({
    state: 'complete',
    stage: 'idle',
    completedAt,
    lastSuccessAt: completedAt,
    nextSyncAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    videos,
    activityTabId: null,
    historyTabId: null,
    lastError: '',
  });
}

async function startActivitySync(syncId, observedAt, since) {
  const config = await settings();
  const tab = await chrome.tabs.create({
    active: false,
    url: withAuthuser('https://myactivity.google.com/product/youtube', config.googleAccount),
  });
  if (!tab.id) throw new Error('Could not open Google My Activity');
  await lifelogStatus({ activityTabId: tab.id });
  try {
    await waitForTab(tab.id);
    const result = await sendToTab(tab.id, {
      type: 'start-activity-sync',
      syncId,
      observedAt,
      since,
    }, 'Google My Activity');
    if (!result?.ok) throw new Error(result?.error || 'Google My Activity sync failed');
  } catch (error) {
    await closeActivitySyncTab(tab.id);
    throw error;
  }
}

async function startLifelogSync({ automatic = false } = {}) {
  const config = await settings();
  if (!config.enabled || !config.token) throw new Error('Capture token is not configured');
  if (automatic && config.autoSync === false) return { skipped: true, reason: 'disabled' };
  const stored = await chrome.storage.local.get([LIFELOG_STATUS_KEY, HISTORY_STATUS_KEY]);
  if (stored[LIFELOG_STATUS_KEY]?.state === 'running') {
    throw new Error('A YouTube lifelog sync is already running');
  }
  if (stored[HISTORY_STATUS_KEY]?.state === 'running') {
    throw new Error('A history progress import is already running');
  }
  const remote = await serverHistoryStatus();
  const candidates = [
    stored[LIFELOG_STATUS_KEY]?.lastEventAt,
    remote.latestEventAt,
  ].filter(Boolean).sort();
  const latestEventAt = candidates.at(-1) ?? null;
  const since = latestEventAt
    ? new Date(Date.parse(latestEventAt) - DAILY_SYNC_OVERLAP_MS).toISOString()
    : new Date(Date.now() - 7 * 86_400_000).toISOString();
  const syncId = crypto.randomUUID();
  const observedAt = new Date().toISOString();
  await lifelogStatus({
    state: 'running',
    stage: 'activity',
    syncId,
    observedAt,
    startedAt: observedAt,
    completedAt: null,
    automatic,
    events: 0,
    videos: 0,
    pass: 0,
    latestEventAt,
    activityTabId: null,
    historyTabId: null,
    lastError: '',
  });
  try {
    await startActivitySync(syncId, observedAt, since);
    return { syncId, observedAt, since };
  } catch (error) {
    await failLifelogSync(syncId, error);
    throw error;
  }
}

async function completeActivitySync(syncId, patch) {
  const stored = await chrome.storage.local.get(LIFELOG_STATUS_KEY);
  const status = stored[LIFELOG_STATUS_KEY] ?? {};
  if (status.syncId !== syncId || status.state !== 'running' || status.stage !== 'activity') {
    return { updated: false };
  }
  await closeActivitySyncTab(status.activityTabId);
  const latestEventAt = [
    status.lastEventAt ?? status.latestEventAt,
    patch.newestEventAt,
  ]
    .filter(Boolean).sort().at(-1) ?? null;
  await lifelogStatus({
    state: 'running',
    stage: 'progress',
    events: patch.events,
    lastEventAt: latestEventAt,
    latestEventAt,
    activityTabId: null,
  });
  try {
    const history = await startHistoryImport({
      active: false,
      mode: 'incremental',
      parentSyncId: syncId,
    });
    await lifelogStatus({ historyTabId: history.tabId });
    return { updated: true };
  } catch (error) {
    await failLifelogSync(syncId, error);
    throw error;
  }
}

async function cancelLifelogSync() {
  const stored = await chrome.storage.local.get([LIFELOG_STATUS_KEY, HISTORY_STATUS_KEY]);
  const status = stored[LIFELOG_STATUS_KEY] ?? {};
  if (status.state !== 'running') return;
  if (status.stage === 'activity' && status.activityTabId) {
    await chrome.tabs.sendMessage(
      status.activityTabId,
      { type: 'cancel-activity-sync' },
    ).catch(() => {});
    await closeActivitySyncTab(status.activityTabId);
  }
  if (
    status.stage === 'progress'
    && stored[HISTORY_STATUS_KEY]?.parentSyncId === status.syncId
  ) {
    await cancelHistoryImport();
  }
  await lifelogStatus({
    state: 'cancelled',
    stage: 'idle',
    completedAt: new Date().toISOString(),
    activityTabId: null,
    historyTabId: null,
    lastError: '',
  });
}

async function maybeStartLifelogSync() {
  const config = await settings();
  if (!config.enabled || !config.token || config.autoSync === false) return;
  const stored = await chrome.storage.local.get(LIFELOG_STATUS_KEY);
  const status = stored[LIFELOG_STATUS_KEY] ?? {};
  if (status.state === 'running') return;
  const lastSuccess = Date.parse(status.lastSuccessAt ?? '');
  if (Number.isFinite(lastSuccess) && Date.now() - lastSuccess < DAILY_SYNC_DUE_MS) return;
  // A sync that fails for a standing reason fails again every hour and keeps
  // rewriting the same popup error. Back the automatic retry off; "Sync now"
  // stays immediate.
  const lastFailure = Date.parse(status.completedAt ?? '');
  if (
    status.state === 'error'
    && Number.isFinite(lastFailure)
    && Date.now() - lastFailure < DAILY_SYNC_RETRY_MS
  ) return;
  await startLifelogSync({ automatic: true }).catch(() => {});
}

async function ensureAlarms() {
  await chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 1 });
  await chrome.alarms.create(DAILY_SYNC_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: 60,
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'capture' && message.payload) {
    enqueue(message.payload)
      .then(() => sendResponse({ queued: true }))
      .catch((error) => sendResponse({ queued: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'flush') {
    flushQueue()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'lifelog-sync-start') {
    startLifelogSync({ automatic: false })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    return true;
  }
  if (message?.type === 'lifelog-sync-cancel') {
    cancelLifelogSync()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'settings-updated') {
    ensureAlarms()
      // Re-run the queue immediately after provisioning or saving settings.
      // Besides sending pending captures, this replaces any stale
      // "token is not configured" status left by the install-time flush.
      .then(() => flushQueue())
      .then(() => maybeStartLifelogSync())
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'extension-update-check') {
    checkExtensionUpdate()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === 'history-import-start') {
    startHistoryImport()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      });
    return true;
  }
  if (message?.type === 'history-import-cancel') {
    cancelHistoryImport()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'history-progress-batch' && message.payload) {
    sendProgressBatch(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    return true;
  }
  if (message?.type === 'history-backfill-batch' && message.payload) {
    sendBackfillBatch(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    return true;
  }
  if (message?.type === 'activity-history-batch' && message.payload) {
    sendHistoryBatch(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    return true;
  }
  if (message?.type === 'activity-sync-progress') {
    const operation = (async () => {
      const stored = await chrome.storage.local.get(LIFELOG_STATUS_KEY);
      const status = stored[LIFELOG_STATUS_KEY] ?? {};
      if (status.syncId !== message.syncId || status.state !== 'running') return;
      await lifelogStatus({
        state: 'running',
        stage: 'activity',
        events: message.events,
        pass: message.pass,
        latestEventAt: message.newestEventAt ?? status.latestEventAt ?? null,
      });
    })();
    operation
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'activity-sync-complete') {
    completeActivitySync(message.syncId, {
      events: message.events,
      newestEventAt: message.newestEventAt,
    })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'activity-sync-error') {
    failLifelogSync(
      message.syncId,
      String(message.error || 'Google My Activity sync failed'),
    )
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'history-import-progress') {
    const operation = (async () => {
      await historyStatus({
        state: 'running',
        videos: message.videos,
        pass: message.pass,
      });
      const stored = await chrome.storage.local.get([
        HISTORY_STATUS_KEY,
        LIFELOG_STATUS_KEY,
      ]);
      const history = stored[HISTORY_STATUS_KEY] ?? {};
      const lifelog = stored[LIFELOG_STATUS_KEY] ?? {};
      if (
        history.parentSyncId
        && history.parentSyncId === lifelog.syncId
        && lifelog.state === 'running'
      ) {
        await lifelogStatus({
          stage: 'progress',
          videos: message.videos,
          pass: message.pass,
        });
      }
    })();
    operation
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'history-import-complete') {
    finishHistoryImport(message.scanId, {
      state: 'complete',
      videos: message.videos,
      lastError: '',
    })
      .then(({ updated, tabId, parentSyncId }) => {
        sendResponse({ ok: true, updated });
        void closeHistoryImportTab(tabId);
        if (updated && parentSyncId) void finishLifelogSync(parentSyncId, message.videos);
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'history-import-error') {
    finishHistoryImport(message.scanId, {
      state: 'error',
      lastError: String(message.error || 'YouTube History import failed'),
    })
      .then(({ updated, tabId, parentSyncId }) => {
        sendResponse({ ok: true, updated });
        void closeHistoryImportTab(tabId);
        if (updated && parentSyncId) {
          void failLifelogSync(
            parentSyncId,
            String(message.error || 'YouTube History import failed'),
          );
        }
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  return false;
});

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get([
    SETTINGS_KEY,
    HISTORY_STATUS_KEY,
    LIFELOG_STATUS_KEY,
  ]);
  if (!stored[SETTINGS_KEY]) {
    await chrome.storage.local.set({
      [SETTINGS_KEY]: {
        endpoint: DEFAULT_ENDPOINT,
        token: '',
        enabled: true,
        autoSync: true,
      },
    });
    // One-click provisioning: the site page hands us endpoint + token via
    // the provision content script; no manual copying.
    await chrome.tabs.create({ url: new URL('/extension-setup', DEFAULT_ENDPOINT).toString() });
  }
  const historyImport = stored[HISTORY_STATUS_KEY] ?? {};
  if (historyImport.state === 'running') {
    await closeHistoryImportTab(historyImport.tabId);
    await historyStatus({
      state: 'cancelled',
      completedAt: new Date().toISOString(),
      lastError: '',
    });
  }
  const lifelogSync = stored[LIFELOG_STATUS_KEY] ?? {};
  if (lifelogSync.state === 'running') {
    await closeActivitySyncTab(lifelogSync.activityTabId);
    await lifelogStatus({
      state: 'cancelled',
      stage: 'idle',
      completedAt: new Date().toISOString(),
      activityTabId: null,
      historyTabId: null,
      lastError: '',
    });
  }
  await ensureAlarms();
  void flushQueue();
  void maybeStartLifelogSync();
  void checkExtensionUpdate();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarms();
  void flushQueue();
  void maybeStartLifelogSync();
  void checkExtensionUpdate();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM) void flushQueue();
  if (alarm.name === DAILY_SYNC_ALARM) {
    void maybeStartLifelogSync();
    void checkExtensionUpdate();
  }
});

// Unpacked installs cannot auto-update, but they can know an update exists:
// the server publishes its bundled extension version; a newer one lights a
// badge and a notice in the popup pointing at the update steps.
function isNewerVersion(latest, current) {
  const a = String(latest ?? '').split('.').map(Number);
  const b = String(current ?? '').split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff > 0) return true;
    if (diff < 0) return false;
  }
  return false;
}

async function checkExtensionUpdate() {
  try {
    const config = await settings();
    const origin = new URL(config.endpoint).origin;
    const response = await fetch(`${origin}/extension-version.json`);
    if (!response.ok) return;
    const latest = String((await response.json())?.version ?? '');
    await chrome.storage.local.set({ latestExtensionVersion: latest });
    const updateDue = isNewerVersion(latest, chrome.runtime.getManifest().version);
    await chrome.action.setBadgeText({ text: updateDue ? 'NEW' : '' });
    if (updateDue) await chrome.action.setBadgeBackgroundColor({ color: '#d03b3b' });
  } catch {
    // Version discovery is best-effort; never disturb capture over it.
  }
}
void checkExtensionUpdate();
