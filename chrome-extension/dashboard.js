(() => {
  const control = document.querySelector('[data-youtube-import-control]');
  if (!control) return;
  const requestEvent = 'urtube-youtube-import-request';
  const statusEvent = 'urtube-youtube-import-status';

  function dispatchStatus(status) {
    control.dataset.extensionStatus = JSON.stringify(status);
    window.dispatchEvent(new Event(statusEvent));
  }

  async function emitStatus(extra = {}) {
    const stored = await chrome.storage.local.get([
      'historyImportStatus',
      'lifelogSyncStatus',
    ]);
    const history = stored.historyImportStatus ?? {};
    const status = stored.lifelogSyncStatus ?? {};
    dispatchStatus({
      extensionReady: true,
      state: status.state ?? 'idle',
      stage: status.stage ?? 'idle',
      events: Number(status.events ?? 0),
      videos: Number(status.videos ?? history.videos ?? 0),
      pass: Number(status.pass ?? history.pass ?? 0),
      lastSuccessAt: status.lastSuccessAt ?? null,
      nextSyncAt: status.nextSyncAt ?? null,
      lastError: String(status.lastError ?? ''),
      ...extra,
    });
  }

  window.addEventListener(requestEvent, () => {
    if (!chrome.runtime?.sendMessage) {
      dispatchStatus({
        extensionReady: false,
        state: 'error',
        lastError: 'Extension was updated. Reload this page and try again.',
      });
      return;
    }
    const action = control.dataset.importAction;
    const type = action === 'cancel'
      ? 'lifelog-sync-cancel'
      : 'lifelog-sync-start';
    chrome.runtime.sendMessage({ type })
      .then((response) => emitStatus(response?.ok
        ? {}
        : { state: 'error', lastError: response?.error || 'Import request failed' }))
      .catch((error) => emitStatus({
        state: 'error',
        lastError: error instanceof Error ? error.message : String(error),
      }));
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (
      areaName === 'local'
      && (changes.historyImportStatus || changes.lifelogSyncStatus)
    ) void emitStatus();
  });
  void emitStatus();
})();
