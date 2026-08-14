(() => {
  function parseDurationText(value) {
    const parts = String(value ?? '').trim().split(':').map(Number);
    if (parts.length < 2 || parts.length > 3 || parts.some(Number.isNaN)) return null;
    return parts.reduce((total, part) => total * 60 + part, 0);
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
    if (progressPercent === null && resumeSeconds === null) return null;
    return {
      videoId,
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
      progressPercent,
      resumeSeconds,
      durationSeconds: current.durationSeconds ?? incoming.durationSeconds,
    };
  }

  function collectProgressFromRoots(roots) {
    const items = new Map();
    for (const root of roots) {
      const item = progressFromLockup(root);
      if (item) items.set(item.videoId, mergeProgress(items.get(item.videoId), item));
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

  globalThis.urtubeYoutubeHistory = {
    compactHistorySections,
    collectProgress,
    collectProgressFromRoots,
    mergeProgress,
    parseDurationText,
  };
})();
