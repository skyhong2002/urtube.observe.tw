import type { TagLeanData, TagLeanGroup } from '../youtube/taglists.js';
import {
  REFERENCE_POPULATION_POLICY_URL,
  type ReferenceAxis,
  type ReferencePopulation,
} from '../youtube/reference-population.js';
import { YOUTUBE_RANGES } from '../youtube/types.js';
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
  .tl-hero{display:block;margin-top:18px;padding:26px 28px}
  .tl-hero-title{font-size:17px;margin:5px 0 22px}
  .tl-hero-figure strong{align-items:baseline;display:flex;flex-wrap:wrap;gap:14px;font-size:clamp(40px,6vw,64px);font-weight:750;letter-spacing:-.045em;line-height:.95}
  .tl-hero-figure span{color:var(--ink-2);display:block;font-size:13px;margin-top:10px}
  .tl-hero-stats{border-top:1px solid var(--line);display:grid;gap:16px 26px;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));margin-top:24px;padding-top:20px}

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

  .tl-groups{display:grid;gap:20px;grid-template-columns:1fr;margin-top:20px}
  .tl-group h3{align-items:center;display:flex;font-size:12px;gap:7px;letter-spacing:.02em;margin:0 0 9px}
  .tl-group h3 .tl-group-meta{color:var(--muted);font-size:10px;font-weight:600;margin-left:auto;text-align:right}
  .tl-channel{align-items:center;border-radius:8px;display:grid;gap:8px;grid-template-columns:24px minmax(0,1fr) 46px;padding:4px 4px 4px 0}
  .tl-channel img,.tl-channel-avatar{background:var(--raised);border-radius:50%;color:var(--ink-2);display:grid;font-size:10px;font-weight:700;height:24px;object-fit:cover;place-items:center;width:24px}
  .tl-channel-name{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tl-channel-name a{color:var(--ink);text-decoration:none}.tl-channel-name a:hover{color:var(--accent-text)}
  .tl-channel-hours{color:var(--muted);font-size:10.5px;font-variant-numeric:tabular-nums;text-align:right}
  .tl-empty{color:var(--muted);font-size:12px}
  .tl-coverage-bar{background:var(--line-strong);border-radius:4px;display:flex;height:18px;overflow:hidden}
  .tl-coverage-bar span{background:var(--accent);display:block;height:100%}
  .tl-coverage-labels{display:flex;flex-wrap:wrap;gap:8px 24px;justify-content:space-between;margin-top:10px;font-size:13px;font-variant-numeric:tabular-nums}
  .tl-coverage-help{color:var(--ink-2);font-size:13px;max-width:72ch}
  .tl-coverage-details{border-top:1px solid var(--line);margin-top:20px;padding-top:12px}
  .tl-coverage-details summary{cursor:pointer;width:fit-content}
  .tl-coverage-details summary:focus-visible{outline:2px solid var(--accent-text);outline-offset:4px}
  .tl-coverage-scroll{overflow-x:auto}.tl-coverage-details table{border-collapse:collapse;width:100%;font-size:12px}
  .tl-coverage-details th,.tl-coverage-details td{border-bottom:1px solid var(--line);padding:10px 6px;text-align:right;font-variant-numeric:tabular-nums}
  .tl-coverage-details th:first-child,.tl-coverage-details td:first-child{text-align:left}
  .tl-coverage-details h3{font-size:14px;margin:24px 0 8px}
  .tl-uncovered{list-style:none;padding:0;margin:12px 0;max-width:72ch}
  .tl-uncovered li{display:flex;gap:20px;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px}
  .tl-uncovered li>:first-child{min-width:0;overflow-wrap:anywhere}.tl-uncovered li>span:last-child{flex:none;color:var(--ink-2)}
  .tl-foot{color:var(--muted);font-size:11px;margin-top:16px}
  .tl-reference{margin-top:26px}.tl-reference>p{color:var(--ink-2);font-size:13px;line-height:1.65;max-width:72ch}
  .tl-reference-axis{margin-top:20px}.tl-reference-axis h3{align-items:baseline;display:flex;flex-wrap:wrap;font-size:14px;gap:8px;margin:0 0 9px}.tl-reference-axis h3 span{color:var(--muted);font-size:11px;font-weight:600}
  .tl-reference-scroll{overflow-x:auto}.tl-reference-table{border-collapse:collapse;font-size:12px;min-width:640px;width:100%}.tl-reference-table th,.tl-reference-table td{border-bottom:1px solid var(--line);padding:9px 8px;text-align:right}.tl-reference-table th:first-child,.tl-reference-table td:first-child{text-align:left}.tl-reference-table th{color:var(--muted);font-size:10px;letter-spacing:.03em}.tl-reference-table td{color:var(--ink-2);font-variant-numeric:tabular-nums}.tl-reference-table td strong{color:var(--ink)}
  @media(min-width:900px){
    .tl-hero{align-items:center;display:grid;gap:22px 42px;grid-template-columns:minmax(270px,.78fr) minmax(0,1.22fr)}
    .tl-hero-lead{min-width:0}.tl-hero-title{margin-bottom:18px}
    .tl-hero-stats{border-left:1px solid var(--line);border-top:0;margin-top:0;padding:4px 0 4px 34px}
    .tl-rows{column-gap:36px;grid-template-columns:repeat(2,minmax(0,1fr))}
    .tl-groups{grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}
  }
  @media(max-width:820px){.tl-row{grid-template-columns:88px minmax(0,1fr) 118px}}
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

function referenceAxis(
  heading: string,
  axis: ReferenceAxis,
  t: Messages,
): string {
  if (axis.status === 'insufficient') {
    return `<div class="tl-reference-axis"><h3>${heading}</h3><p class="tl-empty">${t.tagLeanReferenceInsufficient(axis.sampleSize)}</p></div>`;
  }
  if (axis.status === 'viewer-unavailable') {
    return `<div class="tl-reference-axis"><h3>${heading}<span>${t.tagLeanReferenceSample(axis.sampleSize)}</span></h3><p class="tl-empty">${t.tagLeanReferenceViewerUnavailable}</p></div>`;
  }
  const rows = axis.metrics.map((metric) => `<tr>
    <td>${html(t.tagGroups[metric.key])}</td>
    <td><strong>${pctLabel(metric.viewerPct)}</strong></td>
    <td>${pctLabel(metric.meanPct)}</td>
    <td class="tl-reference-detail">${pctLabel(metric.medianPct)}</td>
    <td class="tl-reference-detail">${metric.lift === null ? '—' : `${metric.lift.toFixed(1)}×`}</td>
    <td>${t.tagLeanReferencePercentile(metric.percentile)}</td>
  </tr>`).join('');
  return `<div class="tl-reference-axis"><h3>${heading}<span>${t.tagLeanReferenceSample(axis.sampleSize)}</span></h3>
    <div class="tl-reference-scroll"><table class="tl-reference-table">
      <thead><tr><th>${t.colGroup}</th><th>${t.tagLeanReferenceYou}</th><th>${t.tagLeanReferenceMean}</th><th class="tl-reference-detail">${t.tagLeanReferenceMedian}</th><th class="tl-reference-detail">${t.tagLeanReferenceLift}</th><th>${t.tagLeanReferencePercentileHeading}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

function referenceSection(reference: ReferencePopulation, t: Messages): string {
  const updated = reference.dataUpdatedAt?.slice(0, 10) ?? '—';
  return `<section class="section tl-reference"><div class="section-head"><h2>${t.tagLeanReferenceTitle}</h2></div>
    <p>${t.tagLeanReferencePara}</p>
    ${referenceAxis(t.tagLeanContent, reference.content, t)}
    ${referenceAxis(t.tagLeanPolitics, reference.political, t)}
    <p class="tl-foot">${t.tagLeanReferenceMeta(updated)} · <a href="${REFERENCE_POPULATION_POLICY_URL}">${t.tagLeanReferenceMethodLink}</a></p>
  </section>`;
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
      <span class="tl-channel-name">${channel.channelId ? `<a href="/channel/${html(channel.channelId)}">${html(channel.name)}</a>` : html(channel.name)}</span>
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
  reference?: ReferencePopulation;
}

function coverageSection(data: TagLeanData, t: Messages): string {
  const seconds = data.totals.estimatedWatchSeconds;
  const classified = pct(data.matched.estimatedWatchSeconds, seconds);
  const unclassified = pct(data.unmatched.estimatedWatchSeconds, seconds);
  const label = `${t.tagLeanClassified} · ${pctLabel(classified)}`;
  const uncoveredLabel = `${t.tagLeanUnclassified} · ${pctLabel(unclassified)}`;
  const rows = [...data.content, ...data.political].map((group) => `<tr>
    <th scope="row">${html(t.tagGroups[group.key])}</th>
    <td>${seconds > 0 ? pctLabel(pct(group.estimatedWatchSeconds, seconds)) : '—'}</td>
    <td>${hours(group.estimatedWatchSeconds)}</td><td>${group.watchedChannels}</td>
  </tr>`).join('');
  return `<section class="section tl-coverage-section"><div class="section-head"><h2>${t.tagLeanCoverageTitle}</h2></div>
    ${seconds > 0 ? `<div class="tl-coverage-bar" role="img" aria-label="${html(`${label}, ${uncoveredLabel}`)}"><span style="width:${classified}%"></span></div>
      <div class="tl-coverage-labels"><span>${label} · ${hours(data.matched.estimatedWatchSeconds)}</span><span>${uncoveredLabel} · ${hours(data.unmatched.estimatedWatchSeconds)}</span></div>`
      : `<p class="tl-empty">${t.tagLeanCoverageEmpty}</p>`}
    <p class="tl-coverage-help">${t.tagLeanCoverageHelp}</p>
    <details class="tl-coverage-details"><summary>${t.tagLeanCoverageDetails}</summary>
      <div class="tl-coverage-scroll"><table><thead><tr><th scope="col">${t.colGroup}</th><th scope="col">${t.colShare}</th><th scope="col">${t.colEstTime}</th><th scope="col">${t.colChannels}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <h3>${t.tagLeanUnclassified}</h3>
      ${data.unmatched.channels > 0 ? `<p class="tl-coverage-help">${t.tagLeanUncoveredCount(data.unmatched.topChannels.length, data.unmatched.channels)}</p>
        <ul class="tl-uncovered">${data.unmatched.topChannels.map((channel) => `<li>
          ${channel.channelId ? `<a href="/channel/${html(channel.channelId)}">${html(channel.name || channel.channelId)}</a>` : `<span>${html(channel.name || t.tagLeanUnknownChannel)}</span>`}
          <span>${hours(channel.estimatedWatchSeconds)}</span></li>`).join('')}</ul>`
        : `<p class="tl-empty">${seconds > 0 ? t.tagLeanFullyCovered : t.tagLeanCoverageEmpty}</p>`}
    </details>
  </section>`;
}

export interface TagLeanSectionOptions {
  // Coverage detail and the uncovered-channel list stay on the owner's page.
  owner?: boolean;
}

export function tagLeanSection(
  data: TagLeanData,
  lang: Lang = 'en',
  reference?: ReferencePopulation,
  options: TagLeanSectionOptions = {},
): string {
  const t = messages(lang);
  const politicalSeconds = data.political.reduce((sum, group) => sum + group.estimatedWatchSeconds, 0);
  const heroFigure = politicalSeconds > 0
    ? `<strong>${hours(politicalSeconds)}</strong>
      <span>${t.tagLeanHeroSub(t.ranges[data.range])}</span>`
    : `<strong>—</strong><span>${t.tagLeanHeroNone}</span>`;
  const matchedShare = pct(data.matched.estimatedWatchSeconds, data.totals.estimatedWatchSeconds);
  const hero = `<section class="card tl-hero"><div class="tl-hero-lead"><div class="eyebrow">${t.tagLeanEyebrow}</div><h2 class="tl-hero-title">${t.tagLeanTitle}</h2>
    <div class="tl-hero-figure">${heroFigure}</div></div>
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

  const coverage = options.owner ? coverageSection(data, t) : '';
  // Retain source and update date for interpretation; version identifiers belong in methodology.
  const provenance = data.provenance;
  const sourceHost = provenance.sourceUrl.replace(/^https?:\/\//, '').split('/')[0];
  const foot = `<p class="tl-foot">${t.tagLeanSource(
    html(sourceHost),
    html(provenance.sourceUpdatedAt),
  )} · <a href="${html(provenance.policyUrl)}">${t.tagLeanPolicyLink}</a> · <a href="${html(provenance.reportUrl)}">${t.tagLeanReportLink}</a></p>
    <p class="tl-foot">${t.tagLeanCaveat}</p>`;
  return `<style>${tagLeanStyles}</style>${hero}${coverage}${politics}${content}${reference ? referenceSection(reference, t) : ''}${foot}`;
}

export function tagLeanPage(ownerName: string, data: TagLeanData, options: TagLeanPageOptions): string {
  const lang = options.lang ?? 'en';
  const t = messages(lang);
  const rangeNav = `<nav class="yt-range" aria-label="Time range">${YOUTUBE_RANGES.map((range) =>
    `<a href="${options.basePath}?range=${range}"${range === data.range ? ' aria-current="page"' : ''}>${t.ranges[range]}</a>`
  ).join('')}</nav>`;
  // Page name + range in the title and h1: distinct from the dashboard's h1
  // for the same owner, and distinct across every ?range variant.
  const scope = `${t.tagLeanTitle} · ${t.ranges[data.range]}`;
  const intro = `<section class="yt-profile">
    <img class="yt-avatar" src="${html(`/avatar${options.dashboardPath}`)}" alt="" width="70" height="70">
    <div class="yt-profile-copy"><div class="eyebrow">${t.tagLeanEyebrow}</div>
    <h1>${html(ownerName)}<em class="h1-scope">${scope}</em></h1>
    <div class="yt-profile-meta"><a href="${html(options.dashboardPath)}">${t.navBack}</a></div></div></section>`;
  return shell(`${ownerName} · ${scope}`, intro + rangeNav + tagLeanSection(data, lang, options.reference),
    options.nav ?? [], '', lang, options.basePath);
}
