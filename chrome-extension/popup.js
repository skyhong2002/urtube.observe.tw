function isNewerVersion(latest, current) {
  const a = String(latest ?? '').split('.').map(Number);
  const b = String(current ?? '').split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff > 0) return true;
    if (diff < 0) return false;
  }
  return false;
}

let actionError = '';

async function render() {
  const stored = await chrome.storage.local.get([
    'captureSettings',
    'captureQueue',
    'captureStatus',
    'historyImportStatus',
    'lifelogSyncStatus',
    'latestExtensionVersion',
  ]);
  const settings = stored.captureSettings ?? {};
  const status = stored.captureStatus ?? {};
  const history = stored.historyImportStatus ?? {};
  const lifelog = stored.lifelogSyncStatus ?? {};
  const configured = Boolean(settings.token);
  document.querySelector('#state').textContent = !settings.enabled
    ? urtubeT.paused
    : configured ? urtubeT.active : urtubeT.setupRequired;
  document.querySelector('#pending').textContent = String(
    status.pending ?? stored.captureQueue?.length ?? 0
  );
  document.querySelector('#last-sync').textContent = lifelog.lastSuccessAt
    ? new Date(lifelog.lastSuccessAt).toLocaleString()
    : urtubeT.never;
  // Provisioning can race the install-time background flush. Never show its
  // missing-token error after captureSettings already contains a token.
  const captureError = configured && status.lastError === 'Capture token is not configured'
    ? ''
    : status.lastError ?? '';
  const syncError = actionError || captureError || lifelog.lastError || history.lastError;
  document.querySelector('#error').textContent = urtubeErrorMessage(syncError);
  const latest = stored.latestExtensionVersion ?? '';
  const installed = chrome.runtime.getManifest().version;
  const updateDue = isNewerVersion(latest, installed);
  // Always name the build that is actually running: "which version am I on"
  // was previously only answerable from chrome://extensions.
  const versionTag = document.querySelector('#version');
  versionTag.textContent = updateDue ? `v${installed} \u2192 v${latest}` : `v${installed}`;
  versionTag.classList.toggle('outdated', updateDue);
  const updateBox = document.querySelector('#update');
  updateBox.hidden = !updateDue;
  if (updateDue) {
    const link = document.querySelector('#update-link');
    link.textContent = urtubeT.updateAvailable(latest);
    const origin = settings.endpoint ? new URL(settings.endpoint).origin : 'https://urtube.observe.tw';
    link.onclick = (event) => {
      event.preventDefault();
      void chrome.tabs.create({ url: `${origin}/account` });
    };
  }
  const historyButton = document.querySelector('#history');
  const running = history.state === 'running';
  historyButton.textContent = running ? urtubeT.cancelScan : urtubeT.rescanAll;
  historyButton.classList.toggle('danger', running);
  document.querySelector('#history-state').textContent = running
    ? history.mode === 'deep'
      ? urtubeT.deepHistoryProgress(
        Number(history.events ?? 0) + Number(history.currentEvents ?? 0),
      )
      : urtubeT.videos(history.videos ?? 0)
    : history.state === 'complete'
      ? urtubeT.historyResult(history.endReason, history.events ?? history.videos ?? 0)
      : history.state === 'error'
        ? urtubeT.importFailed
        : urtubeT.notImported;
  const lifelogRunning = lifelog.state === 'running';
  document.querySelector('#sync').textContent = lifelogRunning ? urtubeT.cancelSync : urtubeT.syncNow;
  document.querySelector('#lifelog-state').textContent = syncError
    ? urtubeT.syncFailed
    : lifelogRunning
      ? lifelog.stage === 'activity'
        ? urtubeT.events(lifelog.events ?? 0)
        : urtubeT.progressRows(lifelog.videos ?? 0)
      : lifelog.state === 'complete'
        ? urtubeT.upToDate
        : lifelog.state === 'error'
          ? urtubeT.syncFailed
          : urtubeT.notSynced;
}

async function runAction(statusKey, start, cancel) {
  actionError = '';
  try {
    const stored = await chrome.storage.local.get(statusKey);
    const running = stored[statusKey]?.state === 'running';
    const response = await chrome.runtime.sendMessage({ type: running ? cancel : start });
    if (!response?.ok) throw new Error(response?.error || 'Sync failed');
  } catch (error) {
    const stored = await chrome.storage.local.get(['captureStatus', statusKey]);
    // Persisted worker errors remain the source of truth, so recovery in
    // Settings can clear them while this popup is still open.
    if (!stored.captureStatus?.lastError && !stored[statusKey]?.lastError) {
      actionError = error instanceof Error ? error.message : String(error);
    }
  }
  await render();
}

document.querySelector('#sync').addEventListener('click', () => {
  return runAction('lifelogSyncStatus', 'lifelog-sync-start', 'lifelog-sync-cancel');
});
document.querySelector('#history').addEventListener('click', () => {
  return runAction('historyImportStatus', 'history-import-start', 'history-import-cancel');
});
document.querySelector('#options').addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

// Opening the popup is the moment the answer matters, so re-check instead of
// waiting for the hourly alarm. Web Store installs update themselves; unpacked
// ones cannot, so the best Chrome allows is telling you promptly.
void chrome.runtime.sendMessage({ type: 'extension-update-check' })
  .then(render)
  .catch(() => {});
void render();
window.setInterval(render, 1000);
