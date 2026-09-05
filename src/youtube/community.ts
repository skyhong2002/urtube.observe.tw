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
}
interface Member { id: number; dashboardPublic: boolean; handle?: string; displayName?: string }
interface Source<T extends Member> {
  listUsers(): T[];
  repositoryFor(user: T): { youtubeChannelTotals(range: '90d', now: Date): YoutubeChannelSummary[] };
}

// Only public archives contribute. Recheck membership on EVERY request so a
// privacy change or deletion invalidates the cache immediately. No user IDs,
// raw events, searches, or per-user contribution maps leave this function.
// The profile projection contains only current public handles and display names.
export function communityStatsProvider<T extends Member>(source: Source<T>, clock = () => Date.now()) {
  let cache: { key: string; at: number; value: CommunityStats } | undefined;
  return (): CommunityStats => {
    const now = clock();
    const empty: CommunityStats = { status: 'unavailable', generatedAt: new Date(now).toISOString(), publicMembers: 0, profiles: [], activeMembers: 0, watches: 0, channels: 0, estimatedWatchSeconds: 0, topWatchedChannels: [], topDurationChannels: [], topChannels: [] };
    try {
      const members = source.listUsers().filter(user => user.dashboardPublic);
      const profiles = members.flatMap(user => user.handle && user.displayName ? [{ handle: user.handle, displayName: user.displayName }] : []);
      const key = JSON.stringify([members.map(user => user.id).sort((a, b) => a - b), profiles]);
      if (cache?.key === key && now - cache.at < 300_000) return cache.value;
      const value: CommunityStats = { ...empty, status: 'ready', publicMembers: members.length, profiles };
      const channels = new Map<string, CommunityChannel>();
      for (const user of members) {
        const rows = source.repositoryFor(user).youtubeChannelTotals('90d', new Date(now));
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
      value.topChannels = [...channels.values()].sort((a, b) => b.members - a.members || b.watches - a.watches || a.id.localeCompare(b.id)).slice(0, 8);
      value.topWatchedChannels = [...channels.values()].sort((a, b) => b.watches - a.watches || (b.estimatedWatchSeconds ?? 0) - (a.estimatedWatchSeconds ?? 0) || a.id.localeCompare(b.id)).slice(0, 30);
      value.topDurationChannels = [...channels.values()].sort((a, b) => (b.estimatedWatchSeconds ?? 0) - (a.estimatedWatchSeconds ?? 0) || b.watches - a.watches || a.id.localeCompare(b.id)).slice(0, 30);
      cache = { key, at: now, value };
      return value;
    } catch {
      cache = undefined;
      return empty;
    }
  };
}
