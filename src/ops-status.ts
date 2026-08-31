import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

export type OpsStatusName = 'backup' | 'worker';

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
