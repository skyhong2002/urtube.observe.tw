import { performance } from 'node:perf_hooks';

// Metadata-only timing for slow work: stage names, cache decisions, read kinds
// and durations. Never data values, handles, keys with user input, or paths.
export const SLOW_MS = 1000;

export function logTiming(event: string, fields: Record<string, string | number>): void {
  console.log(`[timing] ${event} ${Object.entries(fields).map(([name, value]) => `${name}=${value}`).join(' ')}`);
}

// Request stages: call mark(name) after each await; log() reports once if the
// whole request took longer than SLOW_MS.
export function stageTimer(event: string, fields: Record<string, string | number> = {}) {
  const started = performance.now();
  let last = started;
  const stages: Record<string, number> = {};
  return {
    mark(name: string) {
      const now = performance.now();
      stages[name] = Math.round((stages[name] ?? 0) + now - last);
      last = now;
    },
    log() {
      const total = Math.round(performance.now() - started);
      if (total >= SLOW_MS) logTiming(event, { ...fields, totalMs: total, ...Object.fromEntries(Object.entries(stages).map(([name, ms]) => [`${name}Ms`, ms])) });
    },
  };
}

// Reports request-thread stalls: a 250 ms timer that fires late by more than
// SLOW_MS means the thread was blocked (or not scheduled) for that long.
export function watchEventLoop(extra: () => Record<string, string | number> = () => ({})): void {
  let expected = performance.now() + 250;
  setInterval(() => {
    const now = performance.now();
    const late = now - expected;
    if (late >= SLOW_MS) logTiming('event-loop-stall', { lateMs: Math.round(late), ...extra() });
    expected = now + 250;
  }, 250).unref();
}
