import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { Repository } from './data/database.js';

// Multi-tenant MVP: one small registry database maps hashed per-user tokens
// to a user, and each user owns a separate SQLite data file that reuses the
// single-user Repository unchanged. The default user (the instance owner)
// keeps the legacy env-token and env-data-key behaviour so a database
// migrated from Infovore keeps decrypting.

// The instance owner's handle; override with OWNER_HANDLE (e.g. skyhong.tw).
export const DEFAULT_HANDLE = process.env.OWNER_HANDLE ?? 'sky';

const HANDLE_PATTERN = /^[a-z0-9][a-z0-9.-]{1,31}$/;

export interface User {
  id: number;
  handle: string;
  displayName: string;
  dashboardPublic: boolean;
  dataKeyMode: 'legacy-env' | 'derived';
  keySeed: string;
  createdAt: string;
  googleSub: string | null;
  googleEmail: string | null;
}

export interface PendingSignup {
  sub: string;
  email: string;
}

export interface CreatedUser extends User {
  captureToken: string;
  dashboardToken: string;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(36).toString('base64url');
}

export function timingSafeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: Number(row.id),
    handle: String(row.handle),
    displayName: String(row.display_name),
    dashboardPublic: Number(row.dashboard_public) === 1,
    dataKeyMode: row.data_key_mode as User['dataKeyMode'],
    keySeed: String(row.key_seed ?? row.handle),
    createdAt: String(row.created_at),
    googleSub: row.google_sub == null ? null : String(row.google_sub),
    googleEmail: row.google_email == null ? null : String(row.google_email),
  };
}

export class UserRegistry {
  private readonly db: DatabaseSync;
  private readonly repositories = new Map<string, Repository>();
  private readonly dataDir: string;

  constructor(registryPath: string, dataDir?: string) {
    if (registryPath !== ':memory:') mkdirSync(dirname(registryPath), { recursive: true });
    this.dataDir = dataDir ?? (registryPath === ':memory:' ? ':memory:' : join(dirname(registryPath), 'users'));
    this.db = new DatabaseSync(registryPath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        handle TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        capture_token_hash TEXT NOT NULL UNIQUE,
        dashboard_token_hash TEXT NOT NULL UNIQUE,
        dashboard_public INTEGER NOT NULL DEFAULT 0,
        data_key_mode TEXT NOT NULL DEFAULT 'derived'
          CHECK (data_key_mode IN ('legacy-env', 'derived')),
        created_at TEXT NOT NULL
      );
    `);
    // key_seed freezes the derivation input at creation time so renaming a
    // user never changes their encryption key.
    const columns = this.db.prepare("SELECT name FROM pragma_table_info('users')").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'key_seed')) {
      this.db.exec('ALTER TABLE users ADD COLUMN key_seed TEXT');
    }
    this.db.exec('UPDATE users SET key_seed=handle WHERE key_seed IS NULL');
    // Google identity: sub is Google's permanent account id (emails can
    // change), unique so one Google account maps to at most one user.
    for (const name of ['google_sub', 'google_email']) {
      if (!columns.some((column) => column.name === name)) {
        this.db.exec(`ALTER TABLE users ADD COLUMN ${name} TEXT`);
      }
    }
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub
        ON users(google_sub) WHERE google_sub IS NOT NULL;
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      -- Single-use short-lived tokens for the login flow: 'oauth' rows are
      -- OAuth state values, 'pending' rows carry a verified Google identity
      -- that has not picked a handle yet.
      CREATE TABLE IF NOT EXISTS login_states (
        state TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('oauth', 'pending')),
        payload TEXT NOT NULL DEFAULT '',
        expires_at TEXT NOT NULL
      );
    `);
  }

  private expireLoginState(): void {
    this.db.prepare('DELETE FROM login_states WHERE expires_at < ?').run(new Date().toISOString());
  }

  close(): void {
    for (const repository of this.repositories.values()) repository.close();
    this.repositories.clear();
    this.db.close();
  }

  createUser(
    handle: string,
    displayName: string,
    options: {
      dataKeyMode?: User['dataKeyMode'];
      dashboardPublic?: boolean;
      googleSub?: string;
      googleEmail?: string;
    } = {},
  ): CreatedUser {
    if (!HANDLE_PATTERN.test(handle)) {
      throw new Error('Handle must be 2-32 chars of lowercase letters, digits, dots, or dashes');
    }
    const captureToken = newToken();
    const dashboardToken = newToken();
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO users (
        handle, display_name, capture_token_hash, dashboard_token_hash,
        dashboard_public, data_key_mode, key_seed, created_at, google_sub, google_email
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      handle, displayName, tokenHash(captureToken), tokenHash(dashboardToken),
      options.dashboardPublic ? 1 : 0, options.dataKeyMode ?? 'derived', handle, createdAt,
      options.googleSub ?? null, options.googleEmail ?? null,
    );
    const user = this.userByHandle(handle)!;
    return { ...user, captureToken, dashboardToken };
  }

  // The instance owner: legacy env tokens and the env data key map here, and
  // the migrated Infovore database is this user's data file.
  ensureDefaultUser(): User {
    const existing = this.userByHandle(DEFAULT_HANDLE);
    if (existing) return existing;
    const created = this.createUser(DEFAULT_HANDLE, config.ownerName, {
      dataKeyMode: 'legacy-env',
      dashboardPublic: true,
    });
    console.log(JSON.stringify({
      createdDefaultUser: created.handle,
      captureToken: created.captureToken,
      dashboardToken: created.dashboardToken,
      note: 'Store these tokens now; only hashes are kept. The legacy env YOUTUBE_CAPTURE_TOKEN also works for this user.',
    }));
    return created;
  }

  userByHandle(handle: string): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE handle=?').get(handle) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToUser(row) : null;
  }

  userByCaptureToken(token: string): User | null {
    if (!token) return null;
    // Legacy env token → default user, timing-safe like Infovore's check.
    if (config.youtube.captureToken && timingSafeEquals(token, config.youtube.captureToken)) {
      return this.ensureDefaultUser();
    }
    const row = this.db.prepare('SELECT * FROM users WHERE capture_token_hash=?')
      .get(tokenHash(token)) as Record<string, unknown> | undefined;
    return row ? rowToUser(row) : null;
  }

  userByDashboardToken(handle: string, token: string): User | null {
    if (!token) return null;
    const row = this.db.prepare('SELECT * FROM users WHERE handle=? AND dashboard_token_hash=?')
      .get(handle, tokenHash(token)) as Record<string, unknown> | undefined;
    return row ? rowToUser(row) : null;
  }

  listUsers(): User[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY id').all() as Array<Record<string, unknown>>;
    return rows.map(rowToUser);
  }

  deleteUser(handle: string): void {
    if (handle === DEFAULT_HANDLE) throw new Error('Refusing to delete the instance owner');
    const user = this.userByHandle(handle);
    if (!user) throw new Error(`Unknown user: ${handle}`);
    const repository = this.repositories.get(handle);
    if (repository) {
      repository.close();
      this.repositories.delete(handle);
    }
    this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    this.db.prepare('DELETE FROM users WHERE handle=?').run(handle);
    const path = this.databasePathFor(user);
    if (path !== ':memory:') {
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
    }
  }

  renameUser(oldHandle: string, newHandle: string): User {
    if (!HANDLE_PATTERN.test(newHandle)) {
      throw new Error('Handle must be 2-32 chars of lowercase letters, digits, dots, or dashes');
    }
    const user = this.userByHandle(oldHandle);
    if (!user) throw new Error(`Unknown user: ${oldHandle}`);
    if (this.userByHandle(newHandle)) throw new Error(`Handle already taken: ${newHandle}`);
    const repository = this.repositories.get(oldHandle);
    if (repository) {
      repository.close();
      this.repositories.delete(oldHandle);
    }
    // key_seed intentionally stays put: the encryption key must survive
    // renames. Only per-user data files move.
    const oldPath = this.databasePathFor(user);
    this.db.prepare('UPDATE users SET handle=? WHERE handle=?').run(newHandle, oldHandle);
    const renamed = this.userByHandle(newHandle)!;
    const newPath = this.databasePathFor(renamed);
    if (oldPath !== ':memory:' && newPath !== ':memory:' && oldPath !== newPath && existsSync(oldPath)) {
      for (const suffix of ['', '-wal', '-shm']) {
        if (existsSync(`${oldPath}${suffix}`)) renameSync(`${oldPath}${suffix}`, `${newPath}${suffix}`);
      }
    }
    return renamed;
  }

  userByGoogleSub(sub: string): User | null {
    if (!sub) return null;
    const row = this.db.prepare('SELECT * FROM users WHERE google_sub=?').get(sub) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToUser(row) : null;
  }

  linkGoogle(handle: string, sub: string, email: string): User {
    const user = this.userByHandle(handle);
    if (!user) throw new Error(`Unknown user: ${handle}`);
    const taken = this.userByGoogleSub(sub);
    if (taken && taken.id !== user.id) {
      throw new Error(`That Google account is already linked to another user`);
    }
    this.db.prepare('UPDATE users SET google_sub=?, google_email=? WHERE id=?').run(sub, email, user.id);
    return this.userByHandle(handle)!;
  }

  // --- Google login plumbing: OAuth states, pending signups, sessions ---

  createLoginState(): string {
    this.expireLoginState();
    const state = newToken();
    this.db.prepare("INSERT INTO login_states (state, kind, expires_at) VALUES (?, 'oauth', ?)")
      .run(state, new Date(Date.now() + 10 * 60_000).toISOString());
    return state;
  }

  consumeLoginState(state: string): boolean {
    if (!state) return false;
    this.expireLoginState();
    const changes = this.db.prepare("DELETE FROM login_states WHERE state=? AND kind='oauth'").run(state);
    return Number(changes.changes) === 1;
  }

  // A verified Google identity waiting for the user to pick a handle. The
  // returned token travels in an HttpOnly cookie, never in a URL.
  createPendingSignup(sub: string, email: string): string {
    this.expireLoginState();
    const token = newToken();
    this.db.prepare("INSERT INTO login_states (state, kind, payload, expires_at) VALUES (?, 'pending', ?, ?)")
      .run(token, JSON.stringify({ sub, email }), new Date(Date.now() + 30 * 60_000).toISOString());
    return token;
  }

  pendingSignup(token: string): PendingSignup | null {
    if (!token) return null;
    this.expireLoginState();
    const row = this.db.prepare("SELECT payload FROM login_states WHERE state=? AND kind='pending'")
      .get(token) as { payload: string } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.payload) as PendingSignup;
    return { sub: String(parsed.sub), email: String(parsed.email ?? '') };
  }

  consumePendingSignup(token: string): void {
    this.db.prepare("DELETE FROM login_states WHERE state=? AND kind='pending'").run(token);
  }

  createSession(user: User, ttlDays = 180): string {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
    const token = newToken();
    const now = new Date();
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash(token), user.id, now.toISOString(), new Date(now.getTime() + ttlDays * 86400_000).toISOString());
    return token;
  }

  userBySession(token: string): User | null {
    if (!token) return null;
    const row = this.db.prepare(`
      SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash=? AND sessions.expires_at >= ?
    `).get(tokenHash(token), new Date().toISOString()) as Record<string, unknown> | undefined;
    return row ? rowToUser(row) : null;
  }

  deleteSession(token: string): void {
    if (!token) return;
    this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token));
  }

  setDisplayName(handle: string, displayName: string): User {
    // Slice by code points so an 80-unit cut cannot split a surrogate pair.
    const trimmed = [...displayName.trim()].slice(0, 80).join('');
    if (!trimmed) throw new Error('A display name is required');
    const user = this.userByHandle(handle);
    if (!user) throw new Error(`Unknown user: ${handle}`);
    this.db.prepare('UPDATE users SET display_name=? WHERE id=?').run(trimmed, user.id);
    return { ...user, displayName: trimmed };
  }

  setDashboardPublic(handle: string, dashboardPublic: boolean): User {
    const user = this.userByHandle(handle);
    if (!user) throw new Error(`Unknown user: ${handle}`);
    this.db.prepare('UPDATE users SET dashboard_public=? WHERE id=?').run(dashboardPublic ? 1 : 0, user.id);
    return { ...user, dashboardPublic };
  }

  rotateTokens(handle: string): { captureToken: string; dashboardToken: string } {
    const user = this.userByHandle(handle);
    if (!user) throw new Error(`Unknown user: ${handle}`);
    const captureToken = newToken();
    const dashboardToken = newToken();
    this.db.prepare('UPDATE users SET capture_token_hash=?, dashboard_token_hash=? WHERE handle=?')
      .run(tokenHash(captureToken), tokenHash(dashboardToken), handle);
    return { captureToken, dashboardToken };
  }

  // Per-user search-encryption key. The default user keeps the raw env key so
  // ciphertext migrated from Infovore stays decryptable; other users get a
  // key derived from the env key and their handle, so no key material is
  // stored and users cannot decrypt each other's data.
  dataKeyFor(user: User): string {
    if (!config.youtube.privateDataKey) return '';
    if (user.dataKeyMode === 'legacy-env') return config.youtube.privateDataKey;
    return createHash('sha256')
      .update(`${config.youtube.privateDataKey}\u001f${user.keySeed}`)
      .digest('hex');
  }

  databasePathFor(user: User): string {
    if (this.dataDir === ':memory:') return ':memory:';
    // The default user uses the main database path (the migrated Infovore
    // data); everyone else gets their own file under data/users/.
    if (user.handle === DEFAULT_HANDLE) return config.databasePath;
    return join(this.dataDir, `${user.handle}.sqlite`);
  }

  repositoryFor(user: User): Repository {
    const key = user.handle;
    let repository = this.repositories.get(key);
    if (!repository) {
      repository = new Repository(this.databasePathFor(user));
      this.repositories.set(key, repository);
    }
    return repository;
  }
}
