import {
  YOUTUBE_RANGES,
  type YoutubeDailySummary,
  type YoutubeDashboardData,
  type YoutubeHourlySummary,
  type YoutubeRecentVideo,
} from '../youtube/types.js';
import {
  PERSONAL_TAXONOMY_TRUSTED_COVERAGE,
  PERSONAL_TOPICS,
} from '../youtube/personal-taxonomy.js';
import { messages, type Lang, type Messages } from './i18n.js';
import { duration, hours, html, shell, timeAgo, trustSignals, type ShellNavItem } from './pages.js';
import { processingStyles } from './processing.js';
import { topicTrendSection, topicTrendStyles } from './topic-trend.js';

function compact(value: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function channelAvatar(channel: { name: string; thumbnailUrl: string }): string {
  return channel.thumbnailUrl
    ? `<img src="${html(channel.thumbnailUrl)}" alt="" loading="lazy">`
    : `<span class="yt-channel-avatar" aria-hidden="true">${html([...channel.name][0] ?? '?')}</span>`;
}

interface RhythmBar {
  label: string;
  key: string;
  watches: number;
  estimatedWatchSeconds: number;
}

// Zero-filled rhythm series: every day between the first and last active day
// exists, so quiet stretches are visible instead of silently collapsed. Long
// spans fold to months to keep one bar ≥ a few pixels wide.
function rhythmBars(daily: YoutubeDailySummary[], t: Messages): { bars: RhythmBar[]; unit: 'day' | 'month' } {
  if (!daily.length) return { bars: [], unit: 'day' };
  const byDay = new Map(daily.map((entry) => [entry.day, entry]));
  const first = new Date(`${daily[0].day}T00:00:00Z`);
  const last = new Date(`${daily[daily.length - 1].day}T00:00:00Z`);
  const spanDays = Math.round((last.getTime() - first.getTime()) / 86400_000) + 1;
  if (spanDays > 200) {
    const months = new Map<string, RhythmBar>();
    for (let cursor = new Date(first); cursor <= last; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
      const key = cursor.toISOString().slice(0, 7);
      months.set(key, {
        key,
        label: t.monthYear(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1),
        watches: 0,
        estimatedWatchSeconds: 0,
      });
    }
    for (const entry of daily) {
      const bucket = months.get(entry.day.slice(0, 7));
      if (!bucket) continue;
      bucket.watches += entry.watches;
      bucket.estimatedWatchSeconds += entry.estimatedWatchSeconds;
    }
    return { bars: [...months.values()], unit: 'month' };
  }
  const bars: RhythmBar[] = [];
  for (let cursor = new Date(first); cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const key = cursor.toISOString().slice(0, 10);
    const entry = byDay.get(key);
    bars.push({
      key,
      label: t.monthDay(cursor.getUTCMonth() + 1, cursor.getUTCDate()),
      watches: entry?.watches ?? 0,
      estimatedWatchSeconds: entry?.estimatedWatchSeconds ?? 0,
    });
  }
  return { bars, unit: 'day' };
}

function polarPoint(angle: number, radius: number): [number, number] {
  const radians = (angle - 90) * Math.PI / 180;
  return [150 + Math.cos(radians) * radius, 150 + Math.sin(radians) * radius];
}

function radialSector(hour: number, value: number, max: number): string {
  const inner = 9;
  const outer = inner + value / (max > 0 ? max : 1) * 108;
  const startAngle = hour * 15 + 1.5;
  const endAngle = (hour + 1) * 15 - 1.5;
  const [innerStartX, innerStartY] = polarPoint(startAngle, inner);
  const [outerStartX, outerStartY] = polarPoint(startAngle, outer);
  const [outerEndX, outerEndY] = polarPoint(endAngle, outer);
  const [innerEndX, innerEndY] = polarPoint(endAngle, inner);
  return `M${innerStartX.toFixed(2)},${innerStartY.toFixed(2)}L${outerStartX.toFixed(2)},${outerStartY.toFixed(2)}A${outer.toFixed(2)},${outer.toFixed(2)} 0 0 1 ${outerEndX.toFixed(2)},${outerEndY.toFixed(2)}L${innerEndX.toFixed(2)},${innerEndY.toFixed(2)}A${inner},${inner} 0 0 0 ${innerStartX.toFixed(2)},${innerStartY.toFixed(2)}Z`;
}

// One 24-hour rose chart. Values are any non-negative series (counts,
// seconds, or shares); the caller formats the tooltip.
export function radialClock(
  values: number[],
  label: string,
  ariaLabel: string,
  tip: (hour: number, value: number) => string,
  panel = '',
): string {
  const max = Math.max(1e-9, ...values);
  const spokes = values.map((_, hour) => {
    const [x1, y1] = polarPoint(hour * 15, 10);
    const [x2, y2] = polarPoint(hour * 15, 126);
    return `<line${hour % 6 === 0 ? ' class="yt-rhythm-major"' : ''} x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"></line>`;
  }).join('');
  const sectors = values.map((value, hour) => value > 0
    ? `<path class="yt-rhythm-sector" d="${radialSector(hour, value, max)}" tabindex="0" data-tip="${html(hourLabel(hour))}" data-tip-label="${html(tip(hour, value))}"></path>`
    : '').join('');
  return `<figure class="yt-rhythm-clock"${panel ? ` data-rhythm-panel="${html(panel)}"` : ''}><svg viewBox="0 0 300 300" role="img" aria-label="${html(ariaLabel)}">
    <g class="yt-rhythm-spokes">${spokes}</g>${sectors}<circle cx="150" cy="150" r="3"></circle>
    <g class="yt-rhythm-hours"><text x="150" y="13">00</text><text x="289" y="154">06</text><text x="150" y="297">12</text><text x="11" y="154">18</text></g>
    </svg><figcaption>${label}</figcaption></figure>`;
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`;
}

function rhythmClock(
  hourly: YoutubeHourlySummary[],
  metric: 'watches' | 'estimatedWatchSeconds',
  label: string,
  t: Messages,
): string {
  const byHour = new Map(hourly.map((entry) => [entry.hour, entry]));
  const values = Array.from({ length: 24 }, (_, hour) => byHour.get(hour)?.[metric] ?? 0);
  return radialClock(
    values,
    label,
    t.rhythmAria(label),
    (_hour, value) => (metric === 'watches' ? t.tipVideos(value) : hours(value)),
    metric,
  );
}

function rhythmSection(data: YoutubeDashboardData, t: Messages): string {
  const { exactWatches, dateOnlyWatches } = data.rhythmCoverage;
  if (!exactWatches && !dateOnlyWatches) return '';
  // A date-only history row is stored at local noon solely so it has a stable
  // calendar date. It must never become a fake 12:00 viewing habit. When such
  // rows dominate the selected range, suppress the visualization entirely;
  // otherwise chart only the exact subset and disclose what was excluded.
  const unreliable = dateOnlyWatches > 0 && dateOnlyWatches >= exactWatches;
  if (unreliable) {
    return `<section class="section"><div class="section-head"><div><h2>${t.rhythm}</h2>
      <span>${t.rhythmSub(t.ranges[data.range])}</span></div></div>
      <div class="yt-rhythm-quality yt-rhythm-quality-blocking" role="note">
        <span class="yt-rhythm-quality-mark" aria-hidden="true">!</span><div><strong>${t.rhythmUnavailableTitle}</strong>
        <p>${t.rhythmUnavailable(exactWatches, dateOnlyWatches)}</p></div>
      </div></section>`;
  }
  const quality = dateOnlyWatches > 0
    ? `<div class="yt-rhythm-quality" role="note"><span class="yt-rhythm-quality-mark" aria-hidden="true">!</span><div><strong>${t.rhythmPartialTitle}</strong><p>${t.rhythmPartial(exactWatches, dateOnlyWatches)}</p></div></div>`
    : '';
  const tableRows = Array.from({ length: 24 }, (_, hour) => {
    const entry = data.hourly.find((item) => item.hour === hour);
    return entry?.watches
      ? `<tr><td>${t.hourRange(hour)}</td><td>${entry.watches}</td><td>${hours(entry.estimatedWatchSeconds)}</td></tr>`
      : '';
  }).join('');
  return `<section class="section"><div class="section-head"><div><h2>${t.rhythm}</h2>
    <span>${t.rhythmSub(t.ranges[data.range])}</span></div>
    <div class="yt-metric-toggle" role="group" aria-label="${t.rhythm}">
      <button type="button" data-rhythm-metric="watches" aria-pressed="true">${t.rhythmWatches}</button>
      <button type="button" data-rhythm-metric="estimatedWatchSeconds" aria-pressed="false">${t.rhythmTime}</button>
    </div></div>
    ${quality}
    <div class="yt-rhythm-clocks">${rhythmClock(data.hourly, 'watches', t.rhythmWatches, t)}${rhythmClock(data.hourly, 'estimatedWatchSeconds', t.rhythmTime, t)}</div>
    <details class="viz-table"><summary>${t.tableView}</summary><table>
      <thead><tr><th>${t.colHour}</th><th>${t.colVideos}</th><th>${t.colEstTime}</th></tr></thead>
      <tbody>${tableRows}</tbody></table></details>
    <script>(()=>{const root=document.currentScript?.closest('section');if(!root)return;const toggle=root.querySelector('.yt-metric-toggle');const buttons=[...root.querySelectorAll('[data-rhythm-metric]')];const panels=[...root.querySelectorAll('[data-rhythm-panel]')];const wide=matchMedia('(min-width:900px)');let metric='watches';const apply=(next)=>{metric=next;toggle.hidden=wide.matches;for(const panel of panels)panel.hidden=!wide.matches&&panel.dataset.rhythmPanel!==metric;for(const button of buttons)button.setAttribute('aria-pressed',String(button.dataset.rhythmMetric===metric))};for(const button of buttons)button.addEventListener('click',()=>apply(button.dataset.rhythmMetric));wide.addEventListener('change',()=>apply(metric),{signal:window.urtubePageController.signal});apply(metric)})();</script>
  </section>`;
}

interface ShortFormBar {
  key: string;
  label: string;
  shortWatchSeconds: number;
  knownDurationWatchSeconds: number;
}

export type ShortFormVariant =
  | 'current' | 'stacked' | 'compare' | 'heatmap'
  | 'absolute' | 'dual';

function shortFormBars(data: YoutubeDashboardData, t: Messages): {
  bars: ShortFormBar[];
  unit: 'day' | 'month';
} {
  const rhythm = rhythmBars(data.daily, t);
  const bars = rhythm.bars.map((bar) => ({
    key: bar.key,
    label: bar.label,
    shortWatchSeconds: 0,
    knownDurationWatchSeconds: 0,
  }));
  const byKey = new Map(bars.map((bar) => [bar.key, bar]));
  for (const entry of data.shortFormDaily) {
    const bar = byKey.get(rhythm.unit === 'month' ? entry.day.slice(0, 7) : entry.day);
    if (!bar) continue;
    bar.shortWatchSeconds += entry.shortWatchSeconds;
    bar.knownDurationWatchSeconds += entry.knownDurationWatchSeconds;
  }
  return { bars, unit: rhythm.unit };
}

function shortFormSection(
  data: YoutubeDashboardData,
  t: Messages,
  variant: ShortFormVariant = 'absolute',
): string {
  const { bars, unit } = shortFormBars(data, t);
  if (!bars.length) return '';
  const midpoint = bars.length > 1 ? Math.floor(bars.length / 2) : 0;
  const totalsFor = (slice: ShortFormBar[]) => {
    const short = slice.reduce((sum, bar) => sum + bar.shortWatchSeconds, 0);
    const known = slice.reduce((sum, bar) => sum + bar.knownDurationWatchSeconds, 0);
    return { short, known, share: known ? short / known * 100 : 0 };
  };
  const recent = totalsFor(midpoint ? bars.slice(midpoint) : bars);
  const previous = midpoint ? totalsFor(bars.slice(0, midpoint)) : recent;
  const known = bars.reduce((sum, bar) => sum + bar.knownDurationWatchSeconds, 0);
  if (!known) return '';
  const total = data.daily.reduce((sum, day) => sum + day.estimatedWatchSeconds, 0);
  const coverage = total ? known / total * 100 : 0;
  const delta = recent.share - previous.share;
  const isZh = t.htmlLang === 'zh-Hant';
  const copy = isZh ? {
    stacked: '方案 A · 100% 組成趨勢',
    absolute: 'Shorts 與一般影片時間',
    dual: '方案 A2 · 組成＋總時數',
    compare: '方案 B · 前後期比較',
    heatmap: '方案 C · 年月熱圖',
    short: 'Shorts', other: '一般影片', previous: '前半段', recent: '近期半段',
    delta: '占比變化', coverage: '片長涵蓋率', months: '月份', total: '總觀看時間',
  } : {
    stacked: 'Option A · 100% composition trend',
    absolute: 'Shorts and regular-video time',
    dual: 'Option A2 · composition + total time',
    compare: 'Option B · period comparison',
    heatmap: 'Option C · year/month heatmap',
    short: 'Shorts', other: 'Regular videos', previous: 'Earlier half', recent: 'Recent half',
    delta: 'Share change', coverage: 'Duration coverage', months: 'Months', total: 'Total watch time',
  };
  const shareOf = (bar: ShortFormBar) => bar.knownDurationWatchSeconds
    ? bar.shortWatchSeconds / bar.knownDurationWatchSeconds * 100
    : 0;
  const tableRows = bars.filter((bar) => bar.knownDurationWatchSeconds > 0).map((bar) => {
    const share = shareOf(bar);
    return `<tr><td>${html(bar.label)}</td><td>${Math.round(share)}%</td><td>${hours(bar.shortWatchSeconds)}</td><td>${hours(bar.knownDurationWatchSeconds - bar.shortWatchSeconds)}</td></tr>`;
  }).join('');
  const details = `<details class="viz-table"><summary>${t.tableView}</summary><table>
    <thead><tr><th>${unit === 'day' ? t.colDay : t.colMonth}</th><th>${t.colShare}</th><th>${t.colShortTime}</th><th>${copy.other}</th></tr></thead>
    <tbody>${tableRows}</tbody></table></details>`;
  const method = `<div class="yt-short-method"><span>${t.shortFormMethod}</span><span>${copy.coverage} ${Math.round(coverage)}%</span></div>`;

  if (variant === 'compare') {
    const periodLabel = (slice: ShortFormBar[]) => slice.length
      ? `${slice[0].label}–${slice.at(-1)!.label}` : '';
    const periods = [
      { label: copy.previous, range: periodLabel(bars.slice(0, midpoint || bars.length)), totals: previous },
      { label: copy.recent, range: periodLabel(midpoint ? bars.slice(midpoint) : bars), totals: recent },
    ];
    const cards = periods.map((period) => `<div class="yt-short-compare-card">
      <div class="yt-short-compare-head"><span><strong>${period.label}</strong><small>${html(period.range)}</small></span><b>${Math.round(period.totals.share)}%</b></div>
      <div class="yt-short-compare-track"><i style="width:${period.totals.share.toFixed(1)}%"></i></div>
      <div class="yt-short-compare-meta"><span>${copy.short} ${hours(period.totals.short)}</span><span>${copy.other} ${hours(period.totals.known - period.totals.short)}</span></div>
    </div>`).join('');
    return `<section class="section"><div class="section-head"><h2>${t.shortForm}</h2><span>${copy.compare}</span></div>
      <div class="yt-short-compare-summary"><strong>${delta >= 0 ? '+' : ''}${Math.round(delta)}<small>pp</small></strong><span>${copy.delta}</span></div>
      <div class="yt-short-compare">${cards}</div>${method}${details}</section>`;
  }

  if (variant === 'heatmap') {
    const monthly = new Map<string, ShortFormBar>();
    for (const entry of data.shortFormDaily) {
      const key = entry.day.slice(0, 7);
      const month = monthly.get(key) ?? {
        key, label: key, shortWatchSeconds: 0, knownDurationWatchSeconds: 0,
      };
      month.shortWatchSeconds += entry.shortWatchSeconds;
      month.knownDurationWatchSeconds += entry.knownDurationWatchSeconds;
      monthly.set(key, month);
    }
    const keys = [...monthly.keys()].sort();
    const firstYear = Number(keys[0]?.slice(0, 4));
    const lastYear = Number(keys.at(-1)?.slice(0, 4));
    const monthHeads = Array.from({ length: 12 }, (_, index) =>
      `<span>${t.monthTick(index + 1)}</span>`).join('');
    const rows = Array.from({ length: lastYear - firstYear + 1 }, (_, offset) => {
      const year = firstYear + offset;
      const cells = Array.from({ length: 12 }, (_, monthIndex) => {
        const key = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
        const bar = monthly.get(key);
        if (!bar?.knownDurationWatchSeconds) return '<span class="yt-short-heat-empty"></span>';
        const share = shareOf(bar);
        const alpha = Math.min(.95, .12 + share / 100 * .83);
        const tip = `${Math.round(share)}% · ${hours(bar.shortWatchSeconds)} / ${hours(bar.knownDurationWatchSeconds)}`;
        return `<span class="yt-short-heat-cell" style="--heat:${alpha.toFixed(2)}" data-tip="${key}" data-tip-label="${html(tip)}"><strong>${Math.round(share)}</strong><small>%</small></span>`;
      }).join('');
      return `<strong class="yt-short-heat-year">${year}</strong>${cells}`;
    }).join('');
    return `<section class="section"><div class="section-head"><h2>${t.shortForm}</h2><span>${copy.heatmap}</span></div>
      <div class="yt-short-heat-wrap"><div class="yt-short-heat-head"><span>${copy.months}</span>${monthHeads}</div><div class="yt-short-heat">${rows}</div></div>
      <div class="yt-short-heat-scale"><span>0%</span><i></i><span>100%</span></div>${method}${details}</section>`;
  }

  const maxKnown = Math.max(1, ...bars.map((bar) => bar.knownDurationWatchSeconds));
  const stackColumns = bars.map((bar) => {
    const share = shareOf(bar);
    const tip = `${Math.round(share)}% · ${copy.total} ${hours(bar.knownDurationWatchSeconds)}`;
    return `<div class="yt-short-stack-col" data-tip="${html(bar.label)}" data-tip-label="${html(tip)}"><i style="height:${share.toFixed(1)}%"></i></div>`;
  }).join('');
  const volumeColumns = bars.map((bar) => {
    const tip = `${copy.total} ${hours(bar.knownDurationWatchSeconds)}`;
    return `<div class="yt-short-volume-col" data-tip="${html(bar.label)}" data-tip-label="${html(tip)}"><i style="height:${(bar.knownDurationWatchSeconds / maxKnown * 100).toFixed(1)}%"></i></div>`;
  }).join('');

  if (variant === 'absolute') {
    const columns = bars.map((bar) => {
      const share = shareOf(bar);
      const totalHeight = bar.knownDurationWatchSeconds / maxKnown * 100;
      const tip = `${Math.round(share)}% · ${copy.short} ${hours(bar.shortWatchSeconds)} · ${copy.total} ${hours(bar.knownDurationWatchSeconds)}`;
      return `<div class="yt-short-absolute-col" data-tip="${html(bar.label)}" data-tip-label="${html(tip)}"><span style="height:${totalHeight.toFixed(1)}%"><i class="yt-short-segment" style="height:${share.toFixed(1)}%"></i><b class="yt-regular-segment" style="height:${(100 - share).toFixed(1)}%"></b></span></div>`;
    }).join('');
    return `<section class="section"><div class="section-head"><h2>${t.shortForm}</h2><span>${copy.absolute}</span></div>
      <div class="yt-short-absolute-axis"><span>${hours(maxKnown)}</span><span>0h</span></div>
      <div class="yt-short-absolute" role="img" aria-label="${t.shortFormAria}">${columns}</div>
      <div class="yt-short-stack-legend"><span><i></i>${copy.short}</span><span><i></i>${copy.other}</span></div>${method}${details}</section>`;
  }

  if (variant === 'dual') {
    return `<section class="section"><div class="section-head"><h2>${t.shortForm}</h2><span>${copy.dual}</span></div>
      <div class="yt-short-dual-label"><strong>${t.colShare}</strong><span>100%</span></div>
      <div class="yt-short-stack yt-short-stack-compact" role="img" aria-label="${t.shortFormAria}">${stackColumns}</div>
      <div class="yt-short-dual-label"><strong>${copy.total}</strong><span>max ${hours(maxKnown)}</span></div>
      <div class="yt-short-volume">${volumeColumns}</div>
      <div class="yt-short-stack-legend"><span><i></i>${copy.short}</span><span><i></i>${copy.other}</span><span class="yt-short-total-key"><i></i>${copy.total}</span></div>${method}${details}</section>`;
  }

  const columns = bars.map((bar) => {
    const share = shareOf(bar);
    const tip = `${Math.round(share)}% · ${hours(bar.shortWatchSeconds)} / ${hours(bar.knownDurationWatchSeconds)}`;
    return variant === 'stacked'
      ? `<div class="yt-short-stack-col" data-tip="${html(bar.label)}" data-tip-label="${html(tip)}"><i style="height:${share.toFixed(1)}%"></i></div>`
      : `<div class="yt-short-col" data-tip="${html(bar.label)}" data-tip-label="${html(tip)}"><i style="height:${share.toFixed(1)}%"></i></div>`;
  }).join('');
  if (variant === 'stacked') {
    return `<section class="section"><div class="section-head"><h2>${t.shortForm}</h2><span>${copy.stacked}</span></div>
      <div class="yt-short-stack" role="img" aria-label="${t.shortFormAria}">${columns}</div>
      <div class="yt-short-stack-legend"><span><i></i>${copy.short}</span><span><i></i>${copy.other}</span></div>${method}${details}</section>`;
  }
  return `<section class="section"><div class="section-head"><h2>${t.shortForm}</h2>
    <span>${t.shortFormSub(Math.round(recent.share), Math.round(delta), Math.round(coverage))}</span></div>
    <div class="yt-short-chart" role="img" aria-label="${t.shortFormAria}">${columns}</div>
    <div class="yt-short-legend"><span>100%</span><strong>${t.shortFormMethod}</strong><span>0%</span></div>
    ${details}</section>`;
}

// Row pitch of the race: 32px row + 9px gap. Rows are absolutely positioned
// and moved with translateY so rank changes slide instead of snapping.
const RACE_ROW_PITCH = 41;

function channelChase(data: YoutubeDashboardData, t: Messages): string {
  const race = data.channelRace;
  if (!race.frames.length) return '';
  const payload = JSON.stringify({ channels: race.channels, frames: race.frames })
    .replace(/</g, '\\u003c');
  const latest = race.frames.at(-1)!;
  const maxRows = Math.max(...race.frames.map((frame) => frame.entries.length));
  const trackHeight = maxRows * RACE_ROW_PITCH - 9;
  const max = Math.max(1, latest.entries[0]?.[1] ?? 1);
  const initialRows = latest.entries.map(([index, score], rank) => {
    const channel = race.channels[index];
    return `<div class="yt-chase-row" data-chase-index="${index}" style="transform:translateY(${rank * RACE_ROW_PITCH}px)">
    ${channelAvatar(channel)}
    <div class="yt-chase-copy"><div class="yt-chase-label"><strong>${html(channel.name)}</strong></div>
      <div class="yt-chase-track"><i style="--share:${(score / max).toFixed(4)}"></i></div></div>
    <span class="yt-chase-value">${hours(score)}</span>
  </div>`;
  }).join('');
  return `<section class="section"><div class="section-head"><h2>${t.momentum}</h2><span>${t.momentumSub(race.halfLifeDays)}</span></div>
    <div class="yt-chase">
      <div class="yt-chase-controls">
        <button type="button" data-chase-play data-label-play="${t.playHistory}" data-label-pause="${t.pauseHistory}" aria-label="${t.playHistory}" title="${t.playHistory}">▶</button>
        <strong class="yt-chase-period" data-chase-period>${html(latest.period)}</strong>
        <input type="range" min="0" max="${race.frames.length - 1}" value="${race.frames.length - 1}" aria-label="${t.momentum}" data-chase-range>
      </div>
      <div class="yt-chase-rows" data-chase-rows style="height:${trackHeight}px">${initialRows}</div>
    </div>
    <script type="application/json" data-chase-data>${payload}</script>
    <script>
      (() => {
        const root = document.currentScript?.closest('section');
        if (!root) return;
        const race = JSON.parse(root.querySelector('[data-chase-data]').textContent || '{}');
        const frames = race.frames || [];
        const rows = root.querySelector('[data-chase-rows]');
        const range = root.querySelector('[data-chase-range]');
        const period = root.querySelector('[data-chase-period]');
        const play = root.querySelector('[data-chase-play]');
        const pitch = ${RACE_ROW_PITCH};
        const hiddenY = ${trackHeight + RACE_ROW_PITCH};
        const stepMs = Math.max(120, Math.min(650, Math.round(15000 / frames.length)));
        let timer = null;
        const formatHours = (seconds) => (Math.round(seconds / 360) / 10) + 'h';
        const rowCache = new Map();
        rows.querySelectorAll('[data-chase-index]').forEach((row) => {
          rowCache.set(Number(row.dataset.chaseIndex), {
            row,
            bar: row.querySelector('.yt-chase-track i'),
            value: row.querySelector('.yt-chase-value'),
          });
        });
        const makeRow = (index) => {
          const channel = race.channels[index];
          const row = document.createElement('div');
          row.className = 'yt-chase-row';
          if (channel.thumbnailUrl) {
            const image = document.createElement('img');
            image.src = channel.thumbnailUrl;
            image.alt = '';
            row.append(image);
          } else {
            const fallback = document.createElement('span');
            fallback.className = 'yt-channel-avatar';
            fallback.setAttribute('aria-hidden', 'true');
            fallback.textContent = Array.from(channel.name)[0] || '?';
            row.append(fallback);
          }
          const copy = document.createElement('div');
          copy.className = 'yt-chase-copy';
          const label = document.createElement('div');
          label.className = 'yt-chase-label';
          const name = document.createElement('strong');
          name.textContent = channel.name;
          label.append(name);
          const track = document.createElement('div');
          track.className = 'yt-chase-track';
          const bar = document.createElement('i');
          track.append(bar);
          copy.append(label, track);
          const value = document.createElement('span');
          value.className = 'yt-chase-value';
          row.append(copy, value);
          row.style.transform = 'translateY(' + hiddenY + 'px)';
          row.style.opacity = '0';
          rows.append(row);
          void row.offsetHeight; // commit the off-screen start so entering rows slide in
          const cached = { row, bar, value };
          rowCache.set(index, cached);
          return cached;
        };
        const render = (frameIndex) => {
          const frame = frames[frameIndex];
          if (!frame) return;
          const max = Math.max(1, frame.entries[0] ? frame.entries[0][1] : 1);
          const seen = new Set();
          frame.entries.forEach((pair, rank) => {
            const cached = rowCache.get(pair[0]) || makeRow(pair[0]);
            seen.add(pair[0]);
            cached.row.style.transform = 'translateY(' + (rank * pitch) + 'px)';
            cached.row.style.opacity = '1';
            cached.bar.style.setProperty('--share', String(pair[1] / max));
            cached.value.textContent = formatHours(pair[1]);
          });
          for (const [index, cached] of rowCache) {
            if (seen.has(index)) continue;
            cached.row.style.opacity = '0';
            cached.row.style.transform = 'translateY(' + hiddenY + 'px)';
          }
          period.textContent = frame.period;
          range.value = String(frameIndex);
        };
        const stop = () => {
          if (timer !== null) window.clearInterval(timer);
          timer = null;
          play.textContent = '▶';
          play.setAttribute('aria-label', play.dataset.labelPlay);
          play.title = play.dataset.labelPlay;
        };
        render(frames.length - 1);
        window.urtubePageController.signal.addEventListener('abort', stop, { once: true });
        range.addEventListener('input', () => {
          stop();
          render(Number(range.value));
        });
        play.addEventListener('click', () => {
          if (timer !== null) return stop();
          if (Number(range.value) >= frames.length - 1) render(0);
          play.textContent = '❚❚';
          play.setAttribute('aria-label', play.dataset.labelPause);
          play.title = play.dataset.labelPause;
          timer = window.setInterval(() => {
            const next = Number(range.value) + 1;
            if (next >= frames.length) return stop();
            render(next);
          }, stepMs);
        });
      })();
    </script>
  </section>`;
}

// Shared with the two-person comparison page.
export const rhythmClockStyles = `
  .yt-rhythm-clocks{margin:4px auto 8px;max-width:460px}
  .yt-rhythm-clock{margin:0;min-width:0;text-align:center}.yt-rhythm-clock[hidden]{display:none}.yt-rhythm-clock svg{display:block;margin:auto;max-width:420px;overflow:visible;width:100%}
  .yt-rhythm-spokes line{stroke:var(--line-strong);stroke-width:1}.yt-rhythm-spokes .yt-rhythm-major{stroke:var(--muted);stroke-width:1.4}
  .yt-rhythm-sector{fill:var(--accent);outline:none;transition:fill .15s}.yt-rhythm-sector:hover,.yt-rhythm-sector:focus{fill:#e66767}
  .yt-rhythm-clock circle{fill:var(--ink)}.yt-rhythm-hours{fill:var(--muted);font-size:8px;font-variant-numeric:tabular-nums}.yt-rhythm-hours text{text-anchor:middle}
  .yt-rhythm-clock figcaption{color:var(--ink-2);font-size:11px;font-weight:700;letter-spacing:.08em;margin-top:5px;text-transform:uppercase}
  .yt-rhythm-quality{align-items:flex-start;background:rgba(208,59,59,.08);border:1px solid rgba(230,103,103,.28);border-radius:12px;display:flex;gap:12px;margin:0 0 20px;padding:14px 16px}
  .yt-rhythm-quality-mark{align-items:center;background:var(--accent);border-radius:50%;color:#fff;display:flex;flex:0 0 24px;font-size:13px;font-weight:800;height:24px;justify-content:center}
  .yt-rhythm-quality strong{display:block;font-size:13px;margin-bottom:3px}.yt-rhythm-quality p{color:var(--ink-2);font-size:12px;line-height:1.6;margin:0;max-width:820px}
  .yt-rhythm-quality-blocking{align-items:center;justify-content:center;margin-bottom:0;min-height:260px;padding:32px}.yt-rhythm-quality-blocking>div{max-width:680px}.yt-rhythm-quality-blocking strong{font-size:17px}.yt-rhythm-quality-blocking p{font-size:13px;margin-top:7px}

  .yt-metric-toggle{background:var(--raised);border:1px solid var(--line);border-radius:999px;display:flex;padding:2px}
  .yt-metric-toggle button{background:transparent;border:0;border-radius:999px;color:var(--muted);cursor:pointer;font:inherit;font-size:11px;font-weight:700;padding:6px 11px}
  .yt-metric-toggle button[aria-pressed=true]{background:var(--ink);color:#111}
`;

const dashboardStyles = `${rhythmClockStyles}
  .yt-import-control{align-items:center;display:flex;gap:12px;margin:0 0 18px}.yt-import-control[hidden]{display:none}
  .yt-import-control button{background:var(--raised);border:1px solid var(--line-strong);border-radius:999px;color:var(--ink);cursor:pointer;font:inherit;font-size:12px;font-weight:600;padding:7px 14px}
  .yt-import-control button:hover{border-color:var(--muted)}.yt-import-control button:disabled{cursor:wait;opacity:.6}
  .yt-import-control span{color:var(--muted);font-size:11px}

  .yt-page-nav{display:flex;gap:6px;margin:-4px 0 18px;overflow-x:auto;padding:2px 0 8px}
  .yt-page-nav a{border-bottom:2px solid transparent;color:var(--muted);font-size:12px;font-weight:700;padding:7px 10px;text-decoration:none;white-space:nowrap}
  .yt-page-nav a:hover{color:var(--ink)}.yt-page-nav a[aria-current=page]{border-color:var(--accent);color:var(--ink)}

  .yt-hero{display:block;padding:26px 28px}
  .yt-hero-figure strong{display:block;font-size:clamp(52px,7.5vw,84px);font-weight:750;letter-spacing:-.045em;line-height:.95}
  .yt-hero-figure strong em{color:var(--accent-text);font-size:.42em;font-style:normal;font-weight:700;letter-spacing:-.01em;margin-left:4px;vertical-align:.12em}
  .yt-hero-figure span{color:var(--ink-2);display:block;font-size:13px;margin-top:10px}
  .yt-hero-stats{border-top:1px solid var(--line);display:grid;gap:16px 26px;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));margin-top:24px;padding-top:20px}
  .yt-hero-foot{border-top:1px solid var(--line);color:var(--muted);font-size:11px;margin-top:18px;padding-top:12px}


  .yt-channels{display:grid;gap:4px}
  .yt-channel-row{align-items:center;border-radius:10px;display:grid;gap:12px;grid-template-columns:18px 36px minmax(0,1fr) 92px;padding:6px 8px 6px 2px}
  .yt-channel-row:hover{background:var(--raised)}
  .yt-channel-rank{color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums;text-align:right}
  .yt-channel-row img,.yt-channel-avatar{background:var(--raised);border-radius:50%;color:var(--ink-2);display:grid;flex:0 0 36px;font-size:13px;font-weight:700;height:36px;object-fit:cover;place-items:center;width:36px}
  .yt-channel-main{min-width:0}
  .yt-channel-name{display:block;font-size:13px;font-weight:600;margin-bottom:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .yt-channel-name a{color:var(--ink);text-decoration:none}.yt-channel-name a:hover{color:var(--accent-text)}
  .yt-channel-track{background:var(--raised);border-radius:999px;height:7px}
  .yt-channel-track i{background:var(--accent);border-radius:999px 4px 4px 999px;display:block;height:100%;min-width:2px}
  .yt-channel-nums{text-align:right}
  .yt-channel-nums strong{display:block;font-size:13px;font-variant-numeric:tabular-nums;font-weight:650}
  .yt-channel-nums span{color:var(--muted);font-size:10px;font-variant-numeric:tabular-nums}
  .yt-sort a{color:var(--muted);text-decoration:none}.yt-sort a:hover{color:var(--ink-2)}
  .yt-sort a[aria-current=page]{color:var(--accent-text);font-weight:700}
  .yt-channel-row[hidden],.yt-top-video[hidden]{display:none}

  .yt-mix{display:grid;gap:11px}
  .yt-mix-row{align-items:center;display:grid;gap:10px;grid-template-columns:76px minmax(0,1fr) 44px}
  .yt-mix-row>span:first-child{color:var(--ink-2);font-size:12px}
  .yt-mix-row>span:last-child{color:var(--ink-2);font-size:12px;font-variant-numeric:tabular-nums;text-align:right}
  .yt-mix-track{background:var(--raised);border-radius:999px;height:8px}
  .yt-mix-track i{border-radius:999px 4px 4px 999px;display:block;height:100%;min-width:2px}

  .yt-top-videos{display:grid;gap:8px;grid-template-columns:1fr}
  .yt-top-video{align-items:center;border-radius:10px;color:inherit;display:grid;gap:10px;grid-template-columns:18px 80px minmax(0,1fr) 72px;padding:6px 8px 6px 2px;text-decoration:none}
  .yt-top-video:hover{background:var(--raised)}
  .yt-top-video-media{aspect-ratio:16/9;background:var(--raised);border-radius:7px;display:block;overflow:hidden;position:relative}
  .yt-top-video-media img,.yt-top-video-placeholder{display:block;height:100%;object-fit:cover;width:100%}
  .yt-top-video-media .yt-video-length{bottom:3px;right:3px}
  .yt-top-video-main{min-width:0}.yt-top-video-main strong{display:block;font-size:12px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .yt-top-video-main span{color:var(--muted);display:block;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .yt-top-video-nums{text-align:right}.yt-top-video-nums strong{display:block;font-size:12px;font-variant-numeric:tabular-nums}.yt-top-video-nums span{color:var(--muted);font-size:10px;white-space:nowrap}

  .yt-short-chart{align-items:end;background:linear-gradient(to bottom,var(--line) 1px,transparent 1px,transparent 50%,var(--line) 50%,transparent calc(50% + 1px));display:flex;height:150px}
  .yt-short-col{align-items:end;display:flex;flex:1 0 3px;height:100%;justify-content:center;min-width:0;padding:0 1px}
  .yt-short-col i{background:var(--accent);border-radius:3px 3px 0 0;display:block;max-width:22px;min-height:1px;width:100%}
  .yt-short-legend{color:var(--muted);display:flex;font-size:10px;justify-content:space-between;margin-top:6px}.yt-short-legend strong{font-weight:500}
  .yt-short-method{border-top:1px solid var(--line);color:var(--muted);display:flex;font-size:10px;justify-content:space-between;margin-top:14px;padding-top:10px}

  .yt-short-stack{align-items:stretch;display:flex;gap:2px;height:180px}
  .yt-short-stack-compact{height:112px}
  .yt-short-stack-col{background:var(--raised);border-radius:3px 3px 0 0;display:flex;flex:1 1 4px;justify-content:stretch;min-width:2px;overflow:hidden;position:relative}
  .yt-short-stack-col i{align-self:end;background:var(--accent);display:block;min-height:1px;width:100%}
  .yt-short-stack-legend{display:flex;gap:20px;justify-content:center;margin-top:12px}.yt-short-stack-legend span{align-items:center;color:var(--muted);display:flex;font-size:11px;gap:6px}.yt-short-stack-legend i{background:var(--accent);border-radius:2px;height:10px;width:10px}.yt-short-stack-legend span+span i{background:#55534e;border:0}
  .yt-short-stack-legend .yt-short-total-key i{background:var(--ink-2);border:0}

  .yt-short-absolute{align-items:end;background:linear-gradient(to bottom,var(--line) 1px,transparent 1px);display:flex;gap:2px;height:190px;overflow:hidden}.yt-short-absolute-col{align-items:end;display:flex;flex:1 1 4px;height:100%;min-width:2px}.yt-short-absolute-col>span{border-radius:3px 3px 0 0;display:flex;flex-direction:column;overflow:hidden;width:100%}.yt-short-absolute-col .yt-short-segment,.yt-short-absolute-col .yt-regular-segment{display:block;width:100%}.yt-short-absolute-col .yt-short-segment{background:var(--accent)}.yt-short-absolute-col .yt-regular-segment{background:#55534e}.yt-short-absolute-axis{color:var(--muted);display:flex;font-size:9px;justify-content:space-between;margin-bottom:4px}

  .yt-short-dual-label{align-items:center;color:var(--muted);display:flex;font-size:9px;justify-content:space-between;margin:12px 0 5px}.yt-short-dual-label strong{color:var(--ink-2);font-size:10px;font-weight:650;text-transform:uppercase}
  .yt-short-volume{align-items:end;display:flex;gap:2px;height:64px}.yt-short-volume-col{align-items:end;display:flex;flex:1 1 4px;height:100%;min-width:2px}.yt-short-volume-col i{background:var(--ink-2);border-radius:2px 2px 0 0;display:block;opacity:.72;width:100%}

  .yt-short-compare-summary{align-items:baseline;display:flex;gap:10px;margin:-4px 0 18px}.yt-short-compare-summary>strong{color:var(--accent-text);font-size:34px;letter-spacing:-.04em}.yt-short-compare-summary small{font-size:14px;margin-left:2px}.yt-short-compare-summary>span{color:var(--muted);font-size:11px}
  .yt-short-compare{display:grid;gap:14px;grid-template-columns:1fr}.yt-short-compare-card{background:var(--raised);border:1px solid var(--line);border-radius:12px;padding:16px}
  .yt-short-compare-head{align-items:start;display:flex;justify-content:space-between}.yt-short-compare-head span strong,.yt-short-compare-head span small{display:block}.yt-short-compare-head span strong{font-size:13px}.yt-short-compare-head span small{color:var(--muted);font-size:10px;margin-top:3px}.yt-short-compare-head>b{font-size:28px;letter-spacing:-.04em}
  .yt-short-compare-track{background:var(--surface);border-radius:999px;height:12px;margin:16px 0 8px;overflow:hidden}.yt-short-compare-track i{background:var(--accent);border-radius:999px;display:block;height:100%}
  .yt-short-compare-meta{color:var(--muted);display:flex;font-size:10px;justify-content:space-between}

  .yt-short-heat-wrap{overflow-x:auto;padding-bottom:5px}.yt-short-heat-head,.yt-short-heat{display:grid;gap:5px;grid-template-columns:52px repeat(12,minmax(42px,1fr));min-width:680px}.yt-short-heat-head{color:var(--muted);font-size:9px;margin-bottom:5px;text-align:center}.yt-short-heat-head>span:first-child{text-align:left}
  .yt-short-heat-year{align-self:center;color:var(--ink-2);font-size:11px;font-variant-numeric:tabular-nums}.yt-short-heat-cell,.yt-short-heat-empty{align-items:baseline;aspect-ratio:1.45;border-radius:6px;display:flex;justify-content:center;place-self:stretch}.yt-short-heat-cell{background:rgba(230,103,103,var(--heat));color:#fff;padding-top:9px;text-shadow:0 1px 2px rgba(0,0,0,.35)}.yt-short-heat-cell strong{font-size:12px}.yt-short-heat-cell small{font-size:8px}.yt-short-heat-empty{background:var(--raised);opacity:.35}
  .yt-short-heat-scale{align-items:center;color:var(--muted);display:flex;font-size:9px;gap:8px;justify-content:flex-end;margin-top:8px}.yt-short-heat-scale i{background:linear-gradient(90deg,rgba(230,103,103,.12),rgba(230,103,103,.95));border-radius:999px;height:7px;width:110px}

  .yt-chase-controls{align-items:center;display:grid;gap:12px;grid-template-columns:34px 92px minmax(0,1fr);margin-bottom:18px}
  .yt-chase-controls button{align-items:center;background:var(--raised);border:1px solid var(--line-strong);border-radius:50%;color:var(--ink);cursor:pointer;display:flex;font-size:11px;height:34px;justify-content:center;padding:0;width:34px}
  .yt-chase-controls button:hover{border-color:var(--muted)}
  .yt-chase-controls input{accent-color:var(--accent);width:100%}
  .yt-chase-period{color:var(--ink-2);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
  .yt-chase-rows{overflow:hidden;position:relative}
  .yt-chase-row{align-items:center;display:grid;gap:10px;grid-template-columns:32px minmax(0,1fr) 62px;left:0;position:absolute;right:0;top:0;transition:opacity .45s ease,transform .45s ease}
  .yt-chase-row img,.yt-chase-row .yt-channel-avatar{flex-basis:32px;height:32px;width:32px}
  .yt-chase-copy{min-width:0}
  .yt-chase-label{display:flex;font-size:12px;justify-content:space-between;margin-bottom:4px}
  .yt-chase-label strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .yt-chase-track{background:var(--raised);border-radius:999px;height:7px;overflow:hidden}
  .yt-chase-track i{background:var(--accent);border-radius:999px;display:block;height:100%;transform:scaleX(var(--share));transform-origin:left;transition:transform .4s ease;width:100%}
  .yt-chase-value{color:var(--ink-2);font-size:11px;font-variant-numeric:tabular-nums;text-align:right}

  .yt-taxonomy{display:block}.yt-taxonomy>section{margin-top:18px}
  .yt-topic-list{display:flex;flex-wrap:wrap;gap:8px}
  .yt-topic{background:var(--raised);border:1px solid var(--line);border-radius:10px;padding:9px 12px}
  .yt-topic strong{display:block;font-size:12px}
  .yt-topic span{color:var(--muted);font-size:10px}
  .yt-keywords{align-content:center;align-items:center;display:flex;flex-wrap:wrap;gap:8px 14px;justify-content:center;min-height:190px;padding:8px}
  .yt-keywords a{color:var(--cloud-color);font-size:var(--cloud-size);font-weight:650;line-height:1;text-decoration:none}
  .yt-keywords a:hover{color:var(--accent-text)}

  .yt-recent{display:grid;gap:0;grid-template-columns:1fr}
  .yt-video{border-bottom:1px solid var(--line);color:inherit;display:grid;gap:14px;grid-template-columns:minmax(120px,190px) minmax(0,1fr);min-width:0;padding:12px 0;text-decoration:none}.yt-video:last-child{border-bottom:0}
  .yt-video-media{aspect-ratio:16/9;background:var(--raised);border-radius:10px;display:block;overflow:hidden;position:relative;width:100%}
  .yt-video img,.yt-video-placeholder{display:block;height:100%;object-fit:cover;transition:transform .25s ease;width:100%}
  .yt-video:hover img{transform:scale(1.045)}
  .yt-video-length{background:rgba(0,0,0,.78);border-radius:5px;bottom:6px;color:#fff;font-size:10px;font-variant-numeric:tabular-nums;font-weight:600;padding:2px 5px;position:absolute;right:6px}
  .yt-video-copy{align-self:center;min-width:0}.yt-video h3{font-size:13px;line-height:1.35;margin:0 0 4px}
  .yt-video:hover h3{color:var(--accent-text)}
  .yt-video p{color:var(--muted);font-size:11px;line-height:1.4;margin:0}
  .yt-video .yt-video-when{color:var(--muted);font-size:10.5px;margin-top:2px;opacity:.8}

  .yt-history-day{border-top:1px solid var(--line);padding-top:16px}.yt-history-day:first-child{border-top:0;padding-top:0}.yt-history-day>h2{color:var(--ink-2);font-size:12px;font-variant-numeric:tabular-nums;letter-spacing:.04em;margin:0 0 6px}.yt-history-day-rows{display:grid;gap:0;grid-template-columns:1fr}
  .yt-history-row{align-items:center;border-bottom:1px solid var(--line);color:inherit;display:grid;gap:14px;grid-template-columns:90px minmax(0,1fr) auto;padding:10px 0;text-decoration:none}.yt-history-row:last-child{border-bottom:0}.yt-history-row img,.yt-history-placeholder{aspect-ratio:16/9;background:var(--raised);border-radius:7px;height:auto;object-fit:cover;width:90px}.yt-history-copy{min-width:0}.yt-history-copy strong,.yt-history-copy span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.yt-history-copy strong{font-size:12px}.yt-history-copy span,.yt-history-when{color:var(--muted);font-size:10px}.yt-history-when{font-variant-numeric:tabular-nums;white-space:nowrap}
  .yt-private-note{text-align:center}.yt-private-note p{color:var(--ink-2);margin:0 auto;max-width:560px}
  .yt-recap-intro{padding:34px 28px}.yt-recap-intro h2{font-size:clamp(30px,5vw,54px);letter-spacing:-.045em;line-height:1.02;margin:5px 0 10px}.yt-recap-intro p{color:var(--ink-2);margin:0}
  .yt-recap-chapter{padding:30px 28px}.yt-recap-figure>strong{display:block;font-size:clamp(30px,5vw,58px);letter-spacing:-.04em;line-height:1;margin:8px 0 12px}.yt-recap-copy{align-self:center}.yt-recap-chapter h2{font-size:17px;margin:0 0 7px}.yt-recap-chapter p{color:var(--ink-2);font-size:14px;margin:0;max-width:720px}.yt-recap-chapter a{color:inherit;text-decoration:none}.yt-recap-chapter a:hover{color:var(--accent-text)}
  @media(min-width:900px){
    .yt-hero{align-items:center;display:grid;gap:22px 42px;grid-template-columns:minmax(250px,.72fr) minmax(0,1.28fr)}
    .yt-hero-stats{border-left:1px solid var(--line);border-top:0;margin-top:0;padding:4px 0 4px 34px}
    .yt-hero-foot{grid-column:1/-1;margin-top:0}
    .yt-rhythm-clocks{display:grid;gap:34px;grid-template-columns:repeat(2,minmax(0,1fr));max-width:none}
    .yt-rhythm-clock svg{max-width:430px}
    .yt-channels,.yt-top-videos,.yt-recent{column-gap:28px;grid-template-columns:repeat(2,minmax(0,1fr))}
    .yt-short-compare{grid-template-columns:repeat(2,minmax(0,1fr))}
    .yt-mix{column-gap:36px;grid-template-columns:repeat(2,minmax(0,1fr))}
    .yt-history-day-rows{column-gap:28px;grid-template-columns:repeat(2,minmax(0,1fr))}
    .yt-recap-intro{align-items:end;display:grid;gap:8px 42px;grid-template-columns:minmax(260px,.8fr) minmax(0,1.2fr)}
    .yt-recap-intro .eyebrow{grid-column:1/-1}.yt-recap-intro h2{margin:0}.yt-recap-intro p{padding-bottom:5px}
    .yt-recap-chapter{align-items:center;display:grid;gap:28px 48px;grid-template-columns:minmax(260px,.8fr) minmax(0,1.2fr)}
  }
  @media(max-width:560px){.yt-hero{padding:20px}.yt-channel-row{grid-template-columns:14px 30px minmax(0,1fr) 84px}.yt-channel-row img,.yt-channel-avatar{flex-basis:30px;height:30px;width:30px}.yt-video{grid-template-columns:110px minmax(0,1fr)}.yt-history-row{grid-template-columns:72px minmax(0,1fr)}.yt-history-row img,.yt-history-placeholder{width:72px}.yt-history-when{display:none}}
`;

// Ordinal ramp for the length buckets (short → long, light → dark), validated
// with the dataviz --ordinal checks on the dark surface. Unknown wears gray.
const LENGTH_RAMP: Record<string, string> = {
  '< 1 min': '#f2b3b3',
  '1-5 min': '#ee8a8a',
  '5-20 min': '#e66767',
  '20-60 min': '#d03b3b',
  '60+ min': '#a92f2f',
  Unknown: '#55534e',
};

function taipeiDateLabel(iso: string, lang: Lang): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-TW' : 'en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  }).format(date);
}

function taipeiTimeLabel(iso: string, lang: Lang): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-TW' : 'en-US', {
    timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function recentSection(data: YoutubeDashboardData, t: Messages, lang: Lang, showRecent: boolean): string {
  if (!showRecent || !data.recent.length) return '';
  const rows = data.recent.map((video) => `<a class="yt-video" href="${html(video.url)}">
    <span class="yt-video-media">${video.thumbnailUrl ? `<img src="${html(video.thumbnailUrl)}" alt="" loading="lazy">` : '<span class="yt-video-placeholder"></span>'}${video.durationSeconds === null ? '' : `<span class="yt-video-length">${duration(video.durationSeconds, lang)}</span>`}</span>
    <span class="yt-video-copy"><h3>${html(video.title)}</h3><p>${html(video.channelTitle)}${video.watchCount > 1 ? ` · ${t.plays(video.watchCount)}` : ''}</p><p class="yt-video-when">${timeAgo(video.watchedAt, lang)}</p></span></a>`).join('');
  return `<section class="section"><div class="section-head"><h2>${t.recent}</h2><span>${t.recentSub(data.recent.length)}</span></div><div class="yt-recent">${rows}</div></section>`;
}

function historySection(
  history: YoutubeRecentVideo[] | undefined,
  data: YoutubeDashboardData,
  t: Messages,
  lang: Lang,
  showRecent: boolean,
): string {
  if (!showRecent) return `<section class="section yt-private-note"><div class="section-head"><h2>${t.historyTitle}</h2></div><p>${t.historyPrivate}</p></section>`;
  if (!history?.length) return `<section class="section yt-private-note"><div class="section-head"><h2>${t.historyTitle}</h2></div><p>${t.historyEmpty}</p></section>`;
  const groups = new Map<string, YoutubeRecentVideo[]>();
  for (const row of history) {
    const day = taipeiDateLabel(row.watchedAt, lang);
    const entries = groups.get(day) ?? [];
    entries.push(row);
    groups.set(day, entries);
  }
  const days = [...groups].map(([day, entries]) => `<div class="yt-history-day"><h2>${html(day)}</h2><div class="yt-history-day-rows">${entries.map((video) => `<a class="yt-history-row" href="${html(video.url)}">
    ${video.thumbnailUrl ? `<img src="${html(video.thumbnailUrl)}" alt="" loading="lazy">` : '<span class="yt-history-placeholder"></span>'}
    <span class="yt-history-copy"><strong>${html(video.title)}</strong><span>${html(video.channelTitle)}</span></span>
    <time class="yt-history-when" datetime="${html(video.watchedAt)}">${html(taipeiTimeLabel(video.watchedAt, lang))}</time>
  </a>`).join('')}</div></div>`).join('');
  return `<section class="section"><div class="section-head"><h2>${t.historyTitle}</h2><span>${t.historySub(history.length, t.ranges[data.range])}</span></div>${days}</section>`;
}

function recapSection(data: YoutubeDashboardData, t: Messages): string {
  if (!data.stats.watchEvents) return `<section class="section yt-private-note"><div class="section-head"><h2>${t.recapTitle}</h2></div><p>${t.recapEmpty}</p></section>`;
  const activeDays = data.daily.filter((day) => day.watches > 0);
  const peakDay = [...activeDays].sort((a, b) => b.estimatedWatchSeconds - a.estimatedWatchSeconds)[0];
  const topChannel = [...data.topChannels].sort((a, b) => b.estimatedWatchSeconds - a.estimatedWatchSeconds)[0];
  const topVideo = [...data.topVideos].sort((a, b) => b.watches - a.watches || b.estimatedWatchSeconds - a.estimatedWatchSeconds)[0];
  const rhythmReliable = data.rhythmCoverage.dateOnlyWatches === 0
    || data.rhythmCoverage.exactWatches > data.rhythmCoverage.dateOnlyWatches;
  const peakHour = rhythmReliable
    ? [...data.hourly].sort((a, b) => b.estimatedWatchSeconds - a.estimatedWatchSeconds)[0]
    : undefined;
  const shortSeconds = data.shortFormDaily.reduce((sum, day) => sum + day.shortWatchSeconds, 0);
  const knownSeconds = data.shortFormDaily.reduce((sum, day) => sum + day.knownDurationWatchSeconds, 0);
  const chapter = (eyebrow: string, figure: string, title: string, copy: string) => `<section class="section yt-recap-chapter"><div class="yt-recap-figure"><div class="eyebrow">${html(eyebrow)}</div><strong>${html(figure)}</strong></div><div class="yt-recap-copy"><h2>${html(title)}</h2><p>${html(copy)}</p></div></section>`;
  const chapters = [
    chapter(t.heroHoursUnit, hours(data.stats.estimatedWatchSeconds), t.recapTotalTitle,
      t.recapTotalCopy(hours(data.stats.estimatedWatchSeconds), data.stats.watchEvents, activeDays.length)),
    peakDay ? chapter(t.colDay, peakDay.day, t.recapPeakTitle, t.recapPeakCopy(peakDay.day, hours(peakDay.estimatedWatchSeconds))) : '',
    topChannel ? chapter(t.topChannels, topChannel.name, t.recapChannelTitle,
      t.recapChannelCopy(topChannel.name, hours(topChannel.estimatedWatchSeconds), topChannel.watches)) : '',
    topVideo ? chapter(t.topVideos, `${topVideo.watches}×`, t.recapVideoTitle,
      t.recapVideoCopy(topVideo.title, hours(topVideo.estimatedWatchSeconds), topVideo.watches)) : '',
    peakHour ? chapter(t.rhythm, t.hourRange(peakHour.hour), t.recapRhythmTitle,
      t.recapRhythmCopy(t.hourRange(peakHour.hour), hours(peakHour.estimatedWatchSeconds))) : '',
    knownSeconds ? chapter(t.shortForm, `${Math.round(shortSeconds / knownSeconds * 100)}%`, t.recapShortTitle,
      t.recapShortCopy(Math.round(shortSeconds / knownSeconds * 100), hours(shortSeconds), hours(knownSeconds))) : '',
  ].join('');
  return `<section class="card yt-recap-intro"><div class="eyebrow">${t.navRecap}</div><h2>${t.recapTitle}</h2><p>${t.recapSub(t.ranges[data.range])}</p></section>${chapters}`;
}

export type YoutubeDashboardPageKind = 'overview' | 'insights' | 'history' | 'recap';

export interface YoutubeDashboardOptions {
  // Path the dashboard is served under; range/sort links stay on it.
  basePath?: string;
  nav?: ShellNavItem[];
  // Extra HTML (e.g. onboarding instructions) rendered above the dashboard.
  setupHtml?: string;
  lang?: Lang;
  // Individual watch rows are private detail, not aggregate dashboard data.
  showRecent?: boolean;
  // Local design-review variants for the short-form visualization.
  shortFormVariant?: ShortFormVariant;
  page?: YoutubeDashboardPageKind;
  // Stable root for switching between the four profile pages.
  profilePath?: string;
  // Private raw watch events, provided only to authorized History viewers.
  history?: YoutubeRecentVideo[];
  // Background-processing notice, rendered above every profile page while
  // the worker still owes this archive metadata or topics. Its presence also
  // marks the headline figure as provisional.
  processingHtml?: string;
  // Insight-only content computed outside the dashboard aggregate cache.
  insightsHtml?: string;
  // Public examples must not imply that their current dashboard is private.
  dashboardPrivate?: boolean;
}

export function youtubeDashboardPage(
  ownerName: string,
  data: YoutubeDashboardData,
  sort: 'watches' | 'duration' = 'duration',
  options: YoutubeDashboardOptions = {},
): string {
  const lang = options.lang ?? 'en';
  const t = messages(lang);
  const basePath = options.basePath ?? '/youtube';
  const profilePath = options.profilePath ?? basePath;
  const page = options.page ?? 'overview';
  const rangeNav = `<nav class="yt-range" aria-label="Time range">${YOUTUBE_RANGES.map((range) =>
    `<a href="${basePath}?range=${range}&sort=${sort}"${range === data.range ? ' aria-current="page"' : ''}>${t.ranges[range]}</a>`
  ).join('')}</nav>`;
  const importLabels = JSON.stringify({
    now: t.syncNow, cancel: t.syncCancel, last: t.syncLast, failed: t.syncFailed,
    ready: t.syncReady, events: t.syncEvents, rows: t.syncRows,
  }).replace(/</g, '\\u003c');
  const importControl = `<div class="yt-import-control" data-youtube-import-control hidden>
    <button type="button">${t.syncNow}</button><span aria-live="polite"></span>
  </div><script>(()=>{const c=document.querySelector('[data-youtube-import-control]');if(!c)return;const L=${importLabels};const b=c.querySelector('button');const s=c.querySelector('span');let state='idle';window.addEventListener('urtube-youtube-import-status',()=>{let value={};try{value=JSON.parse(c.dataset.extensionStatus||'{}')}catch{}if(!value.extensionReady)return;c.hidden=false;state=value.state||'idle';const running=state==='running';b.disabled=false;b.textContent=running?L.cancel:L.now;if(running){s.textContent=value.stage==='activity'?(value.events+' '+L.events):(value.videos+' '+L.rows)}else if(state==='complete'&&value.lastSuccessAt){s.textContent=L.last+' '+new Date(value.lastSuccessAt).toLocaleString()}else if(state==='error'){s.textContent=value.lastError||L.failed}else{s.textContent=L.ready}},{signal:window.urtubePageController.signal});b.addEventListener('click',()=>{b.disabled=true;c.dataset.importAction=state==='running'?'cancel':'start';window.dispatchEvent(new Event('urtube-youtube-import-request'));},{signal:window.urtubePageController.signal});})();</script>`;
  const heroHours = data.stats.estimatedWatchSeconds === null ? null : Math.round(data.stats.estimatedWatchSeconds / 3600);
  const hero = `<section class="card yt-hero">
    <div class="yt-hero-figure">
      <strong>${heroHours === null ? '—' : new Intl.NumberFormat('en').format(heroHours)}<em>${t.heroHoursUnit}</em></strong>
      <span>${t.heroSub(t.ranges[data.range])}${options.processingHtml ? `<span class="yt-provisional">${t.provisional}</span>` : ''}</span>
    </div>
    <div class="yt-hero-stats">
      <div class="yt-stat"><strong>${compact(data.stats.watchEvents)}</strong><span>${t.statWatchEvents}</span></div>
      <div class="yt-stat"><strong>${compact(data.stats.uniqueVideos)}</strong><span>${t.statVideos}</span></div>
      <div class="yt-stat"><strong>${compact(data.stats.uniqueChannels)}</strong><span>${t.statChannels}</span></div>
      <div class="yt-stat"><strong>${Math.round(data.stats.topicCoverage * 100)}%</strong><span>${t.statTopicCoverage}</span></div>
      <div class="yt-stat"><strong>${hours(data.stats.actualWatchedSeconds)}</strong><span>${t.statMeasured}</span></div>
    </div>
    <div class="yt-hero-foot">${t.heroFoot(Math.round(data.stats.metadataCoverage * 100), Math.round(data.stats.progressCoverage * 100))}</div>
  </section>`;
  const channels = [...data.topChannels].sort((a, b) =>
    sort === 'duration'
      ? b.estimatedWatchSeconds - a.estimatedWatchSeconds || b.watches - a.watches
      : b.watches - a.watches || b.estimatedWatchSeconds - a.estimatedWatchSeconds
  );
  const maxChannel = Math.max(1, ...channels.slice(0, 12).map((channel) =>
    sort === 'duration' ? channel.estimatedWatchSeconds : channel.watches));
  const sortLinks = `<span class="yt-sort"><a data-youtube-sort="watches" href="${basePath}?range=${data.range}&sort=watches"${sort === 'watches' ? ' aria-current="page"' : ''}>${t.sortPlays}</a> · <a data-youtube-sort="duration" href="${basePath}?range=${data.range}&sort=duration"${sort === 'duration' ? ' aria-current="page"' : ''}>${t.sortTime}</a></span>`;
  const channelList = `<section class="section"><div class="section-head"><h2>${t.topChannels}</h2>${sortLinks}</div>
    <div class="yt-channels" data-youtube-sort-list="channels">${channels.map((channel, index) => {
      const metric = sort === 'duration' ? channel.estimatedWatchSeconds : channel.watches;
      return `<div class="yt-channel-row" data-watches="${channel.watches}" data-duration="${channel.estimatedWatchSeconds}"${index >= 12 ? ' hidden' : ''}>
        <span class="yt-channel-rank">${index + 1}</span>
        ${channelAvatar(channel)}
        <div class="yt-channel-main">
          <span class="yt-channel-name">${channel.channelId ? `<a href="/channel/${html(channel.channelId)}">${html(channel.name)}</a>` : html(channel.name)}</span>
          <div class="yt-channel-track"><i style="width:${Math.max(1, Math.round(metric / maxChannel * 100))}%"></i></div>
        </div>
        <div class="yt-channel-nums"><strong>${hours(channel.estimatedWatchSeconds)}</strong><span>${t.plays(channel.watches)}</span></div>
      </div>`;
    }).join('')}</div></section>`;
  const videos = [...data.topVideos].sort((a, b) =>
    sort === 'duration'
      ? b.estimatedWatchSeconds - a.estimatedWatchSeconds || b.watches - a.watches
      : b.watches - a.watches || b.estimatedWatchSeconds - a.estimatedWatchSeconds
  );
  const topVideos = videos.length ? `<section class="section"><div class="section-head"><h2>${t.topVideos}</h2>${sortLinks}</div>
    <div class="yt-top-videos" data-youtube-sort-list="videos">${videos.map((video, index) => `<a class="yt-top-video" href="${html(video.url)}" data-watches="${video.watches}" data-duration="${video.estimatedWatchSeconds}"${index >= 12 ? ' hidden' : ''}>
      <span class="yt-channel-rank">${index + 1}</span>
      <span class="yt-top-video-media">${video.thumbnailUrl ? `<img src="${html(video.thumbnailUrl)}" alt="" loading="lazy">` : '<span class="yt-top-video-placeholder"></span>'}${video.durationSeconds === null ? '' : `<span class="yt-video-length">${duration(video.durationSeconds, lang)}</span>`}</span>
      <span class="yt-top-video-main"><strong>${html(video.title)}</strong><span>${html(video.channelTitle)}</span></span>
      <span class="yt-top-video-nums"><strong>${hours(video.estimatedWatchSeconds)}</strong><span>${t.plays(video.watches)}</span></span>
    </a>`).join('')}</div></section>` : '';
  const bucketOrder = ['< 1 min', '1-5 min', '5-20 min', '20-60 min', '60+ min', 'Unknown'];
  const orderedBuckets = [...data.lengthBuckets]
    .sort((a, b) => bucketOrder.indexOf(a.label) - bucketOrder.indexOf(b.label));
  const maxLength = Math.max(1, ...data.lengthBuckets.map((bucket) => bucket.videos));
  const distribution = `<section class="section"><div class="section-head"><h2>${t.lengthMix}</h2><span>${t.uniqueVideos}</span></div><div class="yt-mix">${orderedBuckets.map((bucket) =>
    `<div class="yt-mix-row"><span>${html(t.buckets[bucket.label] ?? bucket.label)}</span><div class="yt-mix-track"><i style="background:${LENGTH_RAMP[bucket.label] ?? '#55534e'};width:${Math.round(bucket.videos / maxLength * 100)}%"></i></div><span>${bucket.videos}</span></div>`
  ).join('')}</div></section>`;
  const maxKeywordScore = Math.max(0.001, ...data.keywords.map((item) => item.score));
  const trustedTopics = data.stats.topicCoverage >= PERSONAL_TAXONOMY_TRUSTED_COVERAGE;
  const localizedTopicName = (slug: string, fallback: string) => {
    const definition = PERSONAL_TOPICS.find((topic) => topic.slug === slug);
    return definition ? lang === 'zh' ? definition.nameZh : definition.name : fallback;
  };
  const topicCoverage = lang === 'zh'
    ? `已處理 ${Math.round(data.stats.topicProcessedCoverage * 100)}% · 有效 ${Math.round(data.stats.topicCoverage * 100)}% · Unknown ${Math.round(data.stats.topicUnknownCoverage * 100)}%`
    : `Processed ${Math.round(data.stats.topicProcessedCoverage * 100)}% · effective ${Math.round(data.stats.topicCoverage * 100)}% · Unknown ${Math.round(data.stats.topicUnknownCoverage * 100)}%`;
  const topicPending = lang === 'zh'
    ? '有效覆蓋未達 80%，暫不顯示主題排名。'
    : 'Effective coverage is below 80%, so topic ranking is hidden for now.';
  const taxonomy = `<div class="yt-taxonomy"><section class="section"><div class="section-head"><h2>${t.topics}</h2><span>${topicCoverage}</span></div>
    <div class="yt-topic-list">${trustedTopics && data.topics.length ? data.topics.map((topic) =>
      `<div class="yt-topic"><strong>${html(localizedTopicName(topic.slug, topic.name))}</strong><span>${t.topicMeta(topic.watches, hours(topic.estimatedWatchSeconds))}</span></div>`
    ).join('') : `<span class="muted">${topicPending}</span>`}</div></section>
    <section class="section"><div class="section-head"><h2>${t.keywords}</h2><span>${t.keywordsSub(data.keywordCoverage.sampledVideos, data.keywordCoverage.eligibleVideos)}</span></div>
    <div class="yt-keywords">${data.keywords.length ? data.keywords.map((keyword, index) => {
      // Size follows the commonness score; the tooltip states the distinct
      // video count, channel spread and which metadata sources contributed.
      const size = 12 + Math.round(Math.sqrt(keyword.score / maxKeywordScore) * 18);
      // Keywords are text, so they wear ink tokens; size carries the weight.
      const colors = ['#f4f2ee', '#b8b5ad', '#8a877f'];
      const query = encodeURIComponent(keyword.term);
      const tip = `${keyword.term} · ${t.keywordTip(keyword.channels, keyword.sources.title, keyword.sources.tag, keyword.sources.description)}`;
      return `<a href="https://www.youtube.com/results?search_query=${query}" data-tip="${t.tipVideos(keyword.videos)}" data-tip-label="${html(tip)}" style="--cloud-size:${size}px;--cloud-color:${colors[index % colors.length]}">${html(keyword.term)}</a>`;
    }).join('') : `<span class="muted">${t.keywordsEmpty}</span>`}</div></section></div>`;
  const pageLabels: Record<YoutubeDashboardPageKind, string> = {
    overview: t.navOverview, insights: t.navInsights, history: t.navHistory, recap: t.navRecap,
  };
  const pagePaths: Record<YoutubeDashboardPageKind, string> = {
    overview: profilePath,
    insights: `${profilePath}/insights`,
    history: `${profilePath}/history`,
    recap: `${profilePath}/recap`,
  };
  const pageNav = `<nav class="yt-page-nav" aria-label="YouTube profile">${(Object.keys(pagePaths) as YoutubeDashboardPageKind[]).map((key) =>
    `<a href="${html(pagePaths[key])}?range=${data.range}&sort=${sort}"${key === page ? ' aria-current="page"' : ''}>${html(pageLabels[key])}</a>`
  ).join('')}</nav>`;
  // Range and sort ride along in the title so every view is clearly named.
  const scope = page === 'overview'
    ? `${pageLabels[page]} · ${t.ranges[data.range]} · ${t.sortedBy(sort === 'watches' ? t.sortPlays : t.sortTime)}`
    : `${pageLabels[page]} · ${t.ranges[data.range]}`;
  const sortState = JSON.stringify({
    watches: {
      scope: `${pageLabels.overview} · ${t.ranges[data.range]} · ${t.sortedBy(t.sortPlays)}`,
      title: `${ownerName} · YouTube · ${pageLabels.overview} · ${t.ranges[data.range]} · ${t.sortedBy(t.sortPlays)} · urtube`,
    },
    duration: {
      scope: `${pageLabels.overview} · ${t.ranges[data.range]} · ${t.sortedBy(t.sortTime)}`,
      title: `${ownerName} · YouTube · ${pageLabels.overview} · ${t.ranges[data.range]} · ${t.sortedBy(t.sortTime)} · urtube`,
    },
  }).replace(/</g, '\\u003c');
  const sortScript = `<script>(()=>{const states=${sortState};const links=[...document.querySelectorAll('[data-youtube-sort]')];const lists=[...document.querySelectorAll('[data-youtube-sort-list]')];const scope=document.querySelector('[data-youtube-sort-scope]');const apply=(sort,write)=>{if(!states[sort])return;for(const list of lists){const items=[...list.children].sort((a,b)=>Number(b.dataset[sort])-Number(a.dataset[sort])||Number(b.dataset[sort==='watches'?'duration':'watches'])-Number(a.dataset[sort==='watches'?'duration':'watches']));items.forEach((item,index)=>{list.append(item);item.hidden=index>=12;const rank=item.querySelector('.yt-channel-rank');if(rank)rank.textContent=String(index+1)});if(list.dataset.youtubeSortList==='channels'){const shown=items.slice(0,12);const max=Math.max(1,...shown.map(item=>Number(item.dataset[sort])));shown.forEach(item=>{const bar=item.querySelector('.yt-channel-track i');if(bar)bar.style.width=Math.max(1,Math.round(Number(item.dataset[sort])/max*100))+'%'})}}for(const link of links){if(link.dataset.youtubeSort===sort)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current')}if(scope)scope.textContent=states[sort].scope;document.title=states[sort].title;if(write){const url=new URL(location.href);url.searchParams.set('sort',sort);history.pushState({youtubeSort:sort},'',url);dispatchEvent(new Event('urtube:query-updated'))}};for(const link of links)link.addEventListener('click',event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();apply(link.dataset.youtubeSort,true)});addEventListener('urtube:sort',event=>apply(event.detail,false),{signal:window.urtubePageController.signal});})();</script>`;
  const intro = `<style>${dashboardStyles}${topicTrendStyles}${processingStyles}</style><section class="yt-profile">
    <img class="yt-avatar" src="${html(`/avatar${options.profilePath}`)}" alt="" width="70" height="70">
    <div class="yt-profile-copy"><div class="eyebrow">${t.eyebrowArchive}</div>
    <h1>${html(ownerName)}<em class="h1-scope" data-youtube-sort-scope>${scope}</em></h1>
    <div class="yt-profile-meta"><a href="/">${t.home}</a></div></div></section>`;
  const showRecent = options.showRecent !== false;
  const overview = hero + (options.setupHtml ?? '') + recentSection(data, t, lang, showRecent)
    + channelList + topVideos + sortScript;
  const insights = page === 'insights' ? rhythmSection(data, t) + shortFormSection(data, t, options.shortFormVariant)
    + topicTrendSection(data, t) + channelChase(data, t) + (options.insightsHtml ?? '')
    + distribution + taxonomy : '';
  const history = historySection(options.history, data, t, lang, showRecent);
  const recap = recapSection(data, t);
  const insightTrust = page === 'insights' && options.dashboardPrivate
    ? trustSignals([t.trustPrivateDefault], t.trustSignalsLabel)
    : '';
  const content = (options.processingHtml ?? '') + (page === 'overview' ? importControl + overview
    : page === 'insights' ? insightTrust + insights
      : page === 'history' ? history : recap);
  return shell(`${ownerName} · YouTube · ${scope}`, intro + pageNav + rangeNav + content,
    options.nav ?? [], '', lang, basePath);
}
