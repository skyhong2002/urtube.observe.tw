// /channel/<youtube channel id>: one channel through the signed-in person's
// history, plus how the matching pool as a whole watches it — the stats.fm
// artist page, for a YouTube channel.
import type { YoutubeChannelDetail, YoutubeChannelMetadata, YoutubeChannelSummary, YoutubeRange } from '../youtube/types.js';
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
  const key = (row: T) => 'videoId' in row ? String(row.videoId) : 'handle' in row ? String(row.handle) : 'channelId' in row ? String(row.channelId) : '';
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
  channel: YoutubeChannelMetadata;
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
  .site-main{padding-top:14px}
  .ch-page .section{background:none;border:0;border-radius:0;box-shadow:none;margin-top:24px;padding:0}
  .ch-page .section-head{align-items:baseline;gap:6px 14px;justify-content:flex-start;margin-bottom:10px;min-height:28px;padding-right:120px}.ch-page .section-head h2{font-size:19px;letter-spacing:-.025em}.ch-page .section-head span{font-size:12px}
  .ch-head{align-items:center;display:flex;gap:18px;margin:8px 0 14px}.ch-avatar{background:var(--raised);border-radius:50%;color:var(--ink-2);display:grid;flex:0 0 88px;font-size:30px;font-weight:700;height:88px;object-fit:cover;place-items:center;width:88px}.ch-head>div{min-width:0}.ch-head h1{font-size:clamp(26px,3vw,36px);letter-spacing:-.035em;line-height:1.15;margin:0 0 5px}.ch-meta{align-items:center;color:var(--muted);display:flex;flex-wrap:wrap;font-size:12px;gap:5px 16px}.ch-meta a{color:var(--ink-2)}.ch-subscribers{color:var(--ink-2);font-size:14px}.ch-subscribers strong{color:var(--ink);font-weight:700}
  .ch-public{align-items:baseline;color:var(--muted);display:flex;flex-wrap:wrap;font-size:12px;gap:4px 16px;margin-top:6px}.ch-public strong{color:var(--ink-2);font-weight:600}.ch-tags{align-items:center;display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}.ch-tags span{color:var(--muted);font-size:11px;margin-right:2px}.ch-tags a{background:var(--raised);border-radius:5px;color:var(--ink-2);font-size:11px;padding:2px 7px;text-decoration:none}
  .ch-toolbar{align-items:center;display:flex;flex-wrap:wrap;gap:8px 20px;margin:14px 0}.ch-toolbar .yt-range{margin:0}.ch-toolbar .yt-range a{font-size:11px;padding:5px 11px}.ch-toolbar .ch-sort{margin-left:auto}
  .ch-stats{display:flex;gap:24px;overflow-x:auto;padding:2px 0 8px;scroll-snap-type:x proximity}.ch-stats .yt-stat{flex:0 0 auto;min-width:110px;scroll-snap-align:start}.ch-stats .yt-stat strong{font-size:24px;line-height:1.3}.ch-stats .yt-stat span{font-size:11px;font-weight:500;letter-spacing:0;margin-top:2px;text-transform:none}.ch-stats .ch-date strong{font-size:14px;padding-top:7px;white-space:nowrap}
  .ch-shelf{position:relative}.ch-controls{display:flex;gap:6px;position:absolute;right:0;top:-40px}.ch-controls button{background:var(--raised);border:0;border-radius:50%;color:var(--ink);cursor:pointer;font-size:17px;height:30px;width:30px}.ch-controls button svg{display:block;height:16px;margin:auto;width:16px}.ch-controls button[aria-pressed=true]{background:var(--ink);color:var(--bg)}.ch-controls button:disabled{cursor:default;opacity:.3}
  .ch-rows{display:flex;gap:16px;overflow-x:auto;overscroll-behavior-x:contain;padding:2px 0 10px;scroll-snap-type:x proximity;scrollbar-color:var(--line-strong) transparent;scrollbar-width:thin}
  .ch-shelf.is-grid .ch-rows{display:grid;grid-template-columns:repeat(auto-fill,minmax(136px,1fr));overflow:visible;row-gap:22px;scroll-snap-type:none}.ch-shelf.is-grid .ch-row{min-width:0}
  .ch-row{border-radius:6px;display:flex;flex:0 0 calc((100% - 96px)/7);flex-direction:column;gap:5px;min-width:136px;padding:0;position:relative;scroll-snap-align:start}.ch-row.me .ch-main strong{color:var(--accent-text)}.ch-row:hover .ch-main strong a{color:var(--accent-text)}
  .ch-rank{background:rgba(13,13,12,.88);border-radius:5px;color:var(--ink-2);font-size:11px;font-variant-numeric:tabular-nums;line-height:1.6;padding:1px 5px;position:absolute;right:5px;top:5px;z-index:1}.ch-row:nth-child(-n+3) .ch-rank{color:#ecc15b}
  .ch-main{display:flex;flex:1;flex-direction:column;gap:7px;min-width:0}.ch-main strong{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:13px;font-weight:650;line-height:1.4;overflow:hidden;overflow-wrap:anywhere}.ch-main a{color:var(--ink);text-decoration:none}.ch-main small{color:var(--muted);display:block;font-size:11px;line-height:1.4;margin-top:2px}.ch-main>div{min-width:0}.ch-main strong small{display:inline}
  .ch-main img,.ch-initial{aspect-ratio:1;background:var(--raised);border-radius:50%;color:var(--ink-2);display:grid;font-size:32px;font-weight:700;height:auto;object-fit:cover;place-items:center;width:100%}.ch-main img.ch-thumb,.ch-thumb{aspect-ratio:16/9;border-radius:5px;display:block;height:auto;margin:0;object-fit:cover;width:100%;background:var(--raised)}
  .ch-nums{display:flex;flex-wrap:wrap;gap:2px 8px;align-items:baseline;margin-top:auto}.ch-nums strong{font-size:12px;font-variant-numeric:tabular-nums;font-weight:650}.ch-nums span{color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}.ch-main img:not(.ch-thumb),.ch-initial{height:104px;margin-inline:auto;width:104px}.ch-person .ch-rank,.ch-channel .ch-rank{right:calc(50% - 52px);top:80px}.ch-person .ch-main>div,.ch-channel .ch-main>div{text-align:center}.ch-person .ch-nums,.ch-channel .ch-nums{justify-content:center}.ch-person .ch-main small{font-size:10px}
  .ch-search{display:flex;gap:8px;max-width:450px;margin:10px 0}.ch-search input[type=search]{background:var(--surface);border:1px solid var(--line-strong);border-radius:7px;color:var(--ink);flex:1;font:inherit;font-size:12px;min-width:0;padding:8px 10px}.ch-search button{background:var(--accent);border:0;border-radius:7px;color:white;font:inherit;font-size:12px;padding:8px 14px}.ch-back{display:inline-block;font-size:11px;margin-bottom:8px}.ch-intro{color:var(--muted);font-size:12px;margin:3px 0 8px}.ch-directory h1{font-size:28px;line-height:1.2;margin:4px 0}.ch-directory-head{align-items:center;display:flex;flex-wrap:wrap;gap:8px 30px;justify-content:space-between}.ch-directory-head .ch-search{flex:1;min-width:240px}
  .ch-months{align-items:flex-end;display:flex;gap:4px;height:100px;margin-top:6px;overflow-x:auto}.ch-month{background:var(--accent);border-radius:3px 3px 1px 1px;flex:1;min-width:6px;outline:none}.ch-month:hover,.ch-month:focus{background:#e66767}.ch-month-labels{color:var(--muted);display:flex;font-size:10px;justify-content:space-between;margin-top:4px}.ch-empty{color:var(--muted);font-size:12px;margin:0}
  .ch-personal{border-top:1px solid var(--line);margin-top:24px;padding-top:2px}
  @media(max-width:1000px){.ch-row{flex-basis:152px;min-width:0}.ch-rows{gap:12px}}
  @media(max-width:560px){.ch-main img:not(.ch-thumb),.ch-initial{height:80px;width:80px}.ch-person .ch-rank,.ch-channel .ch-rank{right:calc(50% - 40px);top:56px}.ch-avatar{flex-basis:64px;height:64px;width:64px}.ch-head{align-items:flex-start;gap:12px}.ch-head h1{font-size:24px}.ch-row{flex-basis:140px}.ch-toolbar{gap:8px}.ch-toolbar .ch-sort{margin-left:0}.ch-page .section-head h2{font-size:17px}.ch-page .section-head{align-items:flex-start;flex-direction:column;gap:1px}.ch-controls{top:-39px}.ch-stats{gap:18px}.ch-stats .yt-stat strong{font-size:21px}.ch-stats .yt-stat{min-width:95px}.ch-stats .ch-date strong{font-size:13px}.ch-public{gap:4px 10px}.ch-directory-head .ch-search{max-width:none}}
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

function shelf(rows: string[], label: string, t: Messages): string {
  return `<div class="ch-shelf"><div class="ch-controls"><button type="button" data-ch-grid aria-pressed="false" aria-label="${html(t.channelExpandGrid)}" title="${html(t.channelExpandGrid)}" data-expand-label="${html(t.channelExpandGrid)}" data-collapse-label="${html(t.channelCollapseGrid)}"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="2" width="14" height="14" rx="1"/><path d="M2 7h14M2 11h14M7 2v14M11 2v14"/></svg></button><button type="button" data-ch-scroll="-1" aria-label="${html(t.channelScrollPrevious)}">←</button><button type="button" data-ch-scroll="1" aria-label="${html(t.channelScrollNext)}">→</button></div><div class="ch-rows" role="region" aria-label="${html(label)}" tabindex="0">${rows.join('')}</div></div>`;
}

const shelfScript = `<script>(()=>{
  for(const [index,shelf] of [...document.querySelectorAll('.ch-shelf')].entries()){
    const rail=shelf.querySelector('.ch-rows');
    const buttons=[...shelf.querySelectorAll('[data-ch-scroll]')];
    const toggle=shelf.querySelector('[data-ch-grid]');
    let scrollPosition=0;
    rail.id='ch-rail-'+index;
    toggle.setAttribute('aria-controls',rail.id);
    const update=()=>{
      buttons[0].disabled=rail.scrollLeft<=3;
      buttons[1].disabled=rail.scrollLeft+rail.clientWidth>=rail.scrollWidth-3;
    };
    toggle.addEventListener('click',()=>{
      const expanded=!shelf.classList.contains('is-grid');
      if(expanded)scrollPosition=rail.scrollLeft;
      shelf.classList.toggle('is-grid',expanded);
      toggle.setAttribute('aria-pressed',String(expanded));
      const label=expanded?toggle.dataset.collapseLabel:toggle.dataset.expandLabel;
      toggle.setAttribute('aria-label',label);
      toggle.title=label;
      for(const button of buttons)button.hidden=expanded;
      if(!expanded)rail.scrollLeft=scrollPosition;
      update();
    });
    for(const button of buttons)button.addEventListener('click',()=>rail.scrollBy({left:Number(button.dataset.chScroll)*rail.clientWidth*.85,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'}));
    rail.addEventListener('scroll',update,{passive:true});
    new ResizeObserver(update).observe(rail);
    update();
  }
})();</script>`;

function videoRow(video: { videoId: string; title: string; thumbnailUrl: string; watches: number; estimatedWatchSeconds: number }, index: number, t: Messages, sort: ChannelPageSort, extra = ''): string {
  const thumb = video.thumbnailUrl
    ? `<img class="ch-thumb" src="${html(video.thumbnailUrl)}" alt="" loading="lazy" width="64" height="36">`
    : '<span class="ch-thumb" aria-hidden="true"></span>';
  return `<div class="ch-row"><span class="ch-rank">#${index + 1}</span><div class="ch-main"><a href="https://www.youtube.com/watch?v=${html(video.videoId)}" rel="noopener" target="_blank" tabindex="-1" aria-hidden="true">${thumb}</a><div><strong><a href="https://www.youtube.com/watch?v=${html(video.videoId)}" rel="noopener" target="_blank">${html(video.title)}</a></strong>${extra ? `<small>${extra}</small>` : ''}</div></div><div class="ch-nums"><strong>${sort === 'watches' ? html(t.matchesTimes(video.watches)) : hours(video.estimatedWatchSeconds)}</strong><span>${sort === 'watches' ? hours(video.estimatedWatchSeconds) : html(t.matchesTimes(video.watches))}</span></div></div>`;
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
  const sortLinks = `<nav class="yt-range ch-sort" aria-label="${html(t.matchesMetric)}">${(['duration', 'watches'] as const).map((metric) => `<a href="${basePath}?range=${data.range}&sort=${metric}"${metric === sort ? ' aria-current="page"' : ''}>${metric === 'duration' ? t.rhythmTime : t.rhythmWatches}</a>`).join('')}</nav>`;
  const channelRank = sort === 'watches' ? mine.rank.watches : mine.rank.time;
  const stat = (value: string, label: string, date = false) => `<div class="yt-stat${date ? ' ch-date' : ''}"><strong>${value}</strong><span>${html(label)}</span></div>`;
  const yours = mine.stats.watches
    ? `<div class="ch-stats" role="region" aria-label="${html(t.channelYourStats)}" tabindex="0">
        ${stat(count(mine.stats.watches), t.channelStatWatches)}
        ${stat(hours(mine.stats.estimatedWatchSeconds), t.channelStatHours)}
        ${stat(count(mine.stats.uniqueVideos), t.channelStatVideos)}
        ${stat(`${Math.round(mine.stats.share * 1000) / 10}%`, t.channelStatShare)}
        ${stat(channelRank === null ? '—' : `#${channelRank}`, t.channelStatRank(mine.rank.channels))}
        ${stat(taipeiDate(mine.stats.firstWatchedAt, t), t.channelFirstWatch, true)}
        ${stat(taipeiDate(mine.stats.lastWatchedAt, t), t.channelLastWatch, true)}
      </div>`
    : `<p class="ch-empty">${t.channelNothingYet}</p>`;
  const myVideos = mine.videos.length
    ? shelf(ranked(mine.videos, sort).slice(0, 50).map((video, index) => videoRow(video, index, t, sort)), t.channelYourVideos, t)
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
      return `<div class="ch-row ch-person${member.isViewer ? ' me' : ''}"><span class="ch-rank">#${index + 1}</span><div class="ch-main">${avatar}<div>${name}${rank}</div></div><div class="ch-nums"><strong>${sort === 'watches' ? html(t.matchesTimes(member.watches)) : hours(member.estimatedWatchSeconds)}</strong><span>${sort === 'watches' ? hours(member.estimatedWatchSeconds) : html(t.matchesTimes(member.watches))}</span></div></div>`;
    });
    const communityVideos = ranked(community.videos, sort).slice(0, 50).map((video, index) =>
      videoRow(video, index, t, sort, html(t.channelViewers(video.viewers))));
    const totals = community.members.reduce((sum, member) => ({ watches: sum.watches + member.watches, seconds: sum.seconds + member.estimatedWatchSeconds }), { watches: 0, seconds: 0 });
    communityHtml = `<section class="section ch-community-summary"><div class="section-head"><h2>${t.channelCommunityStats}</h2><span>${html(t.ranges[data.range])}</span></div><div class="ch-stats" role="region" aria-label="${html(t.channelCommunityStats)}" tabindex="0">${stat(count(community.memberCount), t.channelStatMembers)}${stat(count(totals.watches), t.channelStatWatches)}${stat(hours(totals.seconds), t.channelStatHours)}${stat(count(community.videos.length), t.channelStatVideos)}</div></section>
      <section class="section"><div class="section-head"><h2>${t.channelCommunityVideos}</h2><span>${html(t.channelCommunityVideosSub)}</span></div>${communityVideos.length ? shelf(communityVideos, t.channelCommunityVideos, t) : `<p class="ch-empty">${t.channelNoMembers}</p>`}</section>
      <section class="section"><div class="section-head"><h2>${t.channelTopViewers}</h2><span>${html(t.channelTopViewersSub(community.memberCount))}</span></div>${memberRows.length ? shelf(memberRows, t.channelTopViewers, t) : `<p class="ch-empty">${t.channelNoMembers}</p>`}</section>`;
  }
  const publicStats = channel.statistics;
  const subscriberValue = publicStats?.hiddenSubscriberCount ? t.channelSubscribersHidden
    : publicStats?.subscriberCount != null ? `≈ ${count(publicStats.subscriberCount)}` : '—';
  const publicMetric = (value: number | null | undefined, label: string) => value == null ? '' : `<span><strong>${count(value)}</strong> ${html(label)}</span>`;
  const tags = (publicStats?.topicCategories ?? []).flatMap((value) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !/(^|\.)wikipedia\.org$/.test(url.hostname) || !url.pathname.startsWith('/wiki/')) return [];
      return [`<a href="${html(url.href)}" target="_blank" rel="noopener">${html(decodeURIComponent(url.pathname.slice(6)).replaceAll('_', ' '))}</a>`];
    } catch { return []; }
  });
  const body = `<style>${styles}</style><div class="ch-page ch-detail">
    <a class="ch-back" href="/channel/?range=${data.range}&sort=${sort}">← ${t.channelDirectory}</a>
    <header class="ch-head">${avatar}<div><h1>${html(channel.name)}</h1><div class="ch-meta"><span class="ch-subscribers" title="${html(publicStats?.subscriberCount != null ? t.channelSubscriberNote : t.channelStatsUnavailable)}"><strong>${html(subscriberValue)}</strong> ${t.channelSubscribers}</span><a href="https://www.youtube.com/channel/${html(channel.channelId)}" rel="noopener" target="_blank">${t.channelOpenYoutube} ↗</a></div><div class="ch-public">${publicMetric(publicStats?.videoCount, t.channelPublicVideos)}${publicMetric(publicStats?.viewCount, t.channelPublicViews)}${publicStats?.publishedAt ? `<span>${t.channelCreated} <strong>${html(taipeiDate(publicStats.publishedAt, t))}</strong></span>` : ''}${channel.statisticsFetchedAt ? `<span>${html(t.channelUpdated(taipeiDate(channel.statisticsFetchedAt, t)))}</span>` : ''}</div>${tags.length ? `<div class="ch-tags"><span>${t.channelCategories}</span>${tags.join('')}</div>` : ''}</div></header>
    <div class="ch-toolbar">${ranges}${sortLinks}</div>
    ${communityHtml}
    <div class="ch-personal"><section class="section"><div class="section-head"><h2>${t.channelYourStats}</h2><span>${html(viewer.displayName)}</span></div>${yours}</section>
    <section class="section"><div class="section-head"><h2>${t.channelYourVideos}</h2></div>${myVideos}</section>
    ${monthlySection(mine, t, sort)}</div></div>${shelfScript}`;
  return shell(`${channel.name} · ${t.channelEyebrow}`, body, primaryNav(lang, {
    active: 'channels', dashboardHref: `/${viewer.handle}`,
    languageHref: `${basePath}?range=${data.range}&sort=${sort}&lang=${lang === 'zh' ? 'en' : 'zh'}`,
  }), '', lang);
}

export interface ChannelDirectoryData {
  range: ChannelPageRange;
  sort: ChannelPageSort;
  query: string;
  mine: YoutubeChannelSummary[];
  community: Array<YoutubeChannelSummary & { viewers: number }> | null;
}

export function channelDirectoryPage(viewer: ChannelPageViewer, data: ChannelDirectoryData, lang: Lang = 'en'): string {
  const t = messages(lang);
  const url = (range: ChannelPageRange, sort: ChannelPageSort, language = lang) =>
    `/channel/?${new URLSearchParams({ range, sort, q: data.query, lang: language })}`;
  const controls = `<nav class="yt-range" aria-label="${html(t.matchesRange)}">${CHANNEL_PAGE_RANGES.map((range) =>
    `<a href="${html(url(range, data.sort))}"${range === data.range ? ' aria-current="page"' : ''}>${html(t.ranges[range])}</a>`).join('')}</nav>
    <nav class="yt-range ch-sort" aria-label="${html(t.matchesMetric)}">${(['duration', 'watches'] as const).map((sort) =>
      `<a href="${html(url(data.range, sort))}"${sort === data.sort ? ' aria-current="page"' : ''}>${sort === 'duration' ? t.rhythmTime : t.rhythmWatches}</a>`).join('')}</nav>`;
  const section = (label: string, channels: YoutubeChannelSummary[]) => {
    const query = data.query.toLocaleLowerCase();
    const rows = ranked(channels, data.sort)
      .filter((channel) => YOUTUBE_CHANNEL_ID_PATTERN.test(channel.channelId ?? ''))
      .filter((channel) => !query || `${channel.name} ${channel.channelId}`.toLocaleLowerCase().includes(query))
      .slice(0, 100)
      .map((channel, index) => {
        const name = channel.name || channel.channelId!;
        const href = `/channel/${channel.channelId}?range=${data.range}&sort=${data.sort}`;
        const avatar = channel.thumbnailUrl
          ? `<img src="${html(channel.thumbnailUrl)}" alt="" loading="lazy" width="128" height="128">`
          : `<span class="ch-initial" aria-hidden="true">${html([...name][0] ?? '?')}</span>`;
        const viewers = 'viewers' in channel ? `<small>${html(t.channelViewers(Number(channel.viewers)))}</small>` : '';
        return `<article class="ch-row ch-channel"><span class="ch-rank">#${index + 1}</span><div class="ch-main"><a href="${html(href)}" tabindex="-1" aria-hidden="true">${avatar}</a><div><strong><a href="${html(href)}">${html(name)}</a></strong>${viewers}</div></div><div class="ch-nums"><strong>${data.sort === 'duration' ? hours(channel.estimatedWatchSeconds) : html(t.matchesTimes(channel.watches))}</strong><span>${data.sort === 'duration' ? html(t.matchesTimes(channel.watches)) : hours(channel.estimatedWatchSeconds)}</span></div></article>`;
      });
    return `<section class="section"><div class="section-head"><h2>${html(label)}</h2></div>${rows.length ? shelf(rows, label, t) : `<p class="ch-empty">${t.channelDirectoryEmpty}</p>`}</section>`;
  };
  const community = data.community === null
    ? `<section class="section"><div class="section-head"><h2>${t.channelPopular}</h2></div><p class="ch-empty">${t.channelJoinForCommunity} <a href="/account">${t.accountMatchingSave}</a></p></section>`
    : section(t.channelPopular, data.community);
  const body = `<style>${styles}</style><div class="ch-page ch-directory"><div class="ch-directory-head"><div><h1>${t.channelDirectory}</h1><p class="ch-intro">${t.channelDirectoryIntro}</p></div>
    <form class="ch-search" action="/channel/" method="get"><input type="hidden" name="range" value="${data.range}"><input type="hidden" name="sort" value="${data.sort}"><input type="hidden" name="lang" value="${lang}"><input type="search" name="q" value="${html(data.query)}" maxlength="100" placeholder="${html(t.channelSearch)}" aria-label="${html(t.channelSearch)}"><button type="submit">${t.channelSearchButton}</button></form>
    </div><div class="ch-toolbar">${controls}</div>${community}${section(t.channelYourChannels, data.mine)}</div>${shelfScript}`;
  return shell(t.channelDirectory, body, primaryNav(lang, {
    active: 'channels', dashboardHref: `/${viewer.handle}`,
    languageHref: url(data.range, data.sort, lang === 'zh' ? 'en' : 'zh'),
  }), '', lang);
}
