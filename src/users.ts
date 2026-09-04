import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { Repository } from './data/database.js';
import {
  MATCHING_DISCLOSURE_LEVELS,
  type MatchingDisclosureLevel,
} from './youtube/disclosure.js';
import {
  resolveMatchingDimensions,
  validateMatchingDimensions,
  type MatchingDimensions,
  type StoredMatchingDimensions,
} from './youtube/dimensions.js';
import { MATCHING_TAXONOMY } from './youtube/matching.js';
import {
  parseRegistryMatchingCrystal,
  REGISTRY_CRYSTAL_VERSION,
  registryCrystalEligible,
  type RegistryMatchingCrystal,
} from './youtube/registry-crystal.js';

// Multi-tenant MVP: one small registry database maps hashed per-user tokens
// to a user, and each user owns a separate SQLite data file that reuses the
// single-user Repository unchanged. The default user (the instance owner)
// keeps the legacy env-token and env-data-key behaviour so a database
// migrated from Infovore keeps decrypting.

// The instance owner's handle; override with OWNER_HANDLE (e.g. skyhong.tw).
export const DEFAULT_HANDLE = process.env.OWNER_HANDLE ?? 'sky';

const HANDLE_PATTERN = /^[a-z0-9][a-z0-9.-]{1,31}$/;
export type { MatchingDisclosureLevel } from './youtube/disclosure.js';

export interface User {
  id: number;
  handle: string;
  displayName: string;
  dashboardPublic: boolean;
  matchingOptIn: boolean;
  matchingDisclosure: MatchingDisclosureLevel;
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

export interface MatchableCrystal {
  userId: number;
  handle: string;
  displayName: string;
  disclosureLevel: MatchingDisclosureLevel;
  crystal: RegistryMatchingCrystal;
  dimensions: MatchingDimensions;
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
    matchingOptIn: Number(row.matching_opt_in) === 1,
    matchingDisclosure: row.matching_disclosure as MatchingDisclosureLevel,
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
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        handle TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        capture_token_hash TEXT NOT NULL UNIQUE,
        dashboard_token_hash TEXT NOT NULL UNIQUE,
        dashboard_public INTEGER NOT NULL DEFAULT 0,
        matching_opt_in INTEGER NOT NULL DEFAULT 0
          CHECK (matching_opt_in IN (0, 1)),
        matching_disclosure TEXT NOT NULL DEFAULT 'topics_only'
          CHECK (matching_disclosure IN ('topics_only', 'topics_and_channel')),
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
    if (!columns.some((column) => column.name === 'matching_opt_in')) {
      this.db.exec(`ALTER TABLE users ADD COLUMN matching_opt_in INTEGER NOT NULL DEFAULT 0
        CHECK (matching_opt_in IN (0, 1))`);
    }
    if (!columns.some((column) => column.name === 'matching_disclosure')) {
      this.db.exec(`ALTER TABLE users ADD COLUMN matching_disclosure TEXT NOT NULL DEFAULT 'topics_only'
        CHECK (matching_disclosure IN ('topics_only', 'topics_and_channel'))`);
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
      CREATE TABLE IF NOT EXISTS matching_profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        opted_in INTEGER NOT NULL DEFAULT 0 CHECK (opted_in IN (0, 1)),
        dimension_taxonomy_version INTEGER,
        selected_topic_keys TEXT NOT NULL DEFAULT '[]',
        excluded_topic_keys TEXT NOT NULL DEFAULT '[]',
        dimensions_confirmed INTEGER NOT NULL DEFAULT 0
          CHECK (dimensions_confirmed IN (0, 1)),
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS crystals (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('matching')),
        version INTEGER NOT NULL,
        taxonomy_version INTEGER NOT NULL,
        generated_at TEXT NOT NULL,
        eligible INTEGER NOT NULL CHECK (eligible IN (0, 1)),
        json TEXT NOT NULL,
        PRIMARY KEY(user_id, kind)
      );
      CREATE INDEX IF NOT EXISTS crystals_matchable_idx
        ON crystals(kind, eligible, taxonomy_version, generated_at DESC);
      CREATE TABLE IF NOT EXISTS crystal_refresh_queue (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        requested_at TEXT NOT NULL
      );
    `);
    const profileColumns = this.db.prepare("SELECT name FROM pragma_table_info('matching_profiles')")
      .all() as Array<{ name: string }>;
    for (const [name, definition] of [
      ['dimension_taxonomy_version', 'INTEGER'],
      ['selected_topic_keys', "TEXT NOT NULL DEFAULT '[]'"],
      ['excluded_topic_keys', "TEXT NOT NULL DEFAULT '[]'"],
      ['dimensions_confirmed', 'INTEGER NOT NULL DEFAULT 0 CHECK (dimensions_confirmed IN (0, 1))'],
    ] as const) {
      if (!profileColumns.some((column) => column.name === name)) {
        this.db.exec(`ALTER TABLE matching_profiles ADD COLUMN ${name} ${definition}`);
      }
    }
    // #6 stored opt-in in a dedicated row before #7 established the user
    // preference columns. Reconcile it idempotently on every open: this also
    // recovers an interrupted ALTER and imports changes made after a binary
    // rollback. New writes update both copies in one transaction.
    this.db.exec(`
      UPDATE users SET matching_opt_in=(
        SELECT p.opted_in FROM matching_profiles p WHERE p.user_id=users.id
      ) WHERE EXISTS (
        SELECT 1 FROM matching_profiles p WHERE p.user_id=users.id
      )
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

  setMatchingOptIn(handle: string, optedIn: boolean): void {
    const user = this.userByHandle(handle);
    if (!user) throw new Error(`Unknown user: ${handle}`);
    this.setMatchingPreferences(handle, optedIn, user.matchingDisclosure);
  }

  setMatchingPreferences(
    handle: string,
    optedIn: boolean,
    disclosureLevel: MatchingDisclosureLevel,
  ): User {
    if (!MATCHING_DISCLOSURE_LEVELS.includes(disclosureLevel)) {
      throw new Error('Unknown matching disclosure level');
    }
    const user = this.userByHandle(handle);
    if (!user) throw new Error(`Unknown user: ${handle}`);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        UPDATE users SET matching_opt_in=?, matching_disclosure=? WHERE id=?
      `).run(optedIn ? 1 : 0, disclosureLevel, user.id);
      this.db.prepare(`
        INSERT INTO matching_profiles(user_id, opted_in, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          opted_in=excluded.opted_in, updated_at=excluded.updated_at
      `).run(user.id, optedIn ? 1 : 0, new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.userByHandle(handle)!;
  }

  matchingDimensionsFor(user: User): MatchingDimensions {
    const row = this.db.prepare(`
      SELECT dimension_taxonomy_version, selected_topic_keys,
        excluded_topic_keys, dimensions_confirmed
      FROM matching_profiles WHERE user_id=?
    `).get(user.id) as Record<string, unknown> | undefined;
    const stored: StoredMatchingDimensions | null = row ? {
      taxonomyVersion: row.dimension_taxonomy_version == null
        ? null : Number(row.dimension_taxonomy_version),
      selectedTopicKeysJson: String(row.selected_topic_keys),
      excludedTopicKeysJson: String(row.excluded_topic_keys),
      confirmed: Number(row.dimensions_confirmed) === 1,
    } : null;
    return resolveMatchingDimensions(this.matchingCrystalFor(user.handle), stored);
  }

  setMatchingDimensions(
    handle: string,
    taxonomyVersion: number,
    selectedTopicKeys: string[],
    excludedTopicKeys: string[],
  ): MatchingDimensions {
    const user = this.userByHandle(handle);
    if (!user) throw new Error(`Unknown user: ${handle}`);
    const valid = validateMatchingDimensions(
      taxonomyVersion, selectedTopicKeys, excludedTopicKeys,
    );
    this.db.prepare(`
      INSERT INTO matching_profiles(
        user_id, opted_in, dimension_taxonomy_version, selected_topic_keys,
        excluded_topic_keys, dimensions_confirmed, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        dimension_taxonomy_version=excluded.dimension_taxonomy_version,
        selected_topic_keys=excluded.selected_topic_keys,
        excluded_topic_keys=excluded.excluded_topic_keys,
        dimensions_confirmed=1,
        updated_at=excluded.updated_at
    `).run(
      user.id,
      user.matchingOptIn ? 1 : 0,
      taxonomyVersion,
      JSON.stringify(valid.selectedTopicKeys),
      JSON.stringify(valid.excludedTopicKeys),
      new Date().toISOString(),
    );
    return this.matchingDimensionsFor(user);
  }

  markCrystalDirty(user: User, requestedAt = new Date().toISOString()): void {
    this.db.prepare(`
      INSERT INTO crystal_refresh_queue(user_id, requested_at) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET requested_at=excluded.requested_at
    `).run(user.id, requestedAt);
  }

  crystalRefreshPending(): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM crystal_refresh_queue LIMIT 1').get());
  }

  upsertMatchingCrystal(user: User, crystal: RegistryMatchingCrystal): void {
    if (crystal.kind !== 'matching' || crystal.taxonomyVersion !== MATCHING_TAXONOMY.version) {
      throw new Error('Matching crystal uses an unsupported taxonomy version');
    }
    const json = JSON.stringify(crystal);
    if (!parseRegistryMatchingCrystal(json)) throw new Error('Matching crystal is invalid');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO crystals(
          user_id, kind, version, taxonomy_version, generated_at, eligible, json
        ) VALUES (?, 'matching', ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, kind) DO UPDATE SET
          version=excluded.version,
          taxonomy_version=excluded.taxonomy_version,
          generated_at=excluded.generated_at,
          eligible=excluded.eligible,
          json=excluded.json
      `).run(
        user.id,
        crystal.version,
        crystal.taxonomyVersion,
        crystal.generatedAt,
        registryCrystalEligible(crystal) ? 1 : 0,
        json,
      );
      // Keep a refresh request that arrived while this projection was being
      // built. Equal timestamps err toward one harmless extra cycle.
      this.db.prepare(`
        DELETE FROM crystal_refresh_queue WHERE user_id=? AND requested_at<?
      `).run(user.id, crystal.generatedAt);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  matchingCrystalFor(handle: string): RegistryMatchingCrystal | null {
    const row = this.db.prepare(`
      SELECT c.json FROM crystals c JOIN users u ON u.id=c.user_id
      WHERE u.handle=? AND c.kind='matching'
        AND c.version=? AND c.taxonomy_version=?
    `).get(
      handle,
      REGISTRY_CRYSTAL_VERSION,
      MATCHING_TAXONOMY.version,
    ) as { json: string } | undefined;
    return row ? parseRegistryMatchingCrystal(row.json) : null;
  }

  listMatchableCrystals(): MatchableCrystal[] {
    const rows = this.db.prepare(`
      SELECT u.id user_id, u.handle, u.display_name, u.matching_disclosure, c.json,
        p.dimension_taxonomy_version, p.selected_topic_keys,
        p.excluded_topic_keys, p.dimensions_confirmed
      FROM crystals c
      JOIN users u ON u.id=c.user_id
      LEFT JOIN matching_profiles p ON p.user_id=u.id
      WHERE u.matching_opt_in=1 AND c.kind='matching' AND c.version=? AND c.eligible=1
        AND c.taxonomy_version=?
      ORDER BY u.id
    `).all(
      REGISTRY_CRYSTAL_VERSION,
      MATCHING_TAXONOMY.version,
    ) as Array<Record<string, unknown>>;
    return rows.flatMap((row) => {
      const crystal = parseRegistryMatchingCrystal(String(row.json));
      const stored: StoredMatchingDimensions | null = row.selected_topic_keys == null ? null : {
        taxonomyVersion: row.dimension_taxonomy_version == null
          ? null : Number(row.dimension_taxonomy_version),
        selectedTopicKeysJson: String(row.selected_topic_keys),
        excludedTopicKeysJson: String(row.excluded_topic_keys),
        confirmed: Number(row.dimensions_confirmed) === 1,
      };
      return crystal ? [{
        userId: Number(row.user_id),
        handle: String(row.handle),
        displayName: String(row.display_name),
        disclosureLevel: String(row.matching_disclosure) as MatchingDisclosureLevel,
        crystal,
        dimensions: resolveMatchingDimensions(crystal, stored),
      }] : [];
    });
  }

  listMatchingCandidatesFor(viewer: User): MatchableCrystal[] {
    const current = this.userByHandle(viewer.handle);
    if (!current || current.id !== viewer.id || !current.matchingOptIn) return [];
    return this.listMatchableCrystals().filter((candidate) => candidate.userId !== current.id);
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

  // `next` is an optional same-site path to land on after the OAuth round
  // trip (e.g. /extension-setup); it rides in the state row, never the URL.
  createLoginState(next = ''): string {
    this.expireLoginState();
    const state = newToken();
    this.db.prepare("INSERT INTO login_states (state, kind, payload, expires_at) VALUES (?, 'oauth', ?, ?)")
      .run(state, next, new Date(Date.now() + 10 * 60_000).toISOString());
    return state;
  }

  consumeLoginState(state: string): { valid: boolean; next: string } {
    if (!state) return { valid: false, next: '' };
    this.expireLoginState();
    const row = this.db.prepare("SELECT payload FROM login_states WHERE state=? AND kind='oauth'")
      .get(state) as { payload: string } | undefined;
    if (!row) return { valid: false, next: '' };
    this.db.prepare("DELETE FROM login_states WHERE state=? AND kind='oauth'").run(state);
    return { valid: true, next: row.payload };
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

  // Extension provisioning issues a fresh capture token without touching the
  // dashboard key: re-authorizing a (re)installed extension must not break
  // saved dashboard links.
  rotateCaptureToken(handle: string): string {
    const user = this.userByHandle(handle);
    if (!user) throw new Error(`Unknown user: ${handle}`);
    const captureToken = newToken();
    this.db.prepare('UPDATE users SET capture_token_hash=? WHERE id=?').run(tokenHash(captureToken), user.id);
    return captureToken;
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

  databaseBytesFor(user: User): number {
    const path = this.databasePathFor(user);
    if (path === ':memory:') return 0;
    return ['', '-wal', '-shm'].reduce((total, suffix) => {
      const candidate = `${path}${suffix}`;
      return total + (existsSync(candidate) ? statSync(candidate).size : 0);
    }, 0);
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
