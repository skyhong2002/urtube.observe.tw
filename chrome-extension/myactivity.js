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
    parseDurationText,
    timestampFromParts,
  };

  if (typeof chrome === 'undefined' || typeof document === 'undefined') return;

  let cancelled = false;

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

  async function runSync(syncId, observedAt, since) {
    if (location.pathname !== '/product/youtube') {
      throw new Error('Activity sync must run on Google My Activity YouTube History');
    }
    cancelled = false;
    const cutoff = Date.parse(since);
    const sent = new Set();
    let newestEventAt = null;
    let idlePasses = 0;
    for (let pass = 0; pass < 50; pass++) {
      if (cancelled) throw new Error('Activity sync cancelled');
      const events = [...document.querySelectorAll('[role="listitem"]')]
        .map(activityFromCard)
        .filter(Boolean);
      const timestamps = events.map((event) => Date.parse(event.occurredAt))
        .filter(Number.isFinite);
      const changed = events.filter((event) => {
        if (Date.parse(event.occurredAt) < cutoff) return false;
        const identity = event.kind === 'search'
          ? `${event.kind}\u001f${event.query}\u001f${event.occurredAt}`
          : `${event.kind}\u001f${event.url}\u001f${event.occurredAt}`;
        if (sent.has(identity)) return false;
        sent.add(identity);
        if (!newestEventAt || event.occurredAt > newestEventAt) newestEventAt = event.occurredAt;
        return true;
      });
      for (let index = 0; index < changed.length; index += 200) {
        await sendBatch(syncId, observedAt, changed.slice(index, index + 200));
      }
      await chrome.runtime.sendMessage({
        type: 'activity-sync-progress',
        syncId,
        events: sent.size,
        pass,
        newestEventAt,
      });
      const oldestLoaded = timestamps.length ? Math.min(...timestamps) : Number.POSITIVE_INFINITY;
      if (oldestLoaded <= cutoff) break;
      const loadMore = document.querySelector('button[jsname="T8gEfd"]');
      if (!loadMore) {
        idlePasses++;
        if (idlePasses >= 3) break;
      } else {
        idlePasses = 0;
        loadMore.click();
      }
      await wait(900);
    }
    return { events: sent.size, newestEventAt };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'start-activity-sync') {
      runSync(message.syncId, message.observedAt, message.since)
        .then((result) => chrome.runtime.sendMessage({
          type: 'activity-sync-complete',
          syncId: message.syncId,
          ...result,
        }))
        .catch((error) => chrome.runtime.sendMessage({
          type: 'activity-sync-error',
          syncId: message.syncId,
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
