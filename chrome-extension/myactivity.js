(() => {
  function parseDurationText(value) {
    const parts = String(value ?? '').trim().split(':').map(Number);
    if (parts.length < 2 || parts.length > 3 || parts.some(Number.isNaN)) return null;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }

  function timestampFromParts(dateValue, timeValue) {
    const dateMatch = String(dateValue ?? '').match(/^(\d{4})(\d{2})(\d{2})$/);
    const timeMatch = String(timeValue ?? '')
      .replace(/\u202f|\u00a0/g, ' ')
      .match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (!dateMatch || !timeMatch) return null;
    let hour = Number(timeMatch[1]);
    if (timeMatch[4]) {
      hour = hour % 12 + (timeMatch[4].toUpperCase() === 'PM' ? 12 : 0);
    }
    const date = new Date(
      Number(dateMatch[1]),
      Number(dateMatch[2]) - 1,
      Number(dateMatch[3]),
      hour,
      Number(timeMatch[2]),
      Number(timeMatch[3] ?? 0),
    );
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  // Chrome signed into several Google accounts pins a non-default account
  // onto an account-indexed path, so My Activity serves the same YouTube
  // page at both /product/youtube and /u/1/product/youtube.
  function isActivityPath(pathname) {
    return /^(?:\/u\/\d+)?\/product\/youtube\/?$/.test(String(pathname ?? ''));
  }

  function youtubeUrl(raw) {
    try {
      const url = new URL(raw);
      return /(^|\.)youtube\.com$/i.test(url.hostname) ? url : null;
    } catch {
      return null;
    }
  }

  function activityFromParts({ dateValue, timeText, links, durationText }) {
    const occurredAt = timestampFromParts(dateValue, timeText);
    if (!occurredAt) return null;
    const normalizedLinks = links.map((link) => ({
      ...link,
      url: youtubeUrl(link.href),
      text: String(link.text ?? '').trim(),
    })).filter((link) => link.url);
    const search = normalizedLinks.find((link) =>
      link.url.pathname === '/results' && link.url.searchParams.has('search_query')
    );
    if (search) {
      const query = search.text || search.url.searchParams.get('search_query')?.trim();
      return query ? { kind: 'search', occurredAt, query, activityType: 'search' } : null;
    }

    const video = normalizedLinks.find((link) =>
      link.url.pathname === '/watch'
      && /^[A-Za-z0-9_-]{11}$/.test(link.url.searchParams.get('v') ?? '')
      && !/^Play video\b/i.test(link.ariaLabel ?? '')
    );
    const post = normalizedLinks.find((link) => /^\/post\/[A-Za-z0-9_-]+$/.test(link.url.pathname));
    const target = video ?? post;
    if (!target) return null;
    const channel = normalizedLinks.find((link) => /^\/channel\/[^/]+$/.test(link.url.pathname));
    const videoId = video?.url.searchParams.get('v') ?? null;
    return {
      kind: 'watch',
      occurredAt,
      videoId,
      title: target.text || (videoId ? 'Unavailable video' : 'YouTube activity'),
      url: videoId
        ? `https://www.youtube.com/watch?v=${videoId}`
        : `https://www.youtube.com${target.url.pathname}`,
      channelId: channel?.url.pathname.split('/')[2] ?? null,
      channelTitle: channel?.text || null,
      durationSeconds: video ? parseDurationText(durationText) : null,
      activityType: video ? 'video' : 'post',
    };
  }

  function activityFromCard(card) {
    const container = card.closest?.('c-wiz[data-date]');
    const dateValue = container?.getAttribute('data-date');
    const timeText = card.querySelector?.('[jsname="vjl09e"]')?.textContent ?? '';
    const durationText = card.querySelector?.('[aria-label="Video duration"]')?.textContent ?? '';
    const links = [...(card.querySelectorAll?.('a[href]') ?? [])].map((link) => ({
      href: link.href,
      text: link.textContent,
      ariaLabel: link.getAttribute('aria-label'),
    }));
    return activityFromParts({ dateValue, timeText, links, durationText });
  }

  globalThis.urtubeYoutubeActivity = {
    activityFromCard,
    activityFromParts,
    isActivityPath,
    parseDurationText,
    timestampFromParts,
  };

  if (typeof chrome === 'undefined' || typeof document === 'undefined') return;

  let cancelled = false;
  const DEEP_HISTORY_EVENT_LIMIT = 2_000;
  const DEEP_HISTORY_MAX_PASSES = 200;

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function sendBatch(syncId, observedAt, events) {
    const response = await chrome.runtime.sendMessage({
      type: 'activity-history-batch',
      payload: { syncId, observedAt, events },
    });
    if (!response?.ok) throw new Error(response?.error || 'Activity batch was rejected');
  }

  async function runSync(syncId, observedAt, since, options = {}) {
    if (!isActivityPath(location.pathname)) {
      throw new Error('Activity sync must run on Google My Activity YouTube History');
    }
    cancelled = false;
    const cutoff = Date.parse(since);
    const sent = new Set();
    let newestEventAt = null;
    let oldestEventAt = null;
    let idlePasses = 0;
    let endReason = 'pass-limit';
    const deep = options.purpose === 'deep-history';
    const maximumPasses = deep ? DEEP_HISTORY_MAX_PASSES : 50;
    for (let pass = 0; pass < maximumPasses; pass++) {
      if (cancelled) throw new Error('Activity sync cancelled');
      const events = [...document.querySelectorAll('[role="listitem"]')]
        .map(activityFromCard)
        .filter(Boolean);
      const timestamps = events.map((event) => Date.parse(event.occurredAt))
        .filter(Number.isFinite);
      const remainingCapacity = deep
        ? Math.max(0, DEEP_HISTORY_EVENT_LIMIT - sent.size)
        : Number.POSITIVE_INFINITY;
      const changed = events.filter((event) => {
        if (Date.parse(event.occurredAt) < cutoff) return false;
        const identity = event.kind === 'search'
          ? `${event.kind}\u001f${event.query}\u001f${event.occurredAt}`
          : `${event.kind}\u001f${event.url}\u001f${event.occurredAt}`;
        return !sent.has(identity);
      }).slice(0, remainingCapacity);
      for (const event of changed) {
        const identity = event.kind === 'search'
          ? `${event.kind}\u001f${event.query}\u001f${event.occurredAt}`
          : `${event.kind}\u001f${event.url}\u001f${event.occurredAt}`;
        sent.add(identity);
        if (!newestEventAt || event.occurredAt > newestEventAt) newestEventAt = event.occurredAt;
        if (!oldestEventAt || event.occurredAt < oldestEventAt) oldestEventAt = event.occurredAt;
      }
      for (let index = 0; index < changed.length; index += 200) {
        await sendBatch(syncId, observedAt, changed.slice(index, index + 200));
      }
      await chrome.runtime.sendMessage({
        type: 'activity-sync-progress',
        syncId,
        events: sent.size,
        pass,
        newestEventAt,
        oldestEventAt,
        purpose: options.purpose ?? 'daily',
      });
      const oldestLoaded = timestamps.length ? Math.min(...timestamps) : Number.POSITIVE_INFINITY;
      if (oldestLoaded <= cutoff) {
        endReason = 'range-complete';
        break;
      }
      if (deep && sent.size >= DEEP_HISTORY_EVENT_LIMIT) {
        endReason = 'segment-limit';
        break;
      }
      const loadMore = document.querySelector('button[jsname="T8gEfd"]');
      if (!loadMore) {
        idlePasses++;
        if (idlePasses >= 3) {
          endReason = 'range-complete';
          break;
        }
      } else {
        idlePasses = 0;
        loadMore.click();
      }
      await wait(900);
    }
    return { events: sent.size, newestEventAt, oldestEventAt, endReason };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'start-activity-sync') {
      runSync(message.syncId, message.observedAt, message.since, {
        purpose: message.purpose,
      })
        .then((result) => chrome.runtime.sendMessage({
          type: 'activity-sync-complete',
          syncId: message.syncId,
          purpose: message.purpose ?? 'daily',
          range: message.range ?? null,
          ...result,
        }))
        .catch((error) => chrome.runtime.sendMessage({
          type: 'activity-sync-error',
          syncId: message.syncId,
          purpose: message.purpose ?? 'daily',
          range: message.range ?? null,
          error: error instanceof Error ? error.message : String(error),
        }));
      sendResponse({ ok: true, started: true });
      return false;
    }
    if (message?.type === 'cancel-activity-sync') {
      cancelled = true;
      sendResponse({ ok: true });
    }
    return false;
  });
})();
