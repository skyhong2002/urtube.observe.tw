import type { TokenObservation } from './telemetry.js';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { digest, type Genre, type Profile } from './model.js';

export interface Preferences { genres: Genre[]; topics: { id: string; name: string; genres: Genre[] }[] }
export interface Job { userId: number; fingerprint: string; version: string; token: string; attempts: number }
export interface JobProgress { phase: 'classification' | 'embedding' | 'channels'; processed: number; total: number; genre?: Genre }
// Uses the existing registry connection, so snapshots/backups and user deletion
// include all v3 state. Constructor is called ONLY when v3 is enabled.
export class MatchingStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS matching_v3_worker_status (id INTEGER PRIMARY KEY CHECK(id=1), heartbeat INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS matching_v3_operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, items INTEGER NOT NULL,
        started_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL, error TEXT
      );
      CREATE TABLE IF NOT EXISTS matching_v3_cache (
        key TEXT PRIMARY KEY, value_json TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS matching_v3_cache_stats ON matching_v3_cache (
        CASE WHEN json_type(value_json)='array' THEN 'embedding'
          WHEN json_type(value_json,'$.assignments')='array' THEN 'classification' ELSE 'channel' END,
        created_at);
      CREATE TABLE IF NOT EXISTS matching_v3_api_budget (
        day TEXT PRIMARY KEY, calls INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS matching_v3_preferences (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        preferences_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS matching_v3_profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        profile_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS matching_v3_jobs (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        fingerprint TEXT NOT NULL, version TEXT NOT NULL,
        state TEXT NOT NULL, token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
    `);
    if (!db.prepare('PRAGMA table_info(matching_v3_operations)').all().some(row => row.name === 'valid_items')) db.exec('ALTER TABLE matching_v3_operations ADD COLUMN valid_items INTEGER');
    if (!db.prepare('PRAGMA table_info(matching_v3_operations)').all().some(row => row.name === 'usage_json')) db.exec('ALTER TABLE matching_v3_operations ADD COLUMN usage_json TEXT');
    if (!db.prepare('PRAGMA table_info(matching_v3_jobs)').all().some(row => row.name === 'progress_json')) {
      db.exec('ALTER TABLE matching_v3_jobs ADD COLUMN progress_json TEXT');
    }
  }
  operationUsage(id: number, value: TokenObservation): void {
    this.db.prepare('UPDATE matching_v3_operations SET usage_json=? WHERE id=?').run(JSON.stringify(value), id);
  }
  workerHeartbeat(): void {
    this.db.prepare('INSERT OR REPLACE INTO matching_v3_worker_status VALUES (1,?)').run(Date.now());
  }
  operationStart(kind: string, items: number): number {
    const result = this.db.prepare("INSERT INTO matching_v3_operations(kind,items,started_at,status) VALUES (?,?,?,'running')").run(kind, items, Date.now());
    // Amortize cleanup; retain recent completed requests for RPM/error inspection.
    if (Number(result.lastInsertRowid) % 256 === 0) this.db.prepare("DELETE FROM matching_v3_operations WHERE id < ? AND status != 'running' AND finished_at < ?")
      .run(Number(result.lastInsertRowid) - 2000, Date.now() - 300000);
    return Number(result.lastInsertRowid);
  }
  operationEnd(id: number, error: string | null = null, validItems?: number): void {
    this.db.prepare('UPDATE matching_v3_operations SET finished_at=?,status=?,error=?,valid_items=COALESCE(?,CASE WHEN ? IS NULL THEN items ELSE 0 END) WHERE id=?')
      .run(Date.now(), error ? validItems && validItems > 0 ? 'partial' : 'failed' : 'success', error, validItems ?? null, error, id);
  }
  monitoring() {
    return {
      heartbeat: this.db.prepare('SELECT heartbeat FROM matching_v3_worker_status WHERE id=1').get()?.heartbeat ?? null,
      cache: this.db.prepare(`SELECT CASE WHEN json_type(value_json)='array' THEN 'embedding'
        WHEN json_type(value_json,'$.assignments')='array' THEN 'classification' ELSE 'channel' END kind,
        count(*) count,max(created_at) latest FROM matching_v3_cache GROUP BY kind`).all(),
      budget: this.db.prepare('SELECT day,calls FROM matching_v3_api_budget WHERE day=?').get(new Date().toISOString().slice(0,10)) ?? { calls: 0 },
      operations: this.db.prepare('SELECT * FROM matching_v3_operations ORDER BY id DESC LIMIT 50').all(),
      recent: this.db.prepare(`SELECT kind,status,count(*) calls,sum(items) items,sum(COALESCE(valid_items,CASE WHEN status='success' THEN items ELSE 0 END)) valid_items,max(finished_at) latest,avg(finished_at-started_at) average_ms
        FROM matching_v3_operations WHERE started_at>=? GROUP BY kind,status`).all(Date.now()-300000),
    };
  }
  reserveApiCall(limit: number, now = new Date()): boolean {
    // Shared across worker processes and restarts; reset at midnight UTC.
    return Boolean(this.db.prepare(`INSERT INTO matching_v3_api_budget(day,calls) VALUES (?,1)
      ON CONFLICT(day) DO UPDATE SET calls=calls+1 WHERE ?=0 OR calls<? RETURNING calls`)
      .get(now.toISOString().slice(0, 10), limit, limit));
  }
  cache<T>(key: string, maxAge = Infinity): T | null {
    const row = this.db.prepare('SELECT value_json, created_at FROM matching_v3_cache WHERE key=?').get(key);
    return row && Date.now() - Number(row.created_at) <= maxAge ? JSON.parse(String(row.value_json)) as T : null;
  }
  putCache(key: string, value: unknown): void {
    this.db.prepare('INSERT OR REPLACE INTO matching_v3_cache VALUES (?, ?, ?)').run(key, JSON.stringify(value), Date.now());
  }
  preferences(userId: number): Preferences {
    const row = this.db.prepare('SELECT preferences_json FROM matching_v3_preferences WHERE user_id=?').get(userId);
    return row ? JSON.parse(String(row.preferences_json)) : { genres: [], topics: [] };
  }
  hasPreferences(userId: number): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM matching_v3_preferences WHERE user_id=?').get(userId));
  }
  savePreferences(userId: number, prefs: Preferences): void {
    this.db.prepare('INSERT OR REPLACE INTO matching_v3_preferences VALUES (?, ?)').run(userId, JSON.stringify(prefs));
    // Selection controls matching/disclosure, not precomputation. Routes check
    // current preferences on every result; changing a topic never deletes vectors.
  }
  profile(userId: number): Profile | null {
    const row = this.db.prepare('SELECT profile_json FROM matching_v3_profiles WHERE user_id=?').get(userId);
    return row ? JSON.parse(String(row.profile_json)) : null;
  }
  status(userId: number) {
    const row = this.db.prepare('SELECT state, attempts, error, retry_at, progress_json FROM matching_v3_jobs WHERE user_id=?').get(userId);
    if (!row) return null;
    return { state: String(row.state), attempts: Number(row.attempts), error: row.error === null ? null : String(row.error),
      retry_at: Number(row.retry_at), progress: row.progress_json ? JSON.parse(String(row.progress_json)) as JobProgress : null };
  }
  progress(job: Job, progress: JobProgress): void {
    this.db.prepare('UPDATE matching_v3_jobs SET progress_json=? WHERE user_id=? AND token=?')
      .run(JSON.stringify(progress), job.userId, job.token);
  }
  schedule(userId: number, fingerprint: string, version: string): void {
    this.db.prepare(`INSERT INTO matching_v3_jobs(user_id,fingerprint,version,state) VALUES (?,?,?,'queued')
      ON CONFLICT(user_id) DO UPDATE SET fingerprint=excluded.fingerprint, version=excluded.version,
      state='queued', token=NULL, lease_until=0, attempts=0, retry_at=0, error=NULL, progress_json=NULL
      WHERE fingerprint<>excluded.fingerprint OR version<>excluded.version`).run(userId, fingerprint, version);
  }
  claim(now = Date.now(), exclude: number[] = []): Job | null {
    const token = randomUUID();
    const row = this.db.prepare(`UPDATE matching_v3_jobs SET state='running', token=?, lease_until=?
      WHERE user_id=(SELECT user_id FROM matching_v3_jobs
        WHERE ((state='queued' AND retry_at<=?) OR (state='running' AND lease_until<?))
        AND user_id NOT IN (SELECT value FROM json_each(?))
        ORDER BY retry_at,user_id LIMIT 1) RETURNING *`).get(token, now + 180_000, now, now, JSON.stringify(exclude));
    return row ? { userId: Number(row.user_id), fingerprint: String(row.fingerprint), version: String(row.version), token, attempts: Number(row.attempts) } : null;
  }
  heartbeat(job: Job): void {
    const result = this.db.prepare("UPDATE matching_v3_jobs SET lease_until=? WHERE user_id=? AND token=? AND state='running'").run(Date.now() + 180_000, job.userId, job.token);
    if (!result.changes) throw new Error('Job superseded');
  }
  publishPreview(userId: number, profile: Profile): boolean {
    if (profile.complete) throw new Error('Preview must be provisional');
    // Never replace a current profile published by the worker during computation.
    const result = this.db.prepare(`INSERT INTO matching_v3_profiles(user_id,profile_json) VALUES (?,?)
      ON CONFLICT(user_id) DO UPDATE SET profile_json=excluded.profile_json
      WHERE json_extract(matching_v3_profiles.profile_json,'$.version') != json_extract(excluded.profile_json,'$.version')`)
      .run(userId, JSON.stringify(profile));
    return Boolean(result.changes);
  }
  finish(job: Job, profile: Profile): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare("UPDATE matching_v3_jobs SET state='done', token=NULL, error=NULL WHERE user_id=? AND token=? AND fingerprint=? AND version=? AND state='running'").run(job.userId, job.token, job.fingerprint, job.version);
      if (result.changes) this.db.prepare('INSERT OR REPLACE INTO matching_v3_profiles VALUES (?,?)').run(job.userId, JSON.stringify(profile));
      this.db.exec('COMMIT');
      return Boolean(result.changes);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  defer(job: Job, error: string | null, permanent = false, retryAt?: number): void {
    const delay = error ? Math.min(3600_000, 30_000 * 2 ** Math.min(job.attempts, 7)) : 0;
    this.db.prepare(`UPDATE matching_v3_jobs SET state=?, token=NULL, retry_at=?, attempts=attempts+?, error=?
      WHERE user_id=? AND token=?`).run(permanent ? 'failed' : 'queued', retryAt ?? Date.now() + delay,
        error && error !== 'daily_budget_reached' ? 1 : 0, error, job.userId, job.token);
  }
  queuedWorkDelay(now = Date.now(), idlePollMs = 5000): number | null {
    const row = this.db.prepare("SELECT min(retry_at) ready_at FROM matching_v3_jobs WHERE state='queued'").get();
    return row?.ready_at == null ? null : Math.min(idlePollMs, Math.max(0, Number(row.ready_at) - now));
  }
  nextWorkDelay(now = Date.now(), idlePollMs = 5000): number {
    const row = this.db.prepare(`SELECT min(CASE WHEN state='queued' THEN retry_at ELSE lease_until END) ready_at
      FROM matching_v3_jobs WHERE state IN ('queued','running')`).get();
    return row?.ready_at == null ? idlePollMs : Math.min(idlePollMs, Math.max(0, Number(row.ready_at) - now));
  }
  retry(userId: number): void {
    this.db.prepare("UPDATE matching_v3_jobs SET state='queued', attempts=0, retry_at=0, error=NULL WHERE user_id=? AND state IN ('failed','done','queued')").run(userId);
  }
}
// Channel descriptions can change independently of imported video metadata.
// Revisit their cache daily; successful public classification has a 30-day TTL.
export const sourceKey = (fingerprint: string, prefs: Preferences) => digest([
  fingerprint, [...prefs.genres].sort(), prefs.genres.includes('channel type') ? Math.floor(Date.now() / 86400_000) : null,
]);
