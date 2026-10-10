import { createHash } from 'node:crypto';
import { YOUTUBE_RANGES, type YoutubeRange, type YoutubeRecentVideo } from './types.js';

export interface HistoryQueryInput {
  range?: YoutubeRange;
  q?: string;
  from?: string;
  to?: string;
  cursor?: string;
  direction?: string;
  limit?: number;
}

export interface YoutubeHistoryFilters {
  range: YoutubeRange;
  q: string;
  from: string;
  to: string;
}

export interface YoutubeHistoryEntry extends YoutubeRecentVideo {
  eventId: string;
  precision: 'exact' | 'day';
}

export interface YoutubeHistoryPage {
  entries: YoutubeHistoryEntry[];
  filters: YoutubeHistoryFilters;
  olderCursor: string | null;
  newerCursor: string | null;
}

export class HistoryQueryError extends Error {
  constructor(public readonly field: 'q' | 'dates' | 'cursor') {
    super(`Invalid history ${field}`);
    this.name = 'HistoryQueryError';
  }
}

interface HistoryCursor {
  v: 1;
  at: string;
  id: string;
  filters: string;
}

function calendarDate(value: string | undefined): string {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || value.startsWith('0000-')) throw new HistoryQueryError('dates');
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new HistoryQueryError('dates');
  }
  return value;
}

function cursorTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false;
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!parts || Number(parts[2]) > 23 || Number(parts[3]) > 59 || Number(parts[4]) > 59) return false;
  // Date.parse accepts both ambiguous prose and rollover dates (February 30).
  // Keep actual ISO timestamps, including legacy offsets, and preserve the
  // original spelling because the paging key is the stored timestamp text.
  return Boolean(calendarDate(parts[1])) && Number.isFinite(Date.parse(value));
}

export function normalizeHistoryQuery(input: HistoryQueryInput = {}) {
  if (input.q !== undefined && typeof input.q !== 'string') throw new HistoryQueryError('q');
  const q = (input.q ?? '').trim();
  if ([...q].length > 120 || q.includes('\0')) throw new HistoryQueryError('q');
  const from = calendarDate(input.from);
  const to = calendarDate(input.to);
  if (from && to && from > to) throw new HistoryQueryError('dates');
  const range = from || to ? 'all' : (input.range ?? '365d');
  if (!YOUTUBE_RANGES.includes(range)) throw new HistoryQueryError('dates');
  const filters: YoutubeHistoryFilters = { range, q, from, to };
  const filterHash = createHash('sha256').update(JSON.stringify(filters)).digest('hex');
  const direction = input.direction ?? 'older';
  if (direction !== 'older' && direction !== 'newer') throw new HistoryQueryError('cursor');
  let cursor: HistoryCursor | null = null;
  if (input.cursor !== undefined && input.cursor !== '') {
    try {
      if (typeof input.cursor !== 'string' || input.cursor.length > 2048
        || !/^[A-Za-z0-9_-]+$/.test(input.cursor)) throw new Error();
      const decoded: unknown = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
      if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error();
      const value = decoded as Partial<HistoryCursor>;
      if (value.v !== 1 || value.filters !== filterHash
        || !cursorTimestamp(value.at)
        || typeof value.id !== 'string' || !value.id || value.id.length > 1024 || value.id.includes('\0')) {
        throw new Error();
      }
      cursor = value as HistoryCursor;
    } catch { throw new HistoryQueryError('cursor'); }
  } else if (direction === 'newer') {
    throw new HistoryQueryError('cursor');
  }
  const limit = typeof input.limit === 'number' && Number.isFinite(input.limit)
    ? Math.max(1, Math.min(100, Math.floor(input.limit))) : 50;
  // SQLite LIKE only folds ASCII. The query folds both operands explicitly,
  // while escaping its three special characters keeps search text literal.
  const pattern = q ? `%${q.toLowerCase().replace(/[\\%_]/g, '\\$&')}%` : null;
  const start = from ? new Date(`${from}T00:00:00+08:00`).toISOString() : null;
  const end = to ? new Date(Date.parse(`${to}T00:00:00+08:00`) + 86_400_000).toISOString() : null;
  return { filters, filterHash, cursor, direction, limit, pattern, start, end };
}

export function historyCursor(entry: YoutubeHistoryEntry, filterHash: string): string {
  // This is a paging position, never an access credential. Repository and
  // route authorization still determine whose records may be read.
  const value: HistoryCursor = { v: 1, at: entry.watchedAt, id: entry.eventId, filters: filterHash };
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
