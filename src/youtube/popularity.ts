// Watched-video popularity distributions (#50): channel subscriber counts and
// public video view counts over the distinct videos watched in a range.
// Bump the version whenever the bounds or refresh policy change.
export const YOUTUBE_POPULARITY_VERSION = 'popularity-v1';

// Lower bounds of the five buckets (<1K, 1K–10K, 10K–100K, 100K–1M, ≥1M);
// the last bucket is open-ended. Shared by channel subscribers and video views.
export const YOUTUBE_POPULARITY_BOUNDS = [0, 1_000, 10_000, 100_000, 1_000_000] as const;

// Video view-count refresh policy. One videos.list request covers 50 videos,
// but long histories hold tens of thousands of them and YouTube quota is
// shared by every account. Recently watched videos refresh at most daily;
// older watches refresh quarterly. Channel subscriber counts keep the
// channel policy in src/data/database.ts.
export const VIDEO_STATISTICS_ACTIVE_REFRESH_DAYS = 1;
export const VIDEO_STATISTICS_DORMANT_REFRESH_DAYS = 90;
export const VIDEO_STATISTICS_ACTIVE_WATCH_DAYS = 30;

// SQL CASE arms mapping a non-negative integer expression to a bucket index.
export function popularityBucketSql(expression: string): string {
  return `CASE ${YOUTUBE_POPULARITY_BOUNDS.slice(1).map((bound, index) =>
    `WHEN ${expression}<${bound} THEN ${index}`).join(' ')} ELSE ${YOUTUBE_POPULARITY_BOUNDS.length - 1} END`;
}
