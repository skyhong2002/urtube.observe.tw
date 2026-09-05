import { COMPARISON_RANGES, type CommonItemMeasures, type ComparisonWatchEdge, type WatchComparison } from '../youtube/comparison.js';
import { messages, type Lang } from './i18n.js';
import { channelHref, metricScript, type ComparisonMetric } from './matches.js';
import { hours, html } from './pages.js';
import { radialClock, rhythmClockStyles } from './youtube.js';

// Only consume the already consent-filtered Blend projection, never a raw
// dashboard or private profile. Side b is the person whose profile is open.
export function friendProfileContent(handle: string, displayName: string, comparison: WatchComparison, lang: Lang): string {
  if (!comparison.connected || !comparison.stats) return '';
  const t = messages(lang);
  const count = (value: number) => new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value);
  const panels = (render: (metric: ComparisonMetric) => string) => (['seconds', 'watches'] as const).map(metric => `<div data-metric-panel="${metric}"${metric === 'seconds' ? '' : ' hidden'}>${render(metric)}</div>`).join('');
  const value = (metric: ComparisonMetric, amount: number) => metric === 'seconds' ? hours(amount) : t.matchesTimes(Math.round(amount * 10) / 10);
  const section = (heading: string, content: string) => `<section class="fp-section"><h2>${html(heading)}</h2>${content}</section>`;
  const cards = <T extends CommonItemMeasures>(items: T[], render: (item: T, metric: ComparisonMetric) => string) => panels(metric => {
    const rows = [...items].sort((a, b) => b[metric].blend - a[metric].blend || (a[metric].rank.a + a[metric].rank.b) - (b[metric].rank.a + b[metric].rank.b)).map(item => render(item, metric));
    if (!rows.length) return `<p class="fp-note">${html(t.matchesNothingInCommon)}</p>`;
    return `<div class="fp-grid">${rows.slice(0, 6).join('')}</div>${rows.length > 6 ? `<details class="fp-more"><summary>${html(t.matchesShowMore(rows.length - 6))}</summary><div class="fp-grid">${rows.slice(6).join('')}</div></details>` : ''}`;
  });
  const measure = (item: CommonItemMeasures, metric: ComparisonMetric) => `<small class="fp-measure">#${item[metric].rank.b} · ${html(value(metric, item[metric].value.b))}</small>`;
  const channelCards = (items: WatchComparison['channels']['items']) => cards(items, (channel, metric) => {
    const href = channelHref(channel);
    const image = channel.thumbnailUrl ? `<img class="fp-avatar" src="${html(channel.thumbnailUrl)}" alt="" loading="lazy" width="64" height="64">` : `<span class="fp-avatar" aria-hidden="true">${html([...channel.name][0] ?? '?')}</span>`;
    return `<article class="fp-card"><a href="${html(href)}"${href.startsWith('/') ? ' data-channel-preview aria-haspopup="dialog"' : ' target="_blank" rel="noopener"'}>${image}<strong>${html(channel.name)}</strong></a>${measure(channel, metric)}</article>`;
  });
  const rangeLinks = `<nav class="yt-range mt-range" aria-label="${html(t.matchesRange)}">${COMPARISON_RANGES.map(range => `<a href="/${html(handle)}?range=${range}&lang=${lang}"${range === comparison.range ? ' aria-current="page"' : ''}>${html(t.ranges[range])}</a>`).join('')}</nav>`;
  const metrics = `<div class="yt-metric-toggle" role="group" aria-label="${html(t.matchesMetric)}"><button type="button" data-metric="seconds" aria-pressed="true">${html(t.rhythmTime)}</button><button type="button" data-metric="watches" aria-pressed="false">${html(t.rhythmWatches)}</button></div>`;
  const stats = section(t.matchesWatchStats, `<div class="fp-stats">${comparison.stats.map(stat => `<div><strong>${count(stat.b)}</strong><span>${html(t.matchesStat[stat.key])}</span></div>`).join('')}</div>`);
  const common = `<p class="fp-note fp-shared">${html(t.memberProfileShared)}</p>`
    + section(t.matchesCommonTopics, cards(comparison.topics.items, (topic, metric) => `<article class="fp-card"><strong>${html(topic.name)}</strong>${measure(topic, metric)}</article>`))
    + section(t.matchesCommonChannels, channelCards(comparison.channels.items))
    + section(t.matchesCommonShorts, channelCards(comparison.shortsChannels.items))
    + section(t.matchesCommonVideos, cards(comparison.videos.items, (video, metric) => `<article class="fp-card"><a href="https://www.youtube.com/watch?v=${html(video.videoId)}" target="_blank" rel="noopener">${video.thumbnailUrl ? `<img class="fp-thumb" src="${html(video.thumbnailUrl)}" alt="" loading="lazy" width="160" height="90">` : '<span class="fp-thumb" aria-hidden="true"></span>'}<strong>${html(video.title)}</strong></a>${measure(video, metric)}</article>`));
  const clock = section(t.matchesClock, `<p class="fp-note">${html(t.matchesClockSub)}</p>${comparison.clock.b.reliable ? panels(metric => radialClock(metric === 'seconds' ? comparison.clock.b.seconds : comparison.clock.b.watches, displayName, t.rhythmAria(displayName), (_hour, amount) => value(metric, amount))) : `<p class="fp-note">${html(t.matchesClockUnreliable)}</p>`}`);
  const week = section(t.matchesWeekdays, panels(metric => {
    const rows = comparison.weekdays.rows;
    const amount = (row: typeof rows[number]) => metric === 'seconds' ? row.seconds.b : row.watches.b;
    const max = Math.max(1e-9, ...rows.map(amount));
    return `<p class="fp-note">${html(metric === 'seconds' ? t.matchesWeekdaysTime : t.matchesWeekdaysWatches)}</p><div class="fp-week">${rows.map(row => `<div><span>${html(t.matchesWeekdayNames[row.weekday]!)}</span><i style="--fp-bar:${Math.round(amount(row) / max * 100)}%"></i><strong>${html(value(metric, amount(row)))}</strong></div>`).join('')}</div>`;
  }) + `<p class="fp-note">${html(t.matchesWeekdaysAverageNote)}</p>`);
  const edge = (heading: string, watch: ComparisonWatchEdge | null | undefined) => section(heading, watch ? `<strong class="fp-edge-title">${html(watch.title)}</strong><p class="fp-note">${html(new Intl.DateTimeFormat(lang === 'zh' ? 'zh-TW' : 'en', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(watch.watchedAt)))}</p>` : `<p class="fp-note">${html(t.matchesNoHistory)}</p>`);
  return `<style>${rhythmClockStyles}${friendStyles}</style><div class="fp-profile">${rangeLinks}${metrics}${stats}${common}<div class="fp-rhythm">${clock}${week}</div><div class="fp-edges">${edge(t.matchesFirstWatch, comparison.firstWatch?.b)}${edge(t.matchesLastWatch, comparison.lastWatch?.b)}</div></div><script>${metricScript}</script>`;
}

const friendStyles = `
  .mp-profile.has-stats{max-width:960px}.fp-profile{margin-top:24px}.fp-profile>.yt-metric-toggle{margin:0 auto;width:fit-content}.fp-profile .mt-range{flex-wrap:wrap;justify-content:center}.fp-profile [data-metric-panel][hidden]{display:none}.fp-section{border-top:1px solid var(--line);margin-top:26px;padding-top:22px}.fp-section h2{font-size:18px;margin:0 0 16px}.fp-stats{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(120px,1fr))}.fp-stats strong{display:block;font-size:24px;font-variant-numeric:tabular-nums}.fp-stats span,.fp-measure{color:var(--muted);font-size:11px}.fp-measure{display:block;margin-top:6px}.fp-note{color:var(--muted);font-size:12px;line-height:1.7;margin:10px auto;max-width:640px}.fp-shared{margin-top:28px}
  .fp-grid{display:grid;gap:18px 14px;grid-template-columns:repeat(auto-fit,minmax(130px,1fr))}.fp-card{justify-self:center;max-width:160px;min-width:0;width:100%}.fp-card a{color:var(--ink);text-decoration:none}.fp-card a:hover{color:var(--accent-text)}.fp-card strong{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:13px;line-height:1.4;overflow:hidden;overflow-wrap:anywhere}.fp-avatar{background:var(--raised);border-radius:50%;display:grid;font-size:24px;height:64px;margin:0 auto 10px;object-fit:cover;place-items:center;width:64px}.fp-thumb{aspect-ratio:16/9;background:var(--raised);border-radius:5px;display:block;height:auto;margin-bottom:10px;object-fit:cover;width:100%}.fp-more summary{color:var(--muted);cursor:pointer;font-size:12px;margin:16px 0}.fp-rhythm,.fp-edges{display:grid;gap:24px;grid-template-columns:repeat(2,minmax(0,1fr))}.fp-rhythm .yt-rhythm-clock{margin-inline:auto;max-width:320px}.fp-week{display:grid;gap:10px;margin:18px auto;max-width:440px}.fp-week>div{align-items:center;display:grid;font-size:12px;gap:12px;grid-template-columns:40px minmax(0,1fr) 64px}.fp-week span{color:var(--muted)}.fp-week i{background:linear-gradient(to right,var(--accent) var(--fp-bar),transparent var(--fp-bar));border-radius:4px;height:8px}.fp-week strong{font-size:12px;text-align:right}.fp-edge-title{font-size:13px;overflow-wrap:anywhere}@media(max-width:620px){.fp-rhythm,.fp-edges{grid-template-columns:1fr}.fp-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.fp-stats strong{font-size:20px}.fp-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
