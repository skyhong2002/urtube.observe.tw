const DAY_MS = 86_400_000;

export const YOUTUBE_HISTORY_EARLIEST = '2005-04-23T00:00:00.000Z';
export const DEEP_HISTORY_WINDOW_DAYS = 90;

export function buildDeepHistoryRanges(
  now = new Date(),
  earliest = new Date(YOUTUBE_HISTORY_EARLIEST),
  windowDays = DEEP_HISTORY_WINDOW_DAYS,
) {
  const endLimit = now.getTime();
  const startLimit = earliest.getTime();
  if (!Number.isFinite(endLimit) || !Number.isFinite(startLimit) || endLimit <= startLimit) return [];
  const windowMs = Math.max(1, Math.floor(windowDays)) * DAY_MS;
  const ranges = [];
  let end = endLimit;
  while (end > startLimit) {
    const start = Math.max(startLimit, end - windowMs);
    ranges.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
    end = start;
  }
  return ranges;
}

export function splitDeepHistoryRange(range) {
  const start = Date.parse(range?.start ?? '');
  const end = Date.parse(range?.end ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start <= DAY_MS) return [];
  const middle = start + Math.floor((end - start) / 2);
  const split = new Date(middle).toISOString();
  return [
    { start: range.start, end: split },
    { start: split, end: range.end },
  ];
}

export function myActivityRangeUrl(range, googleAccount = '') {
  const start = Date.parse(range.start);
  const end = Date.parse(range.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new Error('Invalid deep-history date range');
  }
  const url = new URL('https://myactivity.google.com/product/youtube');
  // My Activity's calendar filter uses epoch microseconds. Treat ranges as
  // [start, end), subtracting one microsecond prevents adjacent overlap.
  url.searchParams.set('min', String(start * 1000));
  url.searchParams.set('max', String(end * 1000 - 1));
  if (googleAccount) url.searchParams.set('authuser', googleAccount);
  return url.toString();
}
