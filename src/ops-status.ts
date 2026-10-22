import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

export type OpsStatusName = 'backup' | 'worker' | 'matching';

export interface WorkerOpsStatus {
  lastStartedAt?: string;
  lastCompletedAt?: string;
  heartbeatAt?: string;
  running?: boolean;
  users?: number;
  failedUsers?: number;
  lastError?: string;
  // Longest stall of the YouTube worker thread's event loop in the recent
  // window, and when it was seen. The supervisor publishes heartbeats from
  // its own loop, so a large value here no longer implies a stale heartbeat.
  eventLoopMaxDelayMs?: number;
  eventLoopMaxDelayAt?: string;
  // YouTube Data API requests this worker process made since the last quota
  // reset (one request = one quota unit). See youtubeApiUsage().
  youtubeApiRequestsSinceReset?: number;
  youtubeApiQuotaResetAt?: string;
}

// Published by the matching worker, which shares the YouTube API keys.
export interface MatchingOpsStatus {
  heartbeatAt?: string;
  youtubeApiRequestsSinceReset?: number;
  youtubeApiQuotaResetAt?: string;
}

export const WORKER_HEARTBEAT_INTERVAL_MS = 30_000;
export const WORKER_HEARTBEAT_MAX_AGE_MS = 2 * 60_000;
export const WORKER_COMPLETION_MAX_AGE_MS = 3 * 3600_000;

function statusPath(name: OpsStatusName): string {
  return join(config.opsStatusDirectory, `${name}-status.json`);
}

export function readOpsStatus<T>(name: OpsStatusName): T | null {
  try {
    return JSON.parse(readFileSync(statusPath(name), 'utf8')) as T;
  } catch {
    return null;
  }
}

export function writeOpsStatus(name: OpsStatusName, value: unknown): void {
  mkdirSync(config.opsStatusDirectory, { recursive: true });
  const path = statusPath(name);
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

// A new catch-up cycle must retain the last successful completion while it
// publishes liveness. There is one writer per status name in production, so
// this read/merge/atomic-write sequence cannot race another worker writer.
export function patchOpsStatus<T extends object>(
  name: OpsStatusName,
  patch: Partial<T>,
): T {
  const next = { ...(readOpsStatus<T>(name) ?? {} as T), ...patch } as T;
  writeOpsStatus(name, next);
  return next;
}

export const EVENT_LOOP_DELAY_WINDOW_MS = 15 * 60_000;

// Measures how late a fixed-interval timer fires. perf_hooks'
// monitorEventLoopDelay did not reflect long synchronous blocks in
// production (it reported 0), so the worker uses this explicit drift probe.
export class EventLoopLagProbe {
  private last: number;
  private maxLagMs = 0;

  constructor(readonly intervalMs = 1_000, private readonly now = Date.now) {
    this.last = now();
  }

  tick(): void {
    const at = this.now();
    this.maxLagMs = Math.max(this.maxLagMs, at - this.last - this.intervalMs);
    this.last = at;
  }

  // Worst lag since the previous take, including a block still in progress
  // when a status write runs before the next tick.
  take(): number {
    const at = this.now();
    const pending = at - this.last - this.intervalMs;
    const worst = Math.max(0, this.maxLagMs, pending);
    this.maxLagMs = 0;
    // A block already reported must not be reported again by later writes
    // in the same burst; the next tick measures only the remainder.
    if (pending > 0) this.last = at;
    return Math.round(worst);
  }
}

// Keeps the worst stall for a while so a heartbeat written right after an
// unblock does not immediately overwrite the evidence with a small value.
export function nextEventLoopDelay(
  previous: { ms: number; at: number } | null,
  observedMs: number,
  now: number,
): { ms: number; at: number } {
  if (!previous || now - previous.at > EVENT_LOOP_DELAY_WINDOW_MS || observedMs >= previous.ms) {
    return { ms: observedMs, at: now };
  }
  return previous;
}

function fresh(iso: string | undefined, maxAgeMs: number, now: number): boolean {
  if (!iso) return false;
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= maxAgeMs;
}

export function workerOpsReady(status: WorkerOpsStatus | null, now = Date.now()): boolean {
  if (!status || status.lastError || (status.failedUsers ?? 0) > 0) return false;
  if (status.running) return fresh(status.heartbeatAt, WORKER_HEARTBEAT_MAX_AGE_MS, now);
  return fresh(status.lastCompletedAt, WORKER_COMPLETION_MAX_AGE_MS, now);
}
