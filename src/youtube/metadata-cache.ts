import type { DatabaseSync } from 'node:sqlite';
import { CHANNEL_STATISTICS_ACTIVE_REFRESH_DAYS } from '../data/database.js';
import type { YoutubeVideoStatistics } from './metadata.js';
import { VIDEO_STATISTICS_ACTIVE_REFRESH_DAYS } from './popularity.js';
import type { YoutubeChannelMetadata, YoutubeVideoMetadata } from './types.js';

// Every account keeps its own archive, so two users who watched the same
// video used to cost two YouTube API lookups. This registry-wide cache holds
// only public YouTube metadata keyed by video/channel ID — no user id, watch
// time or other link to who asked — and purges rows once they expire, so an
// account deletion leaves nothing behind for longer than one cache lifetime.
export const VIDEO_METADATA_CACHE_DAYS = 30;
// Within the strictest per-account channel refresh window, so a cache hit
// always satisfies the account that asked for it.
export const CHANNEL_METADATA_CACHE_DAYS = CHANNEL_STATISTICS_ACTIVE_REFRESH_DAYS;
// View counts move daily; a hit must be no older than the fastest refresh.
export const VIDEO_STATISTICS_CACHE_DAYS = VIDEO_STATISTICS_ACTIVE_REFRESH_DAYS;

const DAY_MS = 86400_000;
// Keep each IN (...) list well under SQLite's bound-parameter limit.
const LOOKUP_CHUNK = 500;

export interface CachedYoutubeMetadata<T> {
  value: T;
  fetchedAt: string;
}

export class YoutubeMetadataCache {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS youtube_video_metadata_cache (
        video_id TEXT PRIMARY KEY, metadata_json TEXT NOT NULL, fetched_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS youtube_video_metadata_cache_fetched ON youtube_video_metadata_cache(fetched_at);
      CREATE TABLE IF NOT EXISTS youtube_channel_metadata_cache (
        channel_id TEXT PRIMARY KEY, metadata_json TEXT NOT NULL, fetched_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS youtube_channel_metadata_cache_fetched ON youtube_channel_metadata_cache(fetched_at);
      CREATE TABLE IF NOT EXISTS youtube_video_statistics_cache (
        video_id TEXT PRIMARY KEY, metadata_json TEXT NOT NULL, fetched_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS youtube_video_statistics_cache_fetched ON youtube_video_statistics_cache(fetched_at);
    `);
  }

  videos(ids: readonly string[], now = new Date()): Map<string, CachedYoutubeMetadata<YoutubeVideoMetadata>> {
    return this.read('youtube_video_metadata_cache', 'video_id', ids, cutoff(now, VIDEO_METADATA_CACHE_DAYS));
  }

  channels(ids: readonly string[], now = new Date()): Map<string, CachedYoutubeMetadata<YoutubeChannelMetadata>> {
    return this.read('youtube_channel_metadata_cache', 'channel_id', ids, cutoff(now, CHANNEL_METADATA_CACHE_DAYS));
  }

  videoStatistics(ids: readonly string[], now = new Date()): Map<string, CachedYoutubeMetadata<YoutubeVideoStatistics>> {
    return this.read('youtube_video_statistics_cache', 'video_id', ids, cutoff(now, VIDEO_STATISTICS_CACHE_DAYS));
  }

  putVideoStatistics(videos: readonly YoutubeVideoStatistics[], fetchedAt = new Date().toISOString()): void {
    this.write('youtube_video_statistics_cache',
      videos.map(({ videoId, viewCount }) => [videoId, { videoId, viewCount }]), fetchedAt,
      cutoff(new Date(fetchedAt), VIDEO_STATISTICS_CACHE_DAYS));
  }

  putVideos(videos: readonly YoutubeVideoMetadata[], fetchedAt = new Date().toISOString()): void {
    this.write('youtube_video_metadata_cache',
      videos.map(({ statisticsFetchedAt: _fetched, ...video }) => [video.videoId, video]), fetchedAt,
      cutoff(new Date(fetchedAt), VIDEO_METADATA_CACHE_DAYS));
  }

  putChannels(channels: readonly YoutubeChannelMetadata[], fetchedAt = new Date().toISOString()): void {
    this.write('youtube_channel_metadata_cache',
      channels.map(({ statisticsFetchedAt: _fetched, ...channel }) => [channel.channelId, channel]), fetchedAt,
      cutoff(new Date(fetchedAt), CHANNEL_METADATA_CACHE_DAYS));
  }

  private read<T>(table: string, key: string, ids: readonly string[], since: string): Map<string, CachedYoutubeMetadata<T>> {
    const found = new Map<string, CachedYoutubeMetadata<T>>();
    const unique = [...new Set(ids)];
    for (let index = 0; index < unique.length; index += LOOKUP_CHUNK) {
      const chunk = unique.slice(index, index + LOOKUP_CHUNK);
      const rows = this.db.prepare(`
        SELECT ${key} AS id, metadata_json, fetched_at FROM ${table}
        WHERE ${key} IN (${chunk.map(() => '?').join(',')}) AND fetched_at >= ?
      `).all(...chunk, since) as Array<{ id: string; metadata_json: string; fetched_at: string }>;
      for (const row of rows) found.set(row.id, { value: JSON.parse(row.metadata_json) as T, fetchedAt: row.fetched_at });
    }
    return found;
  }

  private write(table: string, entries: Array<[string, unknown]>, fetchedAt: string, expiredBefore: string): void {
    const statement = this.db.prepare(`INSERT OR REPLACE INTO ${table} VALUES (?, ?, ?)`);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const [id, value] of entries) statement.run(id, JSON.stringify(value), fetchedAt);
      this.db.prepare(`DELETE FROM ${table} WHERE fetched_at < ?`).run(expiredBefore);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function cutoff(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}
