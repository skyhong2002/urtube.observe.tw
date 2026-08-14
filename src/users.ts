import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { Repository } from './data/database.js';

// Multi-tenant MVP: one small registry database maps hashed per-user tokens
// to a user, and each user owns a separate SQLite data file that reuses the
// single-user Repository unchanged. The default user (the instance owner)
// keeps the legacy env-token and env-data-key behaviour so a database
// migrated from Infovore keeps decrypting.

export const DEFAULT_HANDLE = 'sky';

export interface User {
  id: number;
  handle: string;
  displayName: string;
  dashboardPublic: boolean;
  dataKeyMode: 'legacy-env' | 'derived';
  createdAt: string;
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
    createdAt: String(row.created_at),
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
  }

  close(): void {
    for (const repository of this.repositories.values()) repository.close();
    this.repositories.clear();
    this.db.close();
  }

  createUser(
    handle: string,
    displayName: string,
    options: { dataKeyMode?: User['dataKeyMode']; dashboardPublic?: boolean } = {},
  ): CreatedUser {
    if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(handle)) {
      throw new Error('Handle must be 2-32 chars of lowercase letters, digits, or dashes');
    }
    const captureToken = newToken();
    const dashboardToken = newToken();
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO users (
        handle, display_name, capture_token_hash, dashboard_token_hash,
        dashboard_public, data_key_mode, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      handle, displayName, tokenHash(captureToken), tokenHash(dashboardToken),
      options.dashboardPublic ? 1 : 0, options.dataKeyMode ?? 'derived', createdAt,
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
      .update(`${config.youtube.privateDataKey}\u001f${user.handle}`)
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
