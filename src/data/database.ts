import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { activityFromEntry } from './activity.js';
import { taipeiDay } from '../youtube/history-sync.js';
import { weekdayExposure } from '../youtube/weekday-average.js';
import type { Activity, SourceSnapshot } from './types.js';
import type {
  YoutubeChannelMetadata,
  YoutubeChannelRace,
  YoutubeChannelSummary,
  YoutubeDashboardData,
  YoutubeHistoryCoverage,
  YoutubeHistoryStatus,
  YoutubeScanEndReason,
  YoutubeCapturedWatch,
  YoutubeCaptureResult,
  YoutubeChannelDetail,
  YoutubeComparisonProfile,
  YoutubeImportResult,
  YoutubeOAuthCredential,
  YoutubeParsedArchive,
  YoutubePopularity,
  YoutubePopularitySeries,
  YoutubeProgressBatchInput,
  YoutubeProgressImportResult,
  YoutubeProgressImportRow,
  YoutubeRange,
  YoutubeRecentVideo,
  YoutubeTopic,
  YoutubeTopicTrendMonth,
  YoutubeVideoMetadata,
} from '../youtube/types.js';
import { YOUTUBE_SCAN_COVERING_REASONS, YOUTUBE_POPULARITY_BUCKETS_V1, YOUTUBE_STATISTICS_MAX_AGE_MS } from '../youtube/types.js';
import type { YoutubeProcessingCounts } from '../youtube/processing.js';
import {
  KEYWORD_DEFAULT_LIMIT,
  KEYWORD_SAMPLE_LIMIT,
  extractYoutubeKeywords,
  keywordCoverage,
  keywordSampleStride,
} from '../youtube/keywords.js';
import { progressSeconds } from '../youtube/progress.js';
import {
  PERSONAL_TOPICS,
  PERSONAL_TAXONOMY_DEFINITION_VERSION,
  PERSONAL_TAXONOMY_RUN_COVERAGE_MIN,
  assessPersonalTaxonomyQuality,
  personalTaxonomyReadiness,
  samplePersonalTaxonomy,
  type PersonalClassificationDecision,
  type PersonalTaxonomyDistribution,
  type PersonalTaxonomyEvidenceRow,
  type PersonalTaxonomyRun,
  type PersonalTaxonomyRunStatus,
  type PersonalTaxonomySampleCandidate,
  type PersonalTaxonomySampleManifest,
} from '../youtube/personal-taxonomy.js';
import { decryptPrivateValue } from '../youtube/crypto.js';

export interface PersistResult { inserted: number; updated: number }

export interface ActivityQuery {
  limit?: number;
  offset?: number;
  source?: string;
  kind?: string;
  status?: string;
  query?: string;
  since?: string;
  until?: string;
}

export interface ActivityPage {
  data: Activity[];
  total: number;
  limit: number;
  offset: number;
}

export interface PortableExportColumn {
  name: string;
  type: string;
  nullable: boolean;
  description: string;
}

export interface PortableExportTable {
  file: string;
  source: string;
  description: string;
  columns: PortableExportColumn[];
  rowCount: number;
  rows: () => Iterable<Record<string, unknown>>;
}

export interface PortableRepositoryExport {
  schemaVersion: number;
  tables: PortableExportTable[];
  close: () => void;
}

const PORTABLE_TABLES = [
  ['activity-records.json', 'activities', 'Saved activity records used by the archive timeline.'],
  ['source-snapshots.json', 'snapshots', 'Saved source snapshots and their fetch status.'],
  ['sync-runs.json', 'sync_runs', 'Import and synchronization run history.'],
  ['youtube-imports.json', 'youtube_imports', 'Imported archive batches and row counts.'],
  ['watch-events.json', 'youtube_watch_events', 'YouTube watch events saved by urtube.'],
  ['search-events.json', 'youtube_search_events', 'YouTube searches with the owner-only query decrypted.'],
  ['videos.json', 'youtube_videos', 'Public YouTube video metadata cached by urtube.'],
  ['channels.json', 'youtube_channels', 'Public YouTube channel metadata cached by urtube.'],
  ['playback-progress.json', 'youtube_video_progress', 'Latest saved playback progress per video.'],
  ['scan-runs.json', 'youtube_progress_imports', 'History scan boundaries, completion, and diagnostics.'],
  ['personal-taxonomy.json', 'youtube_topics', 'Versioned personal topic definitions.'],
  ['personal-taxonomy-runs.json', 'youtube_taxonomy_runs', 'Personal taxonomy run status, contract, sample, and quality.'],
  ['personal-taxonomy-activations.json', 'youtube_taxonomy_activations', 'Personal taxonomy activation and rollback history.'],
  ['personal-topic-assignments.json', 'youtube_video_topics', 'Personal topic classifications and their provenance.'],
  ['matching-topic-assignments.json', 'youtube_video_matching_topics', 'Canonical matching-topic classifications.'],
  ['sync-state.json', 'youtube_sync_state', 'Data Portability and worker checkpoints.'],
  ['time-ledger.json', 'time_ledger', 'Derived daily measured and estimated time.'],
  ['time-ledger-state.json', 'time_ledger_state', 'Time-ledger processing checkpoints.'],
] as const;

function portableColumnDescription(name: string): string {
  if (name.endsWith('_at')) return 'ISO 8601 timestamp.';
  if (name.endsWith('_seconds')) return 'Duration in seconds.';
  if (name.endsWith('_percent')) return 'Percentage from 0 to 100.';
  if (name.endsWith('_json')) return 'JSON-encoded structured value.';
  if (name.endsWith('_id') || name === 'id') return 'Stable record identifier.';
  if (name.includes('hash')) return 'Integrity or freshness hash, not a login credential.';
  if (name === 'query') return 'Decrypted search text belonging to the exporting user.';
  return `Stored ${name.replaceAll('_', ' ')} value.`;
}

// Ranked comparison lists stop here so an all-time profile stays bounded.
const YOUTUBE_COMPARISON_LIST_LIMIT = 5000;
// Crystal windows keep this many channels; the registry projection takes a
// prefix (see REGISTRY_CRYSTAL_CHANNEL_LIMIT), so it must not be smaller.
export const YOUTUBE_CRYSTAL_CHANNEL_LIMIT = 250;
function youtubeCutoff(range: YoutubeRange, now: Date): string | null {
  if (range === 'all') return null;
  const days = Number.parseInt(range, 10);
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

function selectedTrendWindow(
  range: YoutubeRange,
  now: Date,
  firstExactWatchAt: string | null,
): { start: string; end: string; periods: string[]; format: '%Y-%m' | '%Y-%m-%d'; smoothing: number } {
  const monthly = range === '365d' || range === 'all';
  const start = range === 'all'
    ? firstExactWatchAt ?? now.toISOString()
    : youtubeCutoff(range, now)!;
  const format = monthly ? '%Y-%m' : '%Y-%m-%d';
  const startTaipei = new Date(Date.parse(start) + 8 * 3600_000);
  const endTaipei = new Date(now.getTime() + 8 * 3600_000);
  const cursor = monthly
    ? new Date(Date.UTC(startTaipei.getUTCFullYear(), startTaipei.getUTCMonth(), 1))
    : new Date(Date.UTC(startTaipei.getUTCFullYear(), startTaipei.getUTCMonth(), startTaipei.getUTCDate()));
  const last = monthly
    ? new Date(Date.UTC(endTaipei.getUTCFullYear(), endTaipei.getUTCMonth(), 1))
    : new Date(Date.UTC(endTaipei.getUTCFullYear(), endTaipei.getUTCMonth(), endTaipei.getUTCDate()));
  const periods: string[] = [];
  while (cursor <= last) {
    periods.push(cursor.toISOString().slice(0, monthly ? 7 : 10));
    if (monthly) cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return {
    start,
    end: now.toISOString(),
    periods,
    format,
    smoothing: monthly ? 3 : 7,
  };
}

// Shared by youtubeDashboard(). Per-event watch seconds: the measured value
// when the extension captured one, zero when a measured event for the same
// video sits within five minutes (a duplicate sighting of the same session),
// saved progress capped at ten minutes for history-page rows that only have
// day precision, otherwise the gap to the next watch/search event capped at
// the video length. When a long inactive gap would imply that the whole video
// was watched, a known saved position is the stronger upper bound. The day
// cap prevents a live stream's multi-day playback position from being mistaken
// for one viewing session.
const YOUTUBE_ESTIMATED_EVENTS_CTE = `
      WITH timeline AS (
        SELECT 'watch' kind, event_id, watched_at occurred_at
        FROM youtube_watch_events WHERE activity_type='video'
        UNION ALL
        SELECT 'search' kind, event_id, searched_at occurred_at
        FROM youtube_search_events
      ), ordered AS (
        SELECT kind, event_id, occurred_at,
          LEAD(occurred_at) OVER (ORDER BY occurred_at, kind, event_id) next_activity_at
        FROM timeline
      ), estimated_events AS (
        SELECT w.*,
          CASE
            WHEN w.actual_watched_seconds IS NOT NULL THEN w.actual_watched_seconds
            WHEN EXISTS (
              SELECT 1 FROM youtube_watch_events measured
              WHERE measured.video_id=w.video_id
                AND measured.actual_watched_seconds IS NOT NULL
                AND ABS((julianday(measured.watched_at)-julianday(w.watched_at))*86400)<=300
            ) THEN 0
            WHEN a.occurred_precision='day' THEN MIN(
              COALESCE(vp.progress_seconds, v.duration_seconds, 0),
              COALESCE(v.duration_seconds, vp.progress_seconds, 0),
              600
            )
            WHEN v.duration_seconds IS NULL OR o.next_activity_at IS NULL THEN 0
            ELSE MIN(
              v.duration_seconds,
              MAX(0, CAST((julianday(o.next_activity_at)-julianday(w.watched_at))*86400 AS INTEGER)),
              CASE
                WHEN (julianday(o.next_activity_at)-julianday(w.watched_at))*86400
                  >= v.duration_seconds
                THEN COALESCE(vp.progress_seconds, v.duration_seconds)
                ELSE v.duration_seconds
              END
            )
          END estimated_watch_seconds
        FROM youtube_watch_events w
        JOIN ordered o ON o.kind='watch' AND o.event_id=w.event_id
        JOIN activities a ON a.id=w.activity_id
        LEFT JOIN youtube_videos v ON v.video_id=w.video_id
        LEFT JOIN youtube_video_progress vp ON vp.video_id=w.video_id
        WHERE w.activity_type='video'
      )
    `;

// Read-side prelude: the same `estimated_events` name, but served from the
// per-connection materialized copy (see Repository.ensureEstimatedEvents)
// instead of re-running the expensive window-function CTE per statement.
const YOUTUBE_ESTIMATED_EVENTS_VIEW = `
      WITH estimated_events AS (SELECT * FROM temp.youtube_estimated_events)
    `;

const ACTIVE_PERSONAL_TAXONOMY_VERSION_SQL =
  "(SELECT taxonomy_version FROM youtube_taxonomy_runs WHERE status='active')";

function personalTaxonomyRunRow(row: Record<string, unknown>): PersonalTaxonomyRun {
  return {
    taxonomyVersion: Number(row.taxonomy_version),
    definitionVersion: String(row.definition_version),
    status: row.status as PersonalTaxonomyRunStatus,
    model: String(row.model),
    promptVersion: String(row.prompt_version),
    createdAt: String(row.created_at),
    activatedAt: row.activated_at === null ? null : String(row.activated_at),
    reviewedAt: row.reviewed_at === null ? null : String(row.reviewed_at),
    dataStartAt: row.data_start_at === null ? null : String(row.data_start_at),
    dataEndAt: row.data_end_at === null ? null : String(row.data_end_at),
    inputVideos: Number(row.input_videos),
    categoryCount: Number(row.category_count),
    sample: row.sampling_manifest_json === null
      ? null : JSON.parse(String(row.sampling_manifest_json)) as PersonalTaxonomySampleManifest,
    quality: row.quality_json === null
      ? null : JSON.parse(String(row.quality_json)) as PersonalTaxonomyRun['quality'],
  };
}

export interface ChannelRaceWeekRow {
  week: string;
  channelId: string | null;
  name: string;
  thumbnailUrl: string;
  estimatedWatchSeconds: number;
}

export const CHANNEL_RACE_HALF_LIFE_DAYS = 90;
const CHANNEL_RACE_TOP = 8;
const CHANNEL_RACE_MIN_SECONDS = 60;

// Full-history race frames: each calendar week every channel's score first
// decays by the half-life, then that week's watch seconds are added. Ranks
// therefore track recent heat instead of freezing on all-time totals, and
// quiet weeks (densified here, so playback speed matches real time) let a
// channel fade out on its own. Rows must be grouped by (week, channel) and
// ordered by week, with weeks aligned to the same weekday.
export function buildChannelRace(
  rows: ChannelRaceWeekRow[],
  halfLifeDays = CHANNEL_RACE_HALF_LIFE_DAYS,
): YoutubeChannelRace {
  const race: YoutubeChannelRace = { halfLifeDays, channels: [], frames: [] };
  if (!rows.length) return race;
  const weekly = new Map<string, ChannelRaceWeekRow[]>();
  for (const row of rows) {
    const bucket = weekly.get(row.week);
    if (bucket) bucket.push(row);
    else weekly.set(row.week, [row]);
  }
  const decay = 0.5 ** (7 / halfLifeDays);
  const scores = new Map<string, {
    channelId: string | null; name: string; thumbnailUrl: string; score: number;
  }>();
  const indexByKey = new Map<string, number>();
  const last = new Date(`${rows[rows.length - 1].week}T00:00:00Z`);
  for (
    let cursor = new Date(`${rows[0].week}T00:00:00Z`);
    cursor <= last;
    cursor.setUTCDate(cursor.getUTCDate() + 7)
  ) {
    const week = cursor.toISOString().slice(0, 10);
    for (const entry of scores.values()) entry.score *= decay;
    for (const row of weekly.get(week) ?? []) {
      const key = row.channelId ?? row.name;
      const entry = scores.get(key);
      if (entry) {
        entry.score += row.estimatedWatchSeconds;
        entry.name = row.name;
        if (row.thumbnailUrl) entry.thumbnailUrl = row.thumbnailUrl;
      } else {
        scores.set(key, {
          channelId: row.channelId,
          name: row.name,
          thumbnailUrl: row.thumbnailUrl,
          score: row.estimatedWatchSeconds,
        });
      }
    }
    for (const [key, entry] of scores) {
      if (entry.score < CHANNEL_RACE_MIN_SECONDS) scores.delete(key);
    }
    const top = [...scores.entries()]
      .sort((a, b) => b[1].score - a[1].score || a[1].name.localeCompare(b[1].name))
      .slice(0, CHANNEL_RACE_TOP);
    if (!top.length) continue;
    race.frames.push({
      period: week,
      entries: top.map(([key, entry]) => {
        let index = indexByKey.get(key);
        if (index === undefined) {
          index = race.channels.length;
          indexByKey.set(key, index);
          race.channels.push({
            channelId: entry.channelId, name: entry.name, thumbnailUrl: entry.thumbnailUrl,
          });
        } else {
          race.channels[index].name = entry.name;
          if (entry.thumbnailUrl) race.channels[index].thumbnailUrl = entry.thumbnailUrl;
        }
        return [index, Math.round(entry.score)];
      }),
    });
  }
  // Keep the race field populated before every eventual contender has earned
  // a score. Without this, the first historical frames can show only a few
  // rows even though many channels join the race later. A future contender is
  // present at 0h until its first top-eight frame; its score is never
  // backfilled into the past.
  const firstFrameByChannel = new Map<number, number>();
  race.frames.forEach((frame, frameIndex) => {
    for (const [channelIndex] of frame.entries) {
      if (!firstFrameByChannel.has(channelIndex)) {
        firstFrameByChannel.set(channelIndex, frameIndex);
      }
    }
  });
  race.frames.forEach((frame, frameIndex) => {
    if (frame.entries.length >= CHANNEL_RACE_TOP) return;
    const present = new Set(frame.entries.map(([channelIndex]) => channelIndex));
    const upcoming = [...firstFrameByChannel.entries()]
      .filter(([channelIndex, firstFrame]) => firstFrame > frameIndex && !present.has(channelIndex))
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    for (const [channelIndex] of upcoming) {
      frame.entries.push([channelIndex, 0]);
      if (frame.entries.length >= CHANNEL_RACE_TOP) break;
    }
  });
  return race;
}

export class Repository {
  private readonly db: DatabaseSync;
  private readonly path: string;
  private estimatedEventsKey = '';
  private estimatedEventsBuiltAt = 0;
  private estimatedEventsRevision = '';

  // data_version observes other connections (ingest/worker); total_changes
  // observes writes through this connection, including updates with no new rows.
  readRevision(): string {
    const version = this.db.prepare('PRAGMA main.data_version').get()!.data_version;
    const changes = this.db.prepare('SELECT total_changes() AS n').get()!.n;
    return `${version}:${changes}`;
  }

  constructor(path: string) {
    this.path = path;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
    this.backfillYoutubeChannelIds();
  }

  // Extension captures often know the video but not its channel, so those
  // events fall back to a channel-name key while Takeout rows carry the id.
  // Once metadata names the channel, copy it onto the events so every reader
  // (and every cross-user comparison) keys the channel the same way.
  backfillYoutubeChannelIds(videoIds?: string[]): number {
    const statement = this.db.prepare(`
      UPDATE youtube_watch_events SET
        channel_id=(SELECT v.channel_id FROM youtube_videos v WHERE v.video_id=youtube_watch_events.video_id),
        channel_title=COALESCE(NULLIF(channel_title, ''),
          (SELECT v.channel_title FROM youtube_videos v WHERE v.video_id=youtube_watch_events.video_id))
      WHERE channel_id IS NULL AND video_id IS NOT NULL${videoIds ? ' AND video_id=?' : ''}
        AND EXISTS (
          SELECT 1 FROM youtube_videos v
          WHERE v.video_id=youtube_watch_events.video_id AND v.channel_id IS NOT NULL
        )
    `);
    if (!videoIds) return Number(statement.run().changes);
    let changed = 0;
    for (const videoId of videoIds) changed += Number(statement.run(videoId).changes);
    return changed;
  }

  close(): void { this.db.close(); }

  openPortableExport(dataKey: string): PortableRepositoryExport {
    if (!dataKey) throw new Error('Private data key is required for export');
    const database = this.path === ':memory:'
      ? this.db
      : new DatabaseSync(this.path, { readOnly: true });
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      database.exec('ROLLBACK');
      if (database !== this.db) database.close();
    };
    database.exec('BEGIN');
    try {
      const schemaVersion = Number((database.prepare('PRAGMA user_version').get() as
        { user_version: number }).user_version);
      const tables = PORTABLE_TABLES.map(([file, source, description]): PortableExportTable => {
        const rawColumns = database.prepare(`PRAGMA table_info(${source})`).all() as Array<{
          name: string;
          type: string;
          notnull: number;
        }>;
        const columns = rawColumns.map((column) => ({
          name: source === 'youtube_search_events' && column.name === 'query_ciphertext'
            ? 'query' : column.name,
          type: column.type,
          nullable: column.notnull === 0,
          description: portableColumnDescription(
            source === 'youtube_search_events' && column.name === 'query_ciphertext'
              ? 'query' : column.name,
          ),
        }));
        const rowCount = Number((database.prepare(`SELECT COUNT(*) count FROM ${source}`).get() as
          { count: number }).count);
        const rows = function* (): Iterable<Record<string, unknown>> {
          const iterator = database.prepare(`SELECT * FROM ${source} ORDER BY rowid`).iterate();
          for (const raw of iterator) {
            const row = { ...raw } as Record<string, unknown>;
            if (source === 'youtube_search_events') {
              row.query = decryptPrivateValue(String(row.query_ciphertext), dataKey);
              delete row.query_ciphertext;
            }
            yield row;
          }
        };
        return { file: `data/${file}`, source, description, columns, rowCount, rows };
      });
      return { schemaVersion, tables, close };
    } catch (error) {
      close();
      throw error;
    }
  }

  // Versions 1–8 remain byte-compatible with Infovore, so an imported
  // production database upgrades in place. Later urtube-only migrations are
  // additive; snapshots, sync_runs, and time_ledger* remain unused.
  private migrate(): void {
    const version = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version < 1) {
      this.db.exec(`
        BEGIN;
      CREATE TABLE snapshots (
        source TEXT PRIMARY KEY,
        payload_json TEXT,
        fetched_at TEXT,
        error TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE activities (
        id TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        source_item_id TEXT,
        type TEXT NOT NULL,
        media_kind TEXT NOT NULL,
        title TEXT NOT NULL,
        image TEXT NOT NULL,
        status TEXT,
        occurred_at TEXT,
        occurred_precision TEXT NOT NULL,
        rating_value REAL,
        rating_scale REAL,
        visibility TEXT NOT NULL CHECK (visibility IN ('public', 'summary', 'private')),
        extra_json TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE INDEX activities_timeline_idx ON activities(occurred_at DESC, first_seen_at DESC);
      CREATE INDEX activities_source_idx ON activities(source, last_seen_at DESC);
      CREATE TABLE sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error')),
        entries_seen INTEGER NOT NULL DEFAULT 0,
        inserted_count INTEGER NOT NULL DEFAULT 0,
        updated_count INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      CREATE INDEX sync_runs_source_idx ON sync_runs(source, started_at DESC);
      PRAGMA user_version = 1;
      COMMIT;
      `);
    }
    const current = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (current.user_version < 2) this.migrateYoutube();
    const afterYoutube = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (afterYoutube.user_version < 3) this.migrateYoutubeActivityTypes();
    const afterActivityTypes = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (afterActivityTypes.user_version < 4) this.migrateYoutubeChannels();
    const afterYoutubeChannels = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (afterYoutubeChannels.user_version < 5) this.migrateYoutubeProgress();
    const afterYoutubeProgress = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (afterYoutubeProgress.user_version < 6) this.migrateYoutubeExtensionImports();
    const afterExtensionImports = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (afterExtensionImports.user_version < 7) this.migrateTimeLedger();
    const afterTimeLedger = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (afterTimeLedger.user_version < 8) this.migrateBackloggdDailyLedger();
    const afterBackloggd = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (afterBackloggd.user_version < 9) this.migrateYoutubeScanSummaries();
    const afterScanSummaries = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (afterScanSummaries.user_version < 10) this.migrateYoutubeMatchingTopics();
    const afterMatchingTopics = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (afterMatchingTopics.user_version < 11) this.migratePersonalTaxonomyRuns();
    const afterTaxonomy = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (afterTaxonomy.user_version < 12) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        // App, ingest and worker may start together against the same archive.
        const columns = this.db.prepare('PRAGMA table_info(youtube_channels)').all() as Array<{ name: string }>;
        if (!columns.some((column) => column.name === 'statistics_json')) this.db.exec('ALTER TABLE youtube_channels ADD COLUMN statistics_json TEXT');
        if (!columns.some((column) => column.name === 'statistics_fetched_at')) this.db.exec('ALTER TABLE youtube_channels ADD COLUMN statistics_fetched_at TEXT');
        this.db.exec('PRAGMA user_version = 12; COMMIT;');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
    const afterChannelStatistics = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (afterChannelStatistics.user_version < 13) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const columns = this.db.prepare('PRAGMA table_info(youtube_videos)').all() as Array<{ name: string }>;
        if (!columns.some((column) => column.name === 'is_livestream')) {
          this.db.exec('ALTER TABLE youtube_videos ADD COLUMN is_livestream INTEGER CHECK (is_livestream IN (0, 1))');
        }
        this.db.exec('PRAGMA user_version = 13; COMMIT;');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
    if (Number((this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version) < 14) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const columns = this.db.prepare('PRAGMA table_info(youtube_videos)').all() as Array<{ name: string }>;
        if (!columns.some(column => column.name === 'view_count')) this.db.exec('ALTER TABLE youtube_videos ADD COLUMN view_count INTEGER CHECK(view_count>=0)');
        if (!columns.some(column => column.name === 'statistics_fetched_at')) this.db.exec('ALTER TABLE youtube_videos ADD COLUMN statistics_fetched_at TEXT');
        this.db.exec('PRAGMA user_version=14; COMMIT;');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
  }

  private migrateYoutube(): void {
    const activitiesSql = (this.db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='activities'"
    ).get() as { sql: string }).sql;
    this.db.exec('BEGIN');
    try {
      if (!activitiesSql.includes("'summary'")) {
        this.db.exec(`
          DROP INDEX activities_timeline_idx;
          DROP INDEX activities_source_idx;
          ALTER TABLE activities RENAME TO activities_v1;
          CREATE TABLE activities (
            id TEXT PRIMARY KEY,
            dedupe_key TEXT NOT NULL UNIQUE,
            source TEXT NOT NULL,
            source_item_id TEXT,
            type TEXT NOT NULL,
            media_kind TEXT NOT NULL,
            title TEXT NOT NULL,
            image TEXT NOT NULL,
            status TEXT,
            occurred_at TEXT,
            occurred_precision TEXT NOT NULL,
            rating_value REAL,
            rating_scale REAL,
            visibility TEXT NOT NULL CHECK (visibility IN ('public', 'summary', 'private')),
            extra_json TEXT NOT NULL,
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL
          );
          INSERT INTO activities SELECT * FROM activities_v1;
          DROP TABLE activities_v1;
          CREATE INDEX activities_timeline_idx ON activities(occurred_at DESC, first_seen_at DESC);
          CREATE INDEX activities_source_idx ON activities(source, last_seen_at DESC);
        `);
      }
      this.db.exec(`
        CREATE TABLE youtube_imports (
          archive_hash TEXT PRIMARY KEY,
          source TEXT NOT NULL CHECK (source IN ('takeout', 'dataportability')),
          imported_at TEXT NOT NULL,
          watches_seen INTEGER NOT NULL,
          watches_inserted INTEGER NOT NULL,
          searches_seen INTEGER NOT NULL,
          searches_inserted INTEGER NOT NULL
        );
        CREATE TABLE youtube_videos (
          video_id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          channel_id TEXT,
          channel_title TEXT,
          description TEXT NOT NULL DEFAULT '',
          tags_json TEXT NOT NULL DEFAULT '[]',
          thumbnail_url TEXT NOT NULL DEFAULT '',
          duration_seconds INTEGER,
          published_at TEXT,
          category_id TEXT,
          availability TEXT NOT NULL DEFAULT 'unknown'
            CHECK (availability IN ('unknown', 'available', 'unavailable')),
          metadata_hash TEXT NOT NULL DEFAULT '',
          metadata_fetched_at TEXT
        );
        CREATE TABLE youtube_watch_events (
          event_id TEXT PRIMARY KEY,
          activity_id TEXT NOT NULL UNIQUE REFERENCES activities(id) ON DELETE CASCADE,
          video_id TEXT REFERENCES youtube_videos(video_id),
          watched_at TEXT NOT NULL,
          raw_title TEXT NOT NULL,
          raw_url TEXT NOT NULL,
          channel_id TEXT,
          channel_title TEXT,
          channel_url TEXT,
          actual_watched_seconds INTEGER,
          imported_at TEXT NOT NULL
        );
        CREATE INDEX youtube_watch_time_idx ON youtube_watch_events(watched_at DESC);
        CREATE INDEX youtube_watch_video_idx ON youtube_watch_events(video_id, watched_at DESC);
        CREATE TABLE youtube_search_events (
          event_id TEXT PRIMARY KEY,
          searched_at TEXT NOT NULL,
          query_ciphertext TEXT NOT NULL,
          imported_at TEXT NOT NULL
        );
        CREATE INDEX youtube_search_time_idx ON youtube_search_events(searched_at DESC);
        CREATE TABLE youtube_topics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          taxonomy_version INTEGER NOT NULL,
          slug TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(taxonomy_version, slug)
        );
        CREATE TABLE youtube_video_topics (
          video_id TEXT NOT NULL REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
          topic_id INTEGER NOT NULL REFERENCES youtube_topics(id) ON DELETE CASCADE,
          rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 3),
          confidence REAL NOT NULL,
          model TEXT NOT NULL,
          prompt_version TEXT NOT NULL,
          metadata_hash TEXT NOT NULL,
          classified_at TEXT NOT NULL,
          PRIMARY KEY(video_id, topic_id)
        );
        CREATE INDEX youtube_video_topics_rank_idx ON youtube_video_topics(topic_id, rank);
        CREATE TABLE youtube_oauth (
          id INTEGER PRIMARY KEY CHECK (id=1),
          encrypted_refresh_token TEXT NOT NULL,
          expires_at TEXT,
          scope TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE youtube_oauth_states (
          state TEXT PRIMARY KEY,
          expires_at TEXT NOT NULL,
          used_at TEXT
        );
        CREATE TABLE youtube_sync_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        PRAGMA user_version = 2;
        COMMIT;
      `);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private migrateYoutubeActivityTypes(): void {
    this.db.exec(`
      BEGIN;
      ALTER TABLE youtube_watch_events ADD COLUMN activity_type TEXT NOT NULL DEFAULT 'video'
        CHECK (activity_type IN ('video', 'post', 'other'));
      ALTER TABLE youtube_search_events ADD COLUMN activity_type TEXT NOT NULL DEFAULT 'search'
        CHECK (activity_type IN ('search', 'visit', 'other'));
      PRAGMA user_version = 3;
      COMMIT;
    `);
  }

  private migrateYoutubeChannels(): void {
    this.db.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS youtube_channels (
        channel_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        thumbnail_url TEXT NOT NULL,
        metadata_fetched_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS youtube_channels_fetched_idx ON youtube_channels(metadata_fetched_at);
      PRAGMA user_version = 4;
      COMMIT;
    `);
  }

  private migrateYoutubeProgress(): void {
    this.db.exec(`
      BEGIN;
      CREATE TABLE youtube_progress_imports (
        scan_id TEXT PRIMARY KEY,
        observed_at TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE youtube_video_progress (
        video_id TEXT PRIMARY KEY REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
        progress_percent REAL,
        resume_seconds INTEGER,
        duration_seconds INTEGER,
        progress_seconds INTEGER,
        confidence TEXT NOT NULL CHECK (confidence IN ('resume', 'progress')),
        observed_at TEXT NOT NULL,
        scan_id TEXT NOT NULL REFERENCES youtube_progress_imports(scan_id)
      );
      CREATE INDEX youtube_video_progress_scan_idx
        ON youtube_video_progress(scan_id, observed_at DESC);
      PRAGMA user_version = 5;
      COMMIT;
    `);
  }

  private migrateYoutubeExtensionImports(): void {
    this.db.exec(`
      BEGIN;
      ALTER TABLE youtube_imports RENAME TO youtube_imports_v5;
      CREATE TABLE youtube_imports (
        archive_hash TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK (source IN ('takeout', 'dataportability', 'extension')),
        imported_at TEXT NOT NULL,
        watches_seen INTEGER NOT NULL,
        watches_inserted INTEGER NOT NULL,
        searches_seen INTEGER NOT NULL,
        searches_inserted INTEGER NOT NULL
      );
      INSERT INTO youtube_imports SELECT * FROM youtube_imports_v5;
      DROP TABLE youtube_imports_v5;
      PRAGMA user_version = 6;
      COMMIT;
    `);
  }

  private migrateTimeLedger(): void {
    this.db.exec(`
      BEGIN;
      CREATE TABLE time_ledger (
        day TEXT NOT NULL,
        source TEXT NOT NULL,
        seconds INTEGER NOT NULL CHECK (seconds >= 0),
        method TEXT NOT NULL CHECK (method IN ('measured', 'estimated')),
        detail_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (day, source)
      );
      CREATE INDEX time_ledger_source_idx ON time_ledger(source, day DESC);
      CREATE TABLE time_ledger_state (
        source TEXT NOT NULL,
        key TEXT NOT NULL,
        value INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (source, key)
      );
      PRAGMA user_version = 7;
      COMMIT;
    `);
  }

  private migrateBackloggdDailyLedger(): void {
    this.db.exec(`
      BEGIN;
      DELETE FROM time_ledger WHERE source = 'backloggd';
      DELETE FROM time_ledger_state WHERE source = 'backloggd';
      PRAGMA user_version = 8;
      COMMIT;
    `);
  }

  // How each history-page scan ended, reported by the extension with its
  // completing batch. Covering scans define how far back the archive is
  // known, which is what lets a daily sync stop early instead of re-reading
  // the whole page or guessing with a fixed video cap.
  private migrateYoutubeScanSummaries(): void {
    this.db.exec(`
      BEGIN;
      ALTER TABLE youtube_progress_imports ADD COLUMN mode TEXT;
      ALTER TABLE youtube_progress_imports ADD COLUMN videos INTEGER;
      ALTER TABLE youtube_progress_imports ADD COLUMN passes INTEGER;
      ALTER TABLE youtube_progress_imports ADD COLUMN end_reason TEXT;
      ALTER TABLE youtube_progress_imports ADD COLUMN oldest_watched_at TEXT;
      ALTER TABLE youtube_progress_imports ADD COLUMN newest_watched_at TEXT;
      ALTER TABLE youtube_progress_imports ADD COLUMN error TEXT;
      ALTER TABLE youtube_progress_imports ADD COLUMN landed_url TEXT;
      CREATE INDEX IF NOT EXISTS youtube_progress_imports_coverage_idx
        ON youtube_progress_imports(end_reason, observed_at DESC);
      PRAGMA user_version = 9;
      COMMIT;
    `);
  }

  private migrateYoutubeMatchingTopics(): void {
    this.db.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS youtube_video_matching_topics (
        video_id TEXT NOT NULL REFERENCES youtube_videos(video_id) ON DELETE CASCADE,
        taxonomy_version INTEGER NOT NULL,
        topic_key TEXT,
        metadata_hash TEXT NOT NULL,
        classified_at TEXT NOT NULL,
        PRIMARY KEY(video_id, taxonomy_version)
      );
      CREATE INDEX IF NOT EXISTS youtube_video_matching_topics_version_idx
        ON youtube_video_matching_topics(taxonomy_version, topic_key);
      PRAGMA user_version = 10;
      COMMIT;
    `);
  }

  private migratePersonalTaxonomyRuns(): void {
    this.db.exec(`
      BEGIN;
      ALTER TABLE youtube_video_topics ADD COLUMN decision TEXT NOT NULL DEFAULT 'accepted'
        CHECK (decision IN ('accepted', 'unknown', 'low-confidence'));
      ALTER TABLE youtube_video_topics ADD COLUMN alternative_slug TEXT;
      ALTER TABLE youtube_video_topics ADD COLUMN alternative_confidence REAL;
      ALTER TABLE youtube_video_topics ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '[]';
      CREATE TABLE youtube_taxonomy_runs (
        taxonomy_version INTEGER PRIMARY KEY,
        definition_version TEXT NOT NULL,
        status TEXT NOT NULL
          CHECK (status IN ('candidate', 'ready', 'blocked', 'active', 'retired')),
        model TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        activated_at TEXT,
        reviewed_at TEXT,
        data_start_at TEXT,
        data_end_at TEXT,
        input_videos INTEGER NOT NULL,
        category_count INTEGER NOT NULL,
        sampling_manifest_json TEXT,
        quality_json TEXT
      );
      INSERT INTO youtube_taxonomy_runs(
        taxonomy_version, definition_version, status, model, prompt_version,
        created_at, activated_at, reviewed_at, data_start_at, data_end_at,
        input_videos, category_count, sampling_manifest_json, quality_json
      )
      SELECT t.taxonomy_version, 'personal-generated-v1',
        CASE WHEN t.taxonomy_version=(SELECT MAX(taxonomy_version) FROM youtube_topics)
          THEN 'active' ELSE 'retired' END,
        COALESCE((SELECT vt.model FROM youtube_video_topics vt
          JOIN youtube_topics assigned ON assigned.id=vt.topic_id
          WHERE assigned.taxonomy_version=t.taxonomy_version LIMIT 1), 'unknown'),
        COALESCE((SELECT vt.prompt_version FROM youtube_video_topics vt
          JOIN youtube_topics assigned ON assigned.id=vt.topic_id
          WHERE assigned.taxonomy_version=t.taxonomy_version LIMIT 1), 'youtube-topics-v1'),
        MIN(t.created_at),
        CASE WHEN t.taxonomy_version=(SELECT MAX(taxonomy_version) FROM youtube_topics)
          THEN MIN(t.created_at) ELSE NULL END,
        NULL,
        (SELECT MIN(watched_at) FROM youtube_watch_events WHERE activity_type='video'),
        (SELECT MAX(watched_at) FROM youtube_watch_events WHERE activity_type='video'),
        (SELECT COUNT(*) FROM youtube_videos
          WHERE metadata_fetched_at IS NOT NULL AND availability='available'),
        COUNT(*), NULL, NULL
      FROM youtube_topics t
      GROUP BY t.taxonomy_version;
      CREATE UNIQUE INDEX youtube_taxonomy_runs_active_idx
        ON youtube_taxonomy_runs(status) WHERE status='active';
      CREATE INDEX youtube_taxonomy_runs_created_idx
        ON youtube_taxonomy_runs(created_at DESC);
      CREATE TABLE youtube_taxonomy_activations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_version INTEGER,
        to_version INTEGER NOT NULL REFERENCES youtube_taxonomy_runs(taxonomy_version),
        action TEXT NOT NULL CHECK (action IN ('activate', 'rollback')),
        changed_at TEXT NOT NULL
      );
      CREATE INDEX youtube_taxonomy_activations_changed_idx
        ON youtube_taxonomy_activations(changed_at DESC);
      PRAGMA user_version = 11;
      COMMIT;
    `);
  }

  queryActivities(query: ActivityQuery = {}): ActivityPage {
    const limit = Math.max(1, Math.min(500, Math.floor(query.limit ?? 100)));
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const where = ["visibility='public'"];
    const params: Array<string | number> = [];
    const add = (sql: string, value: string) => { where.push(sql); params.push(value); };
    if (query.source) add('source=?', query.source);
    if (query.kind) add('media_kind=?', query.kind);
    if (query.status) add('status=?', query.status);
    if (query.since) add('occurred_at>=?', query.since);
    if (query.until) add('occurred_at<=?', query.until);
    if (query.query) {
      where.push('(title LIKE ? OR extra_json LIKE ?)');
      params.push(`%${query.query}%`, `%${query.query}%`);
    }
    const clause = where.join(' AND ');
    const totalRow = this.db.prepare(`SELECT COUNT(*) count FROM activities WHERE ${clause}`)
      .get(...params) as { count: number };
    const rows = this.db.prepare(`
      SELECT * FROM activities WHERE ${clause}
      ORDER BY CASE WHEN occurred_precision IN ('exact', 'day') THEN 0 ELSE 1 END,
               occurred_at DESC, first_seen_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as Record<string, unknown>[];
    return { data: rows.map((row) => this.rowToActivity(row)), total: Number(totalRow.count), limit, offset };
  }

  private rowToActivity(row: Record<string, unknown>): Activity {
    return {
      id: String(row.id), dedupeKey: String(row.dedupe_key), source: String(row.source),
      sourceItemId: row.source_item_id === null ? null : String(row.source_item_id),
      type: String(row.type), mediaKind: row.media_kind as Activity['mediaKind'], title: String(row.title),
      image: String(row.image), status: row.status === null ? null : String(row.status),
      occurredAt: row.occurred_at === null ? null : String(row.occurred_at),
      occurredAtPrecision: row.occurred_precision as Activity['occurredAtPrecision'],
      rating: row.rating_value === null ? null : { value: Number(row.rating_value), scale: Number(row.rating_scale) },
      visibility: row.visibility as Activity['visibility'],
      extra: JSON.parse(String(row.extra_json)) as Activity['extra'],
      firstSeenAt: String(row.first_seen_at), lastSeenAt: String(row.last_seen_at),
    };
  }

  ingestEntries(entries: SourceSnapshot['entries'], seenAt = new Date().toISOString()): PersistResult {
    let inserted = 0;
    let updated = 0;
    const exists = this.db.prepare('SELECT 1 FROM activities WHERE id = ?');
    const upsert = this.db.prepare(`
      INSERT INTO activities (
        id, dedupe_key, source, source_item_id, type, media_kind, title, image,
        status, occurred_at, occurred_precision, rating_value, rating_scale,
        visibility, extra_json, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        dedupe_key=excluded.dedupe_key, type=excluded.type, title=excluded.title,
        image=excluded.image, status=excluded.status,
        occurred_at=excluded.occurred_at, occurred_precision=excluded.occurred_precision,
        rating_value=excluded.rating_value, rating_scale=excluded.rating_scale,
        visibility=excluded.visibility, extra_json=excluded.extra_json,
        last_seen_at=excluded.last_seen_at
    `);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const entry of entries) {
        const activity = activityFromEntry(entry, seenAt);
        const wasPresent = Boolean(exists.get(activity.id));
        upsert.run(
          activity.id, activity.dedupeKey, activity.source, activity.sourceItemId,
          activity.type, activity.mediaKind, activity.title, activity.image,
          activity.status, activity.occurredAt, activity.occurredAtPrecision,
          activity.rating?.value ?? null, activity.rating?.scale ?? null,
          activity.visibility, JSON.stringify(activity.extra), activity.firstSeenAt, activity.lastSeenAt
        );
        wasPresent ? updated++ : inserted++;
      }
      this.db.exec('COMMIT');
      return { inserted, updated };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  ingestYoutubeArchive(archive: YoutubeParsedArchive, importedAt = new Date().toISOString()): YoutubeImportResult {
    let watchesInserted = 0;
    let searchesInserted = 0;
    const activityExists = this.db.prepare('SELECT 1 FROM activities WHERE id=?');
    const insertActivity = this.db.prepare(`
      INSERT INTO activities (
        id, dedupe_key, source, source_item_id, type, media_kind, title, image,
        status, occurred_at, occurred_precision, rating_value, rating_scale,
        visibility, extra_json, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, image=excluded.image, extra_json=excluded.extra_json,
        last_seen_at=excluded.last_seen_at
    `);
    const insertVideo = this.db.prepare(`
      INSERT INTO youtube_videos (
        video_id, title, channel_id, channel_title, thumbnail_url, duration_seconds
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET
        title=CASE WHEN youtube_videos.metadata_fetched_at IS NULL THEN excluded.title ELSE youtube_videos.title END,
        channel_id=COALESCE(youtube_videos.channel_id, excluded.channel_id),
        channel_title=COALESCE(youtube_videos.channel_title, excluded.channel_title),
        thumbnail_url=CASE WHEN youtube_videos.thumbnail_url='' THEN excluded.thumbnail_url ELSE youtube_videos.thumbnail_url END,
        duration_seconds=COALESCE(youtube_videos.duration_seconds, excluded.duration_seconds)
    `);
    const insertWatch = this.db.prepare(`
      INSERT OR IGNORE INTO youtube_watch_events (
        event_id, activity_id, video_id, watched_at, raw_title, raw_url,
        channel_id, channel_title, channel_url, actual_watched_seconds, imported_at, activity_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertSearch = this.db.prepare(`
      INSERT OR IGNORE INTO youtube_search_events (
        event_id, searched_at, query_ciphertext, imported_at, activity_type
      ) VALUES (?, ?, ?, ?, ?)
    `);
    const watchSecondKeys = new Set(this.db.prepare(`
      SELECT substr(watched_at, 1, 19) watched_second,
        COALESCE(video_id, NULLIF(raw_url, ''), raw_title) identity
      FROM youtube_watch_events
    `).all().map((row) => {
      const value = row as { watched_second: string; identity: string };
      return `${value.watched_second}\u001f${value.identity}`;
    }));
    const searchSeconds = new Set(this.db.prepare(`
      SELECT substr(searched_at, 1, 19) searched_second
      FROM youtube_search_events
    `).all().map((row) => String((row as { searched_second: string }).searched_second)));
    const watchMinuteKeys = new Set(this.db.prepare(`
      SELECT substr(watched_at, 1, 16) watched_minute,
        COALESCE(video_id, NULLIF(raw_url, ''), raw_title) identity
      FROM youtube_watch_events
    `).all().map((row) => {
      const value = row as { watched_minute: string; identity: string };
      return `${value.watched_minute}\u001f${value.identity}`;
    }));

    // Day-precision backfill events dedupe per Taipei calendar day: one per
    // video per day, and never next to an existing event of any precision.
    const watchDayKeys = new Set(this.db.prepare(`
      SELECT strftime('%Y-%m-%d', watched_at, '+8 hours') watched_day,
        COALESCE(video_id, NULLIF(raw_url, ''), raw_title) identity
      FROM youtube_watch_events
    `).all().map((row) => {
      const value = row as { watched_day: string; identity: string };
      return `${value.watched_day}\u001f${value.identity}`;
    }));
    const selectDayPlaceholders = this.db.prepare(`
      SELECT w.event_id, w.activity_id
      FROM youtube_watch_events w JOIN activities a ON a.id = w.activity_id
      WHERE a.occurred_precision = 'day'
        AND COALESCE(w.video_id, NULLIF(w.raw_url, ''), w.raw_title) = ?
        AND strftime('%Y-%m-%d', w.watched_at, '+8 hours') = ?
    `);
    const deleteWatchEvent = this.db.prepare('DELETE FROM youtube_watch_events WHERE event_id=?');
    const deleteActivity = this.db.prepare('DELETE FROM activities WHERE id=?');

    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const watch of archive.watches) {
        const identity = watch.videoId ?? (watch.url || watch.title);
        const secondKey = `${watch.watchedAt.slice(0, 19)}\u001f${identity}`;
        const minuteKey = `${watch.watchedAt.slice(0, 16)}\u001f${identity}`;
        const dayKey = `${taipeiDay(watch.watchedAt)}\u001f${identity}`;
        // HTML Takeout records omit milliseconds. Match at second precision so
        // importing HTML after JSON does not duplicate the overlapping window.
        const thumbnail = watch.videoId ? `https://i.ytimg.com/vi/${watch.videoId}/hqdefault.jpg` : '';
        if (watch.videoId) {
          insertVideo.run(
            watch.videoId, watch.title, watch.channelId, watch.channelTitle,
            thumbnail, watch.durationSeconds ?? null,
          );
        }
        if (
          watchSecondKeys.has(secondKey)
          || (archive.source === 'extension' && watchMinuteKeys.has(minuteKey))
        ) continue;
        if (watch.precision === 'day') {
          if (watchDayKeys.has(dayKey)) continue;
        } else if (watch.videoId) {
          // An exact event supersedes any day-precision placeholder for the
          // same video on the same Taipei day.
          const placeholders = selectDayPlaceholders.all(identity, taipeiDay(watch.watchedAt)) as
            Array<{ event_id: string; activity_id: string }>;
          for (const row of placeholders) {
            deleteWatchEvent.run(row.event_id);
            deleteActivity.run(row.activity_id);
          }
        }
        const activity = activityFromEntry({
          source: 'youtube',
          sourceItemId: watch.videoId ?? watch.eventId,
          visibility: 'summary',
          kind: 'video',
          title: watch.title.slice(0, 500),
          image: thumbnail,
          status: watch.activityType === 'video' ? 'watched' : watch.activityType,
          activityAt: watch.precision === 'day' ? taipeiDay(watch.watchedAt) : watch.watchedAt,
          rating: null,
          extra: {
            channel: watch.channelTitle ?? '',
            channelId: watch.channelId ?? '',
            url: watch.url,
          },
        }, importedAt);
        const wasPresent = Boolean(activityExists.get(activity.id));
        insertActivity.run(
          activity.id, activity.dedupeKey, activity.source, activity.sourceItemId,
          activity.type, activity.mediaKind, activity.title, activity.image,
          activity.status, activity.occurredAt, activity.occurredAtPrecision,
          null, null, activity.visibility, JSON.stringify(activity.extra),
          activity.firstSeenAt, activity.lastSeenAt
        );
        const result = insertWatch.run(
          watch.eventId, activity.id, watch.videoId, watch.watchedAt, watch.title,
          watch.url, watch.channelId, watch.channelTitle, watch.channelUrl,
          watch.actualWatchedSeconds, importedAt, watch.activityType
        );
        if (Number(result.changes) > 0) {
          watchesInserted++;
          watchSecondKeys.add(secondKey);
          watchMinuteKeys.add(minuteKey);
          watchDayKeys.add(dayKey);
        }
        // A prior interrupted import can leave the generic activity but not the
        // YouTube event. Count only the canonical event insert.
        if (wasPresent && Number(result.changes) === 0) continue;
      }
      for (const search of archive.searches) {
        const searchedSecond = search.searchedAt.slice(0, 19);
        // Search HTML also omits milliseconds. Takeout emits at most one search
        // record per second, so time is the only private-safe cross-format key.
        if (searchSeconds.has(searchedSecond)) continue;
        const result = insertSearch.run(
          search.eventId, search.searchedAt, search.queryCiphertext, importedAt, search.activityType
        );
        if (Number(result.changes) > 0) {
          searchesInserted++;
          searchSeconds.add(searchedSecond);
        }
      }
      this.db.prepare(`
        INSERT OR IGNORE INTO youtube_imports (
          archive_hash, source, imported_at, watches_seen, watches_inserted,
          searches_seen, searches_inserted
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        archive.archiveHash, archive.source, importedAt, archive.watches.length,
        watchesInserted, archive.searches.length, searchesInserted
      );
      // A Takeout row may carry the channel id that earlier capture rows for the
      // same video lacked; reconcile before the import becomes visible.
      this.backfillYoutubeChannelIds();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return {
      archiveHash: archive.archiveHash,
      watchesSeen: archive.watches.length,
      watchesInserted,
      searchesSeen: archive.searches.length,
      searchesInserted,
    };
  }

  upsertYoutubeCapture(
    watch: YoutubeCapturedWatch,
    importedAt = new Date().toISOString(),
  ): YoutubeCaptureResult {
    const existing = this.db.prepare(`
      SELECT video_id, watched_at, actual_watched_seconds
      FROM youtube_watch_events WHERE event_id=?
    `).get(watch.eventId) as {
      video_id: string;
      watched_at: string;
      actual_watched_seconds: number | null;
    } | undefined;
    if (existing && (existing.video_id !== watch.videoId || existing.watched_at !== watch.watchedAt)) {
      throw new Error('Capture session conflicts with an existing watch event');
    }

    const thumbnail = `https://i.ytimg.com/vi/${watch.videoId}/hqdefault.jpg`;
    const activity = activityFromEntry({
      source: 'youtube',
      sourceItemId: watch.videoId,
      visibility: 'summary',
      kind: 'video',
      title: watch.title,
      image: thumbnail,
      status: 'watched',
      activityAt: watch.watchedAt,
      rating: null,
      extra: {
        channel: watch.channelTitle ?? '',
        channelId: '',
        url: watch.url,
      },
    }, importedAt);

    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO youtube_videos (
          video_id, title, channel_title, thumbnail_url, duration_seconds
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(video_id) DO UPDATE SET
          title=CASE WHEN youtube_videos.metadata_fetched_at IS NULL
            THEN excluded.title ELSE youtube_videos.title END,
          channel_title=COALESCE(youtube_videos.channel_title, excluded.channel_title),
          thumbnail_url=CASE WHEN youtube_videos.thumbnail_url=''
            THEN excluded.thumbnail_url ELSE youtube_videos.thumbnail_url END,
          duration_seconds=COALESCE(youtube_videos.duration_seconds, excluded.duration_seconds)
      `).run(
        watch.videoId, watch.title, watch.channelTitle, thumbnail, watch.durationSeconds
      );
      this.db.prepare(`
        INSERT INTO activities (
          id, dedupe_key, source, source_item_id, type, media_kind, title, image,
          status, occurred_at, occurred_precision, rating_value, rating_scale,
          visibility, extra_json, first_seen_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title=excluded.title, image=excluded.image, extra_json=excluded.extra_json,
          last_seen_at=excluded.last_seen_at
      `).run(
        activity.id, activity.dedupeKey, activity.source, activity.sourceItemId,
        activity.type, activity.mediaKind, activity.title, activity.image,
        activity.status, activity.occurredAt, activity.occurredAtPrecision,
        null, null, activity.visibility, JSON.stringify(activity.extra),
        activity.firstSeenAt, activity.lastSeenAt
      );
      this.db.prepare(`
        INSERT INTO youtube_watch_events (
          event_id, activity_id, video_id, watched_at, raw_title, raw_url,
          channel_id, channel_title, channel_url, actual_watched_seconds,
          imported_at, activity_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'video')
        ON CONFLICT(event_id) DO UPDATE SET
          raw_title=excluded.raw_title,
          raw_url=excluded.raw_url,
          channel_title=COALESCE(excluded.channel_title, youtube_watch_events.channel_title),
          actual_watched_seconds=MAX(
            COALESCE(youtube_watch_events.actual_watched_seconds, 0),
            excluded.actual_watched_seconds
          )
      `).run(
        watch.eventId, activity.id, watch.videoId, watch.watchedAt, watch.title,
        watch.url, null, watch.channelTitle, null, watch.actualWatchedSeconds, importedAt
      );
      // A Takeout row may carry the channel id that earlier capture rows for the
      // same video lacked; reconcile before the import becomes visible.
      this.backfillYoutubeChannelIds();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    const previousSeconds = existing?.actual_watched_seconds ?? 0;
    return {
      eventId: watch.eventId,
      inserted: !existing,
      updated: Boolean(existing && watch.actualWatchedSeconds > previousSeconds),
      actualWatchedSeconds: Math.max(previousSeconds, watch.actualWatchedSeconds),
    };
  }

  ingestYoutubeProgress(
    batch: YoutubeProgressBatchInput,
    importedAt = new Date().toISOString(),
  ): YoutubeProgressImportResult {
    const existingImport = this.db.prepare(`
      SELECT observed_at, completed_at FROM youtube_progress_imports WHERE scan_id=?
    `).get(batch.scanId) as { observed_at: string; completed_at: string | null } | undefined;
    if (existingImport && existingImport.observed_at !== batch.observedAt) {
      throw new Error('Progress scan conflicts with an existing observation time');
    }
    if (existingImport?.completed_at && !batch.complete) {
      throw new Error('Progress scan is already complete');
    }

    let stored = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT OR IGNORE INTO youtube_progress_imports (
          scan_id, observed_at, started_at, completed_at
        ) VALUES (?, ?, ?, NULL)
      `).run(batch.scanId, batch.observedAt, importedAt);
      const insertVideo = this.db.prepare(`
        INSERT INTO youtube_videos (
          video_id, title, thumbnail_url, duration_seconds
        ) VALUES (?, 'Unavailable video', ?, ?)
        ON CONFLICT(video_id) DO UPDATE SET
          duration_seconds=COALESCE(youtube_videos.duration_seconds, excluded.duration_seconds),
          thumbnail_url=CASE WHEN youtube_videos.thumbnail_url=''
            THEN excluded.thumbnail_url ELSE youtube_videos.thumbnail_url END
      `);
      const upsert = this.db.prepare(`
        INSERT INTO youtube_video_progress (
          video_id, progress_percent, resume_seconds, duration_seconds,
          progress_seconds, confidence, observed_at, scan_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(video_id) DO UPDATE SET
          progress_percent=excluded.progress_percent,
          resume_seconds=excluded.resume_seconds,
          duration_seconds=COALESCE(excluded.duration_seconds, youtube_video_progress.duration_seconds),
          progress_seconds=COALESCE(excluded.progress_seconds, youtube_video_progress.progress_seconds),
          confidence=excluded.confidence,
          observed_at=excluded.observed_at,
          scan_id=excluded.scan_id
        WHERE excluded.observed_at>youtube_video_progress.observed_at
          OR (
            excluded.observed_at=youtube_video_progress.observed_at
            AND (
              excluded.progress_percent IS NOT youtube_video_progress.progress_percent
              OR excluded.resume_seconds IS NOT youtube_video_progress.resume_seconds
              OR excluded.duration_seconds IS NOT youtube_video_progress.duration_seconds
              OR excluded.progress_seconds IS NOT youtube_video_progress.progress_seconds
              OR excluded.confidence IS NOT youtube_video_progress.confidence
              OR excluded.scan_id IS NOT youtube_video_progress.scan_id
            )
          )
      `);
      for (const item of batch.items) {
        insertVideo.run(
          item.videoId,
          `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
          item.durationSeconds,
        );
        const result = upsert.run(
          item.videoId, item.progressPercent, item.resumeSeconds, item.durationSeconds,
          progressSeconds(item), item.resumeSeconds !== null && item.resumeSeconds > 0
            ? 'resume'
            : 'progress',
          batch.observedAt, batch.scanId,
        );
        stored += Number(result.changes);
      }
      if (batch.complete) {
        this.db.prepare(`
          UPDATE youtube_progress_imports
          SET completed_at=COALESCE(completed_at, ?)
          WHERE scan_id=?
        `).run(importedAt, batch.scanId);
      }
      if (batch.summary) {
        const summary = batch.summary;
        this.db.prepare(`
          UPDATE youtube_progress_imports
          SET mode=?, videos=?, passes=?, end_reason=?, oldest_watched_at=?,
            newest_watched_at=?, error=?, landed_url=?
          WHERE scan_id=?
        `).run(
          summary.mode, summary.videos, summary.passes, summary.endReason,
          summary.oldestWatchedAt, summary.newestWatchedAt, summary.error,
          summary.landedUrl, batch.scanId,
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    const total = this.db.prepare(`
      SELECT COUNT(*) count FROM youtube_video_progress WHERE scan_id=?
    `).get(batch.scanId) as { count: number };
    return {
      scanId: batch.scanId,
      accepted: batch.items.length,
      stored,
      totalStored: Number(total.count),
      completed: batch.complete || Boolean(existingImport?.completed_at),
    };
  }

  youtubeCounts(): {
    watches: number;
    videoWatches: number;
    videos: number;
    searches: number;
    searchQueries: number;
    channels: number;
  } {
    const row = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM youtube_watch_events) watches,
        (SELECT COUNT(*) FROM youtube_watch_events WHERE activity_type='video') video_watches,
        (SELECT COUNT(*) FROM youtube_videos) videos,
        (SELECT COUNT(*) FROM youtube_search_events) searches,
        (SELECT COUNT(*) FROM youtube_search_events WHERE activity_type='search') search_queries,
        (SELECT COUNT(DISTINCT COALESCE(channel_id, channel_title))
           FROM youtube_watch_events
           WHERE activity_type='video' AND (channel_id IS NOT NULL OR channel_title IS NOT NULL)) channels
    `).get() as Record<string, number>;
    return {
      watches: Number(row.watches),
      videoWatches: Number(row.video_watches),
      videos: Number(row.videos),
      searches: Number(row.searches),
      searchQueries: Number(row.search_queries),
      channels: Number(row.channels),
    };
  }

  // What the worker still owes this archive. Cheap COUNTs over the same
  // predicates the enrichment steps use, so "pending" here is exactly what
  // the next cycles will pick up.
  youtubeProcessingCounts(now = new Date()): YoutubeProcessingCounts {
    const row = this.db.prepare(`
      WITH work_run AS (
        SELECT * FROM youtube_taxonomy_runs
        WHERE definition_version='${PERSONAL_TAXONOMY_DEFINITION_VERSION}'
          AND status IN ('candidate', 'active')
        ORDER BY CASE status WHEN 'candidate' THEN 0 ELSE 1 END, taxonomy_version DESC
        LIMIT 1
      )
      SELECT
        (SELECT COUNT(*) FROM youtube_videos) videos,
        (SELECT COUNT(*) FROM youtube_videos WHERE metadata_fetched_at IS NULL) videos_pending_metadata,
        (SELECT COUNT(DISTINCT v.channel_id)
           FROM youtube_videos v
           LEFT JOIN youtube_channels c ON c.channel_id=v.channel_id
           WHERE v.channel_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM youtube_watch_events w WHERE w.video_id=v.video_id AND w.activity_type='video') AND (
             c.metadata_fetched_at IS NULL OR c.statistics_fetched_at IS NULL OR c.statistics_fetched_at < ?
           )) channels_pending_metadata,
        (SELECT COUNT(*) FROM youtube_videos v
           WHERE metadata_fetched_at IS NOT NULL AND availability='available'
             AND EXISTS (SELECT 1 FROM youtube_watch_events w
               WHERE w.video_id=v.video_id AND w.activity_type='video')) videos_classifiable,
        (SELECT COUNT(*) FROM youtube_videos v
           WHERE v.metadata_fetched_at IS NOT NULL AND v.availability='available'
             AND EXISTS (SELECT 1 FROM youtube_watch_events w
               WHERE w.video_id=v.video_id AND w.activity_type='video')
             AND EXISTS (
               SELECT 1 FROM work_run
             )
             AND NOT EXISTS (
               SELECT 1 FROM youtube_video_topics vt
               JOIN youtube_topics t ON t.id=vt.topic_id
               JOIN work_run run ON run.taxonomy_version=t.taxonomy_version
               WHERE vt.video_id=v.video_id AND vt.metadata_hash=v.metadata_hash
                 AND vt.model=run.model AND vt.prompt_version=run.prompt_version
             )) videos_pending_topics,
        (SELECT MAX(imported_at) FROM youtube_watch_events) last_import_at
    `).get(new Date(now.getTime() - YOUTUBE_STATISTICS_MAX_AGE_MS).toISOString()) as Record<string, unknown>;
    return {
      videos: Number(row.videos),
      videosPendingMetadata: Number(row.videos_pending_metadata),
      channelsPendingMetadata: Number(row.channels_pending_metadata),
      videosClassifiable: Number(row.videos_classifiable),
      videosPendingTopics: Number(row.videos_pending_topics),
      lastImportAt: row.last_import_at === null ? null : String(row.last_import_at),
      lastCycleAt: this.youtubeSyncState('worker_cycle_at'),
      lastError: this.youtubeSyncState('last_error'),
    };
  }

  youtubeHistoryStatus(): YoutubeHistoryStatus {
    const watch = this.db.prepare(`
      SELECT MAX(watched_at) latest_at, COUNT(*) count FROM youtube_watch_events
    `).get() as { latest_at: string | null; count: number };
    const search = this.db.prepare(`
      SELECT MAX(searched_at) latest_at, COUNT(*) count FROM youtube_search_events
    `).get() as { latest_at: string | null; count: number };
    const latest = [watch.latest_at, search.latest_at]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
    return {
      latestEventAt: latest,
      latestWatchAt: watch.latest_at,
      latestSearchAt: search.latest_at,
      watches: Number(watch.count),
      searches: Number(search.count),
      coverage: this.youtubeHistoryCoverage(),
    };
  }

  youtubeReferenceDataUpdatedAt(): string | null {
    const row = this.db.prepare(`
      SELECT MAX(updated_at) updated_at FROM (
        SELECT MAX(imported_at) updated_at FROM youtube_watch_events
        UNION ALL SELECT MAX(metadata_fetched_at) FROM youtube_videos
        UNION ALL SELECT MAX(metadata_fetched_at) FROM youtube_channels
        UNION ALL SELECT MAX(observed_at) FROM youtube_video_progress
      )
    `).get() as { updated_at: string | null };
    return row.updated_at;
  }

  // Recent scans with how they ended: the operator's view of an account whose
  // syncs keep coming back empty.
  youtubeProgressImports(limit = 50): YoutubeProgressImportRow[] {
    const rows = this.db.prepare(`
      SELECT scan_id, observed_at, started_at, completed_at, mode, videos, passes,
        end_reason, oldest_watched_at, newest_watched_at, error, landed_url
      FROM youtube_progress_imports
      ORDER BY observed_at DESC LIMIT ?
    `).all(Math.max(1, Math.min(500, Math.floor(limit)))) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      scanId: String(row.scan_id),
      observedAt: String(row.observed_at),
      startedAt: String(row.started_at),
      completedAt: row.completed_at === null ? null : String(row.completed_at),
      mode: row.mode === null ? null : row.mode as 'full' | 'incremental',
      videos: row.videos === null ? null : Number(row.videos),
      passes: row.passes === null ? null : Number(row.passes),
      endReason: row.end_reason === null ? null : row.end_reason as YoutubeScanEndReason,
      oldestWatchedAt: row.oldest_watched_at === null ? null : String(row.oldest_watched_at),
      newestWatchedAt: row.newest_watched_at === null ? null : String(row.newest_watched_at),
      error: row.error === null ? null : String(row.error),
      landedUrl: row.landed_url === null ? null : String(row.landed_url),
    }));
  }

  youtubeHistoryCoverage(): YoutubeHistoryCoverage | null {
    const reasons = [...YOUTUBE_SCAN_COVERING_REASONS];
    const placeholders = reasons.map(() => '?').join(',');
    const row = this.db.prepare(`
      WITH eligible AS (
        SELECT candidate.*
        FROM youtube_progress_imports candidate
        WHERE candidate.completed_at IS NOT NULL
          AND candidate.end_reason IN (${placeholders})
          AND EXISTS (
            SELECT 1 FROM youtube_progress_imports baseline
            WHERE baseline.completed_at IS NOT NULL
              AND baseline.end_reason='history-start'
              AND baseline.observed_at<=candidate.observed_at
          )
      )
      SELECT scan_id, observed_at, end_reason, completed_at,
        (SELECT MIN(oldest_watched_at) FROM eligible) oldest_watched_at
      FROM eligible
      ORDER BY observed_at DESC LIMIT 1
    `).get(...reasons) as {
      scan_id: string; observed_at: string; end_reason: string;
      completed_at: string; oldest_watched_at: string | null;
    } | undefined;
    if (!row) return null;
    return {
      scanId: row.scan_id,
      coveredSince: row.observed_at,
      oldestWatchedAt: row.oldest_watched_at,
      endReason: row.end_reason as YoutubeScanEndReason,
      completedAt: row.completed_at,
    };
  }

  // Private, chronological event rows for the owner's History page. Unlike
  // dashboard.recent this deliberately keeps repeat watches as separate
  // events; callers must enforce dashboard-key/session access before using it.
  youtubeWatchHistory(
    range: YoutubeRange = '28d',
    limit = 100,
    now = new Date(),
  ): YoutubeRecentVideo[] {
    const cutoff = youtubeCutoff(range, now);
    const where = cutoff
      ? "WHERE w.activity_type='video' AND w.watched_at>=?"
      : "WHERE w.activity_type='video'";
    const rows = this.db.prepare(`
      SELECT w.video_id, COALESCE(NULLIF(v.title, ''), w.raw_title) title,
        CASE WHEN w.video_id IS NULL THEN w.raw_url
          ELSE 'https://www.youtube.com/watch?v=' || w.video_id END url,
        COALESCE(w.channel_id, v.channel_id) channel_id,
        COALESCE(NULLIF(w.channel_title, ''), NULLIF(v.channel_title, ''), 'Unknown channel') channel_title,
        COALESCE(v.thumbnail_url, '') thumbnail_url, v.duration_seconds,
        w.actual_watched_seconds, w.watched_at
      FROM youtube_watch_events w
      LEFT JOIN youtube_videos v ON v.video_id=w.video_id
      ${where}
      ORDER BY w.watched_at DESC, w.event_id DESC
      LIMIT ?
    `).all(...(cutoff ? [cutoff] : []), Math.max(1, Math.min(500, limit))) as Array<Record<string, string | number | null>>;
    return rows.map((row) => ({
      videoId: row.video_id === null ? null : String(row.video_id),
      title: String(row.title),
      url: String(row.url),
      channelId: row.channel_id === null ? null : String(row.channel_id),
      channelTitle: String(row.channel_title),
      thumbnailUrl: String(row.thumbnail_url),
      durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
      actualWatchedSeconds: row.actual_watched_seconds === null ? null : Number(row.actual_watched_seconds),
      watchedAt: String(row.watched_at),
      watchCount: 1,
    }));
  }

  // Materialize the estimated-events CTE into a per-connection temp table so
  // dashboard + crystal statements read it instead of each re-running the
  // window functions. Rebuilt immediately when events, durations, metadata,
  // or saved progress change, and periodically as a final consistency guard.
  private ensureEstimatedEvents(): void {
    const revision = this.readRevision();
    if (revision === this.estimatedEventsRevision && Date.now() - this.estimatedEventsBuiltAt < 300_000) return;
    const row = this.db.prepare(`
      SELECT (SELECT COUNT(*) FROM youtube_watch_events) watches,
        (SELECT COUNT(*) FROM youtube_search_events) searches,
        (SELECT MAX(watched_at) FROM youtube_watch_events) latest,
        (SELECT COALESCE(SUM(actual_watched_seconds), 0) FROM youtube_watch_events) measured,
        (SELECT COUNT(*) FROM youtube_videos WHERE duration_seconds IS NOT NULL) durations,
        (SELECT COALESCE(SUM(duration_seconds), 0) FROM youtube_videos) duration_seconds,
        (SELECT MAX(metadata_fetched_at) FROM youtube_videos) metadata_latest,
        (SELECT COUNT(*) FROM youtube_video_progress) progress,
        (SELECT COALESCE(SUM(progress_seconds), 0) FROM youtube_video_progress) progress_seconds,
        (SELECT MAX(observed_at) FROM youtube_video_progress) progress_latest
    `).get() as Record<string, number | string | null>;
    const key = [
      row.watches, row.searches, row.latest, row.measured,
      row.durations, row.duration_seconds, row.metadata_latest,
      row.progress, row.progress_seconds, row.progress_latest,
    ].join(':');
    const now = Date.now();
    if (key === this.estimatedEventsKey && now - this.estimatedEventsBuiltAt < 300_000) {
      this.estimatedEventsRevision = revision;
      return;
    }
    this.db.exec(`
      DROP TABLE IF EXISTS temp.youtube_estimated_events;
      CREATE TEMP TABLE youtube_estimated_events AS ${YOUTUBE_ESTIMATED_EVENTS_CTE}
      SELECT * FROM estimated_events;
      CREATE INDEX temp.youtube_estimated_time_idx ON youtube_estimated_events(watched_at);
      CREATE INDEX temp.youtube_estimated_video_idx ON youtube_estimated_events(video_id);
    `);
    this.estimatedEventsKey = key;
    this.estimatedEventsBuiltAt = now;
    this.estimatedEventsRevision = this.readRevision();
  }

  // Every channel with at least one watch in range, no top-N cut: the
  // leanings page matches these against external tag lists, and rows without
  // a channel id (or name) still count toward honest coverage totals.
  youtubeChannelTotals(range: YoutubeRange = 'all', now = new Date()): YoutubeChannelSummary[] {
    this.ensureEstimatedEvents();
    const cutoff = youtubeCutoff(range, now);
    const estimatedWhere = cutoff ? 'WHERE e.watched_at>=?' : 'WHERE 1=1';
    const params = cutoff ? [cutoff] : [];
    const channelId = 'COALESCE(e.channel_id, v.channel_id)';
    const channelName = "COALESCE(NULLIF(c.name, ''), NULLIF(e.channel_title, ''), NULLIF(v.channel_title, ''))";
    const rows = this.db.prepare(`
      ${YOUTUBE_ESTIMATED_EVENTS_VIEW}
      SELECT ${channelId} channel_id, ${channelName} name,
        COALESCE(c.thumbnail_url, '') thumbnail_url,
        COUNT(*) watches, COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds
      FROM estimated_events e
      LEFT JOIN youtube_videos v ON v.video_id=e.video_id
      LEFT JOIN youtube_channels c ON c.channel_id=${channelId}
      ${estimatedWhere}
      GROUP BY COALESCE(${channelId}, ${channelName})
      ORDER BY estimated_watch_seconds DESC, watches DESC
    `).all(...params) as Array<Record<string, string | number | null>>;
    return rows.map((row) => ({
      channelId: row.channel_id === null ? null : String(row.channel_id),
      name: row.name === null ? '' : String(row.name),
      thumbnailUrl: String(row.thumbnail_url),
      watches: Number(row.watches),
      estimatedWatchSeconds: Number(row.estimated_watch_seconds),
    }));
  }

  youtubeTopicTrend(range: YoutubeRange = 'all', now = new Date()): YoutubeTopicTrendMonth[] {
    this.ensureEstimatedEvents();
    const firstExact = this.db.prepare(`
      SELECT MIN(w.watched_at) first_at
      FROM youtube_watch_events w
      JOIN activities a ON a.id=w.activity_id
      WHERE w.activity_type='video' AND a.occurred_precision='exact'
    `).get() as { first_at: string | null };
    const selectedWindow = selectedTrendWindow(range, now, firstExact?.first_at ?? null);
    const periodExpression = `strftime('${selectedWindow.format}', e.watched_at, '+8 hours')`;
    const monthlyRows = this.db.prepare(`
      ${YOUTUBE_ESTIMATED_EVENTS_VIEW}
      SELECT ${periodExpression} month,
        COUNT(CASE WHEN e.video_id IS NOT NULL THEN 1 END) classifiable_watch_events,
        COUNT(CASE WHEN t.id IS NOT NULL THEN 1 END) processed_watch_events,
        COUNT(CASE WHEN t.id IS NOT NULL AND vt.decision='accepted' AND t.slug<>'unknown'
          THEN 1 END) classified_watch_events,
        COUNT(CASE WHEN t.id IS NOT NULL AND (vt.decision IN ('unknown', 'low-confidence')
          OR t.slug='unknown') THEN 1 END) unknown_watch_events,
        COALESCE(SUM(CASE WHEN t.id IS NOT NULL AND vt.decision='accepted' AND t.slug<>'unknown'
          THEN e.estimated_watch_seconds ELSE 0 END), 0)
          classified_watch_seconds
      FROM estimated_events e
      JOIN activities a ON a.id=e.activity_id
      LEFT JOIN youtube_videos v ON v.video_id=e.video_id
      LEFT JOIN youtube_video_topics vt
        ON vt.video_id=e.video_id AND vt.rank=1 AND vt.metadata_hash=v.metadata_hash
      LEFT JOIN youtube_topics t ON t.id=vt.topic_id
        AND t.taxonomy_version=${ACTIVE_PERSONAL_TAXONOMY_VERSION_SQL}
      WHERE a.occurred_precision='exact' AND e.watched_at>=? AND e.watched_at<?
      GROUP BY month ORDER BY month
    `).all(selectedWindow.start, selectedWindow.end) as Array<Record<string, string | number>>;
    const topicRows = this.db.prepare(`
      ${YOUTUBE_ESTIMATED_EVENTS_VIEW}
      SELECT ${periodExpression} month,
        t.slug, t.name, COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds
      FROM estimated_events e
      JOIN activities a ON a.id=e.activity_id
      JOIN youtube_videos v ON v.video_id=e.video_id
      JOIN youtube_video_topics vt
        ON vt.video_id=e.video_id AND vt.rank=1 AND vt.metadata_hash=v.metadata_hash
      JOIN youtube_topics t ON t.id=vt.topic_id
        AND t.taxonomy_version=${ACTIVE_PERSONAL_TAXONOMY_VERSION_SQL}
      WHERE vt.decision='accepted' AND t.slug<>'unknown'
        AND a.occurred_precision='exact' AND e.watched_at>=? AND e.watched_at<?
      GROUP BY month, t.id ORDER BY month, t.name
    `).all(selectedWindow.start, selectedWindow.end) as Array<Record<string, string | number>>;
    const monthly = new Map(monthlyRows.map((row) => [String(row.month), row]));
    const topicNames = new Map(topicRows.map((row) => [String(row.slug), String(row.name)]));
    const topicSeconds = new Map<string, Map<string, number>>();
    for (const row of topicRows) {
      const month = String(row.month);
      const byTopic = topicSeconds.get(month) ?? new Map<string, number>();
      byTopic.set(String(row.slug), Number(row.estimated_watch_seconds));
      topicSeconds.set(month, byTopic);
    }
    const slugs = [...topicNames.keys()].sort((a, b) =>
      (topicNames.get(a) ?? a).localeCompare(topicNames.get(b) ?? b));
    const result: YoutubeTopicTrendMonth[] = selectedWindow.periods.map((month) => {
      const row = monthly.get(month);
      const classifiableWatchEvents = Number(row?.classifiable_watch_events ?? 0);
      const processedWatchEvents = Number(row?.processed_watch_events ?? 0);
      const classifiedWatchEvents = Number(row?.classified_watch_events ?? 0);
      const unknownWatchEvents = Number(row?.unknown_watch_events ?? 0);
      const classifiedWatchSeconds = Number(row?.classified_watch_seconds ?? 0);
      return {
        month,
        classifiableWatchEvents,
        processedWatchEvents,
        classifiedWatchEvents,
        unknownWatchEvents,
        classificationCoverage: classifiableWatchEvents
          ? classifiedWatchEvents / classifiableWatchEvents : 1,
        processedCoverage: classifiableWatchEvents
          ? processedWatchEvents / classifiableWatchEvents : 1,
        unknownShare: processedWatchEvents ? unknownWatchEvents / processedWatchEvents : 0,
        classifiedWatchSeconds,
        topics: slugs.map((slug) => {
          const estimatedWatchSeconds = topicSeconds.get(month)?.get(slug) ?? 0;
          return {
            slug,
            name: topicNames.get(slug) ?? slug,
            estimatedWatchSeconds,
            share: classifiedWatchSeconds ? estimatedWatchSeconds / classifiedWatchSeconds : 0,
            movingAverageShare: 0,
          };
        }),
      };
    });
    for (let index = 0; index < result.length; index += 1) {
      const trailing = result.slice(Math.max(0, index - selectedWindow.smoothing + 1), index + 1);
      const denominator = trailing.reduce((sum, month) => sum + month.classifiedWatchSeconds, 0);
      for (const topic of result[index].topics) {
        const numerator = trailing.reduce((sum, month) =>
          sum + (month.topics.find((item) => item.slug === topic.slug)?.estimatedWatchSeconds ?? 0), 0);
        topic.movingAverageShare = denominator ? numerator / denominator : 0;
      }
    }
    return result;
  }

  // Overview loads both animations without semantic keywords; history and recap
  // can keep the lightweight projection. Full projections remain the API default.
  youtubeDashboard(range: YoutubeRange = '28d', now = new Date(), includeInsights: boolean | 'overview' = true): YoutubeDashboardData {
    this.ensureEstimatedEvents();
    const cutoff = youtubeCutoff(range, now);
    const where = cutoff
      ? "WHERE w.activity_type='video' AND w.watched_at>=?"
      : "WHERE w.activity_type='video'";
    const params = cutoff ? [cutoff] : [];
    const estimatedWhere = cutoff ? 'WHERE e.watched_at>=?' : 'WHERE 1=1';
    const estimatedEvents = YOUTUBE_ESTIMATED_EVENTS_VIEW;
    const stats = this.db.prepare(`
      ${estimatedEvents},
      selected_videos AS (
        SELECT DISTINCT e.video_id
        FROM estimated_events e
        ${estimatedWhere} AND e.video_id IS NOT NULL
      )
      SELECT COUNT(*) watch_events,
        COUNT(DISTINCT COALESCE(e.video_id, e.raw_url)) unique_videos,
        COUNT(DISTINCT COALESCE(e.channel_id, v.channel_id, e.channel_title)) unique_channels,
        COALESCE(SUM(v.duration_seconds), 0) opened_duration_seconds,
        COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds,
        COALESCE(SUM(CASE WHEN e.actual_watched_seconds IS NULL
          THEN e.estimated_watch_seconds ELSE 0 END), 0) inferred_watch_seconds,
        SUM(e.actual_watched_seconds) actual_watched_seconds,
        COUNT(DISTINCT CASE WHEN v.metadata_fetched_at IS NOT NULL THEN e.video_id END) enriched_videos,
        (SELECT COALESCE(SUM(v2.duration_seconds), 0)
          FROM selected_videos s JOIN youtube_videos v2 ON v2.video_id=s.video_id
        ) catalog_duration_seconds,
        (SELECT COALESCE(SUM(MIN(COALESCE(vp.progress_seconds, 0), COALESCE(v2.duration_seconds, vp.progress_seconds, 0))), 0)
          FROM selected_videos s
          JOIN youtube_videos v2 ON v2.video_id=s.video_id
          JOIN youtube_video_progress vp ON vp.video_id=s.video_id
        ) content_covered_seconds,
        (SELECT COALESCE(SUM(CASE WHEN vp.video_id IS NOT NULL THEN v2.duration_seconds ELSE 0 END), 0)
          FROM selected_videos s
          JOIN youtube_videos v2 ON v2.video_id=s.video_id
          LEFT JOIN youtube_video_progress vp ON vp.video_id=s.video_id
        ) progress_duration_seconds,
        (SELECT COUNT(*) FROM selected_videos s
          JOIN youtube_videos v2 ON v2.video_id=s.video_id
          WHERE EXISTS (
            SELECT 1 FROM youtube_video_topics vt
            JOIN youtube_topics t ON t.id=vt.topic_id
            WHERE vt.video_id=s.video_id AND vt.rank=1
              AND vt.metadata_hash=v2.metadata_hash
              AND vt.decision='accepted' AND t.slug<>'unknown'
              AND t.taxonomy_version=${ACTIVE_PERSONAL_TAXONOMY_VERSION_SQL}
          )
        ) classified_videos,
        (SELECT COUNT(*) FROM selected_videos s
          JOIN youtube_videos v2 ON v2.video_id=s.video_id
          WHERE EXISTS (
            SELECT 1 FROM youtube_video_topics vt
            JOIN youtube_topics t ON t.id=vt.topic_id
            WHERE vt.video_id=s.video_id AND vt.rank=1
              AND vt.metadata_hash=v2.metadata_hash
              AND t.taxonomy_version=${ACTIVE_PERSONAL_TAXONOMY_VERSION_SQL}
          )
        ) processed_topic_videos,
        (SELECT COUNT(*) FROM selected_videos s
          JOIN youtube_videos v2 ON v2.video_id=s.video_id
          WHERE EXISTS (
            SELECT 1 FROM youtube_video_topics vt
            JOIN youtube_topics t ON t.id=vt.topic_id
            WHERE vt.video_id=s.video_id AND vt.rank=1
              AND vt.metadata_hash=v2.metadata_hash
              AND (vt.decision IN ('unknown', 'low-confidence') OR t.slug='unknown')
              AND t.taxonomy_version=${ACTIVE_PERSONAL_TAXONOMY_VERSION_SQL}
          )
        ) unknown_topic_videos
      FROM estimated_events e
      LEFT JOIN youtube_videos v ON v.video_id=e.video_id
      ${estimatedWhere}
    `).get(...params, ...params) as Record<string, number | null>;
    const uniqueVideos = Number(stats.unique_videos ?? 0);
    const daily = this.db.prepare(`
      ${estimatedEvents}
      SELECT strftime('%Y-%m-%d', e.watched_at, '+8 hours') day,
        COUNT(*) watches, COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds
      FROM estimated_events e
      ${estimatedWhere}
      GROUP BY day ORDER BY day
    `).all(...params) as Array<Record<string, string | number>>;
    const rhythmCoverage = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN a.occurred_precision='exact' THEN 1 ELSE 0 END), 0) exact_watches,
        COALESCE(SUM(CASE WHEN a.occurred_precision<>'exact' THEN 1 ELSE 0 END), 0) date_only_watches
      FROM youtube_watch_events w
      JOIN activities a ON a.id=w.activity_id
      ${where}
    `).get(...params) as Record<string, number>;
    const hourly = this.db.prepare(`
      ${estimatedEvents}
      SELECT CAST(strftime('%H', e.watched_at, '+8 hours') AS INTEGER) hour,
        COUNT(*) watches, COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds
      FROM estimated_events e
      JOIN activities a ON a.id=e.activity_id
      ${estimatedWhere} AND a.occurred_precision='exact'
      GROUP BY hour ORDER BY hour
    `).all(...params) as Array<Record<string, string | number>>;
    // YouTube does not expose a definitive Shorts flag through the metadata
    // API. Use duration <= 3 minutes as an explicit short-form proxy and keep
    // unknown-duration time out of the denominator so missing metadata cannot
    // silently look like long-form viewing.
    const shortFormDaily = this.db.prepare(`
      ${estimatedEvents}
      SELECT strftime('%Y-%m-%d', e.watched_at, '+8 hours') day,
        COALESCE(SUM(CASE WHEN v.duration_seconds<=180 AND COALESCE(v.is_livestream, 0)=0
          THEN e.estimated_watch_seconds ELSE 0 END), 0) short_watch_seconds,
        COALESCE(SUM(CASE WHEN v.is_livestream=1
          THEN e.estimated_watch_seconds ELSE 0 END), 0) live_watch_seconds,
        COALESCE(SUM(CASE WHEN v.duration_seconds>180 AND COALESCE(v.is_livestream, 0)=0
          THEN e.estimated_watch_seconds ELSE 0 END), 0) regular_watch_seconds,
        COALESCE(SUM(CASE WHEN v.duration_seconds IS NOT NULL
          THEN e.estimated_watch_seconds ELSE 0 END), 0) known_duration_watch_seconds
      FROM estimated_events e
      LEFT JOIN youtube_videos v ON v.video_id=e.video_id
      ${estimatedWhere}
      GROUP BY day ORDER BY day
    `).all(...params) as Array<Record<string, string | number>>;
    const channelId = 'COALESCE(e.channel_id, v.channel_id)';
    const channelName = "COALESCE(NULLIF(c.name, ''), NULLIF(e.channel_title, ''), NULLIF(v.channel_title, ''))";
    const channelKey = `COALESCE(${channelId}, ${channelName})`;
    const topChannelRows = this.db.prepare(`
      ${estimatedEvents},
      aggregated AS (
        SELECT ${channelId} channel_id, ${channelName} name,
          COALESCE(c.thumbnail_url, '') thumbnail_url,
          COUNT(*) watches, COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds
        FROM estimated_events e
        LEFT JOIN youtube_videos v ON v.video_id=e.video_id
        LEFT JOIN youtube_channels c ON c.channel_id=${channelId}
        ${estimatedWhere}
          AND ${channelName} IS NOT NULL
          AND LOWER(TRIM(${channelName}))<>'unknown channel'
        GROUP BY ${channelKey}
      ), ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (ORDER BY watches DESC, estimated_watch_seconds DESC, name) watch_rank,
          ROW_NUMBER() OVER (ORDER BY estimated_watch_seconds DESC, watches DESC, name) time_rank
        FROM aggregated
      )
      SELECT channel_id, name, thumbnail_url, watches, estimated_watch_seconds
      FROM ranked
      WHERE watch_rank<=12 OR time_rank<=12
      ORDER BY estimated_watch_seconds DESC, watches DESC, name
    `).all(...params) as Array<Record<string, string | number | null>>;
    const topChannels: YoutubeChannelSummary[] = topChannelRows.map((row) => ({
      channelId: row.channel_id === null ? null : String(row.channel_id),
      name: String(row.name),
      thumbnailUrl: String(row.thumbnail_url),
      watches: Number(row.watches),
      estimatedWatchSeconds: Number(row.estimated_watch_seconds),
    }));
    const topVideoRows = this.db.prepare(`
      ${estimatedEvents},
      aggregated AS (
        SELECT e.video_id,
          COALESCE(NULLIF(v.title, ''), e.raw_title) title,
          CASE WHEN e.video_id IS NULL THEN e.raw_url
            ELSE 'https://www.youtube.com/watch?v=' || e.video_id END url,
          COALESCE(NULLIF(v.channel_title, ''), NULLIF(e.channel_title, ''), 'Unknown channel') channel_title,
          COALESCE(v.thumbnail_url, '') thumbnail_url, v.duration_seconds,
          COUNT(*) watches,
          COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds
        FROM estimated_events e
        LEFT JOIN youtube_videos v ON v.video_id=e.video_id
        ${estimatedWhere}
        GROUP BY COALESCE(e.video_id, e.raw_url)
      ), ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (ORDER BY watches DESC, estimated_watch_seconds DESC, title) watch_rank,
          ROW_NUMBER() OVER (ORDER BY estimated_watch_seconds DESC, watches DESC, title) time_rank
        FROM aggregated
      )
      SELECT video_id, title, url, channel_title, thumbnail_url, duration_seconds,
        watches, estimated_watch_seconds
      FROM ranked
      WHERE watch_rank<=12 OR time_rank<=12
      ORDER BY estimated_watch_seconds DESC, watches DESC, title
    `).all(...params) as Array<Record<string, string | number | null>>;
    // The race always covers the full history (no range cutoff): a half-life
    // decay only means something when the whole timeline feeds it. Weeks are
    // keyed by their Monday so frames map to real dates.
    const raceRows = !includeInsights ? [] : this.db.prepare(`
      ${estimatedEvents}
      SELECT date(e.watched_at, '+8 hours', '-6 days', 'weekday 1') week,
        ${channelId} channel_id, ${channelName} name,
        COALESCE(c.thumbnail_url, '') thumbnail_url,
        COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds
      FROM estimated_events e
      LEFT JOIN youtube_videos v ON v.video_id=e.video_id
      LEFT JOIN youtube_channels c ON c.channel_id=${channelId}
      WHERE ${channelName} IS NOT NULL
        AND LOWER(TRIM(${channelName}))<>'unknown channel'
      GROUP BY week, ${channelKey}
      ORDER BY week
    `).all() as Array<Record<string, string | number | null>>;
    const channelRace = buildChannelRace(raceRows.map((row) => ({
      week: String(row.week),
      channelId: row.channel_id === null ? null : String(row.channel_id),
      name: String(row.name),
      thumbnailUrl: String(row.thumbnail_url),
      estimatedWatchSeconds: Number(row.estimated_watch_seconds),
    })));
    const topics = this.db.prepare(`
      ${estimatedEvents}
      SELECT t.slug, t.name, COUNT(*) watches,
        COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds
      FROM estimated_events e
      JOIN youtube_video_topics vt ON vt.video_id=e.video_id AND vt.rank=1
      JOIN youtube_videos topic_video ON topic_video.video_id=e.video_id
        AND vt.metadata_hash=topic_video.metadata_hash
      JOIN youtube_topics t ON t.id=vt.topic_id
        AND t.taxonomy_version=${ACTIVE_PERSONAL_TAXONOMY_VERSION_SQL}
      WHERE vt.decision='accepted' AND t.slug<>'unknown'
      ${cutoff ? 'AND e.watched_at>=?' : ''}
      GROUP BY t.id ORDER BY watches DESC, estimated_watch_seconds DESC, t.name LIMIT 12
    `).all(...params) as Array<Record<string, string | number>>;
    const lengthWhere = cutoff
      ? "WHERE activity_type='video' AND watched_at>=? AND video_id IS NOT NULL"
      : "WHERE activity_type='video' AND video_id IS NOT NULL";
    const lengthBuckets = this.db.prepare(`
      WITH selected AS (
        SELECT DISTINCT video_id FROM youtube_watch_events ${lengthWhere}
      )
      SELECT CASE
        WHEN v.duration_seconds IS NULL THEN 'Unknown'
        WHEN v.duration_seconds<60 THEN '< 1 min'
        WHEN v.duration_seconds<300 THEN '1-5 min'
        WHEN v.duration_seconds<1200 THEN '5-20 min'
        WHEN v.duration_seconds<3600 THEN '20-60 min'
        ELSE '60+ min' END label,
        COUNT(*) videos
      FROM selected s JOIN youtube_videos v ON v.video_id=s.video_id
      GROUP BY label
    `).all(...params) as Array<Record<string, string | number>>;
    const recent = this.db.prepare(`
      WITH ranked AS (
        SELECT w.*, v.title metadata_title, v.channel_title metadata_channel,
          v.thumbnail_url, v.duration_seconds,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(w.video_id, w.raw_url) ORDER BY w.watched_at DESC
          ) row_number,
          COUNT(*) OVER (PARTITION BY COALESCE(w.video_id, w.raw_url)) watch_count
        FROM youtube_watch_events w LEFT JOIN youtube_videos v ON v.video_id=w.video_id
        ${where}
      )
      SELECT video_id, COALESCE(metadata_title, raw_title) title, raw_url url,
        channel_id, COALESCE(channel_title, metadata_channel, 'Unknown channel') channel_title,
        COALESCE(thumbnail_url, '') thumbnail_url, duration_seconds,
        actual_watched_seconds, watched_at, watch_count
      FROM ranked WHERE row_number=1 ORDER BY watched_at DESC LIMIT 10
    `).all(...params) as Array<Record<string, string | number | null>>;
    // Same sampling rule as youtubeCrystalWindow(): distinct videos, one
    // evenly spaced pick every `stride` videos in watch order, so a long
    // range is represented across its whole span and both surfaces agree.
    const keywordStride = keywordSampleStride(uniqueVideos);
    const keywordRows = includeInsights !== true ? [] : this.db.prepare(`
      WITH ranked AS (
        SELECT w.video_id, w.raw_url, w.raw_title, w.watched_at, w.channel_id,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(w.video_id, w.raw_url) ORDER BY w.watched_at DESC
          ) row_number
        FROM youtube_watch_events w
        ${where}
      ), distinct_videos AS (
        SELECT w.video_id, w.raw_url, w.raw_title, w.channel_id,
          ROW_NUMBER() OVER (ORDER BY w.watched_at DESC, COALESCE(w.video_id, w.raw_url)) position
        FROM ranked w WHERE w.row_number=1
      )
      SELECT COALESCE(v.title, w.raw_title) title,
        SUBSTR(v.description, 1, 600) description, v.tags_json,
        COALESCE(w.channel_id, v.channel_id) channel_id
      FROM distinct_videos w LEFT JOIN youtube_videos v ON v.video_id=w.video_id
      WHERE (w.position - 1) % ? = 0
      ORDER BY w.position
      LIMIT ${KEYWORD_SAMPLE_LIMIT}
    `).all(...params, keywordStride) as Array<{ title: string; description: string | null; tags_json: string | null; channel_id: string | null }>;
    return {
      range,
      generatedAt: now.toISOString(),
      stats: {
        watchEvents: Number(stats.watch_events ?? 0),
        uniqueVideos,
        uniqueChannels: Number(stats.unique_channels ?? 0),
        openedDurationSeconds: Number(stats.opened_duration_seconds ?? 0),
        catalogDurationSeconds: Number(stats.catalog_duration_seconds ?? 0),
        estimatedWatchSeconds: Number(stats.estimated_watch_seconds ?? 0),
        inferredWatchSeconds: Number(stats.inferred_watch_seconds ?? 0),
        contentCoveredSeconds: Number(stats.content_covered_seconds ?? 0),
        progressCoverage: Number(stats.catalog_duration_seconds ?? 0)
          ? Number(stats.progress_duration_seconds ?? 0) / Number(stats.catalog_duration_seconds)
          : 0,
        actualWatchedSeconds: stats.actual_watched_seconds === null ? null : Number(stats.actual_watched_seconds),
        metadataCoverage: uniqueVideos ? Number(stats.enriched_videos ?? 0) / uniqueVideos : 0,
        topicProcessedCoverage: uniqueVideos
          ? Number(stats.processed_topic_videos ?? 0) / uniqueVideos : 0,
        topicCoverage: uniqueVideos ? Number(stats.classified_videos ?? 0) / uniqueVideos : 0,
        topicUnknownCoverage: uniqueVideos
          ? Number(stats.unknown_topic_videos ?? 0) / uniqueVideos : 0,
      },
      daily: daily.map((row) => ({
        day: String(row.day), watches: Number(row.watches),
        estimatedWatchSeconds: Number(row.estimated_watch_seconds),
      })),
      hourly: hourly.map((row) => ({
        hour: Number(row.hour), watches: Number(row.watches),
        estimatedWatchSeconds: Number(row.estimated_watch_seconds),
      })),
      rhythmCoverage: {
        exactWatches: Number(rhythmCoverage.exact_watches),
        dateOnlyWatches: Number(rhythmCoverage.date_only_watches),
      },
      shortFormDaily: shortFormDaily.map((row) => ({
        day: String(row.day),
        shortWatchSeconds: Number(row.short_watch_seconds),
        liveWatchSeconds: Number(row.live_watch_seconds),
        regularWatchSeconds: Number(row.regular_watch_seconds),
        knownDurationWatchSeconds: Number(row.known_duration_watch_seconds),
      })),
      lengthBuckets: lengthBuckets.map((row) => ({ label: String(row.label), videos: Number(row.videos) })),
      topChannels,
      topVideos: topVideoRows.map((row) => ({
        videoId: row.video_id === null ? null : String(row.video_id),
        title: String(row.title), url: String(row.url), channelTitle: String(row.channel_title),
        thumbnailUrl: String(row.thumbnail_url),
        durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
        watches: Number(row.watches), estimatedWatchSeconds: Number(row.estimated_watch_seconds),
      })),
      channelRace,
      topics: topics.map((row) => ({
        slug: String(row.slug), name: String(row.name),
        watches: Number(row.watches), estimatedWatchSeconds: Number(row.estimated_watch_seconds),
      })),
      topicTrend: includeInsights ? this.youtubeTopicTrend(range, now) : [],
      keywords: includeInsights === true ? extractYoutubeKeywords(keywordRows, KEYWORD_DEFAULT_LIMIT) : [],
      keywordCoverage: keywordCoverage(keywordRows.length, uniqueVideos),
      recent: recent.map((row) => ({
        videoId: row.video_id === null ? null : String(row.video_id),
        title: String(row.title), url: String(row.url),
        channelId: row.channel_id === null ? null : String(row.channel_id),
        channelTitle: String(row.channel_title), thumbnailUrl: String(row.thumbnail_url),
        durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
        actualWatchedSeconds: row.actual_watched_seconds === null ? null : Number(row.actual_watched_seconds),
        watchedAt: String(row.watched_at), watchCount: Number(row.watch_count),
      })),
    };
  }

  // Aggregates for one time window [start, end), the building block of a
  // "crystal": a compressed, comparable slice of attention. Only aggregates
  // leave this method — no timestamps, no searches, no per-event rows.
  youtubeCrystalWindow(startIso: string | null, endIso: string | null): {
    watchEvents: number;
    uniqueVideos: number;
    estimatedWatchSeconds: number;
    activeDays: number;
    channels: Array<{ key: string; channelId: string | null; name: string; watches: number; estimatedWatchSeconds: number }>;
    topics: Array<{ slug: string; name: string; watches: number; estimatedWatchSeconds: number }>;
    keywords: ReturnType<typeof extractYoutubeKeywords>;
    keywordCoverage: ReturnType<typeof keywordCoverage>;
  } {
    this.ensureEstimatedEvents();
    const bounds = [
      startIso ? 'e.watched_at>=?' : null,
      endIso ? 'e.watched_at<?' : null,
    ].filter(Boolean).join(' AND ');
    const where = bounds ? `WHERE ${bounds}` : 'WHERE 1=1';
    const params = [startIso, endIso].filter((value): value is string => value !== null);
    const totals = this.db.prepare(`
      ${YOUTUBE_ESTIMATED_EVENTS_VIEW}
      SELECT COUNT(*) watch_events,
        COUNT(DISTINCT COALESCE(e.video_id, e.raw_url)) unique_videos,
        COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds,
        COUNT(DISTINCT strftime('%Y-%m-%d', e.watched_at, '+8 hours')) active_days
      FROM estimated_events e
      ${where}
    `).get(...params) as Record<string, number>;
    const channelId = 'COALESCE(e.channel_id, v.channel_id)';
    const channelName = "COALESCE(NULLIF(c.name, ''), NULLIF(e.channel_title, ''), NULLIF(v.channel_title, ''))";
    const channelRows = this.db.prepare(`
      ${YOUTUBE_ESTIMATED_EVENTS_VIEW}
      SELECT ${channelId} channel_id, ${channelName} name,
        COUNT(*) watches, COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds
      FROM estimated_events e
      LEFT JOIN youtube_videos v ON v.video_id=e.video_id
      LEFT JOIN youtube_channels c ON c.channel_id=${channelId}
      ${where}
        AND ${channelName} IS NOT NULL
        AND LOWER(TRIM(${channelName}))<>'unknown channel'
      GROUP BY COALESCE(${channelId}, ${channelName})
      ORDER BY estimated_watch_seconds DESC, watches DESC, name
      LIMIT ${YOUTUBE_CRYSTAL_CHANNEL_LIMIT}
    `).all(...params) as Array<Record<string, string | number | null>>;
    const topicRows = this.db.prepare(`
      ${YOUTUBE_ESTIMATED_EVENTS_VIEW}
      SELECT t.slug, t.name, COUNT(*) watches,
        COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds
      FROM estimated_events e
      JOIN youtube_video_topics vt ON vt.video_id=e.video_id AND vt.rank=1
      JOIN youtube_videos topic_video ON topic_video.video_id=e.video_id
        AND vt.metadata_hash=topic_video.metadata_hash
      JOIN youtube_topics t ON t.id=vt.topic_id
        AND t.taxonomy_version=${ACTIVE_PERSONAL_TAXONOMY_VERSION_SQL}
      ${where} AND vt.decision='accepted' AND t.slug<>'unknown'
      GROUP BY t.id ORDER BY estimated_watch_seconds DESC, watches DESC, t.name
    `).all(...params) as Array<Record<string, string | number>>;
    const eligibleKeywordVideos = Number(totals.unique_videos ?? 0);
    const keywordStride = keywordSampleStride(eligibleKeywordVideos);
    const keywordRows = this.db.prepare(`
      ${YOUTUBE_ESTIMATED_EVENTS_VIEW},
      ranked AS (
        SELECT e.video_id, e.raw_url, e.raw_title, e.watched_at, e.channel_id,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(e.video_id, e.raw_url) ORDER BY e.watched_at DESC
          ) row_number
        FROM estimated_events e
        ${where}
      ), distinct_videos AS (
        SELECT w.video_id, w.raw_url, w.raw_title, w.channel_id,
          ROW_NUMBER() OVER (ORDER BY w.watched_at DESC, COALESCE(w.video_id, w.raw_url)) position
        FROM ranked w WHERE w.row_number=1
      )
      SELECT COALESCE(v.title, w.raw_title) title,
        SUBSTR(v.description, 1, 600) description, v.tags_json,
        COALESCE(w.channel_id, v.channel_id) channel_id
      FROM distinct_videos w LEFT JOIN youtube_videos v ON v.video_id=w.video_id
      WHERE (w.position - 1) % ? = 0
      ORDER BY w.position
      LIMIT ${KEYWORD_SAMPLE_LIMIT}
    `).all(...params, keywordStride) as Array<{ title: string; description: string | null; tags_json: string | null; channel_id: string | null }>;
    return {
      watchEvents: Number(totals.watch_events ?? 0),
      uniqueVideos: Number(totals.unique_videos ?? 0),
      estimatedWatchSeconds: Number(totals.estimated_watch_seconds ?? 0),
      activeDays: Number(totals.active_days ?? 0),
      channels: channelRows.map((row) => ({
        key: row.channel_id === null ? String(row.name) : String(row.channel_id),
        channelId: row.channel_id === null ? null : String(row.channel_id),
        name: String(row.name),
        watches: Number(row.watches),
        estimatedWatchSeconds: Number(row.estimated_watch_seconds),
      })),
      topics: topicRows.map((row) => ({
        slug: String(row.slug), name: String(row.name),
        watches: Number(row.watches), estimatedWatchSeconds: Number(row.estimated_watch_seconds),
      })),
      keywords: extractYoutubeKeywords(keywordRows, KEYWORD_DEFAULT_LIMIT),
      keywordCoverage: keywordCoverage(keywordRows.length, eligibleKeywordVideos),
    };
  }

  youtubeVideosNeedingMetadata(limit = 500): string[] {
    const safeLimit = Math.max(1, Math.min(5000, Math.floor(limit)));
    const rows = this.db.prepare(`
      SELECT video_id FROM youtube_videos
      WHERE metadata_fetched_at IS NULL OR (availability='available' AND is_livestream IS NULL)
      ORDER BY metadata_fetched_at IS NOT NULL, video_id LIMIT ?
    `).all(safeLimit) as Array<{ video_id: string }>;
    return rows.map((row) => row.video_id);
  }

  upsertYoutubeVideoMetadata(videos: YoutubeVideoMetadata[], fetchedAt = new Date().toISOString()): void {
    const statement = this.db.prepare(`
      INSERT INTO youtube_videos (
        video_id, title, channel_id, channel_title, description, tags_json,
        thumbnail_url, duration_seconds, published_at, category_id,
        availability, metadata_hash, metadata_fetched_at, is_livestream, view_count, statistics_fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET
        title=CASE WHEN excluded.title='' THEN youtube_videos.title ELSE excluded.title END,
        channel_id=COALESCE(excluded.channel_id, youtube_videos.channel_id),
        channel_title=COALESCE(excluded.channel_title, youtube_videos.channel_title),
        description=excluded.description, tags_json=excluded.tags_json,
        thumbnail_url=CASE WHEN excluded.thumbnail_url='' THEN youtube_videos.thumbnail_url ELSE excluded.thumbnail_url END,
        duration_seconds=excluded.duration_seconds, published_at=excluded.published_at,
        category_id=excluded.category_id, availability=excluded.availability,
        metadata_hash=excluded.metadata_hash, metadata_fetched_at=excluded.metadata_fetched_at,
        is_livestream=COALESCE(excluded.is_livestream, youtube_videos.is_livestream),
        view_count=CASE WHEN excluded.statistics_fetched_at IS NULL THEN youtube_videos.view_count ELSE excluded.view_count END,
        statistics_fetched_at=COALESCE(excluded.statistics_fetched_at, youtube_videos.statistics_fetched_at)
    `);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const video of videos) {
        statement.run(
          video.videoId, video.title, video.channelId, video.channelTitle,
          video.description, JSON.stringify(video.tags), video.thumbnailUrl,
          video.durationSeconds, video.publishedAt, video.categoryId,
          video.availability, video.metadataHash, fetchedAt,
          video.isLivestream == null ? null : Number(video.isLivestream),
          video.viewCount ?? null, video.viewCount === undefined ? null : fetchedAt
        );
      }
      this.backfillYoutubeChannelIds(videos.filter((video) => video.channelId).map((video) => video.videoId));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  youtubeChannelsNeedingMetadata(limit = 500, now = new Date()): string[] {
    const safeLimit = Math.max(1, Math.min(5000, Math.floor(limit)));
    const rows = this.db.prepare(`
      SELECT DISTINCT v.channel_id
      FROM youtube_videos v
      LEFT JOIN youtube_channels c ON c.channel_id=v.channel_id
      WHERE v.channel_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM youtube_watch_events w WHERE w.video_id=v.video_id AND w.activity_type='video') AND (
        c.metadata_fetched_at IS NULL OR c.statistics_fetched_at IS NULL OR c.statistics_fetched_at < ?
      )
      ORDER BY v.channel_id
      LIMIT ?
    `).all(new Date(now.getTime() - YOUTUBE_STATISTICS_MAX_AGE_MS).toISOString(), safeLimit) as Array<{ channel_id: string }>;
    return rows.map((row) => row.channel_id);
  }

  youtubeVideosNeedingStatistics(limit = 500, now = new Date()): string[] {
    return (this.db.prepare(`SELECT v.video_id FROM youtube_videos v
      WHERE (statistics_fetched_at IS NULL OR statistics_fetched_at<?)
        AND EXISTS (SELECT 1 FROM youtube_watch_events w WHERE w.video_id=v.video_id AND w.activity_type='video')
      ORDER BY statistics_fetched_at IS NOT NULL, statistics_fetched_at, v.video_id LIMIT ?`)
      .all(new Date(now.getTime() - YOUTUBE_STATISTICS_MAX_AGE_MS).toISOString(), Math.max(1, Math.min(5000, Math.floor(limit)))) as Array<{ video_id: string }>).map(row => row.video_id);
  }

  saveYoutubeVideoStatistics(videos: Array<{ videoId: string; viewCount: number | null }>, fetchedAt: string): void {
    const statement = this.db.prepare('UPDATE youtube_videos SET view_count=?, statistics_fetched_at=? WHERE video_id=?');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const video of videos) statement.run(video.viewCount, fetchedAt, video.videoId);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  youtubePopularity(range: YoutubeRange, now = new Date()): YoutubePopularity {
    const cutoff = youtubeCutoff(range, now);
    const where = `activity_type='video' AND (? IS NULL OR watched_at>=?) AND watched_at<=?`;
    const rows = this.db.prepare(`WITH watched AS (
      SELECT DISTINCT video_id FROM youtube_watch_events WHERE ${where} AND video_id IS NOT NULL
    ), sample AS (
      SELECT v.view_count, v.statistics_fetched_at video_at, c.statistics_fetched_at channel_at,
        CASE WHEN json_extract(c.statistics_json,'$.hiddenSubscriberCount')=1 THEN NULL
          WHEN json_type(c.statistics_json,'$.subscriberCount')='integer'
          THEN json_extract(c.statistics_json,'$.subscriberCount') ELSE NULL END subscribers
      FROM watched w LEFT JOIN youtube_videos v ON v.video_id=w.video_id
      LEFT JOIN youtube_channels c ON c.channel_id=v.channel_id
    ), counts AS (
      SELECT 'channels' kind, subscribers value, channel_at fetched_at FROM sample
      UNION ALL SELECT 'videos', view_count, video_at FROM sample
    ) SELECT kind, CASE WHEN value IS NULL OR value<0 THEN -1
      ${YOUTUBE_POPULARITY_BUCKETS_V1.slice(1).map((bound, index) => `WHEN value<${bound} THEN ${index}`).join(' ')}
      ELSE ${YOUTUBE_POPULARITY_BUCKETS_V1.length - 1} END bucket,
      COUNT(*) count, MIN(fetched_at) oldest, MAX(fetched_at) newest
      FROM counts GROUP BY kind,bucket
    `).all(cutoff, cutoff, now.toISOString()) as Array<{ kind: 'channels' | 'videos'; bucket: number; count: number; oldest: string | null; newest: string | null }>;
    const empty = (): YoutubePopularitySeries => ({ buckets: YOUTUBE_POPULARITY_BUCKETS_V1.map(() => 0), known: 0, unknown: 0, oldestFetchedAt: null, newestFetchedAt: null });
    const output: YoutubePopularity = { totalVideos: 0, unidentifiedEvents: 0, channels: empty(), videos: empty() };
    for (const row of rows) {
      const series = output[row.kind];
      if (row.bucket === -1) series.unknown += row.count;
      else { series.buckets[row.bucket] = row.count; series.known += row.count; }
      if (row.oldest && (!series.oldestFetchedAt || row.oldest < series.oldestFetchedAt)) series.oldestFetchedAt = row.oldest;
      if (row.newest && (!series.newestFetchedAt || row.newest > series.newestFetchedAt)) series.newestFetchedAt = row.newest;
    }
    output.totalVideos = output.videos.known + output.videos.unknown;
    output.unidentifiedEvents = Number((this.db.prepare(`SELECT COUNT(*) count FROM youtube_watch_events WHERE ${where} AND video_id IS NULL`)
      .get(cutoff, cutoff, now.toISOString()) as { count: number }).count);
    return output;
  }

  youtubeChannelMetadata(channelId: string): YoutubeChannelMetadata | null {
    const row = this.db.prepare(`
      SELECT * FROM youtube_channels WHERE channel_id=?
    `).get(channelId) as { name: string; thumbnail_url: string; statistics_json: string | null; statistics_fetched_at: string | null } | undefined;
    if (!row) return null;
    return {
      channelId, name: row.name, thumbnailUrl: row.thumbnail_url,
      statistics: row.statistics_json ? JSON.parse(row.statistics_json) : undefined,
      statisticsFetchedAt: row.statistics_fetched_at,
    };
  }

  upsertYoutubeChannelMetadata(
    channels: YoutubeChannelMetadata[],
    fetchedAt = new Date().toISOString(),
  ): void {
    const statement = this.db.prepare(`
      INSERT INTO youtube_channels(channel_id, name, thumbnail_url, metadata_fetched_at, statistics_json, statistics_fetched_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET
        name=excluded.name,
        thumbnail_url=excluded.thumbnail_url,
        metadata_fetched_at=excluded.metadata_fetched_at,
        statistics_json=COALESCE(excluded.statistics_json, youtube_channels.statistics_json),
        statistics_fetched_at=COALESCE(excluded.statistics_fetched_at, youtube_channels.statistics_fetched_at)
    `);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const channel of channels) {
        statement.run(channel.channelId, channel.name, channel.thumbnailUrl, fetchedAt,
          channel.statistics ? JSON.stringify(channel.statistics) : null, channel.statistics ? fetchedAt : null);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  youtubeVideosForPersonalClassification(
    run: PersonalTaxonomyRun,
    limit = 250,
  ): Array<YoutubeVideoMetadata> {
    if (run.definitionVersion !== PERSONAL_TAXONOMY_DEFINITION_VERSION
      || !['candidate', 'active'].includes(run.status)) {
      throw new Error('Personal taxonomy run is not open for classification');
    }
    const rows = this.db.prepare(`
      SELECT v.* FROM youtube_videos v
      LEFT JOIN (
        SELECT video_id, MAX(watched_at) latest_watched_at
        FROM youtube_watch_events WHERE activity_type='video'
        GROUP BY video_id
      ) watched ON watched.video_id=v.video_id
      WHERE v.metadata_fetched_at IS NOT NULL AND v.availability='available'
        AND watched.video_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM youtube_video_topics vt
          JOIN youtube_topics t ON t.id=vt.topic_id
          WHERE vt.video_id=v.video_id AND vt.metadata_hash=v.metadata_hash
            AND t.taxonomy_version=? AND vt.model=? AND vt.prompt_version=?
        )
      ORDER BY watched.latest_watched_at IS NULL,
        watched.latest_watched_at DESC, v.metadata_fetched_at DESC, v.video_id
      LIMIT ?
    `).all(
      run.taxonomyVersion,
      run.model,
      run.promptVersion,
      Math.max(1, Math.min(1000, Math.floor(limit))),
    ) as Array<Record<string, unknown>>;
    return this.youtubeMetadataRows(rows);
  }

  youtubeVideosForMatchingClassification(
    taxonomyVersion: number,
    limit = 1000,
  ): Array<YoutubeVideoMetadata> {
    const rows = this.db.prepare(`
      SELECT v.* FROM youtube_videos v
      LEFT JOIN (
        SELECT video_id, MAX(watched_at) latest_watched_at
        FROM youtube_watch_events WHERE activity_type='video'
        GROUP BY video_id
      ) watched ON watched.video_id=v.video_id
      WHERE v.metadata_fetched_at IS NOT NULL AND v.availability='available'
        AND NOT EXISTS (
          SELECT 1 FROM youtube_video_matching_topics mt
          WHERE mt.video_id=v.video_id AND mt.taxonomy_version=?
            AND mt.metadata_hash=v.metadata_hash
        )
      ORDER BY watched.latest_watched_at IS NULL,
        watched.latest_watched_at DESC, v.metadata_fetched_at DESC, v.video_id
      LIMIT ?
    `).all(
      taxonomyVersion,
      Math.max(1, Math.min(5000, Math.floor(limit))),
    ) as Array<Record<string, unknown>>;
    return this.youtubeMetadataRows(rows);
  }

  saveYoutubeVideoMatchingTopic(input: {
    videoId: string;
    taxonomyVersion: number;
    topicKey: string | null;
    metadataHash: string;
  }, classifiedAt = new Date().toISOString()): void {
    this.db.prepare(`
      INSERT INTO youtube_video_matching_topics(
        video_id, taxonomy_version, topic_key, metadata_hash, classified_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(video_id, taxonomy_version) DO UPDATE SET
        topic_key=excluded.topic_key,
        metadata_hash=excluded.metadata_hash,
        classified_at=excluded.classified_at
    `).run(
      input.videoId,
      input.taxonomyVersion,
      input.topicKey,
      input.metadataHash,
      classifiedAt,
    );
  }

  youtubeMatchingTopicWindow(
    taxonomyVersion: number,
    startIso: string | null,
    endIso: string | null,
  ): {
    watchEvents: number;
    estimatedWatchSeconds: number;
    classifiedWatchSeconds: number;
    topics: Array<{ key: string; watches: number; estimatedWatchSeconds: number }>;
  } {
    this.ensureEstimatedEvents();
    const bounds = [
      startIso ? 'e.watched_at>=?' : null,
      endIso ? 'e.watched_at<?' : null,
    ].filter(Boolean).join(' AND ');
    const where = bounds ? `WHERE ${bounds}` : 'WHERE 1=1';
    const params: Array<string | number> = [taxonomyVersion];
    if (startIso) params.push(startIso);
    if (endIso) params.push(endIso);
    const totals = this.db.prepare(`
      ${YOUTUBE_ESTIMATED_EVENTS_VIEW}
      SELECT COUNT(*) watch_events,
        COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds,
        COALESCE(SUM(CASE WHEN mt.video_id IS NOT NULL
          THEN e.estimated_watch_seconds ELSE 0 END), 0) classified_watch_seconds
      FROM estimated_events e
      LEFT JOIN youtube_videos v ON v.video_id=e.video_id
      LEFT JOIN youtube_video_matching_topics mt
        ON mt.video_id=v.video_id AND mt.taxonomy_version=?
        AND mt.metadata_hash=v.metadata_hash
      ${where}
    `).get(...params) as Record<string, number>;
    const topicRows = this.db.prepare(`
      ${YOUTUBE_ESTIMATED_EVENTS_VIEW}
      SELECT mt.topic_key, COUNT(*) watches,
        COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds
      FROM estimated_events e
      JOIN youtube_videos v ON v.video_id=e.video_id
      JOIN youtube_video_matching_topics mt
        ON mt.video_id=v.video_id AND mt.taxonomy_version=?
        AND mt.metadata_hash=v.metadata_hash
      ${where} AND mt.topic_key IS NOT NULL
      GROUP BY mt.topic_key
      ORDER BY estimated_watch_seconds DESC, watches DESC, mt.topic_key
    `).all(...params) as Array<Record<string, string | number>>;
    return {
      watchEvents: Number(totals.watch_events ?? 0),
      estimatedWatchSeconds: Number(totals.estimated_watch_seconds ?? 0),
      classifiedWatchSeconds: Number(totals.classified_watch_seconds ?? 0),
      topics: topicRows.map((row) => ({
        key: String(row.topic_key),
        watches: Number(row.watches),
        estimatedWatchSeconds: Number(row.estimated_watch_seconds),
      })),
    };
  }

  // One channel through one person's history: totals, rank among their
  // channels, their top videos from it, and a monthly series.
  youtubeChannelDetail(channelId: string, range: YoutubeRange = '365d', now = new Date()): YoutubeChannelDetail {
    this.ensureEstimatedEvents();
    const cutoff = youtubeCutoff(range, now);
    const where = cutoff ? 'WHERE e.watched_at>=?' : 'WHERE 1=1';
    const params = cutoff ? [cutoff] : [];
    const estimatedEvents = YOUTUBE_ESTIMATED_EVENTS_VIEW;
    const channelIdExpr = 'COALESCE(e.channel_id, v.channel_id)';
    const channelName = "COALESCE(NULLIF(c.name, ''), NULLIF(e.channel_title, ''), NULLIF(v.channel_title, ''))";
    const known = this.youtubeChannelMetadata(channelId);
    const totals = this.db.prepare(`
      ${estimatedEvents}
      SELECT COUNT(*) watches,
        COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds,
        COUNT(DISTINCT COALESCE(e.video_id, e.raw_url)) unique_videos,
        MIN(e.watched_at) first_watched_at, MAX(e.watched_at) last_watched_at,
        MAX(${channelName}) name
      FROM estimated_events e
      LEFT JOIN youtube_videos v ON v.video_id=e.video_id
      LEFT JOIN youtube_channels c ON c.channel_id=${channelIdExpr}
      ${where} AND ${channelIdExpr}=?
    `).get(...params, channelId) as Record<string, number | string | null>;
    const overall = this.db.prepare(`
      ${estimatedEvents}
      SELECT COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds
      FROM estimated_events e ${where}
    `).get(...params) as Record<string, number>;
    const rankRow = this.db.prepare(`
      ${estimatedEvents},
      aggregated AS (
        SELECT ${channelIdExpr} channel_id,
          COUNT(*) watches, COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds
        FROM estimated_events e
        LEFT JOIN youtube_videos v ON v.video_id=e.video_id
        ${where} AND ${channelIdExpr} IS NOT NULL
        GROUP BY ${channelIdExpr}
      ), ranked AS (
        SELECT channel_id,
          ROW_NUMBER() OVER (ORDER BY estimated_watch_seconds DESC, watches DESC, channel_id) time_rank,
          ROW_NUMBER() OVER (ORDER BY watches DESC, estimated_watch_seconds DESC, channel_id) watch_rank,
          COUNT(*) OVER () channels
        FROM aggregated
      )
      SELECT time_rank, watch_rank, channels FROM ranked WHERE channel_id=?
    `).get(...params, channelId) as Record<string, number> | undefined;
    const channelCount = rankRow ? Number(rankRow.channels) : Number((this.db.prepare(`
      ${estimatedEvents}
      SELECT COUNT(DISTINCT ${channelIdExpr}) channels
      FROM estimated_events e LEFT JOIN youtube_videos v ON v.video_id=e.video_id ${where}
    `).get(...params) as Record<string, number>).channels ?? 0);
    const videoRows = this.db.prepare(`
      ${estimatedEvents}
      SELECT e.video_id, COALESCE(NULLIF(v.title, ''), e.raw_title) title,
        COALESCE(v.thumbnail_url, '') thumbnail_url,
        COUNT(*) watches, COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds
      FROM estimated_events e
      LEFT JOIN youtube_videos v ON v.video_id=e.video_id
      ${where} AND ${channelIdExpr}=? AND e.video_id IS NOT NULL
      GROUP BY e.video_id
      ORDER BY estimated_watch_seconds DESC, watches DESC, e.video_id
    `).all(...params, channelId) as Array<Record<string, string | number | null>>;
    const monthlyRows = this.db.prepare(`
      ${estimatedEvents}
      SELECT strftime('%Y-%m', e.watched_at, '+8 hours') month,
        COUNT(*) watches, COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds
      FROM estimated_events e
      LEFT JOIN youtube_videos v ON v.video_id=e.video_id
      ${where} AND ${channelIdExpr}=?
      GROUP BY month ORDER BY month
    `).all(...params, channelId) as Array<Record<string, string | number>>;
    const watches = Number(totals.watches ?? 0);
    const seconds = Number(totals.estimated_watch_seconds ?? 0);
    // Metadata may not exist yet and a narrower range may contain no watches.
    const historic = !known?.name && !totals.name ? this.db.prepare(`
      SELECT COALESCE(NULLIF(e.channel_title, ''), NULLIF(v.channel_title, '')) name
      FROM youtube_watch_events e LEFT JOIN youtube_videos v ON v.video_id=e.video_id
      WHERE COALESCE(e.channel_id, v.channel_id)=?
      ORDER BY e.watched_at DESC LIMIT 1
    `).get(channelId) as { name: string | null } | undefined : undefined;
    const name = known?.name || (totals.name ? String(totals.name) : historic?.name) ||
      (known || historic || watches ? channelId : '');
    return {
      range,
      channel: name ? { ...known, channelId, name, thumbnailUrl: known?.thumbnailUrl ?? '' } : null,
      stats: {
        watches,
        estimatedWatchSeconds: seconds,
        uniqueVideos: Number(totals.unique_videos ?? 0),
        firstWatchedAt: totals.first_watched_at ? String(totals.first_watched_at) : null,
        lastWatchedAt: totals.last_watched_at ? String(totals.last_watched_at) : null,
        share: Number(overall.estimated_watch_seconds) > 0 ? seconds / Number(overall.estimated_watch_seconds) : 0,
      },
      rank: {
        time: rankRow ? Number(rankRow.time_rank) : null,
        watches: rankRow ? Number(rankRow.watch_rank) : null,
        channels: channelCount,
      },
      videos: videoRows.map((row) => ({
        videoId: String(row.video_id),
        title: String(row.title),
        thumbnailUrl: String(row.thumbnail_url ?? ''),
        watches: Number(row.watches),
        estimatedWatchSeconds: Number(row.estimated_watch_seconds),
      })),
      monthly: monthlyRows.map((row) => ({
        month: String(row.month),
        watches: Number(row.watches),
        estimatedWatchSeconds: Number(row.estimated_watch_seconds),
      })),
    };
  }

  // Everything one side of a two-person comparison needs, in one pass over
  // the estimated-events temp table. Ranked lists are capped so an all-time
  // history stays a bounded in-memory object; a peer's item beyond the cap
  // simply does not count as common.
  youtubeComparisonProfile(
    taxonomyVersion: number,
    range: YoutubeRange = '28d',
    now = new Date(),
  ): YoutubeComparisonProfile {
    this.ensureEstimatedEvents();
    const cutoff = youtubeCutoff(range, now);
    const where = cutoff ? 'WHERE e.watched_at>=?' : 'WHERE 1=1';
    const params = cutoff ? [cutoff] : [];
    const estimatedEvents = YOUTUBE_ESTIMATED_EVENTS_VIEW;
    const channelId = 'COALESCE(e.channel_id, v.channel_id)';
    const channelName = "COALESCE(NULLIF(c.name, ''), NULLIF(e.channel_title, ''), NULLIF(v.channel_title, ''))";
    const channelKey = `COALESCE(${channelId}, ${channelName})`;
    const totals = this.db.prepare(`
      ${estimatedEvents}
      SELECT COUNT(*) watch_events,
        COUNT(DISTINCT COALESCE(e.video_id, e.raw_url)) unique_videos,
        COUNT(DISTINCT COALESCE(e.channel_id, v.channel_id, e.channel_title)) unique_channels,
        COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds,
        COUNT(DISTINCT strftime('%Y-%m-%d', e.watched_at, '+8 hours')) active_days
      FROM estimated_events e
      LEFT JOIN youtube_videos v ON v.video_id=e.video_id
      ${where}
    `).get(...params) as Record<string, number>;
    const channelQuery = (extraWhere: string) => this.db.prepare(`
      ${estimatedEvents},
      aggregated AS (
        SELECT ${channelKey} key, ${channelName} name,
          COALESCE(c.thumbnail_url, '') thumbnail_url,
          COUNT(*) watches, COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds
        FROM estimated_events e
        LEFT JOIN youtube_videos v ON v.video_id=e.video_id
        LEFT JOIN youtube_channels c ON c.channel_id=${channelId}
        ${where}
          AND ${channelName} IS NOT NULL
          AND LOWER(TRIM(${channelName}))<>'unknown channel'
          ${extraWhere}
        GROUP BY ${channelKey}
      )
      SELECT key, name, thumbnail_url, watches, estimated_watch_seconds,
        ROW_NUMBER() OVER (ORDER BY estimated_watch_seconds DESC, watches DESC, name) rank,
        ROW_NUMBER() OVER (ORDER BY watches DESC, estimated_watch_seconds DESC, name) watch_rank
      FROM aggregated
      ORDER BY rank
      LIMIT ${YOUTUBE_COMPARISON_LIST_LIMIT}
    `).all(...params) as Array<Record<string, string | number | null>>;
    const channelRows = channelQuery('');
    // Same Shorts proxy as the dashboard: known duration of at most three
    // minutes. Unknown durations never count as short-form.
    const shortsChannelRows = channelQuery('AND v.duration_seconds IS NOT NULL AND v.duration_seconds<=180');
    const videoRows = this.db.prepare(`
      ${estimatedEvents},
      aggregated AS (
        SELECT e.video_id,
          COALESCE(NULLIF(v.title, ''), e.raw_title) title,
          COALESCE(NULLIF(v.channel_title, ''), NULLIF(e.channel_title, ''), '') channel_title,
          COALESCE(v.thumbnail_url, '') thumbnail_url,
          COUNT(*) watches, COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds
        FROM estimated_events e
        LEFT JOIN youtube_videos v ON v.video_id=e.video_id
        ${where} AND e.video_id IS NOT NULL
        GROUP BY e.video_id
      )
      SELECT video_id, title, channel_title, thumbnail_url, watches, estimated_watch_seconds,
        ROW_NUMBER() OVER (ORDER BY estimated_watch_seconds DESC, watches DESC, title) rank,
        ROW_NUMBER() OVER (ORDER BY watches DESC, estimated_watch_seconds DESC, title) watch_rank
      FROM aggregated
      ORDER BY rank
      LIMIT ${YOUTUBE_COMPARISON_LIST_LIMIT}
    `).all(...params) as Array<Record<string, string | number | null>>;
    const topicRows = this.db.prepare(`
      ${estimatedEvents},
      aggregated AS (
        SELECT mt.topic_key, COUNT(*) watches,
          COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds
        FROM estimated_events e
        JOIN youtube_videos v ON v.video_id=e.video_id
        JOIN youtube_video_matching_topics mt
          ON mt.video_id=v.video_id AND mt.taxonomy_version=?
          AND mt.metadata_hash=v.metadata_hash
        ${where} AND mt.topic_key IS NOT NULL
        GROUP BY mt.topic_key
      )
      SELECT topic_key, watches, estimated_watch_seconds,
        ROW_NUMBER() OVER (ORDER BY estimated_watch_seconds DESC, watches DESC, topic_key) rank,
        ROW_NUMBER() OVER (ORDER BY watches DESC, estimated_watch_seconds DESC, topic_key) watch_rank
      FROM aggregated ORDER BY rank
    `).all(taxonomyVersion, ...params) as Array<Record<string, string | number>>;
    const rhythmCoverage = this.db.prepare(`
      ${estimatedEvents}
      SELECT
        COALESCE(SUM(CASE WHEN a.occurred_precision='exact' THEN 1 ELSE 0 END), 0) exact_watches,
        COALESCE(SUM(CASE WHEN a.occurred_precision<>'exact' THEN 1 ELSE 0 END), 0) date_only_watches
      FROM estimated_events e
      JOIN activities a ON a.id=e.activity_id
      ${where}
    `).get(...params) as Record<string, number>;
    const hourly = this.db.prepare(`
      ${estimatedEvents}
      SELECT CAST(strftime('%H', e.watched_at, '+8 hours') AS INTEGER) hour,
        COUNT(*) watches, COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds
      FROM estimated_events e
      JOIN activities a ON a.id=e.activity_id
      ${where} AND a.occurred_precision='exact'
      GROUP BY hour ORDER BY hour
    `).all(...params) as Array<Record<string, string | number>>;
    const weekdays = this.db.prepare(`
      ${estimatedEvents}
      SELECT CAST(strftime('%w', e.watched_at, '+8 hours') AS INTEGER) weekday,
        COUNT(*) watches, COALESCE(SUM(e.estimated_watch_seconds), 0) estimated_watch_seconds
      FROM estimated_events e
      ${where}
      GROUP BY weekday ORDER BY weekday
    `).all(...params) as Array<Record<string, string | number>>;
    const channelRow = (row: Record<string, string | number | null>) => ({
      key: String(row.key),
      name: String(row.name),
      thumbnailUrl: String(row.thumbnail_url ?? ''),
      rank: Number(row.rank),
      watchRank: Number(row.watch_rank),
      watches: Number(row.watches),
      estimatedWatchSeconds: Number(row.estimated_watch_seconds),
    });
    const edge = (direction: 'ASC' | 'DESC') => {
      const row = this.db.prepare(`
        SELECT COALESCE(NULLIF(v.title, ''), e.raw_title) title, e.watched_at
        FROM youtube_watch_events e
        LEFT JOIN youtube_videos v ON v.video_id=e.video_id
        ${where}
        ORDER BY e.watched_at ${direction} LIMIT 1
      `).get(...params) as { title: string; watched_at: string } | undefined;
      return row ? { title: String(row.title), watchedAt: String(row.watched_at) } : null;
    };
    const firstWatch = edge('ASC');
    const lastWatch = edge('DESC');
    return {
      range,
      stats: {
        watchEvents: Number(totals.watch_events ?? 0),
        estimatedWatchSeconds: Number(totals.estimated_watch_seconds ?? 0),
        uniqueVideos: Number(totals.unique_videos ?? 0),
        uniqueChannels: Number(totals.unique_channels ?? 0),
        activeDays: Number(totals.active_days ?? 0),
      },
      channels: channelRows.map(channelRow),
      shortsChannels: shortsChannelRows.map(channelRow),
      videos: videoRows.map((row) => ({
        videoId: String(row.video_id),
        title: String(row.title),
        channelTitle: String(row.channel_title ?? ''),
        thumbnailUrl: String(row.thumbnail_url ?? ''),
        rank: Number(row.rank),
        watchRank: Number(row.watch_rank),
        watches: Number(row.watches),
        estimatedWatchSeconds: Number(row.estimated_watch_seconds),
      })),
      topics: topicRows.map((row) => ({
        key: String(row.topic_key),
        rank: Number(row.rank),
        watchRank: Number(row.watch_rank),
        watches: Number(row.watches),
        estimatedWatchSeconds: Number(row.estimated_watch_seconds),
      })),
      hourly: hourly.map((row) => ({
        hour: Number(row.hour),
        watches: Number(row.watches),
        estimatedWatchSeconds: Number(row.estimated_watch_seconds),
      })),
      weekdayDays: cutoff
        ? weekdayExposure(cutoff, now.toISOString())
        : weekdayExposure(firstWatch?.watchedAt ?? null, lastWatch?.watchedAt ?? null, true),
      weekdays: weekdays.map((row) => ({
        weekday: Number(row.weekday),
        watches: Number(row.watches),
        estimatedWatchSeconds: Number(row.estimated_watch_seconds),
      })),
      rhythmCoverage: {
        exactWatches: Number(rhythmCoverage.exact_watches ?? 0),
        dateOnlyWatches: Number(rhythmCoverage.date_only_watches ?? 0),
      },
      firstWatch,
      lastWatch,
    };
  }

  youtubePersonalTaxonomyReadiness() {
    const row = this.db.prepare(`
      SELECT COUNT(*) total_videos,
        COUNT(CASE WHEN v.metadata_fetched_at IS NOT NULL THEN 1 END) metadata_ready_videos,
        COUNT(CASE WHEN v.metadata_fetched_at IS NOT NULL AND v.availability='available' THEN 1 END)
          available_videos
      FROM youtube_videos v
      WHERE EXISTS (SELECT 1 FROM youtube_watch_events w
        WHERE w.video_id=v.video_id AND w.activity_type='video')
    `).get() as Record<string, number>;
    return personalTaxonomyReadiness(
      Number(row.total_videos),
      Number(row.metadata_ready_videos),
      Number(row.available_videos),
    );
  }

  youtubePersonalTaxonomyCandidates(): PersonalTaxonomySampleCandidate[] {
    const rows = this.db.prepare(`
      SELECT v.*, COALESCE(v.channel_id, NULLIF(v.channel_title, ''), 'video:' || v.video_id) channel_key,
        watched.first_watched_at, watched.last_watched_at, watched.watches
      FROM youtube_videos v
      JOIN (
        SELECT video_id, MIN(watched_at) first_watched_at,
          MAX(watched_at) last_watched_at, COUNT(*) watches
        FROM youtube_watch_events WHERE activity_type='video'
        GROUP BY video_id
      ) watched ON watched.video_id=v.video_id
      WHERE v.metadata_fetched_at IS NOT NULL AND v.availability='available'
      ORDER BY watched.last_watched_at, v.video_id
    `).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...this.youtubeMetadataRows([row])[0],
      channelKey: String(row.channel_key),
      firstWatchedAt: String(row.first_watched_at),
      lastWatchedAt: String(row.last_watched_at),
      watches: Number(row.watches),
    }));
  }

  youtubeTaxonomyRuns(): PersonalTaxonomyRun[] {
    const rows = this.db.prepare(`
      SELECT * FROM youtube_taxonomy_runs ORDER BY taxonomy_version DESC
    `).all() as Array<Record<string, unknown>>;
    return rows.map(personalTaxonomyRunRow);
  }

  youtubeTaxonomyRun(taxonomyVersion: number): PersonalTaxonomyRun | null {
    const row = this.db.prepare(`
      SELECT * FROM youtube_taxonomy_runs WHERE taxonomy_version=?
    `).get(taxonomyVersion) as Record<string, unknown> | undefined;
    return row ? personalTaxonomyRunRow(row) : null;
  }

  youtubeTaxonomyRunForContract(
    definitionVersion: string,
    model: string,
    promptVersion: string,
  ): PersonalTaxonomyRun | null {
    const row = this.db.prepare(`
      SELECT * FROM youtube_taxonomy_runs
      WHERE definition_version=? AND model=? AND prompt_version=?
      ORDER BY taxonomy_version DESC LIMIT 1
    `).get(definitionVersion, model, promptVersion) as Record<string, unknown> | undefined;
    return row ? personalTaxonomyRunRow(row) : null;
  }

  createPersonalTaxonomyRun(input: {
    definitionVersion: string;
    model: string;
    promptVersion: string;
    topics: Array<{ slug: string; name: string; description: string }>;
    sample: PersonalTaxonomySampleManifest;
    createdAt?: string;
  }): PersonalTaxonomyRun {
    if (input.definitionVersion !== PERSONAL_TAXONOMY_DEFINITION_VERSION) {
      throw new Error('New personal taxonomy runs must use the current governed definition');
    }
    const governedTopics = PERSONAL_TOPICS.map(({ slug, name, description }) => ({ slug, name, description }));
    if (JSON.stringify(input.topics) !== JSON.stringify(governedTopics)) {
      throw new Error('New personal taxonomy runs must use the governed topic definitions');
    }
    const createdAt = input.createdAt ?? new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db.prepare(`
        SELECT taxonomy_version, status FROM youtube_taxonomy_runs
        WHERE definition_version=? AND model=? AND prompt_version=?
        ORDER BY taxonomy_version DESC LIMIT 1
      `).get(input.definitionVersion, input.model, input.promptVersion) as
        { taxonomy_version: number; status: PersonalTaxonomyRunStatus } | undefined;
      if (existing?.status === 'candidate') {
        throw new Error('Personal taxonomy run already exists for this contract');
      }
      this.db.prepare(`
        UPDATE youtube_taxonomy_runs SET status='retired'
        WHERE status IN ('candidate', 'ready', 'blocked')
      `).run();
      const versionRow = this.db.prepare(`
        SELECT COALESCE(MAX(taxonomy_version), 0) + 1 taxonomy_version FROM youtube_topics
      `).get() as { taxonomy_version: number };
      const taxonomyVersion = Number(versionRow.taxonomy_version);
      this.db.prepare(`
        INSERT INTO youtube_taxonomy_runs(
          taxonomy_version, definition_version, status, model, prompt_version,
          created_at, activated_at, reviewed_at, data_start_at, data_end_at,
          input_videos, category_count, sampling_manifest_json, quality_json
        ) VALUES (?, ?, 'candidate', ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL)
      `).run(
        taxonomyVersion,
        input.definitionVersion,
        input.model,
        input.promptVersion,
        createdAt,
        input.sample.firstWatchedAt,
        input.sample.lastWatchedAt,
        input.sample.eligibleVideos,
        input.topics.length,
        JSON.stringify(input.sample),
      );
      const insert = this.db.prepare(`
        INSERT INTO youtube_topics(taxonomy_version, slug, name, description, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const topic of input.topics) {
        insert.run(taxonomyVersion, topic.slug, topic.name, topic.description, createdAt);
      }
      this.db.exec('COMMIT');
      return this.youtubeTaxonomyRun(taxonomyVersion)!;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private youtubeMetadataRows(rows: Array<Record<string, unknown>>): YoutubeVideoMetadata[] {
    return rows.map((row) => ({
      videoId: String(row.video_id), title: String(row.title),
      channelId: row.channel_id === null ? null : String(row.channel_id),
      channelTitle: row.channel_title === null ? null : String(row.channel_title),
      description: String(row.description), tags: JSON.parse(String(row.tags_json)) as string[],
      thumbnailUrl: String(row.thumbnail_url),
      durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
      publishedAt: row.published_at === null ? null : String(row.published_at),
      categoryId: row.category_id === null ? null : String(row.category_id),
      availability: row.availability as 'available' | 'unavailable',
      metadataHash: String(row.metadata_hash),
      viewCount: row.view_count == null ? null : Number(row.view_count),
      statisticsFetchedAt: row.statistics_fetched_at == null ? null : String(row.statistics_fetched_at),
    }));
  }

  youtubeTopics(taxonomyVersion?: number): YoutubeTopic[] {
    const rows = this.db.prepare(`
      SELECT id, taxonomy_version, slug, name, description FROM youtube_topics
      WHERE taxonomy_version=COALESCE(?, ${ACTIVE_PERSONAL_TAXONOMY_VERSION_SQL})
      ORDER BY id
    `).all(taxonomyVersion ?? null) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row.id), version: Number(row.taxonomy_version), slug: String(row.slug),
      name: String(row.name), description: String(row.description),
    }));
  }

  replaceYoutubeTaxonomy(topics: Array<Omit<YoutubeTopic, 'id'>>, createdAt = new Date().toISOString()): YoutubeTopic[] {
    if (!topics.length || new Set(topics.map((topic) => topic.version)).size !== 1) {
      throw new Error('Legacy taxonomy replacement requires one non-empty version');
    }
    const taxonomyVersion = topics[0].version;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const statement = this.db.prepare(`
        INSERT INTO youtube_topics(taxonomy_version, slug, name, description, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const topic of topics) statement.run(topic.version, topic.slug, topic.name, topic.description, createdAt);
      this.db.prepare(`UPDATE youtube_taxonomy_runs SET status='retired' WHERE status='active'`).run();
      this.db.prepare(`
        INSERT INTO youtube_taxonomy_runs(
          taxonomy_version, definition_version, status, model, prompt_version,
          created_at, activated_at, reviewed_at, data_start_at, data_end_at,
          input_videos, category_count, sampling_manifest_json, quality_json
        ) VALUES (?, 'personal-generated-v1', 'active', 'unknown', 'youtube-topics-v1',
          ?, ?, NULL,
          (SELECT MIN(watched_at) FROM youtube_watch_events WHERE activity_type='video'),
          (SELECT MAX(watched_at) FROM youtube_watch_events WHERE activity_type='video'),
          (SELECT COUNT(*) FROM youtube_videos WHERE metadata_fetched_at IS NOT NULL
            AND availability='available'), ?, NULL, NULL)
      `).run(taxonomyVersion, createdAt, createdAt, topics.length);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.youtubeTopics(taxonomyVersion);
  }

  saveYoutubeVideoTopics(
    videoId: string,
    assignments: Array<{ topicId: number; rank: number; confidence: number }>,
    model: string,
    promptVersion: string,
    metadataHash: string,
    classifiedAt = new Date().toISOString(),
  ): void {
    if (!assignments.length) throw new Error('At least one topic assignment is required');
    const versions = this.db.prepare(`
      SELECT DISTINCT taxonomy_version FROM youtube_topics
      WHERE id IN (${assignments.map(() => '?').join(',')})
    `).all(...assignments.map((assignment) => assignment.topicId)) as Array<{ taxonomy_version: number }>;
    if (versions.length !== 1) throw new Error('Topic assignments must belong to one taxonomy version');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        DELETE FROM youtube_video_topics
        WHERE video_id=? AND topic_id IN (
          SELECT id FROM youtube_topics WHERE taxonomy_version=?
        )
      `).run(videoId, versions[0].taxonomy_version);
      const statement = this.db.prepare(`
        INSERT INTO youtube_video_topics(
          video_id, topic_id, rank, confidence, model, prompt_version, metadata_hash, classified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const item of assignments) {
        statement.run(videoId, item.topicId, item.rank, item.confidence, model, promptVersion, metadataHash, classifiedAt);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  savePersonalYoutubeVideoTopic(
    run: PersonalTaxonomyRun,
    video: YoutubeVideoMetadata,
    assignment: PersonalClassificationDecision,
    classifiedAt = new Date().toISOString(),
  ): void {
    if (run.definitionVersion !== PERSONAL_TAXONOMY_DEFINITION_VERSION
      || !['candidate', 'active'].includes(run.status)) {
      throw new Error('Personal taxonomy run is not open for classification');
    }
    const topic = this.db.prepare(`
      SELECT id FROM youtube_topics WHERE taxonomy_version=? AND slug=?
    `).get(run.taxonomyVersion, assignment.slug) as { id: number } | undefined;
    if (!topic) throw new Error('Personal taxonomy assignment does not belong to its run');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        DELETE FROM youtube_video_topics
        WHERE video_id=? AND topic_id IN (
          SELECT id FROM youtube_topics WHERE taxonomy_version=?
        )
      `).run(video.videoId, run.taxonomyVersion);
      this.db.prepare(`
        INSERT INTO youtube_video_topics(
          video_id, topic_id, rank, confidence, model, prompt_version,
          metadata_hash, classified_at, decision, alternative_slug,
          alternative_confidence, evidence_json
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        video.videoId,
        topic.id,
        assignment.confidence,
        run.model,
        run.promptVersion,
        video.metadataHash,
        classifiedAt,
        assignment.decision,
        assignment.alternativeSlug,
        assignment.alternativeConfidence,
        JSON.stringify(assignment.evidence),
      );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  refreshPersonalTaxonomyRunQuality(
    taxonomyVersion: number,
  ): PersonalTaxonomyRun {
    const run = this.youtubeTaxonomyRun(taxonomyVersion);
    if (!run || run.definitionVersion !== PERSONAL_TAXONOMY_DEFINITION_VERSION) {
      throw new Error('Unknown personal taxonomy v2 run');
    }
    const totals = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM youtube_videos v2
          WHERE metadata_fetched_at IS NOT NULL AND availability='available'
            AND EXISTS (SELECT 1 FROM youtube_watch_events w2
              WHERE w2.video_id=v2.video_id AND w2.activity_type='video')) total,
        COUNT(DISTINCT CASE WHEN vt.metadata_hash=v.metadata_hash
          AND vt.model=? AND vt.prompt_version=? THEN v.video_id END) processed,
        COUNT(DISTINCT CASE WHEN vt.metadata_hash=v.metadata_hash
          AND vt.model=? AND vt.prompt_version=? AND vt.decision='accepted'
          AND t.slug<>'unknown' THEN v.video_id END) accepted,
        COUNT(DISTINCT CASE WHEN vt.metadata_hash=v.metadata_hash
          AND vt.model=? AND vt.prompt_version=? AND vt.decision='unknown'
          THEN v.video_id END) unknown,
        COUNT(DISTINCT CASE WHEN vt.metadata_hash=v.metadata_hash
          AND vt.model=? AND vt.prompt_version=? AND vt.decision='low-confidence'
          THEN v.video_id END) low_confidence,
        COUNT(DISTINCT CASE WHEN vt.metadata_hash=v.metadata_hash
          AND vt.model=? AND vt.prompt_version=? AND vt.decision='accepted'
          AND vt.alternative_confidence IS NOT NULL
          AND vt.confidence-vt.alternative_confidence<0.15 THEN v.video_id END) ambiguous,
        COALESCE(SUM(CASE WHEN vt.metadata_hash=v.metadata_hash
          AND vt.model=? AND vt.prompt_version=? AND vt.decision='accepted'
          AND t.slug<>'unknown' THEN vt.confidence ELSE 0 END), 0) accepted_confidence_total,
        MIN(w.first_watched_at) data_start_at,
        MAX(w.last_watched_at) data_end_at
      FROM youtube_topics t
      LEFT JOIN youtube_video_topics vt ON vt.topic_id=t.id
      LEFT JOIN youtube_videos v ON v.video_id=vt.video_id
      LEFT JOIN (
        SELECT video_id, MIN(watched_at) first_watched_at, MAX(watched_at) last_watched_at
        FROM youtube_watch_events WHERE activity_type='video' GROUP BY video_id
      ) w ON w.video_id=v.video_id
      WHERE t.taxonomy_version=?
    `).get(
      run.model, run.promptVersion,
      run.model, run.promptVersion,
      run.model, run.promptVersion,
      run.model, run.promptVersion,
      run.model, run.promptVersion,
      run.model, run.promptVersion,
      taxonomyVersion,
    ) as Record<string, unknown>;
    const quality = assessPersonalTaxonomyQuality({
      total: Number(totals.total),
      processed: Number(totals.processed),
      accepted: Number(totals.accepted),
      unknown: Number(totals.unknown) + Number(totals.low_confidence),
      lowConfidence: Number(totals.low_confidence),
      ambiguous: Number(totals.ambiguous),
      acceptedConfidenceTotal: Number(totals.accepted_confidence_total),
    });
    const status = ['candidate', 'ready', 'blocked'].includes(run.status)
      ? quality.passed && quality.processedCoverage >= PERSONAL_TAXONOMY_RUN_COVERAGE_MIN
        ? 'ready'
        : quality.processedCoverage >= 1 ? 'blocked' : 'candidate'
      : run.status;
    this.db.prepare(`
      UPDATE youtube_taxonomy_runs
      SET status=?, input_videos=?, data_start_at=?, data_end_at=?, quality_json=?
      WHERE taxonomy_version=?
    `).run(
      status,
      Number(totals.total),
      totals.data_start_at === null ? null : String(totals.data_start_at),
      totals.data_end_at === null ? null : String(totals.data_end_at),
      JSON.stringify(quality),
      taxonomyVersion,
    );
    return this.youtubeTaxonomyRun(taxonomyVersion)!;
  }

  activatePersonalTaxonomy(
    taxonomyVersion: number,
    reviewedAt = new Date().toISOString(),
  ): PersonalTaxonomyRun {
    let gateError: Error | null = null;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare(`
        SELECT * FROM youtube_taxonomy_runs WHERE taxonomy_version=?
      `).get(taxonomyVersion) as Record<string, unknown> | undefined;
      if (!row) throw new Error('Unknown personal taxonomy run');
      let target = personalTaxonomyRunRow(row);
      // Re-evaluate a candidate under the same write lock as activation. A
      // fresh import or metadata change after the review page was rendered
      // must reopen classification instead of activating stale quality data.
      if (target.definitionVersion === PERSONAL_TAXONOMY_DEFINITION_VERSION
        && ['candidate', 'ready', 'blocked'].includes(target.status)) {
        target = this.refreshPersonalTaxonomyRunQuality(taxonomyVersion);
      }
      const readyCandidate = target.status === 'ready' && target.quality?.passed === true;
      const priorActive = target.status === 'retired' && target.activatedAt !== null;
      if (!readyCandidate && !priorActive && target.status !== 'active') {
        // Keep the refreshed candidate status/quality: the worker must see a
        // reopened candidate and fill its stale assignments on the next pass.
        gateError = new Error('Personal taxonomy run has not passed activation gates');
      } else if (target.status !== 'active') {
        const current = this.db.prepare(`
          SELECT taxonomy_version FROM youtube_taxonomy_runs WHERE status='active'
        `).get() as { taxonomy_version: number } | undefined;
        this.db.prepare(`UPDATE youtube_taxonomy_runs SET status='retired' WHERE status='active'`).run();
        this.db.prepare(`
          UPDATE youtube_taxonomy_runs
          SET status='active', reviewed_at=?, activated_at=COALESCE(activated_at, ?)
          WHERE taxonomy_version=?
        `).run(reviewedAt, reviewedAt, taxonomyVersion);
        this.db.prepare(`
          INSERT INTO youtube_taxonomy_activations(from_version, to_version, action, changed_at)
          VALUES (?, ?, ?, ?)
        `).run(
          current?.taxonomy_version ?? null,
          taxonomyVersion,
          priorActive ? 'rollback' : 'activate',
          reviewedAt,
        );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    if (gateError) throw gateError;
    return this.youtubeTaxonomyRun(taxonomyVersion)!;
  }

  youtubeTaxonomyActivations(): Array<{
    fromVersion: number | null;
    toVersion: number;
    action: 'activate' | 'rollback';
    changedAt: string;
  }> {
    const rows = this.db.prepare(`
      SELECT from_version, to_version, action, changed_at
      FROM youtube_taxonomy_activations ORDER BY id DESC
    `).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      fromVersion: row.from_version === null ? null : Number(row.from_version),
      toVersion: Number(row.to_version),
      action: row.action as 'activate' | 'rollback',
      changedAt: String(row.changed_at),
    }));
  }

  youtubePersonalTaxonomyEvidence(
    taxonomyVersion: number,
    perTopic = 2,
  ): PersonalTaxonomyEvidenceRow[] {
    const safeLimit = Math.max(1, Math.min(5, Math.floor(perTopic)));
    const rows = this.db.prepare(`
      WITH ranked AS (
        SELECT t.slug topic_slug, t.name topic_name, v.video_id, v.title,
          COALESCE(v.channel_title, '') channel_title, vt.confidence, vt.evidence_json,
          ROW_NUMBER() OVER (
            PARTITION BY t.id ORDER BY vt.confidence DESC, v.video_id
          ) evidence_rank
        FROM youtube_topics t
        JOIN youtube_video_topics vt ON vt.topic_id=t.id AND vt.rank=1
          AND vt.decision='accepted' AND vt.evidence_json<>'[]'
        JOIN youtube_videos v ON v.video_id=vt.video_id AND v.metadata_hash=vt.metadata_hash
        WHERE t.taxonomy_version=? AND t.slug NOT IN ('unknown', 'other')
      )
      SELECT * FROM ranked WHERE evidence_rank<=?
      ORDER BY topic_name, evidence_rank
    `).all(taxonomyVersion, safeLimit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      topicSlug: String(row.topic_slug),
      topicName: String(row.topic_name),
      videoId: String(row.video_id),
      title: String(row.title),
      channelTitle: String(row.channel_title),
      confidence: Number(row.confidence),
      evidence: JSON.parse(String(row.evidence_json)) as PersonalTaxonomyEvidenceRow['evidence'],
    }));
  }

  youtubePersonalTaxonomyDistribution(
    taxonomyVersion: number,
    range: YoutubeRange = 'all',
    now = new Date(),
  ): PersonalTaxonomyDistribution {
    this.ensureEstimatedEvents();
    const cutoff = youtubeCutoff(range, now);
    const where = cutoff ? 'WHERE e.watched_at>=?' : 'WHERE 1=1';
    const params = cutoff ? [taxonomyVersion, cutoff] : [taxonomyVersion];
    const totals = this.db.prepare(`
      ${YOUTUBE_ESTIMATED_EVENTS_VIEW},
      selected_topics AS (
        SELECT vt.*, t.slug, t.name
        FROM youtube_video_topics vt
        JOIN youtube_topics t ON t.id=vt.topic_id
        WHERE t.taxonomy_version=? AND vt.rank=1
      )
      SELECT COALESCE(SUM(e.estimated_watch_seconds), 0) total_watch_seconds,
        COALESCE(SUM(CASE WHEN selected.decision='accepted' AND selected.slug<>'unknown'
          THEN e.estimated_watch_seconds ELSE 0 END), 0) effective_watch_seconds,
        COALESCE(SUM(CASE WHEN selected.decision IN ('unknown', 'low-confidence')
          OR selected.slug='unknown' THEN e.estimated_watch_seconds ELSE 0 END), 0) unknown_watch_seconds
      FROM estimated_events e
      LEFT JOIN youtube_videos v ON v.video_id=e.video_id
      LEFT JOIN selected_topics selected ON selected.video_id=v.video_id
        AND selected.metadata_hash=v.metadata_hash
      ${where}
    `).get(...params) as Record<string, number>;
    const topicRows = this.db.prepare(`
      ${YOUTUBE_ESTIMATED_EVENTS_VIEW},
      selected_topics AS (
        SELECT vt.*, t.slug, t.name
        FROM youtube_video_topics vt
        JOIN youtube_topics t ON t.id=vt.topic_id
        WHERE t.taxonomy_version=? AND vt.rank=1
      )
      SELECT selected.slug, selected.name,
        COALESCE(SUM(e.estimated_watch_seconds), 0) watch_seconds
      FROM estimated_events e
      JOIN youtube_videos v ON v.video_id=e.video_id
      JOIN selected_topics selected ON selected.video_id=v.video_id
        AND selected.metadata_hash=v.metadata_hash AND selected.decision='accepted'
        AND selected.slug<>'unknown'
      ${where}
      GROUP BY selected.slug ORDER BY watch_seconds DESC, selected.name
    `).all(...params) as Array<Record<string, unknown>>;
    const totalWatchSeconds = Number(totals.total_watch_seconds);
    const effectiveWatchSeconds = Number(totals.effective_watch_seconds);
    const unknownWatchSeconds = Number(totals.unknown_watch_seconds);
    return {
      taxonomyVersion,
      totalWatchSeconds,
      effectiveWatchSeconds,
      unknownWatchSeconds,
      effectiveCoverage: totalWatchSeconds ? effectiveWatchSeconds / totalWatchSeconds : 0,
      unknownShare: totalWatchSeconds ? unknownWatchSeconds / totalWatchSeconds : 0,
      topics: topicRows.map((row) => ({
        slug: String(row.slug),
        name: String(row.name),
        watchSeconds: Number(row.watch_seconds),
        share: effectiveWatchSeconds ? Number(row.watch_seconds) / effectiveWatchSeconds : 0,
      })),
    };
  }

  createYoutubeOAuthState(state: string, expiresAt: string): void {
    this.db.prepare('INSERT INTO youtube_oauth_states(state, expires_at) VALUES (?, ?)').run(state, expiresAt);
  }

  consumeYoutubeOAuthState(state: string, now = new Date().toISOString()): boolean {
    const result = this.db.prepare(`
      UPDATE youtube_oauth_states SET used_at=?
      WHERE state=? AND used_at IS NULL AND expires_at>?
    `).run(now, state, now);
    return Number(result.changes) === 1;
  }

  saveYoutubeOAuthCredential(credential: YoutubeOAuthCredential): void {
    this.db.prepare(`
      INSERT INTO youtube_oauth(id, encrypted_refresh_token, expires_at, scope, updated_at)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET encrypted_refresh_token=excluded.encrypted_refresh_token,
        expires_at=excluded.expires_at, scope=excluded.scope, updated_at=excluded.updated_at
    `).run(
      credential.encryptedRefreshToken, credential.expiresAt,
      credential.scope, credential.updatedAt
    );
  }

  youtubeOAuthCredential(): YoutubeOAuthCredential | null {
    const row = this.db.prepare(`
      SELECT encrypted_refresh_token, expires_at, scope, updated_at
      FROM youtube_oauth WHERE id=1
    `).get() as Record<string, unknown> | undefined;
    return row ? {
      encryptedRefreshToken: String(row.encrypted_refresh_token),
      expiresAt: row.expires_at === null ? null : String(row.expires_at),
      scope: String(row.scope),
      updatedAt: String(row.updated_at),
    } : null;
  }

  setYoutubeSyncState(key: string, value: string, updatedAt = new Date().toISOString()): void {
    this.db.prepare(`
      INSERT INTO youtube_sync_state(key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `).run(key, value, updatedAt);
  }

  youtubeSyncState(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM youtube_sync_state WHERE key=?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  countActivities(): number {
    const row = this.db.prepare('SELECT COUNT(*) count FROM activities').get() as { count: number };
    return Number(row.count);
  }

  countPublicActivities(): number {
    const row = this.db.prepare("SELECT COUNT(*) count FROM activities WHERE visibility='public'").get() as { count: number };
    return Number(row.count);
  }
}
