import type { TagLeanData, TagLeanGroup } from '../youtube/taglists.js';
import { YOUTUBE_RANGES } from '../youtube/types.js';
import { config } from '../config.js';
import { messages, type Lang, type Messages } from './i18n.js';
import { hours, html, shell, type ShellNavItem } from './pages.js';

// Political camp colors are semantically fixed (Taiwanese convention: 泛白 is
// the neutral gray camp) and validated with the dataviz six checks on the dark
// surface #141412: blue/green/gray/red pass contrast ≥3:1, CVD ΔE 8.8, normal
// ΔE 16.8. Gray intentionally sits below the chroma floor — identity is always
// carried by the direct label next to every mark, never by color alone.
const CAMP_COLORS: Record<string, string> = {
  blue: '#3987e5',
  green: '#33a03e',
  white: '#98958c',
  red: '#d03b3b',
};
const CONTENT_COLOR = '#d03b3b';

const tagLeanStyles = `
  .tl-hero{align-items:end;display:grid;gap:26px;grid-template-columns:minmax(0,auto) minmax(0,1fr);padding:26px 28px}
  .tl-hero-figure strong{align-items:baseline;display:flex;flex-wrap:wrap;gap:14px;font-size:clamp(40px,6vw,64px);font-weight:750;letter-spacing:-.045em;line-height:.95}
  .tl-hero-figure strong em{font-size:.52em;font-style:normal;font-weight:700;letter-spacing:-.01em}
  .tl-hero-figure span{color:var(--ink-2);display:block;font-size:13px;margin-top:10px}
  .tl-hero-stats{display:grid;gap:10px 26px;grid-template-columns:repeat(auto-fit,minmax(118px,1fr))}

  .tl-dot{border-radius:50%;display:inline-block;flex:none;height:10px;width:10px}
  .tl-stack{display:flex;gap:2px;height:26px;margin:4px 0 14px}
  .tl-stack i{border-radius:4px;display:block;height:100%;min-width:3px;position:relative}
  .tl-stack i b{color:#fff;font-size:11px;font-weight:700;left:8px;line-height:26px;overflow:hidden;position:absolute;text-shadow:0 1px 2px rgba(0,0,0,.55);white-space:nowrap}

  .tl-rows{display:grid;gap:11px;margin-top:6px}
  .tl-row{align-items:center;display:grid;gap:10px;grid-template-columns:112px minmax(0,1fr) 128px}
  .tl-row-label{align-items:center;display:flex;font-size:12.5px;font-weight:650;gap:7px}
  .tl-row-track{background:var(--raised);border-radius:999px;height:9px}
  .tl-row-track i{border-radius:999px 4px 4px 999px;display:block;height:100%;min-width:2px}
  .tl-row-value{color:var(--ink-2);font-size:12px;font-variant-numeric:tabular-nums;text-align:right}
  .tl-row-value strong{color:var(--ink);font-weight:650}

  .tl-groups{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin-top:20px}
  .tl-group h3{align-items:center;display:flex;font-size:12px;gap:7px;letter-spacing:.02em;margin:0 0 9px}
  .tl-group h3 .tl-group-meta{color:var(--muted);font-size:10px;font-weight:600;margin-left:auto;text-align:right}
  .tl-channel{align-items:center;border-radius:8px;display:grid;gap:8px;grid-template-columns:24px minmax(0,1fr) 46px;padding:4px 4px 4px 0}
  .tl-channel img,.tl-channel-avatar{background:var(--raised);border-radius:50%;color:var(--ink-2);display:grid;font-size:10px;font-weight:700;height:24px;object-fit:cover;place-items:center;width:24px}
  .tl-channel-name{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tl-channel-name a{color:var(--ink);text-decoration:none}.tl-channel-name a:hover{color:var(--accent-text)}
  .tl-channel-hours{color:var(--muted);font-size:10.5px;font-variant-numeric:tabular-nums;text-align:right}
  .tl-empty{color:var(--muted);font-size:12px}
  .tl-coverage{color:var(--ink-2);font-size:14px;line-height:1.6;margin:16px 2px 0}
  .tl-foot{color:var(--muted);font-size:11px;margin-top:16px}
  @media(max-width:820px){.tl-hero{grid-template-columns:1fr}.tl-row{grid-template-columns:88px minmax(0,1fr) 118px}}
`;

function channelAvatar(channel: { name: string; thumbnailUrl: string }): string {
  return channel.thumbnailUrl
    ? `<img src="${html(channel.thumbnailUrl)}" alt="" loading="lazy">`
    : `<span class="tl-channel-avatar" aria-hidden="true">${html([...channel.name][0] ?? '?')}</span>`;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? part / whole * 100 : 0;
}

function pctLabel(value: number): string {
  return `${value >= 10 || value === 0 ? Math.round(value) : value.toFixed(1)}%`;
}

// One axis of groups: share bars against `denominator` seconds, top channels
// per group, and the table view that backs every number on screen.
function axisSection(
  heading: string,
  sub: string,
  groups: TagLeanGroup[],
  denominator: number,
  colorOf: (key: string) => string,
  t: Messages,
  stackedBar = '',
): string {
  const maxSeconds = Math.max(1, ...groups.map((group) => group.estimatedWatchSeconds));
  const rows = groups.map((group) => {
    const share = pct(group.estimatedWatchSeconds, denominator);
    const tip = `${hours(group.estimatedWatchSeconds)} · ${t.tagLeanGroupMeta(group.watches, group.watchedChannels)}`;
    return `<div class="tl-row" data-tip="${pctLabel(share)}" data-tip-label="${html(`${t.tagGroups[group.key]} · ${tip}`)}">
      <span class="tl-row-label"><span class="tl-dot" style="background:${colorOf(group.key)}"></span>${html(t.tagGroups[group.key])}</span>
      <div class="tl-row-track"><i style="background:${colorOf(group.key)};width:${Math.max(1, Math.round(group.estimatedWatchSeconds / maxSeconds * 100))}%"></i></div>
      <span class="tl-row-value"><strong>${pctLabel(share)}</strong> · ${hours(group.estimatedWatchSeconds)}</span>
    </div>`;
  }).join('');
  const columns = groups.map((group) => `<div class="tl-group">
    <h3><span class="tl-dot" style="background:${colorOf(group.key)}"></span>${html(t.tagGroups[group.key])}<span class="tl-group-meta">${t.tagLeanGroupMeta(group.watches, group.watchedChannels)}</span></h3>
    ${group.topChannels.length ? group.topChannels.map((channel) => `<div class="tl-channel">
      ${channelAvatar(channel)}
      <span class="tl-channel-name">${channel.channelId ? `<a href="https://www.youtube.com/channel/${html(channel.channelId)}">${html(channel.name)}</a>` : html(channel.name)}</span>
      <span class="tl-channel-hours">${hours(channel.estimatedWatchSeconds)}</span>
    </div>`).join('') : `<span class="tl-empty">${t.nothingHere}</span>`}
  </div>`).join('');
  const tableRows = groups.map((group) =>
    `<tr><td>${html(t.tagGroups[group.key])}</td><td>${pctLabel(pct(group.estimatedWatchSeconds, denominator))}</td><td>${hours(group.estimatedWatchSeconds)}</td><td>${group.watches}</td><td>${group.watchedChannels}</td></tr>`
  ).join('');
  return `<section class="section"><div class="section-head"><h2>${heading}</h2><span>${sub}</span></div>
    ${stackedBar}${rows ? `<div class="tl-rows">${rows}</div>` : ''}
    <div class="tl-groups">${columns}</div>
    <details class="viz-table"><summary>${t.tableView}</summary><table>
      <thead><tr><th>${t.colGroup}</th><th>${t.colShare}</th><th>${t.colEstTime}</th><th>${t.colVideos}</th><th>${t.colChannels}</th></tr></thead>
      <tbody>${tableRows}</tbody></table></details>
  </section>`;
}

export interface TagLeanPageOptions {
  basePath: string;
  dashboardPath: string;
  nav?: ShellNavItem[];
  lang?: Lang;
}

export function tagLeanPage(ownerName: string, data: TagLeanData, options: TagLeanPageOptions): string {
  const lang = options.lang ?? 'en';
  const t = messages(lang);
  const rangeNav = `<nav class="yt-range" aria-label="Time range">${YOUTUBE_RANGES.map((range) =>
    `<a href="${options.basePath}?range=${range}"${range === data.range ? ' aria-current="page"' : ''}>${t.ranges[range]}</a>`
  ).join('')}</nav>`;

  const politicalSeconds = data.political.reduce((sum, group) => sum + group.estimatedWatchSeconds, 0);
  const dominant = [...data.political].sort((a, b) =>
    b.estimatedWatchSeconds - a.estimatedWatchSeconds || b.watches - a.watches)[0];
  const dominantShare = dominant ? pct(dominant.estimatedWatchSeconds, politicalSeconds) : 0;
  const heroFigure = politicalSeconds > 0 && dominant
    ? `<strong><span style="align-items:center;display:inline-flex;gap:12px"><span class="tl-dot" style="background:${CAMP_COLORS[dominant.key]};height:.35em;width:.35em"></span>${html(t.tagGroups[dominant.key])}</span><em>${pctLabel(dominantShare)}</em></strong>
      <span>${t.tagLeanHeroSub(t.ranges[data.range])}</span>`
    : `<strong>—</strong><span>${t.tagLeanHeroNone}</span>`;
  const matchedShare = pct(data.matched.estimatedWatchSeconds, data.totals.estimatedWatchSeconds);
  const hero = `<section class="card tl-hero">
    <div class="tl-hero-figure">${heroFigure}</div>
    <div class="tl-hero-stats">
      <div class="yt-stat"><strong>${hours(data.matched.estimatedWatchSeconds)}</strong><span>${t.tagLeanStatTaggedTime}</span></div>
      <div class="yt-stat"><strong>${pctLabel(matchedShare)}</strong><span>${t.tagLeanStatTaggedShare}</span></div>
      <div class="yt-stat"><strong>${data.matched.channels}</strong><span>${t.tagLeanStatTaggedChannels}</span></div>
      <div class="yt-stat"><strong>${data.matched.watches}</strong><span>${t.tagLeanStatWatches}</span></div>
    </div>
  </section>`;

  // 100%-stacked spectrum bar: fixed camp order, 2px surface gaps, direct
  // labels on segments wide enough to hold them (the rows repeat every value).
  const stackAria = data.political.map((group) =>
    `${t.tagGroups[group.key]} ${pctLabel(pct(group.estimatedWatchSeconds, politicalSeconds))}`).join(', ');
  const stackedBar = politicalSeconds > 0
    ? `<div class="tl-stack" role="img" aria-label="${html(`${t.tagLeanPolitics}: ${stackAria}`)}">${data.political
      .filter((group) => group.estimatedWatchSeconds > 0)
      .map((group) => {
        const share = pct(group.estimatedWatchSeconds, politicalSeconds);
        return `<i style="background:${CAMP_COLORS[group.key]};flex-basis:${share.toFixed(2)}%" data-tip="${pctLabel(share)}" data-tip-label="${html(`${t.tagGroups[group.key]} · ${hours(group.estimatedWatchSeconds)}`)}">${share >= 14 ? `<b>${html(t.tagGroups[group.key])} ${pctLabel(share)}</b>` : ''}</i>`;
      }).join('')}</div>`
    : `<p class="tl-empty">${t.tagLeanEmpty}</p>`;

  const politics = axisSection(
    t.tagLeanPolitics, t.tagLeanPoliticsSub, data.political, politicalSeconds,
    (key) => CAMP_COLORS[key], t, stackedBar,
  );
  const content = axisSection(
    t.tagLeanContent, t.tagLeanContentSub, data.content, data.totals.estimatedWatchSeconds,
    () => CONTENT_COLOR, t,
  );

  // The coverage sentence scopes every number below it, so it sits right
  // under the hero at reading size; only the source note stays in the footer.
  const coverage = `<p class="tl-coverage">${t.tagLeanCoverage(Math.round(matchedShare))}</p>`;
  const foot = `<p class="tl-foot">${t.tagLeanSource(html(config.tagListsUrl.replace(/^https?:\/\//, '').split('/')[0]))}</p>`;
  // Page name + range in the title and h1: distinct from the dashboard's h1
  // for the same owner, and distinct across every ?range variant.
  const scope = `${t.tagLeanTitle} · ${t.ranges[data.range]}`;
  const intro = `<style>${tagLeanStyles}</style><section class="yt-profile">
    <span class="yt-avatar" aria-hidden="true">${html([...ownerName][0] ?? '?')}</span>
    <div class="yt-profile-copy"><div class="eyebrow">${t.tagLeanEyebrow}</div>
    <h1>${html(ownerName)}<em class="h1-scope">${scope}</em></h1>
    <div class="yt-profile-meta"><a href="${html(options.dashboardPath)}">${t.navBack}</a></div></div></section>`;
  return shell(`${ownerName} · ${scope}`, intro + rangeNav + hero + coverage + politics + content + foot,
    options.nav ?? [], '', lang, options.basePath);
}
