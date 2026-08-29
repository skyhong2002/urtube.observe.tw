const SETTINGS_KEY = 'captureSettings';
const DEFAULT_ENDPOINT = 'https://urtube.observe.tw/api/ingest/youtube/capture';
const form = document.querySelector('#settings');
const endpoint = document.querySelector('#endpoint');
const token = document.querySelector('#token');
const enabled = document.querySelector('#enabled');
const autoSync = document.querySelector('#auto-sync');
const googleAccount = document.querySelector('#google-account');
const result = document.querySelector('#result');

async function load() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY] ?? {};
  endpoint.value = settings.endpoint ?? DEFAULT_ENDPOINT;
  token.value = settings.token ?? '';
  enabled.checked = settings.enabled ?? true;
  autoSync.checked = settings.autoSync ?? true;
  googleAccount.value = settings.googleAccount ?? '';
}

function values() {
  const url = new URL(endpoint.value);
  if (
    url.protocol !== 'https:'
    || url.hostname !== 'urtube.observe.tw'
    || url.pathname !== '/api/ingest/youtube/capture'
  ) {
    throw new Error('Endpoint must be https://urtube.observe.tw/api/ingest/youtube/capture');
  }
  const tokenValue = token.value.trim();
  if (tokenValue.length < 32) throw new Error('Capture token must contain at least 32 characters');
  const googleAccountValue = googleAccount.value.trim();
  if (googleAccountValue && !googleAccountValue.includes('@')) {
    throw new Error(urtubeT.googleAccountInvalid);
  }
  return {
    endpoint: url.toString().replace(/\/$/, ''),
    token: tokenValue,
    enabled: enabled.checked,
    autoSync: autoSync.checked,
    googleAccount: googleAccountValue,
  };
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: values() });
    result.textContent = urtubeT.saved;
    await chrome.runtime.sendMessage({ type: 'settings-updated' });
  } catch (error) {
    result.textContent = error instanceof Error ? error.message : String(error);
  }
});

document.querySelector('#test').addEventListener('click', async () => {
  try {
    const settings = values();
    result.textContent = urtubeT.testing;
    const statusUrl = settings.endpoint.replace(/\/capture$/, '/capture/status');
    const response = await fetch(statusUrl, {
      headers: { authorization: `Bearer ${settings.token}` },
    });
    if (!response.ok) throw new Error(`Connection failed: HTTP ${response.status}`);
    result.textContent = urtubeT.connectionReady;
  } catch (error) {
    result.textContent = error instanceof Error ? error.message : String(error);
  }
});

void load();
