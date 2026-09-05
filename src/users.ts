import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { profileSchema, ProfileError, validHandle, type ProfileInput } from './profile.js';
import { config } from './config.js';
import { MatchingStore } from './matching-v3/store.js';
import { AdminMonitoring } from './matching-v3/monitoring.js';
import { readAdminSnapshot } from './matching-v3/monitoring-read.js';
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

export type { MatchingDisclosureLevel } from './youtube/disclosure.js';

export interface User {
  id: number;
  handle: string;
  displayName: string;
  bio: string;
  socialLinks: ProfileInput['socialLinks'];
  storageName: string;
  autoActivateInitialTopics: boolean;
  dashboardPublic: boolean;
  referenceOptIn: boolean;
  matchingOptIn: boolean;
  matchingDisclosure: MatchingDisclosureLevel;
  // Whether hour-of-day / weekday shares may appear on comparisons before
  // mutual consent.
  matchingRhythm: boolean;
  matchingIntroduction: string;
  matchingContact: string;
  onboardingCompletedAt: string | null;
  dataKeyMode: 'legacy-env' | 'derived';
  keySeed: string;
  createdAt: string;
  googleSub: string | null;
  googleEmail: string | null;
  avatarUrl: string | null;
}

export interface PendingSignup {
  sub: string;
  email: string;
  avatarUrl: string | null;
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
  // Defaults to true; false hides rhythm shares from locked comparisons.
  rhythmDisclosure?: boolean;
  crystal: RegistryMatchingCrystal;
  dimensions: MatchingDimensions;
}

export interface MatchRequestPreview {
  requestToken: string;
  displayName: string;
  topics: string[];
  requestedAt: string;
}

export interface MatchConnection {
  requestToken: string;
  displayName: string;
  introduction: string;
  contact: string;
  topics: string[];
  connectedAt: string;
}

export interface MatchingInbox {
  incoming: MatchRequestPreview[];
  sent: MatchRequestPreview[];
  connections: MatchConnection[];
}

export type MatchRelationship =
  | { status: 'none' }
  | { status: 'incoming'; requestToken: string }
  | { status: 'sent'; requestToken: string }
  | { status: 'connected'; requestToken: string };

export interface PortableAccountData {
  account: {
    handle: string;
    displayName: string;
    googleAccountId: string | null;
    googleEmail: string | null;
    avatarUrl: string | null;
    dashboardPublic: boolean;
    referenceOptIn: boolean;
    createdAt: string;
    onboardingCompletedAt: string | null;
  };
  matching: {
    settings: {
      optedIn: boolean;
      disclosure: MatchingDisclosureLevel;
      introduction: string;
      contact: string;
      dimensions: MatchingDimensions;
    };
    invitations: Array<{
      direction: 'sent' | 'received';
      displayName: string;
      status: 'pending' | 'declined' | 'withdrawn';
      topics: string[];
      createdAt: string;
      updatedAt: string;
    }>;
    connections: Array<{
      direction: 'sent' | 'received';
      displayName: string;
      topics: string[];
      connectedAt: string;
    }>;
  };
  matchingCrystal: RegistryMatchingCrystal | null;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newToken(): string {
  return randomBytes(36).toString('base64url');
}

const MATCH_ACTION_TTL_MS = 20 * 60_000;
const MATCH_ACTION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{48}$/;
const MATCH_TOPIC_NAMES = new Set(MATCHING_TAXONOMY.topics.map((topic) => topic.name));
const MATCH_TOPIC_KEYS_BY_NAME = new Map(
  MATCHING_TAXONOMY.topics.map((topic) => [topic.name, topic.key]),
);

function matchTopics(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length > 2 || parsed.some((topic) =>
    typeof topic !== 'string' || !MATCH_TOPIC_NAMES.has(topic))) {
    throw new Error('Stored match topics are invalid');
  }
  return [...new Set(parsed)];
}

function normalizeMatchTopics(topics: string[]): string[] {
  if (topics.length > 2 || topics.some((topic) => !MATCH_TOPIC_NAMES.has(topic))) {
    throw new Error('Match topics are invalid');
  }
  return [...new Set(topics)];
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
    bio: String(row.bio ?? ''),
    socialLinks: JSON.parse(String(row.social_links ?? '[]')),
    storageName: String(row.storage_name ?? row.handle),
    autoActivateInitialTopics: Number(row.auto_activate_initial_topics) === 1,
    dashboardPublic: Number(row.dashboard_public) === 1,
    referenceOptIn: Number(row.reference_opt_in) === 1,
    matchingOptIn: Number(row.matching_opt_in) === 1,
    matchingDisclosure: row.matching_disclosure as MatchingDisclosureLevel,
    matchingRhythm: row.matching_rhythm == null ? true : Number(row.matching_rhythm) === 1,
    matchingIntroduction: String(row.matching_introduction ?? ''),
    matchingContact: String(row.matching_contact ?? ''),
    onboardingCompletedAt: row.onboarding_completed_at == null
      ? null : String(row.onboarding_completed_at),
    dataKeyMode: row.data_key_mode as User['dataKeyMode'],
    keySeed: String(row.key_seed ?? row.handle),
    createdAt: String(row.created_at),
    googleSub: row.google_sub == null ? null : String(row.google_sub),
    googleEmail: row.google_email == null ? null : String(row.google_email),
    avatarUrl: row.avatar_url == null ? null : String(row.avatar_url),
  };
}

export class UserRegistry {
  private v3Store?: MatchingStore;
  private v3Monitoring?: AdminMonitoring;
  matchingV3Store(): MatchingStore {
    return this.v3Store ??= new MatchingStore(this.db);
  }
  matchingV3Monitoring(version: string) {
    this.matchingV3Store();
    this.v3Monitoring ??= new AdminMonitoring(this.registryPath, version => readAdminSnapshot(this.db, version));
    return this.v3Monitoring.read(version);
  }
  private readonly db: DatabaseSync;
  private readonly repositories = new Map<string, Repository>();
  private readonly dataDir: string;

  constructor(private readonly registryPath: string, dataDir?: string) {
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
        reference_opt_in INTEGER NOT NULL DEFAULT 0
          CHECK (reference_opt_in IN (0, 1)),
        matching_opt_in INTEGER NOT NULL DEFAULT 0
          CHECK (matching_opt_in IN (0, 1)),
        matching_disclosure TEXT NOT NULL DEFAULT 'topics_only'
          CHECK (matching_disclosure IN ('topics_only', 'topics_and_channel')),
        matching_rhythm INTEGER NOT NULL DEFAULT 1
          CHECK (matching_rhythm IN (0, 1)),
        matching_introduction TEXT NOT NULL DEFAULT '',
        matching_contact TEXT NOT NULL DEFAULT '',
        onboarding_completed_at TEXT,
        data_key_mode TEXT NOT NULL DEFAULT 'derived'
          CHECK (data_key_mode IN ('legacy-env', 'derived')),
        google_sub TEXT,
        google_email TEXT,
        avatar_url TEXT,
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
    for (const [name, definition] of [['bio', "TEXT NOT NULL DEFAULT ''"], ['social_links', "TEXT NOT NULL DEFAULT '[]'"], ['storage_name', 'TEXT'], ['auto_activate_initial_topics', 'INTEGER NOT NULL DEFAULT 0']]) {
      if (!columns.some(column => column.name === name)) this.db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
    }
    // Freeze existing filenames; handle edits now only update the registry.
    this.db.exec('UPDATE users SET storage_name=handle WHERE storage_name IS NULL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS handle_aliases (handle TEXT PRIMARY KEY, user_id INTEGER NOT NULL)`);

    // Google identity: sub is Google's permanent account id (emails can
    // change), unique so one Google account maps to at most one user.
    for (const name of ['google_sub', 'google_email', 'avatar_url']) {
      if (!columns.some((column) => column.name === name)) {
        this.db.exec(`ALTER TABLE users ADD COLUMN ${name} TEXT`);
      }
    }
    if (!columns.some((column) => column.name === 'matching_opt_in')) {
      this.db.exec(`ALTER TABLE users ADD COLUMN matching_opt_in INTEGER NOT NULL DEFAULT 0
        CHECK (matching_opt_in IN (0, 1))`);
    }
    if (!columns.some((column) => column.name === 'reference_opt_in')) {
      this.db.exec(`ALTER TABLE users ADD COLUMN reference_opt_in INTEGER NOT NULL DEFAULT 0
        CHECK (reference_opt_in IN (0, 1))`);
    }
    if (!columns.some((column) => column.name === 'matching_disclosure')) {
      this.db.exec(`ALTER TABLE users ADD COLUMN matching_disclosure TEXT NOT NULL DEFAULT 'topics_only'
        CHECK (matching_disclosure IN ('topics_only', 'topics_and_channel'))`);
    }
    if (!columns.some((column) => column.name === 'matching_rhythm')) {
      this.db.exec(`ALTER TABLE users ADD COLUMN matching_rhythm INTEGER NOT NULL DEFAULT 1
        CHECK (matching_rhythm IN (0, 1))`);
    }
    // Joining matching is the single switch: the finer disclosure and rhythm
    // settings were retired, so stored rows are normalized to "everything".
    this.db.exec(`UPDATE users SET matching_disclosure='topics_and_channel', matching_rhythm=1
      WHERE matching_disclosure<>'topics_and_channel' OR matching_rhythm<>1`);
    for (const [name, definition] of [
      ['matching_introduction', "TEXT NOT NULL DEFAULT ''"],
      ['matching_contact', "TEXT NOT NULL DEFAULT ''"],
      ['onboarding_completed_at', 'TEXT'],
    ] as const) {
      if (!columns.some((column) => column.name === name)) {
        this.db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
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
      CREATE TABLE IF NOT EXISTS match_action_tokens (
        token_hash TEXT PRIMARY KEY,
        sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        topics_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        UNIQUE(sender_user_id, recipient_user_id),
        CHECK(sender_user_id <> recipient_user_id)
      );
      CREATE TABLE IF NOT EXISTS match_requests (
        request_token TEXT NOT NULL UNIQUE,
        sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn')),
        topics_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK(sender_user_id <> recipient_user_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS match_requests_pending_direction
        ON match_requests(sender_user_id, recipient_user_id) WHERE status='pending';
      CREATE INDEX IF NOT EXISTS match_requests_participants
        ON match_requests(recipient_user_id, sender_user_id, status, updated_at DESC);
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
    this.v3Monitoring?.close();
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
      avatarUrl?: string;
    } = {},
  ): CreatedUser {
    if (!validHandle(handle)) {
      throw new Error('Handle must be 2-32 chars of lowercase letters, digits, dots, or dashes');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.handleAvailable(handle)) throw new ProfileError('handle', 'taken');
      const captureToken = newToken();
      const dashboardToken = newToken();
      const createdAt = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO users (
          handle, display_name, capture_token_hash, dashboard_token_hash,
          dashboard_public, data_key_mode, key_seed, created_at, google_sub, google_email, avatar_url,
          matching_opt_in, matching_disclosure, matching_rhythm, auto_activate_initial_topics
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        handle, displayName, tokenHash(captureToken), tokenHash(dashboardToken),
        options.dashboardPublic ? 1 : 0, options.dataKeyMode ?? 'derived', handle, createdAt,
        options.googleSub ?? null, options.googleEmail ?? null, options.avatarUrl ?? null,
        // Matching switches start on; the account page turns each one off.
        1, 'topics_and_channel', 1,
      );
      this.db.prepare('UPDATE users SET storage_name=handle WHERE handle=?').run(handle);
      const user = this.userByHandle(handle)!;
      this.db.exec('COMMIT');
      return { ...user, captureToken, dashboardToken };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  // The instance owner: legacy env tokens and the env data key map here, and
  // the migrated Infovore database is this user's data file.
  ensureDefaultUser(): User {
    const ownerRow = this.db.prepare('SELECT * FROM users WHERE storage_name=?').get(DEFAULT_HANDLE) as Record<string, unknown> | undefined;
    const existing = ownerRow ? rowToUser(ownerRow) : this.userByHandle(DEFAULT_HANDLE);
    if (existing) return existing;
    const {
      captureToken: _discardedCaptureToken,
      dashboardToken: _discardedDashboardToken,
      ...created
    } = this.createUser(DEFAULT_HANDLE, config.ownerName, {
      dataKeyMode: 'legacy-env',
      dashboardPublic: true,
    });
    // Service bootstrap is unattended and its stdout is normally retained by
    // the container runtime. Never emit the one-time credentials here. The
    // legacy env capture token remains valid for this owner; an operator who
    // explicitly needs fresh per-user credentials can run the rotation CLI.
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

  // Everyone who joined matching. Channel pages aggregate across these
  // people; nobody outside the pool contributes or can look.
  listMatchingMembers(): User[] {
    const rows = this.db.prepare('SELECT * FROM users WHERE matching_opt_in=1 ORDER BY id')
      .all() as Array<Record<string, unknown>>;
    return rows.map(rowToUser);
  }

  listReferencePopulationUsers(): User[] {
    const rows = this.db.prepare(`
      SELECT * FROM users WHERE reference_opt_in=1 ORDER BY id
    `).all() as Array<Record<string, unknown>>;
    return rows.map(rowToUser);
  }

  setReferenceOptIn(handle: string, optedIn: boolean): User {
    const result = this.db.prepare('UPDATE users SET reference_opt_in=? WHERE handle=?')
      .run(optedIn ? 1 : 0, handle);
    if (result.changes !== 1) throw new Error(`Unknown user: ${handle}`);
    return this.userByHandle(handle)!;
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
    rhythm?: boolean,
  ): User {
    return this.writeMatchingPreferences(handle, optedIn, disclosureLevel, false, rhythm);
  }

  completeOnboarding(
    handle: string,
    optedIn: boolean,
    disclosureLevel: MatchingDisclosureLevel,
    dashboardPublic?: boolean,
  ): User {
    return this.writeMatchingPreferences(handle, optedIn, disclosureLevel, true, undefined, dashboardPublic);
  }

  private writeMatchingPreferences(
    handle: string,
    optedIn: boolean,
    disclosureLevel: MatchingDisclosureLevel,
    completeOnboarding: boolean,
    rhythm?: boolean,
    dashboardPublic?: boolean,
  ): User {
    if (!MATCHING_DISCLOSURE_LEVELS.includes(disclosureLevel)) {
      throw new Error('Unknown matching disclosure level');
    }
    const user = this.userByHandle(handle);
    if (!user) throw new Error(`Unknown user: ${handle}`);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE users SET matching_opt_in=?, matching_disclosure=?, matching_rhythm=?,
          onboarding_completed_at=CASE WHEN ?=1 THEN ? ELSE onboarding_completed_at END,
          dashboard_public=COALESCE(?, dashboard_public)
        WHERE id=?
      `).run(
        optedIn ? 1 : 0,
        disclosureLevel,
        (rhythm ?? user.matchingRhythm) ? 1 : 0,
        completeOnboarding ? 1 : 0,
        now,
        dashboardPublic === undefined ? null : dashboardPublic ? 1 : 0,
        user.id,
      );
      this.db.prepare(`
        INSERT INTO matching_profiles(user_id, opted_in, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          opted_in=excluded.opted_in, updated_at=excluded.updated_at
      `).run(user.id, optedIn ? 1 : 0, now);
      if (!optedIn) {
        this.db.prepare(`
          UPDATE match_requests SET status='withdrawn', updated_at=?
          WHERE status IN ('pending', 'accepted')
            AND (sender_user_id=? OR recipient_user_id=?)
        `).run(now, user.id, user.id);
        this.db.prepare(`
          DELETE FROM match_action_tokens WHERE sender_user_id=? OR recipient_user_id=?
        `).run(user.id, user.id);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.userByHandle(handle)!;
  }

  // Every canonical topic is usable for everyone who joined. Stored
  // per-topic choices from the retired interests UI are ignored.
  matchingDimensionsFor(user: User): MatchingDimensions {
    return resolveMatchingDimensions(this.matchingCrystalFor(user.handle), null);
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

  listMatchableCrystals(limit = 250): MatchableCrystal[] {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const rows = this.db.prepare(`
      SELECT u.id user_id, u.handle, u.display_name, u.matching_disclosure, u.matching_rhythm, c.json,
        p.dimension_taxonomy_version, p.selected_topic_keys,
        p.excluded_topic_keys, p.dimensions_confirmed
      FROM crystals c
      JOIN users u ON u.id=c.user_id
      LEFT JOIN matching_profiles p ON p.user_id=u.id
      WHERE u.matching_opt_in=1 AND c.kind='matching' AND c.version=? AND c.eligible=1
        AND c.taxonomy_version=?
      ORDER BY u.id
      LIMIT ?
    `).all(
      REGISTRY_CRYSTAL_VERSION,
      MATCHING_TAXONOMY.version,
      boundedLimit,
    ) as Array<Record<string, unknown>>;
    return rows.flatMap((row) => {
      const crystal = parseRegistryMatchingCrystal(String(row.json));
      return crystal ? [{
        userId: Number(row.user_id),
        handle: String(row.handle),
        displayName: String(row.display_name),
        disclosureLevel: 'topics_and_channel',
        rhythmDisclosure: true,
        crystal,
        dimensions: resolveMatchingDimensions(crystal, null),
      }] : [];
    });
  }

  listMatchingCandidatesFor(viewer: User, limit = 250): MatchableCrystal[] {
    const current = this.userByHandle(viewer.handle);
    if (!current || current.id !== viewer.id || !current.matchingOptIn) return [];
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 499);
    return this.listMatchableCrystals(boundedLimit + 1)
      // A relationship changes what the comparison can reveal, not whether
      // the person disappears. Keeping active, declined, and withdrawn pairs
      // in this bounded pool makes /matches a stable people directory.
      .filter((candidate) => candidate.userId !== current.id)
      .slice(0, boundedLimit);
  }

  matchingRelationshipFor(viewer: User, otherUserId: number): MatchRelationship {
    const current = this.userByHandle(viewer.handle);
    if (!current || current.id !== viewer.id || !current.matchingOptIn
      || !Number.isSafeInteger(otherUserId) || otherUserId === current.id) {
      return { status: 'none' };
    }
    const row = this.db.prepare(`
      SELECT request_token, sender_user_id, status FROM match_requests
      WHERE status IN ('pending', 'accepted')
        AND ((sender_user_id=? AND recipient_user_id=?)
          OR (sender_user_id=? AND recipient_user_id=?))
      ORDER BY status='accepted' DESC, updated_at DESC LIMIT 1
    `).get(current.id, otherUserId, otherUserId, current.id) as
      | { request_token: string; sender_user_id: number; status: 'pending' | 'accepted' }
      | undefined;
    if (!row) return { status: 'none' };
    if (row.status === 'accepted') {
      return { status: 'connected', requestToken: row.request_token };
    }
    return Number(row.sender_user_id) === current.id
      ? { status: 'sent', requestToken: row.request_token }
      : { status: 'incoming', requestToken: row.request_token };
  }

  issueMatchActionToken(sender: User, recipientUserId: number, topics: string[]): string {
    const current = this.userByHandle(sender.handle);
    if (!current || current.id !== sender.id || !current.matchingOptIn) {
      throw new Error('Matching is not enabled');
    }
    if (!Number.isSafeInteger(recipientUserId) || recipientUserId === current.id
      || !this.db.prepare('SELECT 1 FROM users WHERE id=? AND matching_opt_in=1').get(recipientUserId)) {
      throw new Error('Candidate is no longer eligible');
    }
    const token = newToken();
    const latestTerminal = this.db.prepare(`
      SELECT MAX(updated_at) updated_at FROM match_requests
      WHERE status IN ('declined', 'withdrawn')
        AND ((sender_user_id=? AND recipient_user_id=?)
          OR (sender_user_id=? AND recipient_user_id=?))
    `).get(current.id, recipientUserId, recipientUserId, current.id) as
      | { updated_at: string | null }
      | undefined;
    const terminalTime = latestTerminal?.updated_at
      ? new Date(latestTerminal.updated_at).getTime() : Number.NaN;
    // SQLite timestamps are millisecond precision. Ensure a newly issued
    // directory link sorts after a decline/withdrawal in that same tick,
    // while the old action token remains revoked.
    const now = new Date(Math.max(Date.now(), Number.isFinite(terminalTime) ? terminalTime + 1 : 0));
    this.db.prepare('DELETE FROM match_action_tokens WHERE expires_at < ?').run(now.toISOString());
    this.db.prepare(`
      INSERT INTO match_action_tokens(
        token_hash, sender_user_id, recipient_user_id, topics_json, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(sender_user_id, recipient_user_id) DO UPDATE SET
        token_hash=excluded.token_hash,
        topics_json=excluded.topics_json,
        created_at=excluded.created_at,
        expires_at=excluded.expires_at
    `).run(
      tokenHash(token), current.id, recipientUserId,
      JSON.stringify(normalizeMatchTopics(topics)), now.toISOString(),
      new Date(now.getTime() + MATCH_ACTION_TTL_MS).toISOString(),
    );
    return token;
  }

  friendshipCandidateForAction(viewer: User, actionToken: string): User | null {
    const current = this.userByHandle(viewer.handle);
    if (!current || current.id !== viewer.id || !current.matchingOptIn
      || !MATCH_ACTION_TOKEN_PATTERN.test(actionToken)) return null;
    const row = this.db.prepare(`
      SELECT recipient.* FROM match_action_tokens action
      JOIN users recipient ON recipient.id=action.recipient_user_id AND recipient.matching_opt_in=1
      WHERE action.token_hash=? AND action.sender_user_id=? AND action.expires_at>=?
        AND NOT EXISTS (
          SELECT 1 FROM match_requests request
          WHERE request.status IN ('declined', 'withdrawn')
            AND request.updated_at>=action.created_at
            AND ((request.sender_user_id=action.sender_user_id
              AND request.recipient_user_id=action.recipient_user_id)
              OR (request.sender_user_id=action.recipient_user_id
                AND request.recipient_user_id=action.sender_user_id))
        )
    `).get(tokenHash(actionToken), current.id, new Date().toISOString()) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToUser(row) : null;
  }

  matchingCandidateForAction(viewer: User, actionToken: string): MatchableCrystal | null {
    const target = this.friendshipCandidateForAction(viewer, actionToken);
    return target ? this.matchingCandidateByHandle(viewer, target.handle) : null;
  }

  avatarUserForMatchAction(viewer: User, actionToken: string, viewerSide = false): User | null {
    const candidate = this.matchingCandidateForAction(viewer, actionToken);
    if (!candidate) return null;
    return viewerSide
      ? this.userByHandle(viewer.handle)
      : this.userByHandle(candidate.handle);
  }

  // Stable, handle-addressed comparison: the other person must currently be
  // a candidate for the viewer (both opted in, eligible, not the viewer).
  matchingCandidateByHandle(viewer: User, handle: string): MatchableCrystal | null {
    return this.listMatchingCandidatesFor(viewer, 499)
      .find((candidate) => candidate.handle === handle) ?? null;
  }

  avatarUserForMember(viewer: User, handle: string): User | null {
    const current = this.userByHandle(viewer.handle);
    if (!current || current.id !== viewer.id || !current.matchingOptIn) return null;
    if (handle === current.handle) return current;
    return this.matchingCandidateByHandle(current, handle) ? this.userByHandle(handle) : null;
  }

  avatarUserForMatchRequest(viewer: User, requestToken: string): User | null {
    const current = this.userByHandle(viewer.handle);
    if (!current || current.id !== viewer.id || !current.matchingOptIn || !requestToken) return null;
    const row = this.db.prepare(`
      SELECT other.* FROM match_requests request
      JOIN users other ON other.id=CASE
        WHEN request.sender_user_id=? THEN request.recipient_user_id ELSE request.sender_user_id END
        AND other.matching_opt_in=1
      WHERE request.request_token=?
        AND request.status IN ('pending', 'accepted')
        AND (request.sender_user_id=? OR request.recipient_user_id=?)
    `).get(current.id, requestToken, current.id, current.id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToUser(row) : null;
  }

  createMatchRequest(sender: User, actionToken: string): void {
    const current = this.userByHandle(sender.handle);
    if (!current || current.id !== sender.id || !current.matchingOptIn || !actionToken) {
      throw new Error('Match request is not allowed');
    }
    if (!this.friendshipCandidateForAction(current, actionToken)) {
      // A retried form submission after a successful request remains
      // idempotent. Revoked, declined, or withdrawn pairs cannot be revived
      // by replaying an old action token.
      const alreadyActive = this.db.prepare(`
        SELECT 1 FROM match_action_tokens action
        JOIN match_requests request
          ON request.sender_user_id=action.sender_user_id
          AND request.recipient_user_id=action.recipient_user_id
          AND request.status IN ('pending', 'accepted')
        WHERE action.token_hash=? AND action.sender_user_id=?
      `).get(tokenHash(actionToken), current.id);
      if (alreadyActive) return;
      throw new Error('Match action expired or is no longer valid');
    }
    const now = new Date().toISOString();
    this.db.prepare('DELETE FROM match_action_tokens WHERE expires_at < ?').run(now);
    const action = this.db.prepare(`
      SELECT a.recipient_user_id, a.topics_json
      FROM match_action_tokens a
      JOIN users recipient ON recipient.id=a.recipient_user_id AND recipient.matching_opt_in=1
      WHERE a.token_hash=? AND a.sender_user_id=? AND a.expires_at>=?
    `).get(
      tokenHash(actionToken),
      current.id,
      now,
    ) as { recipient_user_id: number; topics_json: string } | undefined;
    if (!action) throw new Error('Match action expired or is no longer valid');
    const existing = this.db.prepare(`
      SELECT status FROM match_requests
      WHERE ((sender_user_id=? AND recipient_user_id=?)
        OR (sender_user_id=? AND recipient_user_id=?))
        AND status IN ('pending', 'accepted')
      ORDER BY status='accepted' DESC, updated_at DESC LIMIT 1
    `).get(
      current.id, action.recipient_user_id,
      action.recipient_user_id, current.id,
    ) as { status: 'pending' | 'accepted' } | undefined;
    if (existing?.status === 'accepted') return;
    if (existing?.status === 'pending') {
      const sameDirection = this.db.prepare(`
        SELECT 1 FROM match_requests
        WHERE sender_user_id=? AND recipient_user_id=? AND status='pending'
      `).get(current.id, action.recipient_user_id);
      if (sameDirection) return;
    }
    this.db.prepare(`
      INSERT INTO match_requests(
        request_token, sender_user_id, recipient_user_id, status, topics_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      newToken(), current.id, action.recipient_user_id,
      JSON.stringify(matchTopics(action.topics_json)), now, now,
    );
  }

  matchingInboxFor(viewer: User): MatchingInbox {
    const current = this.userByHandle(viewer.handle);
    if (!current || current.id !== viewer.id || !current.matchingOptIn) {
      return { incoming: [], sent: [], connections: [] };
    }
    const viewerDimensions = this.matchingDimensionsFor(current);
    const visibleTopics = (otherUserId: number, value: string): string[] => {
      const topics = matchTopics(value);
      const row = this.db.prepare('SELECT * FROM users WHERE id=?').get(otherUserId) as
        | Record<string, unknown>
        | undefined;
      if (!row) return [];
      const other = rowToUser(row);
      const otherDimensions = this.matchingDimensionsFor(other);
      // A stale taxonomy cannot safely reinterpret a saved topic name. Current
      // exclusions from either participant apply to every later read, not only
      // to the candidate card that created the request.
      if (viewerDimensions.status === 'stale' || otherDimensions.status === 'stale') return [];
      const excluded = new Set([
        ...viewerDimensions.excludedTopicKeys,
        ...otherDimensions.excludedTopicKeys,
      ]);
      return topics.filter((name) => {
        const key = MATCH_TOPIC_KEYS_BY_NAME.get(name);
        return Boolean(key && !excluded.has(key));
      });
    };
    const previews = (direction: 'incoming' | 'sent'): MatchRequestPreview[] => {
      const incoming = direction === 'incoming';
      const rows = this.db.prepare(`
        SELECT r.request_token, other.id other_user_id, other.display_name,
          r.topics_json, r.created_at
        FROM match_requests r
        JOIN users other ON other.id=${incoming ? 'r.sender_user_id' : 'r.recipient_user_id'}
          AND other.matching_opt_in=1
        WHERE r.${incoming ? 'recipient_user_id' : 'sender_user_id'}=? AND r.status='pending'
        ORDER BY r.created_at DESC
      `).all(current.id) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        requestToken: String(row.request_token),
        displayName: String(row.display_name),
        topics: visibleTopics(Number(row.other_user_id), String(row.topics_json)),
        requestedAt: String(row.created_at),
      }));
    };
    const connectionRows = this.db.prepare(`
      SELECT r.request_token, other.id other_user_id, other.display_name,
        other.matching_introduction, other.matching_contact, r.topics_json, r.updated_at
      FROM match_requests r
      JOIN users other ON other.id=CASE
        WHEN r.sender_user_id=? THEN r.recipient_user_id ELSE r.sender_user_id END
        AND other.matching_opt_in=1
      WHERE r.status='accepted' AND (r.sender_user_id=? OR r.recipient_user_id=?)
      ORDER BY r.updated_at DESC
    `).all(current.id, current.id, current.id) as Array<Record<string, unknown>>;
    return {
      incoming: previews('incoming'),
      sent: previews('sent'),
      connections: connectionRows.map((row) => ({
        requestToken: String(row.request_token),
        displayName: String(row.display_name),
        introduction: String(row.matching_introduction),
        contact: String(row.matching_contact),
        topics: visibleTopics(Number(row.other_user_id), String(row.topics_json)),
        connectedAt: String(row.updated_at),
      })),
    };
  }

  portableAccountDataFor(viewer: User): PortableAccountData {
    const current = this.userByHandle(viewer.handle);
    if (!current || current.id !== viewer.id) throw new Error('User is no longer available');
    const rows = this.db.prepare(`
      SELECT r.sender_user_id, r.status, r.topics_json, r.created_at, r.updated_at,
        other.display_name
      FROM match_requests r
      JOIN users other ON other.id=CASE
        WHEN r.sender_user_id=? THEN r.recipient_user_id ELSE r.sender_user_id END
      WHERE r.sender_user_id=? OR r.recipient_user_id=?
      ORDER BY r.created_at, r.request_token
    `).all(current.id, current.id, current.id) as Array<Record<string, unknown>>;
    const shared = (row: Record<string, unknown>) => ({
      direction: (Number(row.sender_user_id) === current.id ? 'sent' : 'received') as
        'sent' | 'received',
      displayName: String(row.display_name),
      topics: matchTopics(String(row.topics_json)),
    });
    return {
      account: {
        handle: current.handle,
        displayName: current.displayName,
        googleAccountId: current.googleSub,
        googleEmail: current.googleEmail,
        avatarUrl: current.avatarUrl,
        dashboardPublic: current.dashboardPublic,
        referenceOptIn: current.referenceOptIn,
        createdAt: current.createdAt,
        onboardingCompletedAt: current.onboardingCompletedAt,
      },
      matching: {
        settings: {
          optedIn: current.matchingOptIn,
          disclosure: current.matchingDisclosure,
          introduction: current.matchingIntroduction,
          contact: current.matchingContact,
          dimensions: this.matchingDimensionsFor(current),
        },
        invitations: rows.filter((row) => row.status !== 'accepted').map((row) => ({
          ...shared(row),
          status: row.status as 'pending' | 'declined' | 'withdrawn',
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
        })),
        connections: rows.filter((row) => row.status === 'accepted').map((row) => ({
          ...shared(row),
          connectedAt: String(row.updated_at),
        })),
      },
      matchingCrystal: this.matchingCrystalFor(current.handle),
    };
  }

  respondToMatchRequest(
    recipient: User,
    requestToken: string,
    response: 'accept' | 'decline',
  ): void {
    const current = this.userByHandle(recipient.handle);
    if (!current || current.id !== recipient.id || !current.matchingOptIn || !requestToken) {
      throw new Error('Match response is not allowed');
    }
    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const request = this.db.prepare(`
        SELECT sender_user_id FROM match_requests
        WHERE request_token=? AND recipient_user_id=? AND status='pending'
      `).get(requestToken, current.id) as { sender_user_id: number } | undefined;
      if (!request) throw new Error('Match request is no longer pending');
      if (response === 'accept') {
        const sender = this.db.prepare('SELECT matching_opt_in FROM users WHERE id=?')
          .get(request.sender_user_id) as { matching_opt_in: number } | undefined;
        if (!sender || Number(sender.matching_opt_in) !== 1) {
          throw new Error('The sender is no longer in matching');
        }
      }
      const result = this.db.prepare(`
        UPDATE match_requests SET status=?, updated_at=?
        WHERE request_token=? AND recipient_user_id=? AND status='pending'
      `).run(response === 'accept' ? 'accepted' : 'declined', now, requestToken, current.id);
      if (Number(result.changes) !== 1) throw new Error('Match request is no longer pending');
      if (response === 'accept') {
        this.db.prepare(`
          UPDATE match_requests SET status='declined', updated_at=?
          WHERE sender_user_id=? AND recipient_user_id=? AND status='pending'
        `).run(now, current.id, request.sender_user_id);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  withdrawMatchRequest(sender: User, requestToken: string): void {
    const current = this.userByHandle(sender.handle);
    if (!current || current.id !== sender.id || !requestToken) {
      throw new Error('Match withdrawal is not allowed');
    }
    const result = this.db.prepare(`
      UPDATE match_requests SET status='withdrawn', updated_at=?
      WHERE request_token=? AND (
        (status='pending' AND sender_user_id=?)
        OR (status='accepted' AND (sender_user_id=? OR recipient_user_id=?))
      )
    `).run(new Date().toISOString(), requestToken, current.id, current.id, current.id);
    if (Number(result.changes) !== 1) throw new Error('Match request is no longer active');
  }

  setMatchingProfile(handle: string, introduction: string, contact: string): User {
    const user = this.userByHandle(handle);
    if (!user) throw new Error(`Unknown user: ${handle}`);
    const normalizedIntroduction = [...introduction.trim()].slice(0, 160).join('');
    const normalizedContact = [...contact.trim()].slice(0, 240).join('');
    this.db.prepare(`
      UPDATE users SET matching_introduction=?, matching_contact=? WHERE id=?
    `).run(normalizedIntroduction, normalizedContact, user.id);
    return this.userByHandle(handle)!;
  }

  deleteUser(handle: string): void {
    if (handle === DEFAULT_HANDLE) throw new Error('Refusing to delete the instance owner');
    const user = this.userByHandle(handle);
    if (!user) throw new Error(`Unknown user: ${handle}`);
    if (user.storageName === DEFAULT_HANDLE) throw new Error('Refusing to delete the instance owner');
    const repository = this.repositories.get(String(user.id));
    if (repository) {
      repository.close();
      this.repositories.delete(String(user.id));
    }
    this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    this.db.prepare('DELETE FROM users WHERE handle=?').run(handle);
    const path = this.databasePathFor(user);
    if (path !== ':memory:') {
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
    }
  }

  handleAvailable(handle: string, userId?: number): boolean {
    const owner = this.userByHandle(handle);
    const alias = this.db.prepare('SELECT user_id FROM handle_aliases WHERE handle=?').get(handle) as { user_id: number } | undefined;
    return (!owner || owner.id === userId) && (!alias || alias.user_id === userId);
  }

  userByAlias(handle: string): User | null {
    const row = this.db.prepare('SELECT users.* FROM handle_aliases JOIN users ON users.id=handle_aliases.user_id WHERE handle_aliases.handle=?').get(handle) as Record<string, unknown> | undefined;
    return row ? rowToUser(row) : null;
  }

  updateProfile(userId: number, input: unknown): User {
    const parsed = profileSchema.safeParse(input);
    if (!parsed.success) throw new ProfileError(parsed.error.issues[0].path[0] as keyof ProfileInput);
    const value = parsed.data;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT * FROM users WHERE id=?').get(userId) as Record<string, unknown> | undefined;
      if (!row) throw new Error('Unknown user');
      const user = rowToUser(row);
      // Existing accounts may retain a handle that became reserved later.
      if (value.handle !== user.handle && !validHandle(value.handle)) throw new ProfileError('handle');
      if (!this.handleAvailable(value.handle, userId)) throw new ProfileError('handle', 'taken');
      if (user.handle !== value.handle) {
        this.db.prepare('INSERT OR IGNORE INTO handle_aliases(handle,user_id) VALUES (?,?)').run(user.handle, userId);
        this.db.prepare('DELETE FROM handle_aliases WHERE handle=? AND user_id=?').run(value.handle, userId);
      }
      this.db.prepare('UPDATE users SET handle=?, display_name=?, bio=?, social_links=? WHERE id=?')
        .run(value.handle, value.displayName, value.bio, JSON.stringify(value.socialLinks), userId);
      this.db.exec('COMMIT');
      return this.userByHandle(value.handle)!;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  renameUser(oldHandle: string, newHandle: string): User {
    const user = this.userByHandle(oldHandle);
    if (!user) throw new Error(`Unknown user: ${oldHandle}`);
    return this.updateProfile(user.id, { ...user, handle: newHandle });
  }

  userByGoogleSub(sub: string): User | null {
    if (!sub) return null;
    const row = this.db.prepare('SELECT * FROM users WHERE google_sub=?').get(sub) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToUser(row) : null;
  }

  linkGoogle(handle: string, sub: string, email: string, avatarUrl: string | null = null): User {
    const user = this.userByHandle(handle);
    if (!user) throw new Error(`Unknown user: ${handle}`);
    const taken = this.userByGoogleSub(sub);
    if (taken && taken.id !== user.id) {
      throw new Error(`That Google account is already linked to another user`);
    }
    this.db.prepare('UPDATE users SET google_sub=?, google_email=?, avatar_url=COALESCE(?, avatar_url) WHERE id=?')
      .run(sub, email, avatarUrl, user.id);
    return this.userByHandle(handle)!;
  }

  refreshGoogleIdentity(user: User, email: string, avatarUrl: string | null): User {
    const current = this.userByGoogleSub(user.googleSub ?? '');
    if (!current || current.id !== user.id) throw new Error('Google identity is no longer linked');
    this.db.prepare('UPDATE users SET google_email=?, avatar_url=COALESCE(?, avatar_url) WHERE id=?')
      .run(email, avatarUrl, current.id);
    return this.userByHandle(current.handle)!;
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
  createPendingSignup(sub: string, email: string, avatarUrl: string | null = null): string {
    this.expireLoginState();
    const token = newToken();
    this.db.prepare("INSERT INTO login_states (state, kind, payload, expires_at) VALUES (?, 'pending', ?, ?)")
      .run(token, JSON.stringify({ sub, email, avatarUrl }), new Date(Date.now() + 30 * 60_000).toISOString());
    return token;
  }

  pendingSignup(token: string): PendingSignup | null {
    if (!token) return null;
    this.expireLoginState();
    const row = this.db.prepare("SELECT payload FROM login_states WHERE state=? AND kind='pending'")
      .get(token) as { payload: string } | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.payload) as PendingSignup;
    return {
      sub: String(parsed.sub),
      email: String(parsed.email ?? ''),
      avatarUrl: typeof parsed.avatarUrl === 'string' ? parsed.avatarUrl : null,
    };
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
    if (user.storageName === DEFAULT_HANDLE) return config.databasePath;
    return join(this.dataDir, `${user.storageName}.sqlite`);
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
    const key = String(user.id);
    let repository = this.repositories.get(key);
    if (!repository) {
      repository = new Repository(this.databasePathFor(user));
      this.repositories.set(key, repository);
    }
    return repository;
  }
}
