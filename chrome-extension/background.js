import { DEFAULT_ENDPOINT, mergeQueue, retryDelayMs } from './queue.js';
import {
  buildDeepHistoryRanges,
  myActivityRangeUrl,
  splitDeepHistoryRange,
} from './history-ranges.js';

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
const IDENTITY_REQUEST_TIMEOUT_MS = 10_000;
// Account partitions. The connected account's queue and sync checkpoints
// live under the well-known keys above (the popup and site bridge read
// them); every other account's are parked under ACCOUNTS_KEY by account key
// (server origin + immutable account id) until that account is connected
// again. RECORDING_KEY is the token-free view content scripts read.
const ACCOUNTS_KEY = 'captureAccounts';
const RECORDING_KEY = 'captureRecording';
const ACCOUNT_STATE_KEYS = [QUEUE_KEY, STATUS_KEY, HISTORY_STATUS_KEY, LIFELOG_STATUS_KEY];
let queueMutation = Promise.resolve();
let statusMutation = Promise.resolve();
let flushPromise = null;
// Bumped on every account switch. Work started for one account carries the
// epoch it started in and stops (or aborts its request) once it is stale.
let accountEpoch = 0;
let accountAbort = new AbortController();

// When Chrome is signed into several Google accounts, Google pages open as
// the default account unless the URL pins one; authuser accepts an email.
function withAuthuser(url, googleAccount) {
  if (!googleAccount) return url;
  const pinned = new URL(url);
  pinned.searchParams.set('authuser', googleAccount);
  return pinned.toString();
}

function withDefaults(stored) {
  return {
    endpoint: DEFAULT_ENDPOINT,
    token: '',
    enabled: true,
    autoSync: true,
    googleAccount: '',
    accountId: '',
    handle: '',
    accountKey: '',
    recordingSince: null,
    ...(stored ?? {}),
  };
}

async function settings() {
  await storageReady;
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return withDefaults(stored[SETTINGS_KEY]);
}

function withQueueLock(work) {
  const operation = queueMutation.then(work);
  queueMutation = operation.catch(() => {});
  return operation;
}

function withStatusLock(work) {
  const operation = statusMutation.then(work);
  statusMutation = operation.catch(() => {});
  return operation;
}

async function currentAccount() {
  const epoch = accountEpoch;
  const signal = accountAbort.signal;
  return { epoch, signal, config: await settings() };
}

function isCurrent(account) {
  return account.epoch === accountEpoch;
}

function assertCurrent(account) {
  if (!isCurrent(account)) throw new Error('The connected account changed; this work was cancelled');
}

function endpointOrigin(endpoint) {
  try {
    return new URL(endpoint).origin;
  } catch {
    return '';
  }
}

async function tokenFingerprint(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Provisioning delivers the server's immutable account id. Connections made
// without one (manual entry, pre-2.1 installs) are keyed by a token
// fingerprint until an id arrives.
async function accountKeyFor(config) {
  if (!config.token) return '';
  const origin = endpointOrigin(config.endpoint);
  return config.accountId
    ? `${origin}#id:${config.accountId}`
    : `${origin}#token:${await tokenFingerprint(config.token)}`;
}

// The id decides when both sides have one. The handle (which can be renamed)
// is only a fallback for connections that predate ids; a mismatch keeps the
// accounts apart, never merges them.
function sameAccount(current, next) {
  if (!current?.endpoint || endpointOrigin(current.endpoint) !== endpointOrigin(next.endpoint)) return false;
  if (current.accountId && next.accountId) return current.accountId === next.accountId;
  if (current.token && current.token === next.token) return true;
  if (current.handle && next.handle) return current.handle === next.handle;
  return false;
}

function recordingView(config) {
  return {
    enabled: Boolean(config.enabled && config.token && config.accountKey),
    accountKey: config.accountKey || '',
    since: config.recordingSince ?? null,
  };
}

// Asks the server who a token belongs to; null when it cannot say.
async function resolveIdentity(endpoint, token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IDENTITY_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint.replace(/\/capture$/, '/capture/status'), {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = await response.json();
    const accountId = body?.accountId == null ? '' : String(body.accountId);
    const handle = typeof body?.user === 'string' ? body.user : '';
    return accountId || handle ? { accountId, handle } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// A pre-2.1 connection does not know which account it is. Learn its handle
// while its token still works, so re-provisioning that same account later
// can adopt its queue instead of parking it.
// Callers already holding the queue lock (the flush) pass locked = true.
async function identifyLegacyAccount({ locked = false } = {}) {
  const config = await settings();
  if (!config.token || config.accountId || config.handle) return;
  const identity = await resolveIdentity(config.endpoint, config.token);
  if (!identity) return;
  const store = async () => {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    const latest = withDefaults(stored[SETTINGS_KEY]);
    if (latest.token !== config.token || latest.accountId || latest.handle) return;
    await chrome.storage.local.set({ [SETTINGS_KEY]: { ...stored[SETTINGS_KEY], handle: identity.handle } });
  };
  await (locked ? store() : withQueueLock(store));
}

// Single-account storage from before partitioning becomes the partition of
// the account it is configured for: its queue is stamped with that account
// and its sync checkpoints stay where they are.
async function migrateStorage() {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, QUEUE_KEY, RECORDING_KEY]);
  if (!stored[SETTINGS_KEY]) {
    if (!stored[RECORDING_KEY]) await chrome.storage.local.set({ [RECORDING_KEY]: recordingView(withDefaults()) });
    return;
  }
  const config = withDefaults(stored[SETTINGS_KEY]);
  if (stored[SETTINGS_KEY].accountKey !== undefined && stored[RECORDING_KEY]) return;
  const accountKey = await accountKeyFor(config);
  const queue = (Array.isArray(stored[QUEUE_KEY]) ? stored[QUEUE_KEY] : [])
    .map((item) => item.account === undefined ? { ...item, account: accountKey } : item);
  const migrated = { ...stored[SETTINGS_KEY], accountKey };
  await chrome.storage.local.set({
    [SETTINGS_KEY]: migrated,
    [QUEUE_KEY]: queue,
    [RECORDING_KEY]: recordingView(withDefaults(migrated)),
  });
}

const storageReady = migrateStorage().catch(() => {});

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

// Recording state is enforced on receipt, not only in the tab: a paused or
// unconnected extension stores nothing, and after a resume or account switch
// a session that began earlier (a tab that missed the change) is refused, so
// only the new interval counts.
function captureRefusal(config, payload) {
  if (!config.enabled) return 'paused';
  if (!config.token || !config.accountKey) return 'not-configured';
  const since = Date.parse(config.recordingSince ?? '');
  const watchedAt = Date.parse(payload?.watchedAt ?? '');
  if (Number.isFinite(since) && !(watchedAt >= since)) return 'started-before-recording';
  return '';
}

async function enqueue(payload) {
  await storageReady;
  const result = await withQueueLock(async () => {
    const config = await settings();
    const refusal = captureRefusal(config, payload);
    if (refusal) return { queued: false, reason: refusal };
    const stored = await chrome.storage.local.get(QUEUE_KEY);
    const queue = mergeQueue(stored[QUEUE_KEY], payload, Date.now(), config.accountKey);
    await chrome.storage.local.set({ [QUEUE_KEY]: queue });
    await updateBadge(queue.length);
    return { queued: true };
  });
  if (result.queued) void flushQueue();
  return result;
}

async function send(item, config, signal) {
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(item.payload),
    signal,
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

// Runs under the queue lock, so an account switch waits for it; the switch
// aborts the request in flight and the loop stops at the stale epoch, leaving
// the rest of the queue with the account it was captured for.
async function runFlush() {
  const account = await currentAccount();
  const { config } = account;
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
  if (queue.length) await identifyLegacyAccount({ locked: true }).catch(() => {});

  const remaining = [];
  let lastSuccessAt = null;
  let lastError = '';
  for (const item of queue) {
    if (
      item.nextAttemptAt > Date.now()
      || item.account !== config.accountKey
      || !isCurrent(account)
    ) {
      remaining.push(item);
      continue;
    }
    try {
      const result = await send(item, config, account.signal);
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
    flushPromise = withQueueLock(runFlush).finally(() => {
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

function backfillEndpoint(endpoint) {
  return endpoint.replace(/\/capture$/, '/backfill');
}

// Sync uploads use the credentials of the account the scan started for and
// stop, mid-request included, once that account is no longer connected.
async function postSyncBatch(account, endpoint, payload, failure) {
  const { config } = account;
  if (!config.token) throw new Error('Capture token is not configured');
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    assertCurrent(account);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROGRESS_REQUEST_TIMEOUT_MS);
    const cancel = () => controller.abort();
    account.signal.addEventListener('abort', cancel);
    try {
      const response = await fetch(endpoint(config.endpoint), {
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
      throw new Error(body?.error || `${failure}: HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      assertCurrent(account);
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** attempt)));
    } finally {
      clearTimeout(timeout);
      account.signal.removeEventListener('abort', cancel);
    }
  }
  throw lastError;
}

async function sendProgressBatch(payload, account) {
  return postSyncBatch(account ?? await currentAccount(), progressEndpoint, payload, 'Progress import failed');
}

// Batches arrive from sync tabs. Only a scan that is running for the
// connected account may upload; a tab left over from another account (or a
// cancelled scan) is refused instead of being sent with the new credentials.
async function ownedScanAccount(scanId) {
  const account = await currentAccount();
  const stored = await chrome.storage.local.get([HISTORY_STATUS_KEY, LIFELOG_STATUS_KEY]);
  const history = stored[HISTORY_STATUS_KEY] ?? {};
  const lifelog = stored[LIFELOG_STATUS_KEY] ?? {};
  const owned = Boolean(scanId) && (
    (history.state === 'running' && history.scanId === scanId)
    || (lifelog.state === 'running' && lifelog.syncId === scanId)
  );
  if (!owned) throw new Error('This sync is no longer running for the connected account');
  return account;
}

async function serverHistoryStatus(account) {
  const { config } = account;
  if (!config.token) throw new Error('Capture token is not configured');
  const response = await fetch(historyEndpoint(config.endpoint, '/status'), {
    headers: { authorization: `Bearer ${config.token}` },
    signal: account.signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `History status failed: HTTP ${response.status}`);
  return body;
}

// Status writes share a lock with the account switch. A guard, when given,
// sees the stored status and decides whether the patch still applies (the
// same scan is still the current one); the result says whether it was written.
function patchStatus(key, patch, guard) {
  return withStatusLock(async () => {
    const stored = await chrome.storage.local.get(key);
    const current = stored[key] ?? {};
    if (guard && !guard(current)) return false;
    await chrome.storage.local.set({ [key]: { ...current, ...patch } });
    return true;
  });
}

function historyStatus(patch, guard = null) {
  return patchStatus(HISTORY_STATUS_KEY, patch, guard);
}

const runningScan = (scanId, account = null) => (status) =>
  status.state === 'running' && status.scanId === scanId && (!account || isCurrent(account));

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

function historyScanFailed(endReason) {
  return ['history-paused', 'signed-out', 'no-content'].includes(endReason);
}

function historyScanFailureMessage(endReason) {
  return {
    'history-paused': 'YouTube watch history is paused. Turn it on in YouTube History, then retry.',
    'signed-out': 'YouTube History is signed out. Sign in to the intended Google account, then retry.',
    'no-content': 'No YouTube history items appeared. Check that you are signed in and watch history is enabled, then retry.',
  }[endReason] ?? '';
}

// Tells the server how a scan ended when the content script could not (it
// never ran, or it was cancelled from here). Best effort; the diagnosis lives
// in the archive so a failing account can be read without its popup.
async function reportScanEnd(account, status, endReason, {
  error = null,
  landedUrl = null,
  oldestWatchedAt = null,
  newestWatchedAt = null,
} = {}) {
  if (!status?.scanId || !status?.observedAt) return;
  await sendProgressBatch({
    scanId: status.scanId,
    observedAt: status.observedAt,
    items: [],
    complete: true,
    summary: {
      mode: status.mode === 'incremental' ? 'incremental' : 'full',
      videos: Number(status.videos ?? status.events ?? 0),
      passes: Number(status.pass ?? 0),
      endReason,
      oldestWatchedAt,
      newestWatchedAt,
      error: error ? String(error).slice(0, 500) : null,
      landedUrl: landedUrl ? String(landedUrl).slice(0, 500) : null,
    },
  }, account).catch(() => {});
}

async function landedUrlOf(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  try {
    if (!tab?.url) return null;
    const url = new URL(tab.url);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

// mode 'full' reads the whole page; 'incremental' stops at date groups the
// server already covers (coveredSince). A full read of a long history takes
// many minutes, and Chrome throttles timers in hidden tabs after five, so
// user-initiated full reads open in the foreground.
async function startHistoryImport({
  active = true,
  mode = 'full',
  parentSyncId = null,
  coveredSince = null,
  account: startedFor = null,
} = {}) {
  const account = startedFor ?? await currentAccount();
  const { config } = account;
  if (!config.token) throw new Error('Capture token is not configured');
  assertCurrent(account);
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
  const status = {
    state: 'running',
    scanId,
    observedAt,
    tabId: tab.id,
    videos: 0,
    pass: 0,
    mode,
    active,
    coveredSince,
    parentSyncId,
    endReason: null,
    lastError: '',
  };
  const written = await historyStatus(status, (current) => current.state !== 'running' && isCurrent(account));
  if (!written) {
    await closeHistoryImportTab(tab.id);
    assertCurrent(account);
    throw new Error('A history import is already running');
  }
  void (async () => {
    try {
      await waitForTab(tab.id);
      const result = await sendToTab(tab.id, {
        type: 'start-history-import',
        scanId,
        observedAt,
        mode,
        coveredSince,
      }, 'YouTube History');
      if (!result?.ok) throw new Error(result?.error || 'YouTube History import failed');
    } catch (error) {
      // Cancelled, or the account switched (which cancels it): nothing to
      // report, and nothing of this scan may land on the new account.
      const landedUrl = await landedUrlOf(tab.id);
      const failed = await historyStatus({
        state: 'error',
        endReason: 'no-receiver',
        completedAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : String(error),
      }, runningScan(scanId, account));
      if (!failed) return;
      await reportScanEnd(account, status, 'no-receiver', { error, landedUrl });
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
    await chrome.tabs.sendMessage(status.tabId, {
      type: status.mode === 'deep' ? 'cancel-activity-sync' : 'cancel-history-import',
    }).catch(() => {});
  }
  await closeHistoryImportTab(status.tabId);
  if (status.state === 'running' && status.mode !== 'deep') {
    await reportScanEnd(await currentAccount(), status, 'cancelled');
  }
  await historyStatus({
    state: 'cancelled',
    endReason: 'cancelled',
    completedAt: new Date().toISOString(),
    tabId: null,
    lastError: '',
  });
}

async function finishHistoryImport(scanId, patch) {
  const stored = await chrome.storage.local.get(HISTORY_STATUS_KEY);
  const status = stored[HISTORY_STATUS_KEY] ?? {};
  if (status.scanId !== scanId || status.state !== 'running' || !await historyStatus({
    ...patch,
    completedAt: new Date().toISOString(),
  }, runningScan(scanId))) {
    return { updated: false, tabId: null, parentSyncId: null, active: false };
  }
  return {
    updated: true,
    tabId: status.tabId ?? null,
    parentSyncId: status.parentSyncId ?? null,
    active: Boolean(status.active),
  };
}

function lifelogStatus(patch, guard = null) {
  return patchStatus(LIFELOG_STATUS_KEY, patch, guard);
}

const runningSync = (syncId, account = null) => (status) =>
  status.state === 'running' && status.syncId === syncId && (!account || isCurrent(account));

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
  }, runningSync(syncId));
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
  }, runningSync(syncId));
}

async function startActivitySync(account, syncId, observedAt, since) {
  const tab = await chrome.tabs.create({
    active: false,
    url: withAuthuser('https://myactivity.google.com/product/youtube', account.config.googleAccount),
  });
  if (!tab.id) throw new Error('Could not open Google My Activity');
  try {
    if (!await lifelogStatus({ activityTabId: tab.id }, runningSync(syncId, account))) {
      throw new Error('This sync is no longer running for the connected account');
    }
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

async function startDeepHistoryRange(scanId) {
  const stored = await chrome.storage.local.get(HISTORY_STATUS_KEY);
  const status = stored[HISTORY_STATUS_KEY] ?? {};
  if (status.state !== 'running' || status.mode !== 'deep' || status.scanId !== scanId) return;
  const range = status.activeRange ?? status.ranges?.[0];
  if (!range) return;
  const ranges = status.activeRange ? (status.ranges ?? []) : (status.ranges ?? []).slice(1);
  const account = await currentAccount();
  if (!await historyStatus(
    { activeRange: range, ranges, tabId: null, currentEvents: 0 },
    runningScan(scanId, account),
  )) return;
  await closeActivitySyncTab(status.tabId);
  const tab = await chrome.tabs.create({
    active: true,
    url: myActivityRangeUrl(range, account.config.googleAccount),
  });
  if (!tab.id) throw new Error('Could not open Google My Activity history segment');
  if (!await historyStatus({ tabId: tab.id }, runningScan(scanId, account))) {
    await closeActivitySyncTab(tab.id);
    return;
  }
  try {
    await waitForTab(tab.id);
    const result = await sendToTab(tab.id, {
      type: 'start-activity-sync',
      syncId: scanId,
      observedAt: status.observedAt,
      since: range.start,
      purpose: 'deep-history',
      range,
    }, 'Google My Activity history segment');
    if (!result?.ok) throw new Error(result?.error || 'Deep history segment failed');
  } catch (error) {
    await historyStatus({
      state: 'error',
      completedAt: new Date().toISOString(),
      lastError: error instanceof Error ? error.message : String(error),
    }, runningScan(scanId));
    await closeActivitySyncTab(tab.id);
  }
}

async function startDeepHistoryImport() {
  const account = await currentAccount();
  if (!account.config.token) throw new Error('Capture token is not configured');
  const stored = await chrome.storage.local.get([HISTORY_STATUS_KEY, LIFELOG_STATUS_KEY]);
  const previous = stored[HISTORY_STATUS_KEY] ?? {};
  if (previous.state === 'running') throw new Error('A history import is already running');
  if (stored[LIFELOG_STATUS_KEY]?.state === 'running') {
    throw new Error('A YouTube lifelog sync is already running');
  }
  const resumable = previous.mode === 'deep'
    && (previous.activeRange || previous.ranges?.length)
    && ['error', 'cancelled'].includes(previous.state);
  const ranges = resumable
    ? [previous.activeRange, ...(previous.ranges ?? [])].filter(Boolean)
    : buildDeepHistoryRanges();
  if (!ranges.length) throw new Error('No history date ranges are available');
  await closeActivitySyncTab(previous.tabId);
  const scanId = crypto.randomUUID();
  const observedAt = new Date().toISOString();
  const written = await historyStatus({
    state: 'running',
    mode: 'deep',
    stage: 'history',
    scanId,
    observedAt,
    startedAt: resumable ? previous.startedAt ?? observedAt : observedAt,
    completedAt: null,
    events: resumable ? Number(previous.events ?? 0) : 0,
    segments: resumable ? Number(previous.segments ?? 0) : 0,
    ranges,
    activeRange: null,
    tabId: null,
    oldestEventAt: resumable ? previous.oldestEventAt ?? null : null,
    newestEventAt: resumable ? previous.newestEventAt ?? null : null,
    lastError: '',
  }, (current) => current.state !== 'running' && isCurrent(account));
  if (!written) throw new Error('A history import is already running');
  void startDeepHistoryRange(scanId).catch((error) => failDeepHistoryImport(scanId, error));
  return { scanId, observedAt, resumed: Boolean(resumable) };
}

async function completeDeepHistoryRange(message) {
  const stored = await chrome.storage.local.get(HISTORY_STATUS_KEY);
  const status = stored[HISTORY_STATUS_KEY] ?? {};
  if (status.state !== 'running' || status.mode !== 'deep' || status.scanId !== message.syncId) {
    return { updated: false };
  }
  const activeRange = status.activeRange;
  if (!activeRange) throw new Error('Deep history segment has no active range');
  if (
    message.range?.start !== activeRange.start
    || message.range?.end !== activeRange.end
  ) {
    throw new Error('Deep history segment response does not match the active range');
  }
  let ranges = status.ranges ?? [];
  if (message.endReason === 'segment-limit') {
    const split = splitDeepHistoryRange(activeRange);
    if (!split.length) {
      throw new Error('A single day exceeds the safe history segment limit; use Takeout for this account');
    }
    ranges = [...split, ...ranges];
  } else if (message.endReason !== 'range-complete') {
    throw new Error(`Deep history segment ended unexpectedly: ${message.endReason ?? 'unknown'}`);
  }
  const oldestEventAt = [status.oldestEventAt, message.oldestEventAt]
    .filter(Boolean).sort().at(0) ?? null;
  const newestEventAt = [status.newestEventAt, message.newestEventAt]
    .filter(Boolean).sort().at(-1) ?? null;
  const completedStatus = {
    ...status,
    events: Number(status.events ?? 0) + Number(message.events ?? 0),
    segments: Number(status.segments ?? 0) + 1,
    ranges,
    activeRange: null,
    tabId: null,
    oldestEventAt,
    newestEventAt,
  };
  const account = await currentAccount();
  if (!await historyStatus(completedStatus, runningScan(status.scanId, account))) return { updated: false };
  await closeActivitySyncTab(status.tabId);
  if (ranges.length) {
    void startDeepHistoryRange(status.scanId)
      .catch((error) => failDeepHistoryImport(status.scanId, error));
    return { updated: true, complete: false };
  }
  await reportScanEnd(account, completedStatus, 'history-start', {
    landedUrl: 'https://myactivity.google.com/product/youtube',
    oldestWatchedAt: oldestEventAt,
    newestWatchedAt: newestEventAt,
  });
  await historyStatus({
    state: 'complete',
    stage: 'idle',
    endReason: 'history-start',
    completedAt: new Date().toISOString(),
    lastError: '',
  }, runningScan(status.scanId, account));
  return { updated: true, complete: true };
}

async function failDeepHistoryImport(syncId, error) {
  const stored = await chrome.storage.local.get(HISTORY_STATUS_KEY);
  const status = stored[HISTORY_STATUS_KEY] ?? {};
  if (status.state !== 'running' || status.mode !== 'deep' || status.scanId !== syncId) return;
  if (!await historyStatus({
    state: 'error',
    completedAt: new Date().toISOString(),
    lastError: error instanceof Error ? error.message : String(error),
  }, runningScan(syncId))) return;
  await closeActivitySyncTab(status.tabId);
}

// The checkpoint (lastEventAt) is the connected account's own: it lives in
// that account's partition, and a switch while the server is being asked
// abandons this start instead of writing one account's checkpoint into
// another's sync.
async function startLifelogSync({ automatic = false } = {}) {
  const account = await currentAccount();
  const { config } = account;
  if (!config.token) throw new Error('Capture token is not configured');
  if (automatic && config.autoSync === false) return { skipped: true, reason: 'disabled' };
  const stored = await chrome.storage.local.get([LIFELOG_STATUS_KEY, HISTORY_STATUS_KEY]);
  if (stored[LIFELOG_STATUS_KEY]?.state === 'running') {
    throw new Error('A YouTube lifelog sync is already running');
  }
  if (stored[HISTORY_STATUS_KEY]?.state === 'running') {
    throw new Error('A history progress import is already running');
  }
  const remote = await serverHistoryStatus(account);
  assertCurrent(account);
  const candidates = [
    stored[LIFELOG_STATUS_KEY]?.lastEventAt,
    remote.latestEventAt,
  ].filter(Boolean).sort();
  const latestEventAt = candidates.at(-1) ?? null;
  const historyCoverage = remote.coverage ?? null;
  const since = latestEventAt
    ? new Date(Date.parse(latestEventAt) - DAILY_SYNC_OVERLAP_MS).toISOString()
    : new Date(Date.now() - 7 * 86_400_000).toISOString();
  const syncId = crypto.randomUUID();
  const observedAt = new Date().toISOString();
  const written = await lifelogStatus({
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
    historyCoverage,
    activityTabId: null,
    historyTabId: null,
    lastError: '',
  }, (current) => current.state !== 'running' && isCurrent(account));
  if (!written) {
    assertCurrent(account);
    throw new Error('A YouTube lifelog sync is already running');
  }
  try {
    await startActivitySync(account, syncId, observedAt, since);
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
  const account = await currentAccount();
  await closeActivitySyncTab(status.activityTabId);
  const latestEventAt = [
    status.lastEventAt ?? status.latestEventAt,
    patch.newestEventAt,
  ]
    .filter(Boolean).sort().at(-1) ?? null;
  if (!await lifelogStatus({
    state: 'running',
    stage: 'progress',
    events: patch.events,
    lastEventAt: latestEventAt,
    latestEventAt,
    activityTabId: null,
  }, runningSync(syncId, account))) return { updated: false };
  try {
    // No covering scan yet (new account, or every scan so far failed): read
    // the whole page once. Only a sync the user asked for may take the
    // foreground; the hourly automatic one stays hidden even if slower.
    const coverage = status.historyCoverage ?? null;
    const history = await startHistoryImport(coverage
      ? {
        active: false,
        mode: 'incremental',
        coveredSince: coverage.coveredSince,
        parentSyncId: syncId,
        account,
      }
      : {
        active: !status.automatic,
        mode: 'full',
        parentSyncId: syncId,
        account,
      });
    await lifelogStatus({ historyTabId: history.tabId }, runningSync(syncId));
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
  }, runningSync(status.syncId));
}

// Daily account-history sync is its own setting (autoSync); pausing
// watch-time recording (enabled) does not stop it, and vice versa.
async function maybeStartLifelogSync() {
  const config = await settings();
  if (!config.token || config.autoSync === false) return;
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

// The outgoing account's running scans end here: their statuses are marked
// cancelled in its own partition (a deep scan stays resumable) and their
// tabs are listed so the caller can stop and close them.
function stopRunningWork(history, lifelog) {
  const completedAt = new Date().toISOString();
  const tabs = [];
  let stoppedHistory = history;
  let stoppedLifelog = lifelog;
  if (history.state === 'running') {
    tabs.push([history.tabId, history.mode === 'deep' ? 'cancel-activity-sync' : 'cancel-history-import']);
    stoppedHistory = { ...history, state: 'cancelled', endReason: 'cancelled', completedAt, tabId: null, lastError: '' };
  }
  if (lifelog.state === 'running') {
    tabs.push([lifelog.activityTabId, 'cancel-activity-sync']);
    stoppedLifelog = {
      ...lifelog, state: 'cancelled', stage: 'idle', completedAt, activityTabId: null, historyTabId: null, lastError: '',
    };
  }
  return { history: stoppedHistory, lifelog: stoppedLifelog, tabs };
}

// Every change of connection goes through here (provisioning and the
// options page), so it is atomic with the queue and status writers.
// - Same account (token rotation, toggles, or a pre-2.1 connection now
//   identified): its queue and checkpoints stay, rebound to its key.
// - Another account: the current one's queue, checkpoints and statuses are
//   parked under its key without its token, its running work is cancelled,
//   and the incoming account gets back its own parked partition, or a fresh
//   one. Nothing moves between accounts.
// Recording toggles not given (provisioning) keep the account's own values.
async function applyConnection(input) {
  await storageReady;
  const before = await settings();
  const next = {
    endpoint: String(input.endpoint ?? ''),
    token: String(input.token ?? ''),
    googleAccount: String(input.googleAccount ?? ''),
    accountId: input.accountId == null ? '' : String(input.accountId),
    handle: String(input.handle ?? ''),
  };
  if (!next.token || !endpointOrigin(next.endpoint)) throw new Error('connection-settings');
  // A code typed into the options page carries no account id: ask the server.
  if (!next.accountId && !next.handle && next.token !== before.token) {
    const identity = await resolveIdentity(next.endpoint, next.token);
    if (identity) Object.assign(next, identity);
  }
  if (before.token && !sameAccount(before, next)) {
    accountEpoch += 1;
    accountAbort.abort();
    accountAbort = new AbortController();
  }
  const { switched, accountKey, closing, pending } = await withQueueLock(() => withStatusLock(async () => {
    const stored = await chrome.storage.local.get([SETTINGS_KEY, ACCOUNTS_KEY, ...ACCOUNT_STATE_KEYS]);
    const current = withDefaults(stored[SETTINGS_KEY]);
    const accounts = { ...(stored[ACCOUNTS_KEY] ?? {}) };
    let state = {
      queue: Array.isArray(stored[QUEUE_KEY]) ? stored[QUEUE_KEY] : [],
      status: stored[STATUS_KEY] ?? {},
      history: stored[HISTORY_STATUS_KEY] ?? {},
      lifelog: stored[LIFELOG_STATUS_KEY] ?? {},
    };
    // A first connection keeps what an unconnected install has.
    const same = !current.token || sameAccount(current, next);
    let previous = current;
    let owned = (item) => item.account === current.accountKey || (!current.token && !item.account);
    let closingTabs = [];
    if (!same) {
      const stopped = stopRunningWork(state.history, state.lifelog);
      closingTabs = stopped.tabs;
      if (current.accountKey) {
        accounts[current.accountKey] = {
          settings: { ...stored[SETTINGS_KEY], token: '' },
          [QUEUE_KEY]: state.queue,
          [STATUS_KEY]: state.status,
          [HISTORY_STATUS_KEY]: stopped.history,
          [LIFELOG_STATUS_KEY]: stopped.lifelog,
        };
      }
      const exactKey = await accountKeyFor(next);
      const parkedKey = exactKey in accounts
        ? exactKey
        : Object.keys(accounts).find((key) => sameAccount(accounts[key].settings, next));
      const parked = parkedKey ? accounts[parkedKey] : {};
      if (parkedKey) delete accounts[parkedKey];
      previous = withDefaults(parked.settings);
      owned = (item) => Boolean(parkedKey) && item.account === parkedKey;
      state = {
        queue: parked[QUEUE_KEY] ?? [],
        status: parked[STATUS_KEY] ?? {},
        history: parked[HISTORY_STATUS_KEY] ?? {},
        lifelog: parked[LIFELOG_STATUS_KEY] ?? {},
      };
    }
    const enabled = typeof input.enabled === 'boolean' ? input.enabled : previous.enabled;
    const autoSync = typeof input.autoSync === 'boolean' ? input.autoSync : previous.autoSync;
    const connected = {
      ...(same ? stored[SETTINGS_KEY] ?? {} : {}),
      endpoint: next.endpoint,
      token: next.token,
      googleAccount: next.googleAccount,
      accountId: next.accountId || previous.accountId,
      handle: next.handle || previous.handle,
      enabled,
      autoSync,
      // Counting restarts at a resume or a new account; sessions from before
      // are refused on receipt.
      recordingSince: !same || (enabled && !current.enabled)
        ? new Date().toISOString()
        : current.recordingSince,
    };
    connected.accountKey = await accountKeyFor(connected);
    const now = Date.now();
    // New credentials retry the account's own queue right away.
    const queue = state.queue.map((item) => owned(item)
      ? { ...item, account: connected.accountKey, nextAttemptAt: now }
      : item);
    await chrome.storage.local.set({
      [SETTINGS_KEY]: connected,
      [ACCOUNTS_KEY]: accounts,
      [QUEUE_KEY]: queue,
      [STATUS_KEY]: { ...state.status, configured: true, pending: queue.length },
      [HISTORY_STATUS_KEY]: state.history,
      [LIFELOG_STATUS_KEY]: state.lifelog,
      [RECORDING_KEY]: recordingView(connected),
    });
    return { switched: !same, accountKey: connected.accountKey, closing: closingTabs, pending: queue.length };
  }));
  for (const [tabId, type] of closing) {
    if (!Number.isInteger(tabId)) continue;
    await chrome.tabs.sendMessage(tabId, { type }).catch(() => {});
    await chrome.tabs.remove(tabId).catch(() => {});
  }
  await updateBadge(pending);
  await ensureAlarms();
  // Re-run the queue immediately: besides sending this account's pending
  // captures, it replaces a stale "token is not configured" status.
  await flushQueue();
  void maybeStartLifelogSync();
  return { switched, accountKey };
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
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ queued: false, error: String(error) }));
    return true;
  }
  // provision.js hands over the /extension-setup payload; the switch happens
  // here so it is atomic with queued and in-flight work.
  if (message?.type === 'provision' && message.payload) {
    applyConnection({
      endpoint: message.payload.endpoint,
      token: message.payload.token,
      googleAccount: message.payload.googleAccount,
      accountId: message.payload.accountId,
      handle: message.payload.handle,
    })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message?.type === 'settings-save' && message.settings) {
    applyConnection(message.settings)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
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
    startDeepHistoryImport()
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
    ownedScanAccount(message.payload.scanId)
      .then((account) => sendProgressBatch(message.payload, account))
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    return true;
  }
  if (message?.type === 'history-backfill-batch' && message.payload) {
    ownedScanAccount(message.payload.scanId)
      .then((account) => postSyncBatch(account, backfillEndpoint, message.payload, 'Backfill import failed'))
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    return true;
  }
  if (message?.type === 'activity-history-batch' && message.payload) {
    ownedScanAccount(message.payload.syncId)
      .then((account) => postSyncBatch(account, historyEndpoint, message.payload, 'History sync failed'))
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    return true;
  }
  if (message?.type === 'activity-sync-progress') {
    const operation = (async () => {
      if (message.purpose === 'deep-history') {
        const stored = await chrome.storage.local.get(HISTORY_STATUS_KEY);
        const status = stored[HISTORY_STATUS_KEY] ?? {};
        if (status.scanId !== message.syncId || status.state !== 'running' || status.mode !== 'deep') return;
        await historyStatus({
          stage: 'history',
          currentEvents: message.events,
          pass: message.pass,
          oldestEventAt: [status.oldestEventAt, message.oldestEventAt].filter(Boolean).sort().at(0) ?? null,
          newestEventAt: [status.newestEventAt, message.newestEventAt].filter(Boolean).sort().at(-1) ?? null,
        }, runningScan(message.syncId));
        return;
      }
      const stored = await chrome.storage.local.get(LIFELOG_STATUS_KEY);
      const status = stored[LIFELOG_STATUS_KEY] ?? {};
      if (status.syncId !== message.syncId || status.state !== 'running') return;
      await lifelogStatus({
        state: 'running',
        stage: 'activity',
        events: message.events,
        pass: message.pass,
        latestEventAt: message.newestEventAt ?? status.latestEventAt ?? null,
      }, runningSync(message.syncId));
    })();
    operation
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'activity-sync-complete') {
    const operation = message.purpose === 'deep-history'
      ? completeDeepHistoryRange(message)
      : completeActivitySync(message.syncId, {
        events: message.events,
        newestEventAt: message.newestEventAt,
      });
    operation
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch(async (error) => {
        if (message.purpose === 'deep-history') await failDeepHistoryImport(message.syncId, error);
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }
  if (message?.type === 'activity-sync-error') {
    const operation = message.purpose === 'deep-history'
      ? failDeepHistoryImport(message.syncId, String(message.error || 'Deep history segment failed'))
      : failLifelogSync(
        message.syncId,
        String(message.error || 'Google My Activity sync failed'),
      );
    operation
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'history-import-progress') {
    const operation = (async () => {
      // Only the scan still running for the connected account reports here.
      if (!await historyStatus({
        videos: message.videos,
        pass: message.pass,
      }, runningScan(message.scanId))) return;
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
        }, runningSync(history.parentSyncId));
      }
    })();
    operation
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'history-import-complete') {
    const failed = historyScanFailed(message.endReason);
    const diagnosis = message.error || historyScanFailureMessage(message.endReason);
    finishHistoryImport(message.scanId, {
      state: failed ? 'error' : 'complete',
      videos: message.videos,
      endReason: message.endReason ?? null,
      lastError: diagnosis,
    })
      .then(({ updated, tabId, parentSyncId, active }) => {
        sendResponse({ ok: true, updated });
        // A foreground failed read stays open: the page itself helps explain
        // a signed-out account or disabled history setting.
        if (!(active && failed)) void closeHistoryImportTab(tabId);
        if (updated && parentSyncId) {
          if (failed) void failLifelogSync(parentSyncId, diagnosis);
          else void finishLifelogSync(parentSyncId, message.videos);
        }
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  if (message?.type === 'history-import-error') {
    finishHistoryImport(message.scanId, {
      state: 'error',
      endReason: 'error',
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
  await storageReady;
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
        accountKey: '',
      },
      [RECORDING_KEY]: recordingView(withDefaults()),
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
  const stored = await chrome.storage.local.get(HISTORY_STATUS_KEY);
  const history = stored[HISTORY_STATUS_KEY] ?? {};
  if (history.state === 'running' && history.mode === 'deep') {
    await closeActivitySyncTab(history.tabId);
    await historyStatus({ state: 'error', tabId: null, lastError: 'Browser restarted; resuming saved history segments.' });
    void startDeepHistoryImport().catch(() => {});
  }
  void flushQueue();
  void maybeStartLifelogSync();
  void checkExtensionUpdate();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    // Normal segment completion clears tabId before closing. If the user or
    // Chrome closes the active tab first, preserve the active range so the
    // next click resumes it rather than starting over.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const stored = await chrome.storage.local.get(HISTORY_STATUS_KEY);
    const status = stored[HISTORY_STATUS_KEY] ?? {};
    if (status.state !== 'running' || status.mode !== 'deep' || status.tabId !== tabId) return;
    await historyStatus({
      state: 'error',
      tabId: null,
      completedAt: new Date().toISOString(),
      lastError: 'History scan tab closed. Click Rescan all history to resume.',
    });
  })();
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
