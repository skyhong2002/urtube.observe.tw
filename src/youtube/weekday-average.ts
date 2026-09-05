const DAY = 86_400_000;
const TAIPEI_OFFSET = 8 * 3_600_000;

// Exposure in Taipei calendar days, Sunday first. Rolling windows prorate
// their partial boundary days, so exactly 28 days contains four of each day.
// Full-history windows include both endpoint dates and every inactive day.
export function weekdayExposure(start: string | null, end: string | null, wholeDates = false): number[] {
  const days = Array<number>(7).fill(0);
  if (!start || !end) return days;
  let from = Date.parse(start) + TAIPEI_OFFSET;
  let until = Date.parse(end) + TAIPEI_OFFSET;
  if (!Number.isFinite(from) || !Number.isFinite(until) || until < from) return days;
  if (wholeDates) {
    from = Math.floor(from / DAY) * DAY;
    until = (Math.floor(until / DAY) + 1) * DAY;
  }
  // Skip complete weeks, leaving at most eight calendar dates to inspect.
  const weeks = Math.floor((until - from) / (7 * DAY));
  days.fill(weeks);
  from += weeks * 7 * DAY;
  while (from < until) {
    const next = Math.min(until, (Math.floor(from / DAY) + 1) * DAY);
    days[new Date(from).getUTCDay()]! += (next - from) / DAY;
    from = next;
  }
  return days;
}
