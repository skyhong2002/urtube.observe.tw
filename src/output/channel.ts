// /channel/<youtube channel id>: one channel through the signed-in person's
// history, plus how the matching pool as a whole watches it — the stats.fm
// artist page, for a YouTube channel.
import type { YoutubeChannelDetail, YoutubeRange } from '../youtube/types.js';
import { messages, type Lang, type Messages } from './i18n.js';
import { hours, html, primaryNav, shell } from './pages.js';

export const CHANNEL_PAGE_RANGES = ['28d', '90d', '365d', 'all'] as const satisfies readonly YoutubeRange[];
export type ChannelPageRange = typeof CHANNEL_PAGE_RANGES[number];

export function channelPageRange(value: string | undefined): ChannelPageRange {
  return (CHANNEL_PAGE_RANGES as readonly string[]).includes(value ?? '') ? value as ChannelPageRange : '365d';
}

export type ChannelPageSort = 'duration' | 'watches';
export function channelPageSort(value: string | undefined): ChannelPageSort {
  return value === 'watches' ? 'watches' : 'duration';
}

// Aggregate the complete per-person lists before capping display results.
function ranked<T extends { watches: number; estimatedWatchSeconds: number }>(rows: T[], sort: ChannelPageSort): T[] {
  const key = (row: T) => 'videoId' in row ? String(row.videoId) : 'handle' in row ? String(row.handle) : '';
  return [...rows].sort((a, b) =>
    (sort === 'watches' ? b.watches - a.watches : b.estimatedWatchSeconds - a.estimatedWatchSeconds)
    || (sort === 'watches' ? b.estimatedWatchSeconds - a.estimatedWatchSeconds : b.watches - a.watches)
    || key(a).localeCompare(key(b)));
}

export const YOUTUBE_CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

export interface ChannelPageViewer {
  handle: string;
  displayName: string;
}

export interface ChannelMemberRow {
  handle: string;
  displayName: string;
  isViewer: boolean;
  canCompare: boolean;
  watches: number;
  estimatedWatchSeconds: number;
  rank: YoutubeChannelDetail['rank'];
}

export interface ChannelCommunityVideo {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  watches: number;
  estimatedWatchSeconds: number;
  viewers: number;
}

export interface ChannelPageData {
  channel: { channelId: string; name: string; thumbnailUrl: string };
  range: ChannelPageRange;
  sort: ChannelPageSort;
  mine: YoutubeChannelDetail;
  // Null when the viewer has not joined matching: community sections are
  // reciprocal, so non-members neither contribute nor see them.
  community: {
    members: ChannelMemberRow[];
    videos: ChannelCommunityVideo[];
    memberCount: number;
  } | null;
}

const styles = `
  .ch-head{align-items:center;display:flex;gap:18px;margin:14px 0 18px}.ch-avatar{background:var(--raised);border-radius:50%;color:var(--ink-2);display:grid;flex:0 0 84px;font-size:30px;font-weight:700;height:84px;object-fit:cover;place-items:center;width:84px}.ch-head h1{font-size:clamp(26px,4vw,40px);letter-spacing:-.03em;line-height:1.05;margin:2px 0 6px}.ch-meta{color:var(--muted);font-size:12px}.ch-meta a{color:var(--ink-2)}
  .ch-range{margin:0 0 14px}.ch-head>div{min-width:0}.ch-head code{overflow-wrap:anywhere}.ch-months{overflow-x:auto}
  .ch-stats{display:grid;gap:14px 22px;grid-template-columns:repeat(auto-fit,minmax(130px,1fr))}.ch-stats .yt-stat:nth-child(n+6) strong{font-size:15px;white-space:nowrap}
  .ch-rows{display:grid;gap:2px}.ch-row{align-items:center;border-radius:10px;display:grid;gap:12px;grid-template-columns:28px minmax(0,1fr) 110px;padding:7px 6px}.ch-row:hover{background:var(--raised)}.ch-row.me{background:rgba(208,59,59,.08)}
  .ch-rank{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;text-align:right}
  .ch-main{align-items:center;display:flex;gap:12px;min-width:0}.ch-main strong{display:block;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ch-main strong a{color:var(--ink);text-decoration:none}.ch-main strong a:hover{color:var(--accent-text)}.ch-main small{color:var(--muted);display:block;font-size:11px}.ch-main>div{min-width:0}
  .ch-main img,.ch-initial{background:var(--raised);border-radius:50%;color:var(--ink-2);display:grid;flex:0 0 36px;font-size:13px;font-weight:700;height:36px;object-fit:cover;place-items:center;width:36px}.ch-main img.ch-thumb,.ch-thumb{border-radius:6px;flex:0 0 64px;height:36px;object-fit:cover;width:64px}
  .ch-nums{text-align:right}.ch-nums strong{display:block;font-size:13px;font-variant-numeric:tabular-nums;font-weight:650}.ch-nums span{color:var(--muted);font-size:10px;font-variant-numeric:tabular-nums}
  .ch-months{align-items:flex-end;display:flex;gap:4px;height:120px;margin-top:6px}.ch-month{background:var(--accent);border-radius:4px 4px 2px 2px;flex:1;min-width:6px;outline:none}.ch-month:hover,.ch-month:focus{background:#e66767}.ch-month-labels{color:var(--muted);display:flex;font-size:10px;justify-content:space-between;margin-top:6px}
  .ch-empty{color:var(--muted);font-size:12px;margin:0}
  .ch-more summary{color:var(--muted);cursor:pointer;font-size:12px;margin:8px 6px 4px}
  @media(max-width:560px){.ch-row{grid-template-columns:24px minmax(0,1fr) 84px;gap:8px}}
`;

function count(value: number): string {
  return new Intl.NumberFormat('en').format(value);
}

function taipeiDate(iso: string | null, t: Messages): string {
  if (!iso) return '—';
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '—';
  const local = new Date(time + 8 * 3600_000);
  return t.fullDate(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate());
}

function folded(rows: string[], t: Messages, visible = 8): string {
  const head = rows.slice(0, visible).join('');
  const rest = rows.slice(visible);
  if (!rest.length) return `<div class="ch-rows">${head}</div>`;
  return `<div class="ch-rows">${head}</div><details class="ch-more"><summary>${html(t.matchesShowMore(rest.length))}</summary><div class="ch-rows">${rest.join('')}</div></details>`;
}

function videoRow(video: { videoId: string; title: string; thumbnailUrl: string; watches: number; estimatedWatchSeconds: number }, index: number, t: Messages, sort: ChannelPageSort, extra = ''): string {
  const thumb = video.thumbnailUrl
    ? `<img class="ch-thumb" src="${html(video.thumbnailUrl)}" alt="" loading="lazy" width="64" height="36">`
    : '<span class="ch-thumb" aria-hidden="true"></span>';
  return `<div class="ch-row"><span class="ch-rank">#${index + 1}</span><div class="ch-main">${thumb}<div><strong><a href="https://www.youtube.com/watch?v=${html(video.videoId)}" rel="noopener" target="_blank">${html(video.title)}</a></strong>${extra ? `<small>${extra}</small>` : ''}</div></div><div class="ch-nums"><strong>${sort === 'watches' ? html(t.matchesTimes(video.watches)) : hours(video.estimatedWatchSeconds)}</strong><span>${sort === 'watches' ? hours(video.estimatedWatchSeconds) : html(t.matchesTimes(video.watches))}</span></div></div>`;
}

function monthlySection(detail: YoutubeChannelDetail, t: Messages, sort: ChannelPageSort): string {
  if (!detail.monthly.length) return '';
  const monthly = [] as YoutubeChannelDetail['monthly'];
  const byMonth = new Map(detail.monthly.map((entry) => [entry.month, entry]));
  const cursor = new Date(`${detail.monthly[0]!.month}-01T00:00:00Z`);
  const lastMonth = detail.monthly[detail.monthly.length - 1]!.month;
  while (cursor.toISOString().slice(0, 7) <= lastMonth) {
    const month = cursor.toISOString().slice(0, 7);
    monthly.push(byMonth.get(month) ?? { month, watches: 0, estimatedWatchSeconds: 0 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const value = (entry: YoutubeChannelDetail['monthly'][number]) => sort === 'watches' ? entry.watches : entry.estimatedWatchSeconds;
  const max = Math.max(1, ...monthly.map(value));
  const bars = monthly.map((entry) =>
    `<div class="ch-month" style="height:${value(entry) ? Math.max(3, Math.round(value(entry) / max * 100)) : 1}%" tabindex="0" data-tip="${html(entry.month)}" data-tip-label="${html(`${hours(entry.estimatedWatchSeconds)} · ${t.matchesTimes(entry.watches)}`)}"></div>`).join('');
  const first = detail.monthly[0]!.month;
  const last = detail.monthly[detail.monthly.length - 1]!.month;
  return `<section class="section"><div class="section-head"><h2>${sort === 'watches' ? t.channelMonthlyWatches : t.channelMonthly}</h2><span>${html(t.ranges[detail.range] ?? detail.range)}</span></div><div class="ch-months">${bars}</div><div class="ch-month-labels"><span>${html(first)}</span><span>${html(last)}</span></div></section>`;
}

export function channelPage(viewer: ChannelPageViewer, data: ChannelPageData, lang: Lang = 'en'): string {
  const t = messages(lang);
  const { channel, mine, community, sort } = data;
  const basePath = `/channel/${html(channel.channelId)}`;
  const avatar = channel.thumbnailUrl
    ? `<img class="ch-avatar" src="${html(channel.thumbnailUrl)}" alt="" width="84" height="84">`
    : `<span class="ch-avatar" aria-hidden="true">${html([...channel.name][0] ?? '?')}</span>`;
  const ranges = `<nav class="yt-range ch-range" aria-label="${html(t.matchesRange)}">${CHANNEL_PAGE_RANGES.map((range) =>
    `<a href="${basePath}?range=${range}&sort=${sort}"${range === data.range ? ' aria-current="page"' : ''}>${html(t.ranges[range] ?? range)}</a>`).join('')}</nav>`;
  const sortLinks = `<nav class="yt-range" aria-label="${html(t.matchesMetric)}">${(['duration', 'watches'] as const).map((metric) => `<a href="${basePath}?range=${data.range}&sort=${metric}"${metric === sort ? ' aria-current="page"' : ''}>${metric === 'duration' ? t.rhythmTime : t.rhythmWatches}</a>`).join('')}</nav>`;
  const channelRank = sort === 'watches' ? mine.rank.watches : mine.rank.time;
  const stat = (value: string, label: string) => `<div class="yt-stat"><strong>${value}</strong><span>${html(label)}</span></div>`;
  const yours = mine.stats.watches
    ? `<div class="ch-stats">
        ${stat(count(mine.stats.watches), t.channelStatWatches)}
        ${stat(hours(mine.stats.estimatedWatchSeconds), t.channelStatHours)}
        ${stat(count(mine.stats.uniqueVideos), t.channelStatVideos)}
        ${stat(`${Math.round(mine.stats.share * 1000) / 10}%`, t.channelStatShare)}
        ${stat(channelRank === null ? '—' : `#${channelRank}`, t.channelStatRank(mine.rank.channels))}
        ${stat(taipeiDate(mine.stats.firstWatchedAt, t), t.channelFirstWatch)}
        ${stat(taipeiDate(mine.stats.lastWatchedAt, t), t.channelLastWatch)}
      </div>`
    : `<p class="ch-empty">${t.channelNothingYet}</p>`;
  const myVideos = mine.videos.length
    ? folded(ranked(mine.videos, sort).slice(0, 50).map((video, index) => videoRow(video, index, t, sort)), t)
    : `<p class="ch-empty">${t.channelNothingYet}</p>`;
  let communityHtml: string;
  if (!community) {
    communityHtml = `<section class="section"><div class="section-head"><h2>${t.channelTopViewers}</h2></div><p class="ch-empty">${t.channelJoinForCommunity} <a href="/account">${t.accountMatchingSave}</a></p></section>`;
  } else {
    const memberRows = ranked(community.members, sort).map((member, index) => {
      const name = member.isViewer
        ? `<strong>${html(member.displayName)} <small>(${t.channelYou})</small></strong>`
        : member.canCompare ? `<strong><a href="/${html(viewer.handle)}/compare/${html(member.handle)}">${html(member.displayName)}</a></strong>`
        : `<strong>${html(member.displayName)}</strong>`;
      const avatar = member.isViewer || member.canCompare
        ? `<img src="/avatar/member/${html(member.handle)}" alt="" loading="lazy" width="36" height="36">`
        : `<span class="ch-initial" aria-hidden="true">${html([...member.displayName][0] ?? '?')}</span>`;
      const position = sort === 'watches' ? member.rank.watches : member.rank.time;
      const rank = position === null ? '' : `<small>${html(t.channelMemberRank(position))}</small>`;
      return `<div class="ch-row${member.isViewer ? ' me' : ''}"><span class="ch-rank">#${index + 1}</span><div class="ch-main">${avatar}<div>${name}${rank}</div></div><div class="ch-nums"><strong>${sort === 'watches' ? html(t.matchesTimes(member.watches)) : hours(member.estimatedWatchSeconds)}</strong><span>${sort === 'watches' ? hours(member.estimatedWatchSeconds) : html(t.matchesTimes(member.watches))}</span></div></div>`;
    });
    const communityVideos = ranked(community.videos, sort).slice(0, 50).map((video, index) =>
      videoRow(video, index, t, sort, html(t.channelViewers(video.viewers))));
    communityHtml = `<section class="section"><div class="section-head"><div><h2>${t.channelTopViewers}</h2></div><span>${html(t.channelTopViewersSub(community.memberCount))}</span></div>${memberRows.length ? folded(memberRows, t, 10) : `<p class="ch-empty">${t.channelNoMembers}</p>`}</section>
      <section class="section"><div class="section-head"><h2>${t.channelCommunityVideos}</h2><span>${html(t.channelCommunityVideosSub)}</span></div>${communityVideos.length ? folded(communityVideos, t) : `<p class="ch-empty">${t.channelNoMembers}</p>`}</section>`;
  }
  const body = `<style>${styles}</style>
    <section class="ch-head">${avatar}<div><div class="eyebrow">${t.channelEyebrow}</div><h1>${html(channel.name)}</h1><div class="ch-meta"><a href="https://www.youtube.com/channel/${html(channel.channelId)}" rel="noopener" target="_blank">${t.channelOpenYoutube}</a> · <code>${html(channel.channelId)}</code></div></div></section>
    ${ranges}${sortLinks}
    <section class="section"><div class="section-head"><h2>${t.channelYourStats}</h2><span>${html(viewer.displayName)}</span></div>${yours}</section>
    ${communityHtml}
    <section class="section"><div class="section-head"><h2>${t.channelYourVideos}</h2></div>${myVideos}</section>
    ${monthlySection(mine, t, sort)}`;
  return shell(`${channel.name} · ${t.channelEyebrow}`, body, primaryNav(lang, {
    dashboardHref: `/${viewer.handle}`,
    languageHref: `${basePath}?range=${data.range}&sort=${sort}&lang=${lang === 'zh' ? 'en' : 'zh'}`,
  }), '', lang);
}
