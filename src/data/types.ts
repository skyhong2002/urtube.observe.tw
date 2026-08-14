// The unified internal data model. Every source module normalizes into this
// shape; every output module reads only from it — neither side needs to know
// the other exists. This is the actual asset: a persistent, cross-platform
// media consumption log, of which cards are just the first rendering.

export type MediaKind = 'game' | 'anime' | 'manga' | 'movie' | 'show' | 'book' | 'music' | 'video' | 'event';

export interface Rating {
  value: number;
  scale: number; // e.g. {value: 3.5, scale: 5} or {value: 8, scale: 10}
}

export type ExtraValue = string | number | string[];

export interface MediaEntry {
  // Stable id from the upstream service when one is available. Persistence
  // falls back to a deterministic content key for sources that do not expose
  // ids (for example Backloggd's public profile grid).
  sourceItemId?: string;
  visibility?: ActivityVisibility;
  source: string;
  kind: MediaKind;
  title: string;
  image: string; // raw source URL; the output layer inlines/resizes it
  status?: string; // raw status label from the source, e.g. 'completed' | 'on_hold' | 'reading'
  // ISO date where the source exposes one; '' if unavailable. Backloggd has
  // no ISO date for "last played" (only a short label like "Jul 7"), so its
  // entries carry that pre-formatted label here instead of a real ISO string.
  activityAt: string;
  rating: Rating | null;
  // Long-tail per-entry display bits that don't generalize across sources
  // (platform/playtime, episode counts, author, ...).
  extra: Record<string, ExtraValue>;
}

// `summary` activities may contribute to explicit aggregate views, but are
// never returned by the generic public timeline, feeds, search, or MCP tools.
export type ActivityVisibility = 'public' | 'summary' | 'private';
export type ActivityTimePrecision = 'exact' | 'day' | 'label' | 'unknown';

// Durable v2 model. SourceSnapshot remains the source/output interchange
// format; Activity is the append-only normalized history derived from it.
export interface Activity {
  id: string;
  dedupeKey: string;
  source: string;
  sourceItemId: string | null;
  type: string;
  mediaKind: MediaKind;
  title: string;
  image: string;
  status: string | null;
  occurredAt: string | null;
  occurredAtPrecision: ActivityTimePrecision;
  rating: Rating | null;
  visibility: ActivityVisibility;
  extra: Record<string, ExtraValue>;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface SourceProfile {
  id: string;
  name: string;
  avatar: string;
  url: string;
}

// One refresh cycle's worth of data for a source. `entries` and `stats` are
// the genuinely universal parts of a lifelog record; `extra` is a typed,
// source-specific bag for things that don't fit `entries` at all (e.g.
// stats.fm's weekly top-albums/top-artists leaderboard has no per-item date,
// so it isn't an "entry"; Backloggd's yearExtras tooltip line).
export interface SourceSnapshot<TExtra = Record<string, never>> {
  source: string;
  profile: SourceProfile;
  stats: Record<string, number>; // headline counters, e.g. gamesPlayed, weeklyMinutes
  entries: MediaEntry[];
  extra: TExtra;
}
