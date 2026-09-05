// Rotates between several YouTube Data API keys. Quota is charged per Google
// Cloud project, so this only helps when the keys belong to different
// projects; within one project every key shares the same 10,000 daily units.
//
// The first key is always preferred. A key that answers 403 quotaExceeded is
// parked until the next YouTube quota reset (midnight Pacific time) and the
// next configured key takes over. Once every key is parked the caller sees
// the original quota error.

export interface YoutubeApiKeyPool {
  readonly size: number;
  /** First usable key in configuration order, or null when all are parked. */
  next(): string | null;
  /** Park a key until the next quota reset. */
  exhausted(key: string): void;
}

const PACIFIC = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', hourCycle: 'h23',
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
});

/** Epoch ms of the next YouTube Data API quota reset (00:00 America/Los_Angeles). */
export function nextYoutubeQuotaReset(now = Date.now()): number {
  const parts: Record<string, number> = {};
  for (const part of PACIFIC.formatToParts(new Date(now))) parts[part.type] = Number(part.value);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offset = localAsUtc - Math.floor(now / 1000) * 1000;
  return Date.UTC(parts.year, parts.month - 1, parts.day + 1) - offset;
}

export function parseYoutubeApiKeys(...values: Array<string | undefined>): string[] {
  const keys = values.flatMap((value) => (value ?? '').split(',')).map((key) => key.trim()).filter(Boolean);
  return [...new Set(keys)];
}

export function createYoutubeApiKeyPool(keys: readonly string[], clock: () => number = Date.now): YoutubeApiKeyPool {
  const ordered = parseYoutubeApiKeys(...keys);
  const parkedUntil = new Map<string, number>();
  return {
    size: ordered.length,
    next() {
      const now = clock();
      for (const key of ordered) {
        const until = parkedUntil.get(key);
        if (until === undefined) return key;
        if (until <= now) {
          parkedUntil.delete(key);
          return key;
        }
      }
      return null;
    },
    exhausted(key) {
      if (ordered.includes(key)) parkedUntil.set(key, nextYoutubeQuotaReset(clock()));
    },
  };
}

export function isYoutubeApiKeyPool(value: unknown): value is YoutubeApiKeyPool {
  return typeof value === 'object' && value !== null && typeof (value as YoutubeApiKeyPool).next === 'function';
}
