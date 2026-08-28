async function render() {
  const stored = await chrome.storage.local.get([
    'captureSettings',
    'captureQueue',
    'captureStatus',
    'historyImportStatus',
    'lifelogSyncStatus',
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
  document.querySelector('#error').textContent = status.lastError ?? '';
  const historyButton = document.querySelector('#history');
  const running = history.state === 'running';
  historyButton.textContent = running ? urtubeT.cancelScan : urtubeT.fullScan;
  historyButton.classList.toggle('danger', running);
  document.querySelector('#history-state').textContent = running
    ? urtubeT.videos(history.videos ?? 0)
    : history.state === 'complete'
      ? urtubeT.importedVideos(history.videos ?? 0)
      : history.state === 'error'
        ? urtubeT.importFailed
        : urtubeT.notImported;
  if (history.lastError) document.querySelector('#error').textContent = history.lastError;
  const lifelogRunning = lifelog.state === 'running';
  document.querySelector('#sync').textContent = lifelogRunning ? urtubeT.cancelSync : urtubeT.syncNow;
  document.querySelector('#lifelog-state').textContent = lifelogRunning
    ? lifelog.stage === 'activity'
      ? urtubeT.events(lifelog.events ?? 0)
      : urtubeT.progressRows(lifelog.videos ?? 0)
    : lifelog.state === 'complete'
      ? urtubeT.upToDate
      : lifelog.state === 'error'
        ? urtubeT.syncFailed
        : urtubeT.notSynced;
  if (lifelog.lastError) document.querySelector('#error').textContent = lifelog.lastError;
}

document.querySelector('#sync').addEventListener('click', async () => {
  const stored = await chrome.storage.local.get('lifelogSyncStatus');
  const running = stored.lifelogSyncStatus?.state === 'running';
  await chrome.runtime.sendMessage({
    type: running ? 'lifelog-sync-cancel' : 'lifelog-sync-start',
  });
  await render();
});
document.querySelector('#history').addEventListener('click', async () => {
  const stored = await chrome.storage.local.get('historyImportStatus');
  const running = stored.historyImportStatus?.state === 'running';
  await chrome.runtime.sendMessage({
    type: running ? 'history-import-cancel' : 'history-import-start',
  });
  await render();
});
document.querySelector('#options').addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

void render();
window.setInterval(render, 1000);
