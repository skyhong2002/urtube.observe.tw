import type { YoutubeDailySummary, YoutubeDashboardData, YoutubeRange } from '../youtube/types.js';
import { duration, hours, html, shell, type ShellNavItem } from './pages.js';

function compact(value: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function rangeLabel(range: YoutubeRange): string {
  return range === 'all' ? 'All time' : `Last ${range.replace('d', ' days')}`;
}

function channelAvatar(channel: { name: string; thumbnailUrl: string }): string {
  return channel.thumbnailUrl
    ? `<img src="${html(channel.thumbnailUrl)}" alt="" loading="lazy">`
    : `<span class="yt-channel-avatar" aria-hidden="true">${html([...channel.name][0] ?? '?')}</span>`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface RhythmBar {
  label: string;
  key: string;
  watches: number;
  estimatedWatchSeconds: number;
}

// Zero-filled rhythm series: every day between the first and last active day
// exists, so quiet stretches are visible instead of silently collapsed. Long
// spans fold to months to keep one bar ≥ a few pixels wide.
function rhythmBars(daily: YoutubeDailySummary[]): { bars: RhythmBar[]; unit: 'day' | 'month' } {
  if (!daily.length) return { bars: [], unit: 'day' };
  const byDay = new Map(daily.map((entry) => [entry.day, entry]));
  const first = new Date(`${daily[0].day}T00:00:00Z`);
  const last = new Date(`${daily[daily.length - 1].day}T00:00:00Z`);
  const spanDays = Math.round((last.getTime() - first.getTime()) / 86400_000) + 1;
  if (spanDays > 200) {
    const months = new Map<string, RhythmBar>();
    for (let t = new Date(first); t <= last; t.setUTCMonth(t.getUTCMonth() + 1)) {
      const key = t.toISOString().slice(0, 7);
      months.set(key, {
        key,
        label: `${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`,
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
  for (let t = new Date(first); t <= last; t.setUTCDate(t.getUTCDate() + 1)) {
    const key = t.toISOString().slice(0, 10);
    const entry = byDay.get(key);
    bars.push({
      key,
      label: `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}`,
      watches: entry?.watches ?? 0,
      estimatedWatchSeconds: entry?.estimatedWatchSeconds ?? 0,
    });
  }
  return { bars, unit: 'day' };
}

function rhythmSection(data: YoutubeDashboardData): string {
  const { bars, unit } = rhythmBars(data.daily);
  if (!bars.length) return '';
  const max = Math.max(1, ...bars.map((bar) => bar.watches));
  const peak = bars.reduce((a, b) => (b.watches > a.watches ? b : a));
  // Month (or year) ticks along the baseline, at the bar where the period turns.
  const ticks: string[] = [];
  let lastTick = '';
  bars.forEach((bar, index) => {
    const tick = unit === 'day' ? bar.key.slice(0, 7) : bar.key.slice(0, 4);
    if (tick !== lastTick) {
      lastTick = tick;
      const label = unit === 'day'
        ? MONTHS[Number(bar.key.slice(5, 7)) - 1]
        : bar.key.slice(0, 4);
      ticks.push(`<span style="left:${(index / bars.length * 100).toFixed(2)}%">${label}</span>`);
    }
  });
  const columns = bars.map((bar) => {
    const tip = `${bar.watches} video${bar.watches === 1 ? '' : 's'} · ${hours(bar.estimatedWatchSeconds)}`;
    return `<div class="yt-rhythm-col" data-tip="${html(bar.label)}" data-tip-label="${html(tip)}"><i style="height:${(bar.watches / max * 100).toFixed(1)}%"></i></div>`;
  }).join('');
  const tableRows = bars.filter((bar) => bar.watches > 0).map((bar) =>
    `<tr><td>${html(bar.label)}</td><td>${bar.watches}</td><td>${hours(bar.estimatedWatchSeconds)}</td></tr>`
  ).join('');
  return `<section class="section"><div class="section-head"><h2>Rhythm</h2>
    <span>videos per ${unit} · peak ${peak.watches} on ${html(peak.label)}</span></div>
    <div class="yt-rhythm" role="img" aria-label="Videos watched per ${unit}">${columns}</div>
    <div class="yt-rhythm-axis">${ticks.join('')}</div>
    <details class="viz-table"><summary>Table view</summary><table>
      <thead><tr><th>${unit === 'day' ? 'Day' : 'Month'}</th><th>Videos</th><th>Est. time</th></tr></thead>
      <tbody>${tableRows}</tbody></table></details>
  </section>`;
}

function channelChase(data: YoutubeDashboardData): string {
  if (!data.channelTrend.length) return '';
  const frames = JSON.stringify(data.channelTrend).replace(/</g, '\\u003c');
  const latest = data.channelTrend.at(-1)!;
  const max = Math.max(1, ...latest.channels.map((channel) => channel.estimatedWatchSeconds));
  const rows = latest.channels.map((channel) => `<div class="yt-chase-row">
    ${channelAvatar(channel)}
    <div class="yt-chase-copy"><div class="yt-chase-label"><strong>${html(channel.name)}</strong></div>
      <div class="yt-chase-track"><i style="--share:${Math.round(channel.estimatedWatchSeconds / max * 100)}%"></i></div></div>
    <span class="yt-chase-value">${hours(channel.estimatedWatchSeconds)}</span>
  </div>`).join('');
  return `<section class="section"><div class="section-head"><h2>Channel momentum</h2><span>cumulative estimated time</span></div>
    <div class="yt-chase">
      <div class="yt-chase-controls">
        <button type="button" data-chase-play aria-label="Play channel history" title="Play channel history">▶</button>
        <strong class="yt-chase-period" data-chase-period>${html(latest.period)}</strong>
        <input type="range" min="0" max="${data.channelTrend.length - 1}" value="${data.channelTrend.length - 1}" aria-label="Channel history period" data-chase-range>
      </div>
      <div class="yt-chase-rows" data-chase-rows>${rows}</div>
    </div>
    <script type="application/json" data-chase-data>${frames}</script>
    <script>
      (() => {
        const root = document.currentScript?.closest('section');
        if (!root) return;
        const frames = JSON.parse(root.querySelector('[data-chase-data]').textContent || '[]');
        const rows = root.querySelector('[data-chase-rows]');
        const range = root.querySelector('[data-chase-range]');
        const period = root.querySelector('[data-chase-period]');
        const play = root.querySelector('[data-chase-play]');
        let timer = null;
        const formatHours = (seconds) => (Math.round(seconds / 360) / 10) + 'h';
        const avatar = (channel) => {
          if (channel.thumbnailUrl) {
            const image = document.createElement('img');
            image.src = channel.thumbnailUrl;
            image.alt = '';
            return image;
          }
          const fallback = document.createElement('span');
          fallback.className = 'yt-channel-avatar';
          fallback.setAttribute('aria-hidden', 'true');
          fallback.textContent = Array.from(channel.name)[0] || '?';
          return fallback;
        };
        const render = (index) => {
          const frame = frames[index];
          if (!frame) return;
          const max = Math.max(1, ...frame.channels.map((channel) => channel.estimatedWatchSeconds));
          rows.replaceChildren(...frame.channels.map((channel) => {
            const row = document.createElement('div');
            row.className = 'yt-chase-row';
            row.append(avatar(channel));
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
            bar.style.setProperty('--share', Math.round(channel.estimatedWatchSeconds / max * 100) + '%');
            track.append(bar);
            copy.append(label, track);
            const value = document.createElement('span');
            value.className = 'yt-chase-value';
            value.textContent = formatHours(channel.estimatedWatchSeconds);
            row.append(copy, value);
            return row;
          }));
          period.textContent = frame.period;
          range.value = String(index);
        };
        const stop = () => {
          if (timer !== null) window.clearInterval(timer);
          timer = null;
          play.textContent = '▶';
          play.setAttribute('aria-label', 'Play channel history');
          play.title = 'Play channel history';
        };
        range.addEventListener('input', () => {
          stop();
          render(Number(range.value));
        });
        play.addEventListener('click', () => {
          if (timer !== null) return stop();
          if (Number(range.value) >= frames.length - 1) render(0);
          play.textContent = '❚❚';
          play.setAttribute('aria-label', 'Pause channel history');
          play.title = 'Pause channel history';
          timer = window.setInterval(() => {
            const next = Number(range.value) + 1;
            if (next >= frames.length) return stop();
            render(next);
          }, 650);
        });
      })();
    </script>
  </section>`;
}

const dashboardStyles = `
  .yt-profile{align-items:center;display:flex;gap:18px;margin:14px 0 22px}
  .yt-avatar{align-items:center;background:linear-gradient(140deg,#e66767,#a92f2f);border-radius:50%;color:#fff;display:flex;flex:0 0 70px;font-size:30px;font-weight:800;height:70px;justify-content:center;width:70px}
  .yt-profile-copy h1{font-size:clamp(28px,4vw,40px);letter-spacing:-.03em;line-height:1.05;margin:2px 0 4px}
  .yt-profile-meta{color:var(--muted);font-size:12px}.yt-profile-meta a{color:var(--ink-2)}

  .yt-range{display:flex;gap:6px;margin-bottom:18px;overflow-x:auto;padding:2px 0}
  .yt-range a{background:var(--surface);border:1px solid var(--line);border-radius:999px;color:var(--ink-2);font-size:12px;font-weight:600;padding:7px 14px;text-decoration:none;white-space:nowrap}
  .yt-range a:hover{border-color:var(--line-strong);color:var(--ink)}
  .yt-range a[aria-current=page]{background:var(--accent);border-color:var(--accent);color:#fff}

  .yt-import-control{align-items:center;display:flex;gap:12px;margin:0 0 18px}.yt-import-control[hidden]{display:none}
  .yt-import-control button{background:var(--raised);border:1px solid var(--line-strong);border-radius:999px;color:var(--ink);cursor:pointer;font:inherit;font-size:12px;font-weight:600;padding:7px 14px}
  .yt-import-control button:hover{border-color:var(--muted)}.yt-import-control button:disabled{cursor:wait;opacity:.6}
  .yt-import-control span{color:var(--muted);font-size:11px}

  .yt-hero{align-items:end;display:grid;gap:26px;grid-template-columns:minmax(0,auto) minmax(0,1fr);padding:26px 28px}
  .yt-hero-figure strong{display:block;font-size:clamp(52px,7.5vw,84px);font-weight:750;letter-spacing:-.045em;line-height:.95}
  .yt-hero-figure strong em{color:var(--accent-text);font-size:.42em;font-style:normal;font-weight:700;letter-spacing:-.01em;margin-left:4px;vertical-align:.12em}
  .yt-hero-figure span{color:var(--ink-2);display:block;font-size:13px;margin-top:10px}
  .yt-hero-stats{display:grid;gap:10px 26px;grid-template-columns:repeat(auto-fit,minmax(118px,1fr))}
  .yt-stat strong{display:block;font-size:22px;font-weight:650;letter-spacing:-.02em}
  .yt-stat span{color:var(--muted);display:block;font-size:10px;font-weight:700;letter-spacing:.09em;margin-top:2px;text-transform:uppercase}
  .yt-hero-foot{border-top:1px solid var(--line);color:var(--muted);font-size:11px;grid-column:1/-1;margin-top:6px;padding-top:12px}

  .yt-rhythm{align-items:end;border-bottom:1px solid var(--line-strong);display:flex;height:150px}
  .yt-rhythm-col{align-items:end;display:flex;flex:1 0 3px;height:100%;justify-content:center;min-width:0;padding:0 1px}
  .yt-rhythm-col i{background:var(--accent);border-radius:3px 3px 0 0;display:block;max-width:22px;min-height:0;transition:background .15s;width:100%}
  .yt-rhythm-col:hover i{background:#e66767}
  .yt-rhythm-col i[style="height:0.0%"]{min-height:0}
  .yt-rhythm-axis{color:var(--muted);font-size:10px;height:18px;letter-spacing:.04em;margin-top:6px;position:relative;text-transform:uppercase}
  .yt-rhythm-axis span{position:absolute;top:0}

  .yt-columns{display:grid;gap:18px;grid-template-columns:minmax(0,1.3fr) minmax(260px,.7fr);margin-top:18px}
  .yt-columns>section{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:22px 24px}

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

  .yt-mix{display:grid;gap:11px}
  .yt-mix-row{align-items:center;display:grid;gap:10px;grid-template-columns:64px minmax(0,1fr) 44px}
  .yt-mix-row>span:first-child{color:var(--ink-2);font-size:12px}
  .yt-mix-row>span:last-child{color:var(--ink-2);font-size:12px;font-variant-numeric:tabular-nums;text-align:right}
  .yt-mix-track{background:var(--raised);border-radius:999px;height:8px}
  .yt-mix-track i{border-radius:999px 4px 4px 999px;display:block;height:100%;min-width:2px}

  .yt-chase-controls{align-items:center;display:grid;gap:12px;grid-template-columns:34px 92px minmax(0,1fr);margin-bottom:18px}
  .yt-chase-controls button{align-items:center;background:var(--raised);border:1px solid var(--line-strong);border-radius:50%;color:var(--ink);cursor:pointer;display:flex;font-size:11px;height:34px;justify-content:center;padding:0;width:34px}
  .yt-chase-controls button:hover{border-color:var(--muted)}
  .yt-chase-controls input{accent-color:var(--accent);width:100%}
  .yt-chase-period{color:var(--ink-2);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
  .yt-chase-rows{display:grid;gap:9px;min-height:280px}
  .yt-chase-row{align-items:center;display:grid;gap:10px;grid-template-columns:32px minmax(0,1fr) 62px}
  .yt-chase-row img,.yt-chase-row .yt-channel-avatar{flex-basis:32px;height:32px;width:32px}
  .yt-chase-copy{min-width:0}
  .yt-chase-label{display:flex;font-size:12px;justify-content:space-between;margin-bottom:4px}
  .yt-chase-label strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .yt-chase-track{background:var(--raised);border-radius:999px;height:7px;overflow:hidden}
  .yt-chase-track i{background:var(--accent);border-radius:999px;display:block;height:100%;transition:width .4s ease;width:var(--share)}
  .yt-chase-value{color:var(--ink-2);font-size:11px;font-variant-numeric:tabular-nums;text-align:right}

  .yt-taxonomy{display:grid;gap:18px;grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);margin-top:18px}
  .yt-taxonomy>div{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:22px 24px}
  .yt-topic-list{display:flex;flex-wrap:wrap;gap:8px}
  .yt-topic{background:var(--raised);border:1px solid var(--line);border-radius:10px;padding:9px 12px}
  .yt-topic strong{display:block;font-size:12px}
  .yt-topic span{color:var(--muted);font-size:10px}
  .yt-keywords{align-content:center;align-items:center;display:flex;flex-wrap:wrap;gap:8px 14px;justify-content:center;min-height:190px;padding:8px}
  .yt-keywords a{color:var(--cloud-color);font-size:var(--cloud-size);font-weight:650;line-height:1;text-decoration:none}
  .yt-keywords a:hover{color:var(--accent-text)}

  .yt-recent{display:grid;gap:22px 16px;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}
  .yt-video{color:inherit;display:block;min-width:0;text-decoration:none}
  .yt-video-media{aspect-ratio:16/9;background:var(--raised);border-radius:10px;display:block;overflow:hidden;position:relative;width:100%}
  .yt-video img,.yt-video-placeholder{display:block;height:100%;object-fit:cover;transition:transform .25s ease;width:100%}
  .yt-video:hover img{transform:scale(1.045)}
  .yt-video-length{background:rgba(0,0,0,.78);border-radius:5px;bottom:6px;color:#fff;font-size:10px;font-variant-numeric:tabular-nums;font-weight:600;padding:2px 5px;position:absolute;right:6px}
  .yt-video h3{font-size:13px;line-height:1.35;margin:9px 0 4px}
  .yt-video:hover h3{color:var(--accent-text)}
  .yt-video p{color:var(--muted);font-size:11px;line-height:1.4;margin:0}

  @media(max-width:820px){.yt-hero{grid-template-columns:1fr}.yt-columns,.yt-taxonomy{grid-template-columns:1fr}}
  @media(max-width:560px){.yt-recent{grid-template-columns:repeat(2,minmax(0,1fr))}.yt-hero{padding:20px}.yt-profile{gap:14px}.yt-avatar{flex-basis:58px;font-size:24px;height:58px;width:58px}.yt-channel-row{grid-template-columns:14px 30px minmax(0,1fr) 84px}.yt-channel-row img,.yt-channel-avatar{flex-basis:30px;height:30px;width:30px}}
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

export interface YoutubeDashboardOptions {
  // Path the dashboard is served under; range/sort links stay on it.
  basePath?: string;
  nav?: ShellNavItem[];
  // Extra HTML (e.g. onboarding instructions) rendered above the dashboard.
  setupHtml?: string;
}

export function youtubeDashboardPage(
  ownerName: string,
  data: YoutubeDashboardData,
  sort: 'watches' | 'duration' = 'duration',
  options: YoutubeDashboardOptions = {},
): string {
  const basePath = options.basePath ?? '/youtube';
  const ranges: YoutubeRange[] = ['7d', '28d', '90d', 'all'];
  const rangeNav = `<nav class="yt-range" aria-label="Time range">${ranges.map((range) =>
    `<a href="${basePath}?range=${range}&sort=${sort}"${range === data.range ? ' aria-current="page"' : ''}>${rangeLabel(range)}</a>`
  ).join('')}</nav>`;
  const importControl = `<div class="yt-import-control" data-youtube-import-control hidden>
    <button type="button">Sync now</button><span aria-live="polite"></span>
  </div><script>(()=>{const c=document.querySelector('[data-youtube-import-control]');if(!c)return;const b=c.querySelector('button');const s=c.querySelector('span');let state='idle';window.addEventListener('urtube-youtube-import-status',()=>{let value={};try{value=JSON.parse(c.dataset.extensionStatus||'{}')}catch{}if(!value.extensionReady)return;c.hidden=false;state=value.state||'idle';const running=state==='running';b.disabled=false;b.textContent=running?'Cancel sync':'Sync now';if(running){s.textContent=value.stage==='activity'?(value.events+' events found'):(value.videos+' recent progress rows')}else if(state==='complete'&&value.lastSuccessAt){s.textContent='Last synced '+new Date(value.lastSuccessAt).toLocaleString()}else if(state==='error'){s.textContent=value.lastError||'Sync failed'}else{s.textContent='Daily account sync ready'}});b.addEventListener('click',()=>{b.disabled=true;c.dataset.importAction=state==='running'?'cancel':'start';window.dispatchEvent(new Event('urtube-youtube-import-request'));});})();</script>`;
  const heroHours = data.stats.estimatedWatchSeconds === null ? null : Math.round(data.stats.estimatedWatchSeconds / 3600);
  const hero = `<section class="card yt-hero">
    <div class="yt-hero-figure">
      <strong>${heroHours === null ? '—' : new Intl.NumberFormat('en').format(heroHours)}<em>hours</em></strong>
      <span>estimated time in front of YouTube · ${rangeLabel(data.range).toLowerCase()}</span>
    </div>
    <div class="yt-hero-stats">
      <div class="yt-stat"><strong>${compact(data.stats.watchEvents)}</strong><span>watch events</span></div>
      <div class="yt-stat"><strong>${compact(data.stats.uniqueVideos)}</strong><span>different videos</span></div>
      <div class="yt-stat"><strong>${compact(data.stats.uniqueChannels)}</strong><span>channels</span></div>
      <div class="yt-stat"><strong>${hours(data.stats.contentCoveredSeconds)}</strong><span>content covered</span></div>
      <div class="yt-stat"><strong>${hours(data.stats.actualWatchedSeconds)}</strong><span>measured</span></div>
    </div>
    <div class="yt-hero-foot">${Math.round(data.stats.metadataCoverage * 100)}% metadata coverage · ${Math.round(data.stats.progressCoverage * 100)}% progress coverage · estimates blend measured seconds, saved progress, and video length</div>
  </section>`;
  const channels = [...data.topChannels].sort((a, b) =>
    sort === 'duration'
      ? b.estimatedWatchSeconds - a.estimatedWatchSeconds
      : b.watches - a.watches
  ).slice(0, 12);
  const maxChannel = Math.max(1, ...channels.map((channel) =>
    sort === 'duration' ? channel.estimatedWatchSeconds : channel.watches));
  const channelList = `<section><div class="section-head"><h2>Top channels</h2><span class="yt-sort"><a href="${basePath}?range=${data.range}&sort=watches"${sort === 'watches' ? ' aria-current="page"' : ''}>plays</a> · <a href="${basePath}?range=${data.range}&sort=duration"${sort === 'duration' ? ' aria-current="page"' : ''}>time</a></span></div>
    <div class="yt-channels">${channels.map((channel, index) => {
      const metric = sort === 'duration' ? channel.estimatedWatchSeconds : channel.watches;
      return `<div class="yt-channel-row">
        <span class="yt-channel-rank">${index + 1}</span>
        ${channelAvatar(channel)}
        <div class="yt-channel-main">
          <span class="yt-channel-name">${channel.channelId ? `<a href="https://www.youtube.com/channel/${html(channel.channelId)}">${html(channel.name)}</a>` : html(channel.name)}</span>
          <div class="yt-channel-track"><i style="width:${Math.max(1, Math.round(metric / maxChannel * 100))}%"></i></div>
        </div>
        <div class="yt-channel-nums"><strong>${hours(channel.estimatedWatchSeconds)}</strong><span>${channel.watches} plays</span></div>
      </div>`;
    }).join('')}</div></section>`;
  const bucketOrder = ['< 1 min', '1-5 min', '5-20 min', '20-60 min', '60+ min', 'Unknown'];
  const orderedBuckets = [...data.lengthBuckets]
    .sort((a, b) => bucketOrder.indexOf(a.label) - bucketOrder.indexOf(b.label));
  const maxLength = Math.max(1, ...data.lengthBuckets.map((bucket) => bucket.videos));
  const distribution = `<section><div class="section-head"><h2>Length mix</h2><span>unique videos</span></div><div class="yt-mix">${orderedBuckets.map((bucket) =>
    `<div class="yt-mix-row"><span>${html(bucket.label)}</span><div class="yt-mix-track"><i style="background:${LENGTH_RAMP[bucket.label] ?? '#55534e'};width:${Math.round(bucket.videos / maxLength * 100)}%"></i></div><span>${bucket.videos}</span></div>`
  ).join('')}</div></section>`;
  const maxKeywordVideos = Math.max(1, ...data.keywords.map((item) => item.videos));
  const taxonomy = `<div class="yt-taxonomy"><div><div class="section-head"><h2>Stable topics</h2><span>AI-classified</span></div>
    <div class="yt-topic-list">${data.topics.length ? data.topics.map((topic) =>
      `<div class="yt-topic"><strong>${html(topic.name)}</strong><span>${topic.watches} watches · ${hours(topic.estimatedWatchSeconds)} est.</span></div>`
    ).join('') : '<span class="muted">Topic classification is pending.</span>'}</div></div>
    <div><div class="section-head"><h2>Trending keywords</h2><span>public metadata only</span></div>
    <div class="yt-keywords">${data.keywords.map((keyword, index) => {
      const size = 12 + Math.round(Math.sqrt(keyword.videos / maxKeywordVideos) * 18);
      // Keywords are text, so they wear ink tokens; size carries the weight.
      const colors = ['#f4f2ee', '#b8b5ad', '#8a877f'];
      const query = encodeURIComponent(keyword.term);
      return `<a href="https://www.youtube.com/results?search_query=${query}" data-tip="${keyword.videos} videos" data-tip-label="${html(keyword.term)}" style="--cloud-size:${size}px;--cloud-color:${colors[index % colors.length]}">${html(keyword.term)}</a>`;
    }).join('')}</div></div></div>`;
  const recent = `<section class="section"><div class="section-head"><h2>Recently watched</h2><span>${data.recent.length} different videos</span></div><div class="yt-recent">${data.recent.map((video) =>
    `<a class="yt-video" href="${html(video.url)}"><span class="yt-video-media">${video.thumbnailUrl ? `<img src="${html(video.thumbnailUrl)}" alt="" loading="lazy">` : '<span class="yt-video-placeholder"></span>'}${video.durationSeconds === null ? '' : `<span class="yt-video-length">${duration(video.durationSeconds)}</span>`}</span><h3>${html(video.title)}</h3><p>${html(video.channelTitle)}${video.watchCount > 1 ? ` · ${video.watchCount} plays` : ''}</p></a>`
  ).join('')}</div></section>`;
  const intro = `<style>${dashboardStyles}</style><section class="yt-profile">
    <span class="yt-avatar" aria-hidden="true">${html([...ownerName][0] ?? '?')}</span>
    <div class="yt-profile-copy"><div class="eyebrow">YouTube · attention archive</div>
    <h1>${html(ownerName)}</h1>
    <div class="yt-profile-meta">${rangeLabel(data.range)} · <a href="/">home</a></div></div></section>`;
  return shell(`${ownerName} · YouTube`, intro + rangeNav + importControl + hero + (options.setupHtml ?? '')
    + rhythmSection(data)
    + `<div class="yt-columns">${channelList}${distribution}</div>`
    + channelChase(data) + taxonomy + recent, options.nav ?? []);
}
