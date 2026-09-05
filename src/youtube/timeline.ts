import type { YoutubeRange } from './types.js';

const DAY = 86_400_000;
export function taipeiDate(value: string | Date): string {
  return new Date(new Date(value).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

// Weeks start on Monday in Taiwan; boundary buckets retain their actual dates.
export function timelineWindow(range: YoutubeRange, now: Date, firstWatchAt: string | null) {
  const weekly = range !== '7d' && range !== '28d';
  const start = range === 'all' ? firstWatchAt ?? now.toISOString()
    : new Date(now.getTime() - Number.parseInt(range, 10) * DAY).toISOString();
  const end = now.toISOString();
  const cursor = new Date(`${taipeiDate(start)}T00:00:00Z`);
  if (weekly) cursor.setUTCDate(cursor.getUTCDate() - (cursor.getUTCDay() + 6) % 7);
  const periods: string[] = [];
  while (cursor.toISOString().slice(0, 10) <= taipeiDate(end)) {
    periods.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + (weekly ? 7 : 1));
  }
  return { start, end, periods, weekly, smoothing: weekly ? 3 : 7 };
}

export function timelineBounds(window: ReturnType<typeof timelineWindow>, period: string) {
  const last = new Date(`${period}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() + (window.weekly ? 6 : 0));
  return {
    start: period < taipeiDate(window.start) ? taipeiDate(window.start) : period,
    end: last.toISOString().slice(0, 10) > taipeiDate(window.end)
      ? taipeiDate(window.end) : last.toISOString().slice(0, 10),
  };
}
