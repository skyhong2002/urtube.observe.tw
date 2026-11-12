import type { YoutubeChannelSummary } from './types.js';

export interface CommunityChannel { id: string; name: string; members: number; watches: number; thumbnailUrl?: string; estimatedWatchSeconds?: number }

export interface CommunityStats {
  status: 'ready' | 'unavailable';
  generatedAt: string;
  publicMembers: number;
  profiles?: Array<{ handle: string; displayName: string }>;
  activeMembers: number;
  watches: number;
  channels: number;
  estimatedWatchSeconds?: number;
  topWatchedChannels?: CommunityChannel[];
  topDurationChannels?: CommunityChannel[];
  topChannels: CommunityChannel[];
  // Share of public members with new watch records in the last 7 days, as a
  // band only (see recentImportsBand). Absent while unavailable.
  recentImports?: RecentImports;
}
interface Member { id: number; dashboardPublic: boolean; handle?: string; displayName?: string }
interface Source<T extends Member> {
  listUsers(): T[];
  repositoryFor(user: T): {
    youtubeChannelTotals(range: '90d', now: Date): YoutubeChannelSummary[] | Promise<YoutubeChannelSummary[]>;
    // When the newest watch record was written into this archive (an ISO
    // time, or only its UTC day from a durable copy), or null if none.
    lastWatchImportAt(): string | null | Promise<string | null>;
  };
}

// Home page data freshness: how many public dashboard members had new watch
// records written (Takeout, data portability, extension history or capture)
// in the last RECENT_IMPORT_DAYS days. Approved by the user on 2026-11-13.
//
// Only a band leaves this module: never a count, a member, or a time. Bands
// over r = recent members / public members (integer arithmetic, no rounding):
//   none           r = 0
//   few            0 < r < 1/4
//   about-quarter  1/4 <= r < 1/2
//   about-half     1/2 <= r < 3/4
//   most           r >= 3/4
// With fewer than MIN_FRESHNESS_MEMBERS public members nothing is shown
// ("too-few-members"). Days are compared as UTC dates, so a record written
// on the UTC date seven days before now still counts (up to 8 days).
export const RECENT_IMPORT_DAYS = 7;
export const MIN_FRESHNESS_MEMBERS = 3;
export const RECENT_IMPORT_BANDS = ['none', 'few', 'about-quarter', 'about-half', 'most'] as const;
export type RecentImportsBand = typeof RECENT_IMPORT_BANDS[number];
export type RecentImports = RecentImportsBand | 'too-few-members';

export function recentImportsBand(recent: number, members: number): RecentImports {
  if (members < MIN_FRESHNESS_MEMBERS) return 'too-few-members';
  if (recent <= 0) return 'none';
  if (recent * 4 < members) return 'few';
  if (recent * 2 < members) return 'about-quarter';
  if (recent * 4 < members * 3) return 'about-half';
  return 'most';
}

function importedRecently(value: string | null, now: number): boolean {
  const day = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : '';
  return day !== '' && day >= new Date(now - RECENT_IMPORT_DAYS * 86_400_000).toISOString().slice(0, 10);
}

// Only public archives contribute. Recheck membership on EVERY request so a
// privacy change or deletion invalidates the cache immediately. No user IDs,
// raw events, searches, or per-user contribution maps leave this function.
// Public profile projections contain only current handles and display names.
//
// A cold refresh reads every public archive. Under host IO pressure that took
// minutes (2026-10-23), longer than the cache lifetime, so the landing page
// never answered. One refresh runs at a time; a request waits at most waitMs,
// then gets the last result for the same members or the "unavailable" state.
// A channel enters the public rankings only when at least this many distinct
// public members watched it in the window, so a ranked channel cannot be tied
// back to one person. Totals (watches, channels, time) still count everyone.
// Approved by the user on 2026-11-12.
export const MIN_RANKED_MEMBERS = 3;

export function communityStatsProvider<T extends Member>(source: Source<T>, clock = () => Date.now(), waitMs = 2000) {
  let cache: { key: string; at: number; value: CommunityStats } | undefined;
  type Run = { key: string; value?: Promise<CommunityStats> };
  let pending: Run | undefined;
  const emptyAt = (now: number): CommunityStats => ({ status: 'unavailable', generatedAt: new Date(now).toISOString(), publicMembers: 0, profiles: [], activeMembers: 0, watches: 0, channels: 0, estimatedWatchSeconds: 0, topWatchedChannels: [], topDurationChannels: [], topChannels: [] });
  const snapshot = () => {
    const members = source.listUsers().filter(user => user.dashboardPublic);
    const profiles = members.flatMap(user => user.handle && user.displayName ? [{ handle: user.handle, displayName: user.displayName }] : []);
    return { members, profiles, key: JSON.stringify([members.map(user => user.id).sort((a, b) => a - b), profiles]) };
  };
  const refresh = async (run: Run, members: T[], profiles: CommunityStats['profiles'], now: number): Promise<CommunityStats> => {
    const empty = emptyAt(now);
    try {
      const value: CommunityStats = { ...empty, status: 'ready', publicMembers: members.length, profiles };
      const channels = new Map<string, CommunityChannel>();
      // A member whose last import cannot be read makes the band unavailable
      // rather than miscounted; the rankings are still shown.
      const repositories = members.map(user => source.repositoryFor(user));
      const lastImports = Promise.all(repositories.map(repository => Promise.resolve()
        .then(() => repository.lastWatchImportAt())
        .then(value => importedRecently(value, now), () => undefined)));
      const totals = await Promise.all(repositories.map(repository => repository.youtubeChannelTotals('90d', new Date(now))));
      const recent = await lastImports;
      if (recent.every(value => value !== undefined)) {
        value.recentImports = recentImportsBand(recent.filter(Boolean).length, members.length);
      }
      for (const rows of totals) {
        const memberChannels = new Set<string>();
        let watches = 0;
        for (const row of rows) {
          watches += row.watches;
          value.estimatedWatchSeconds! += Math.max(0, row.estimatedWatchSeconds || 0);
          // Names are not unique identifiers; unresolved channels are excluded
          // from distinct-channel counts and the ranking, but not watch totals.
          if (!row.channelId || !/^UC[\w-]{22}$/.test(row.channelId) || row.watches <= 0) continue;
          const entry = channels.get(row.channelId) ?? { id: row.channelId, name: row.name || row.channelId, members: 0, watches: 0, estimatedWatchSeconds: 0, thumbnailUrl: /^https:\/\//.test(row.thumbnailUrl) ? row.thumbnailUrl : '' };
          if (!memberChannels.has(row.channelId)) entry.members++;
          memberChannels.add(row.channelId);
          entry.watches += row.watches;
          entry.estimatedWatchSeconds = (entry.estimatedWatchSeconds ?? 0) + Math.max(0, row.estimatedWatchSeconds || 0);
          channels.set(row.channelId, entry);
        }
        value.watches += watches;
        if (watches > 0) value.activeMembers++;
      }
      value.channels = channels.size;
      const ranked = [...channels.values()].filter(channel => channel.members >= MIN_RANKED_MEMBERS);
      value.topChannels = [...ranked].sort((a, b) => b.members - a.members || b.watches - a.watches || a.id.localeCompare(b.id)).slice(0, 8);
      value.topWatchedChannels = [...ranked].sort((a, b) => b.watches - a.watches || (b.estimatedWatchSeconds ?? 0) - (a.estimatedWatchSeconds ?? 0) || a.id.localeCompare(b.id)).slice(0, 30);
      value.topDurationChannels = [...ranked].sort((a, b) => (b.estimatedWatchSeconds ?? 0) - (a.estimatedWatchSeconds ?? 0) || b.watches - a.watches || a.id.localeCompare(b.id)).slice(0, 30);
      if (pending === run) cache = { key: run.key, at: now, value };
      return value;
    } catch {
      if (pending === run) cache = undefined;
      return empty;
    } finally {
      if (pending === run) pending = undefined;
    }
  };
  return async (): Promise<CommunityStats> => {
    const now = clock();
    try {
      const { members, profiles, key } = snapshot();
      if (cache?.key === key && now - cache.at < 300_000) return cache.value;
      let run = pending;
      if (run?.key !== key) {
        run = { key };
        pending = run;
        run.value = refresh(run, members, profiles, now);
      }
      const running = run.value!;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const value = await Promise.race([
        running,
        new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), waitMs); }),
      ]).finally(() => clearTimeout(timer));
      // Membership may have changed while this request waited.
      if (snapshot().key !== key) return emptyAt(now);
      return value ?? (cache?.key === key ? cache.value : { ...emptyAt(now), publicMembers: members.length, profiles });
    } catch {
      cache = undefined;
      return emptyAt(now);
    }
  };
}
