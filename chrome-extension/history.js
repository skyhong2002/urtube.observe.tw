(() => {
  function parseDurationText(value) {
    const parts = String(value ?? '').trim().split(':').map(Number);
    if (parts.length < 2 || parts.length > 3 || parts.some(Number.isNaN)) return null;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }

  // The history page groups lockups under date headers (今天/昨天/8月26日 or
  // Today/Yesterday/Aug 26[, 2024]/weekday names). Resolving a lockup's group
  // lets the scan emit day-precision watch events, not just progress.
  function parseHistoryDateLabel(text, now = new Date()) {
    const value = String(text ?? '').trim();
    if (!value) return null;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const iso = (date) => [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
    if (/^(今天|today)$/i.test(value)) return iso(today);
    if (/^(昨天|yesterday)$/i.test(value)) return iso(new Date(today.getTime() - 86_400_000));
    let match = value.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
    if (match) return iso(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    match = value.match(/^(\d{1,2})月(\d{1,2})日$/);
    if (match) {
      const candidate = new Date(now.getFullYear(), Number(match[1]) - 1, Number(match[2]));
      if (candidate > today) candidate.setFullYear(candidate.getFullYear() - 1);
      return iso(candidate);
    }
    match = value.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
    if (match) {
      const monthIndex = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
        .indexOf(match[1].slice(0, 3).toLowerCase());
      if (monthIndex === -1) return null;
      const candidate = new Date(match[3] ? Number(match[3]) : now.getFullYear(), monthIndex, Number(match[2]));
      if (!match[3] && candidate > today) candidate.setFullYear(candidate.getFullYear() - 1);
      return iso(candidate);
    }
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    let weekday = weekdays.indexOf(value.toLowerCase());
    const zhWeekday = value.match(/^(?:星期|週|周)([日一二三四五六])$/);
    if (zhWeekday) weekday = '日一二三四五六'.indexOf(zhWeekday[1]);
    if (weekday >= 0) {
      const diff = ((today.getDay() - weekday) + 7) % 7 || 7;
      return iso(new Date(today.getTime() - diff * 86_400_000));
    }
    return null;
  }

  function dateForLockup(root, now = new Date()) {
    const section = root.closest?.('ytd-item-section-renderer');
    const label = section?.querySelector?.('#title')?.textContent;
    return parseHistoryDateLabel(label, now);
  }

  function progressFromLockup(root) {
    const link = root.querySelector('h3 a[href*="/watch?v="], a[href*="/shorts/"]');
    if (!link) return null;
    const url = new URL(link.href, location.origin);
    const videoId = url.searchParams.get('v') || url.pathname.match(/^\/shorts\/([^/?]+)/)?.[1];
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId ?? '')) return null;
    const durationText = [...root.querySelectorAll('.ytBadgeShapeText')]
      .map((element) => element.textContent?.trim() ?? '')
      .find((text) => /^(?:\d+:){1,2}\d{2}$/.test(text));
    const durationSeconds = parseDurationText(durationText);
    const progressStyle = root.querySelector(
      '.ytThumbnailOverlayProgressBarHostWatchedProgressBarSegment'
    )?.getAttribute('style') ?? '';
    const progressMatch = progressStyle.match(/width:\s*([\d.]+)%/);
    const progressPercent = progressMatch
      ? Math.max(0, Math.min(100, Number(progressMatch[1])))
      : null;
    const resumeLink = root.querySelector('a[href*="/watch?v="][href*="t="]');
    const resumeUrl = resumeLink ? new URL(resumeLink.href, location.origin) : url;
    const resumeValue = resumeUrl.searchParams.get('t')?.replace(/s$/, '') ?? '';
    const resumeSeconds = /^\d+$/.test(resumeValue) ? Number(resumeValue) : null;
    const watchedDate = dateForLockup(root);
    // Items carry the watch even without a progress bar as long as the date
    // group resolved; with neither there is nothing to report.
    if (progressPercent === null && resumeSeconds === null && watchedDate === null) return null;
    const channelLink = root.querySelector('a[href^="/@"], a[href*="/channel/"]');
    const channelId = channelLink?.getAttribute?.('href')?.match(/\/channel\/(UC[A-Za-z0-9_-]{10,})/)?.[1] ?? null;
    return {
      videoId,
      title: link.textContent?.trim() || null,
      channelId,
      channelTitle: channelLink?.textContent?.trim() || null,
      watchedDate,
      progressPercent,
      resumeSeconds: durationSeconds === null || resumeSeconds === null
        ? resumeSeconds
        : Math.min(durationSeconds, resumeSeconds),
      durationSeconds,
    };
  }

  function mergeProgress(current, incoming) {
    if (!current) return incoming;
    const progressPercent = current.progressPercent === null
      ? incoming.progressPercent
      : incoming.progressPercent === null
        ? current.progressPercent
        : Math.max(current.progressPercent, incoming.progressPercent);
    const resumeSeconds = current.resumeSeconds === null
      ? incoming.resumeSeconds
      : incoming.resumeSeconds === null
        ? current.resumeSeconds
        : Math.max(current.resumeSeconds, incoming.resumeSeconds);
    return {
      videoId: current.videoId,
      title: current.title ?? incoming.title,
      channelId: current.channelId ?? incoming.channelId,
      channelTitle: current.channelTitle ?? incoming.channelTitle,
      watchedDate: current.watchedDate ?? incoming.watchedDate,
      progressPercent,
      resumeSeconds,
      durationSeconds: current.durationSeconds ?? incoming.durationSeconds,
    };
  }

  function collectProgressFromRoots(roots) {
    // Keyed per video AND day: the same video watched on several days must
    // become several day-precision events, while progress still merges.
    const items = new Map();
    for (const root of roots) {
      const item = progressFromLockup(root);
      if (!item) continue;
      const key = `${item.videoId}|${item.watchedDate ?? ''}`;
      items.set(key, mergeProgress(items.get(key), item));
    }
    return [...items.values()];
  }

  function collectProgress(documentRoot = document) {
    return collectProgressFromRoots(documentRoot.querySelectorAll('yt-lockup-view-model'));
  }

  function compactHistorySections(documentRoot = document, maximum = 80) {
    const sections = [...documentRoot.querySelectorAll(
      'ytd-item-section-renderer:not([data-urtube-compacted])'
    )];
    const expired = sections.slice(0, Math.max(0, sections.length - maximum));
    for (const section of expired) {
      const height = Math.max(
        1,
        Math.ceil(section.getBoundingClientRect?.().height ?? section.offsetHeight ?? 0),
      );
      section.replaceChildren();
      section.setAttribute('data-urtube-compacted', '');
      section.style.height = `${height}px`;
      section.style.minHeight = `${height}px`;
      section.style.contain = 'strict';
    }
    return expired.length;
  }

  // A daily sync may stop once the page reaches date groups the server has
  // already covered. The cutoff is the local day two days before the covering
  // scan ran: the day it ran is partial, and the overlap re-sends harmless
  // duplicates rather than risking a gap.
  const COVERAGE_OVERLAP_DAYS = 2;
  function coverageCutoffDay(coveredSince) {
    const at = Date.parse(coveredSince ?? '');
    if (!Number.isFinite(at)) return null;
    const date = new Date(at - COVERAGE_OVERLAP_DAYS * 86_400_000);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  }

  // Oldest and newest date groups seen so far; the page is newest-first, so
  // the oldest is what a coverage decision needs.
  function trackDateBounds(bounds, items) {
    for (const item of items) {
      if (!item.watchedDate) continue;
      if (!bounds.oldest || item.watchedDate < bounds.oldest) bounds.oldest = item.watchedDate;
      if (!bounds.newest || item.watchedDate > bounds.newest) bounds.newest = item.watchedDate;
    }
    return bounds;
  }

  // Local noon of a YYYY-MM-DD day as an ISO timestamp, matching the backfill
  // events' stand-in time-of-day.
  function dayTimestamp(day) {
    if (!day) return null;
    const [year, month, date] = day.split('-').map(Number);
    return new Date(year, month - 1, date, 12).toISOString();
  }

  // YouTube keeps a continuation renderer while another response can still
  // extend the history. An idle timer with that renderer present is a stall,
  // not proof that the account's oldest entry was reached. Be conservative:
  // an unnecessary rescan is recoverable; a false coverage frontier is not.
  function historyCompletionReason(documentRoot = document) {
    return documentRoot.querySelector('ytd-continuation-item-renderer')
      ? 'stalled'
      : 'history-start';
  }

  function historyPageProblem(documentRoot = document) {
    const text = String(documentRoot.body?.textContent ?? '');
    if (/watch history is (?:off|paused)|觀看紀錄(?:已)?(?:暫停|關閉)|暫停(?:了)?觀看紀錄/i.test(text)) {
      return 'history-paused';
    }
    if (/sign in to (?:see|view) your watch history|登入.*觀看紀錄|請先登入/i.test(text)) {
      return 'signed-out';
    }
    return null;
  }

  function historyLandedUrl(locationValue = location) {
    try {
      return `${locationValue.origin}${locationValue.pathname}`;
    } catch {
      return null;
    }
  }

  function historyScanDiagnostic(endReason) {
    const messages = {
      'history-paused': 'YouTube watch history is paused. Turn it on in YouTube History, then retry.',
      'signed-out': 'YouTube History is signed out. Sign in to the intended Google account, then retry.',
      'no-content': 'No YouTube history items appeared. Check that you are signed in and watch history is enabled, then retry.',
      stalled: 'YouTube stopped loading while more history was available. Retry to continue.',
      'segment-limit': 'Recent playback progress was saved at the safe tab limit. Use Rescan all history for the older archive.',
      'time-limit': 'The scan reached its safety time limit. Retry to continue.',
    };
    return messages[endReason] ?? null;
  }

  globalThis.urtubeYoutubeHistory = {
    compactHistorySections,
    coverageCutoffDay,
    dayTimestamp,
    historyCompletionReason,
    historyLandedUrl,
    historyPageProblem,
    historyScanDiagnostic,
    trackDateBounds,
    collectProgress,
    collectProgressFromRoots,
    mergeProgress,
    parseDurationText,
    parseHistoryDateLabel,
  };
})();
