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
    ? 'Capture paused'
    : configured ? 'Capture active' : 'Setup required';
  document.querySelector('#pending').textContent = String(
    status.pending ?? stored.captureQueue?.length ?? 0
  );
  document.querySelector('#last-sync').textContent = lifelog.lastSuccessAt
    ? new Date(lifelog.lastSuccessAt).toLocaleString()
    : 'Never';
  document.querySelector('#error').textContent = status.lastError ?? '';
  const historyButton = document.querySelector('#history');
  const running = history.state === 'running';
  historyButton.textContent = running ? 'Cancel scan' : 'Full progress scan';
  historyButton.classList.toggle('danger', running);
  document.querySelector('#history-state').textContent = running
    ? `${history.videos ?? 0} videos`
    : history.state === 'complete'
      ? `${history.videos ?? 0} imported`
      : history.state === 'error'
        ? 'Import failed'
        : 'Not imported';
  if (history.lastError) document.querySelector('#error').textContent = history.lastError;
  const lifelogRunning = lifelog.state === 'running';
  document.querySelector('#sync').textContent = lifelogRunning ? 'Cancel sync' : 'Sync now';
  document.querySelector('#lifelog-state').textContent = lifelogRunning
    ? lifelog.stage === 'activity'
      ? `${lifelog.events ?? 0} events`
      : `${history.videos ?? 0} progress rows`
    : lifelog.state === 'complete'
      ? 'Up to date'
      : lifelog.state === 'error'
        ? 'Sync failed'
        : 'Not synced';
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
