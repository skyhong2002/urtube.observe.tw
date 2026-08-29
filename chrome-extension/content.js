(() => {
  const MIN_CAPTURE_SECONDS = 5;
  const FLUSH_INTERVAL_SECONDS = 30;
  const SESSION_PREFIX = 'urtubeYoutubeCapture:';
  let state = null;
  let boundVideo = null;
  let lastTickAt = performance.now();
  let lastMediaTime = 0;
  let historyImportCancelled = false;

  function videoIdFromLocation() {
    const url = new URL(location.href);
    if (url.pathname === '/watch') return url.searchParams.get('v');
    const match = url.pathname.match(/^\/(?:shorts|live)\/([A-Za-z0-9_-]{11})/);
    return match?.[1] ?? null;
  }

  function currentTitle() {
    const heading = document.querySelector(
      'ytd-watch-metadata h1 yt-formatted-string, ytd-watch-flexy h1 yt-formatted-string'
    );
    const title = heading?.textContent?.trim()
      || document.title.replace(/\s*-\s*YouTube\s*$/, '').trim();
    return title || 'YouTube video';
  }

  function currentChannel() {
    const channel = document.querySelector(
      'ytd-watch-metadata ytd-channel-name a, #owner #channel-name a, '
      + 'ytd-reel-player-header-renderer #channel-name'
    );
    return channel?.textContent?.trim() || null;
  }

  function storageKey(videoId) {
    return `${SESSION_PREFIX}${videoId}`;
  }

  function persistSession() {
    if (!state) return;
    sessionStorage.setItem(storageKey(state.videoId), JSON.stringify({
      ...state,
      updatedAt: new Date().toISOString(),
    }));
  }

  function restoredSession(videoId) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey(videoId)) ?? 'null');
      const age = Date.now() - Date.parse(saved?.updatedAt ?? '');
      if (
        saved?.videoId === videoId
        && typeof saved.sessionId === 'string'
        && age >= 0
        && age < 30 * 60_000
      ) {
        return {
          ...saved,
          actualSeconds: Number(saved.actualSeconds ?? 0),
          lastSentSeconds: Number(saved.lastSentSeconds ?? 0),
        };
      }
    } catch {
      // A corrupt per-tab cache should create a fresh session.
    }
    return null;
  }

  function ensureSession(video) {
    const videoId = videoIdFromLocation();
    if (!videoId) return null;
    if (state?.videoId === videoId) return state;
    flush(true);
    state = restoredSession(videoId) ?? {
      sessionId: crypto.randomUUID(),
      videoId,
      watchedAt: new Date().toISOString(),
      actualSeconds: 0,
      lastSentSeconds: 0,
    };
    lastTickAt = performance.now();
    lastMediaTime = video.currentTime;
    persistSession();
    return state;
  }

  function capturePayload(video) {
    if (!state) return null;
    const seconds = Math.floor(state.actualSeconds);
    if (seconds < MIN_CAPTURE_SECONDS) return null;
    return {
      sessionId: state.sessionId,
      videoId: state.videoId,
      title: currentTitle().slice(0, 500),
      url: `https://www.youtube.com/watch?v=${state.videoId}`,
      channelTitle: currentChannel(),
      watchedAt: state.watchedAt,
      actualWatchedSeconds: Math.min(86_400, seconds),
      durationSeconds: Number.isFinite(video?.duration)
        ? Math.max(1, Math.min(172_800, Math.round(video.duration)))
        : null,
    };
  }

  function flush(force = false) {
    if (!state || !boundVideo) return;
    const seconds = Math.floor(state.actualSeconds);
    if (!force && seconds - state.lastSentSeconds < FLUSH_INTERVAL_SECONDS) return;
    const payload = capturePayload(boundVideo);
    if (!payload || seconds <= state.lastSentSeconds) return;
    state.lastSentSeconds = seconds;
    persistSession();
    chrome.runtime.sendMessage({ type: 'capture', payload }).catch(() => {
      // The next periodic flush sends the latest cumulative value again.
      state.lastSentSeconds = Math.max(0, state.lastSentSeconds - FLUSH_INTERVAL_SECONDS);
      persistSession();
    });
  }

  function playingTick() {
    const now = performance.now();
    const elapsed = Math.max(0, (now - lastTickAt) / 1000);
    lastTickAt = now;
    if (
      !boundVideo
      || boundVideo.paused
      || boundVideo.ended
      || document.querySelector('.ad-showing')
    ) {
      lastMediaTime = boundVideo?.currentTime ?? 0;
      return;
    }
    ensureSession(boundVideo);
    if (!state) return;
    const mediaDelta = boundVideo.currentTime - lastMediaTime;
    lastMediaTime = boundVideo.currentTime;
    if (mediaDelta > 0) {
      const playbackRate = Math.max(0.1, boundVideo.playbackRate || 1);
      state.actualSeconds += Math.min(elapsed, mediaDelta / playbackRate);
    }
    if (Math.floor(state.actualSeconds) % 5 === 0) persistSession();
    flush(false);
  }

  function bindVideo() {
    const video = document.querySelector('video');
    if (!video || video === boundVideo) return;
    if (boundVideo) flush(true);
    boundVideo = video;
    lastTickAt = performance.now();
    lastMediaTime = video.currentTime;
    video.addEventListener('play', () => {
      ensureSession(video);
      lastTickAt = performance.now();
      lastMediaTime = video.currentTime;
    });
    video.addEventListener('pause', () => flush(true));
    video.addEventListener('ended', () => flush(true));
    if (!video.paused) ensureSession(video);
  }

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function progressFingerprint(item) {
    return [
      item.progressPercent ?? '',
      item.resumeSeconds ?? '',
      item.durationSeconds ?? '',
      item.watchedDate ?? '',
    ].join(':');
  }

  async function sendProgressBatch(scanId, observedAt, items, complete = false) {
    const payloadItems = items
      .filter((item) => item.progressPercent !== null || item.resumeSeconds !== null)
      .map((item) => ({
        videoId: item.videoId,
        progressPercent: item.progressPercent,
        resumeSeconds: item.resumeSeconds,
        durationSeconds: item.durationSeconds,
      }));
    if (!payloadItems.length && !complete) return { ok: true };
    const response = await chrome.runtime.sendMessage({
      type: 'history-progress-batch',
      payload: { scanId, observedAt, items: payloadItems, complete },
    });
    if (!response?.ok) throw new Error(response?.error || 'Progress batch was rejected');
    return response;
  }

  // Day-precision watch events for items whose date group resolved: noon
  // local time stands in for the unknown time-of-day.
  async function sendBackfillBatch(scanId, observedAt, items) {
    const payloadItems = items
      .filter((item) => item.watchedDate)
      .map((item) => {
        const [year, month, day] = item.watchedDate.split('-').map(Number);
        return {
          videoId: item.videoId,
          title: item.title || item.videoId,
          channelId: item.channelId,
          channelTitle: item.channelTitle,
          durationSeconds: item.durationSeconds,
          watchedAt: new Date(year, month - 1, day, 12).toISOString(),
        };
      });
    if (!payloadItems.length) return { ok: true };
    const response = await chrome.runtime.sendMessage({
      type: 'history-backfill-batch',
      payload: { scanId, observedAt, items: payloadItems },
    });
    if (!response?.ok) throw new Error(response?.error || 'Backfill batch was rejected');
    return response;
  }

  function queueHistoryLockups(node, pendingRoots) {
    if (!(node instanceof Element)) return;
    if (node.matches('yt-lockup-view-model')) pendingRoots.add(node);
    for (const root of node.querySelectorAll('yt-lockup-view-model')) {
      pendingRoots.add(root);
    }
  }

  async function runHistoryImport(scanId, observedAt, mode = 'full') {
    if (location.pathname !== '/feed/history') {
      throw new Error('History import must run on the YouTube History page');
    }
    historyImportCancelled = false;
    const sent = new Map();
    const pendingRoots = new Set();
    const historyObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) queueHistoryLockups(node, pendingRoots);
      }
    });
    historyObserver.observe(document.documentElement, { childList: true, subtree: true });
    for (const root of document.querySelectorAll('yt-lockup-view-model')) {
      pendingRoots.add(root);
    }
    let idlePasses = 0;
    const passLimit = mode === 'incremental' ? 120 : 900;
    const videoLimit = mode === 'incremental' ? 1_200 : Number.POSITIVE_INFINITY;
    const idleLimit = mode === 'incremental' ? 10 : 20;
    try {
      for (let pass = 0; pass < passLimit; pass++) {
        if (historyImportCancelled) throw new Error('History import cancelled');
        const roots = [...pendingRoots];
        pendingRoots.clear();
        const items = globalThis.urtubeYoutubeHistory.collectProgressFromRoots(roots);
        const changed = items.filter((item) => {
          const key = `${item.videoId}|${item.watchedDate ?? ''}`;
          const fingerprint = progressFingerprint(item);
          if (sent.get(key) === fingerprint) return false;
          sent.set(key, fingerprint);
          return true;
        });
        for (let index = 0; index < changed.length; index += 250) {
          const slice = changed.slice(index, index + 250);
          await sendProgressBatch(scanId, observedAt, slice);
          await sendBackfillBatch(scanId, observedAt, slice);
        }
        await chrome.runtime.sendMessage({
          type: 'history-import-progress',
          scanId,
          videos: sent.size,
          pass,
        });
        globalThis.urtubeYoutubeHistory.compactHistorySections(document);
        idlePasses = roots.length === 0 && changed.length === 0
          ? idlePasses + 1
          : 0;
        if (idlePasses >= idleLimit || sent.size >= videoLimit) break;
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
        await wait(700);
      }
    } finally {
      historyObserver.disconnect();
    }
    await sendProgressBatch(scanId, observedAt, [], true);
    return sent.size;
  }

  function handleNavigation() {
    const videoId = videoIdFromLocation();
    if (state && state.videoId !== videoId) {
      flush(true);
      state = null;
    }
    bindVideo();
  }

  document.addEventListener('yt-navigate-finish', handleNavigation);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
    lastTickAt = performance.now();
    lastMediaTime = boundVideo?.currentTime ?? 0;
  });
  window.addEventListener('pagehide', () => flush(true));
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'start-history-import') {
      runHistoryImport(message.scanId, message.observedAt, message.mode)
        .then((videos) => chrome.runtime.sendMessage({
          type: 'history-import-complete',
          scanId: message.scanId,
          videos,
        }))
        .catch((error) => chrome.runtime.sendMessage({
          type: 'history-import-error',
          scanId: message.scanId,
          error: error instanceof Error ? error.message : String(error),
        }));
      sendResponse({ ok: true, started: true });
      return false;
    }
    if (message?.type === 'cancel-history-import') {
      historyImportCancelled = true;
      sendResponse({ ok: true });
    }
    return false;
  });
  new MutationObserver(bindVideo).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  setInterval(playingTick, 1000);
  bindVideo();
})();
