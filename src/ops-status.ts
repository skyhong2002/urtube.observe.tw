import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

export type OpsStatusName = 'backup' | 'worker';

export interface WorkerOpsStatus {
  lastStartedAt?: string;
  lastCompletedAt?: string;
  heartbeatAt?: string;
  running?: boolean;
  users?: number;
  failedUsers?: number;
  lastError?: string;
  // YouTube Data API requests this worker process made since the last quota
  // reset (one request = one quota unit). See youtubeApiUsage().
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
