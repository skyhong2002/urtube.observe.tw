// One-click provisioning bridge for /extension-setup: the page puts the
// payload (endpoint + capture token + Google account + account id) into a
// dataset attribute and fires an event; we hand it to the background worker,
// which switches accounts atomically, kick off the first sync, and report
// back through the same dataset — the token never crosses via postMessage
// and never leaves this tab.
(() => {
  const root = document.querySelector('[data-urtube-provision]');
  if (!root) return;
  root.dataset.extensionReady = '1';
  window.dispatchEvent(new Event('urtube-extension-ready'));

  window.addEventListener('urtube-provision-request', async () => {
    try {
      const payload = JSON.parse(root.dataset.provisionPayload || '{}');
      root.dataset.provisionPayload = '';
      if (!payload.token || !payload.endpoint) throw new Error('empty provision payload');
      const response = await chrome.runtime.sendMessage({
        type: 'provision',
        payload: {
          endpoint: String(payload.endpoint),
          token: String(payload.token),
          googleAccount: String(payload.googleAccount ?? ''),
          accountId: payload.accountId == null ? '' : String(payload.accountId),
          handle: String(payload.handle ?? ''),
        },
      });
      if (!response?.ok) throw new Error(response?.error || 'provisioning was rejected');
      // First taste of data right away: start the account-history sync.
      try {
        await chrome.runtime.sendMessage({ type: 'lifelog-sync-start' });
      } catch {
        // A sync may already be running; provisioning still succeeded.
      }
      root.dataset.provisioned = '1';
      window.dispatchEvent(new Event('urtube-provision-done'));
    } catch (error) {
      root.dataset.provisionError = error instanceof Error ? error.message : String(error);
      window.dispatchEvent(new Event('urtube-provision-error'));
    }
  });
})();
