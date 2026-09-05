import type { YoutubeChannelSummary } from './types.js';

export interface CommunityChannel { id: string; name: string; members: number; watches: number; thumbnailUrl?: string }

export interface CommunityStats {
  status: 'ready' | 'unavailable';
  generatedAt: string;
  publicMembers: number;
  activeMembers: number;
  watches: number;
  channels: number;
  estimatedWatchSeconds?: number;
  topWatchedChannels?: CommunityChannel[];
  topChannels: CommunityChannel[];
}
interface Member { id: number; dashboardPublic: boolean }
interface Source<T extends Member> {
  listUsers(): T[];
  repositoryFor(user: T): { youtubeChannelTotals(range: '28d', now: Date): YoutubeChannelSummary[] };
}

// Only public archives contribute. Recheck membership on EVERY request so a
// privacy change or deletion invalidates the cache immediately. No user IDs,
// raw events, searches, or per-user contribution maps leave this function.
export function communityStatsProvider<T extends Member>(source: Source<T>, clock = () => Date.now()) {
  let cache: { key: string; at: number; value: CommunityStats } | undefined;
  return (): CommunityStats => {
    const now = clock();
    const empty: CommunityStats = { status: 'unavailable', generatedAt: new Date(now).toISOString(), publicMembers: 0, activeMembers: 0, watches: 0, channels: 0, estimatedWatchSeconds: 0, topWatchedChannels: [], topChannels: [] };
    try {
      const members = source.listUsers().filter(user => user.dashboardPublic);
      const key = members.map(user => user.id).sort((a, b) => a - b).join(',');
      if (cache?.key === key && now - cache.at < 300_000) return cache.value;
      const value: CommunityStats = { ...empty, status: 'ready', publicMembers: members.length };
      const channels = new Map<string, CommunityChannel>();
      for (const user of members) {
        const rows = source.repositoryFor(user).youtubeChannelTotals('28d', new Date(now));
        const memberChannels = new Set<string>();
        let watches = 0;
        for (const row of rows) {
          watches += row.watches;
          value.estimatedWatchSeconds! += Math.max(0, row.estimatedWatchSeconds || 0);
          // Names are not unique identifiers; unresolved channels are excluded
          // from distinct-channel counts and the ranking, but not watch totals.
          if (!row.channelId || !/^UC[\w-]{22}$/.test(row.channelId) || row.watches <= 0) continue;
          const entry = channels.get(row.channelId) ?? { id: row.channelId, name: row.name || row.channelId, members: 0, watches: 0, thumbnailUrl: /^https:\/\//.test(row.thumbnailUrl) ? row.thumbnailUrl : '' };
          if (!memberChannels.has(row.channelId)) entry.members++;
          memberChannels.add(row.channelId);
          entry.watches += row.watches;
          channels.set(row.channelId, entry);
        }
        value.watches += watches;
        if (watches > 0) value.activeMembers++;
      }
      value.channels = channels.size;
      value.topChannels = [...channels.values()].sort((a, b) => b.members - a.members || b.watches - a.watches || a.id.localeCompare(b.id)).slice(0, 8);
      value.topWatchedChannels = [...channels.values()].sort((a, b) => b.watches - a.watches || b.members - a.members || a.id.localeCompare(b.id)).slice(0, 8);
      cache = { key, at: now, value };
      return value;
    } catch {
      cache = undefined;
      return empty;
    }
  };
}
