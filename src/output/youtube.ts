import type { YoutubeDashboardData, YoutubeRange } from '../youtube/types.js';
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
  return `<section class="yt-section"><div class="yt-heading"><h2>Channel momentum</h2><span>cumulative estimated time</span></div>
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
  .yt-range{align-items:center;border-bottom:1px solid var(--line);display:flex;gap:4px;margin-bottom:28px;overflow-x:auto;padding-bottom:12px}
  .yt-range a{border-radius:6px;color:var(--muted);font-size:12px;padding:7px 10px;text-decoration:none;white-space:nowrap}.yt-range a[aria-current=page]{background:#f2f4f7;color:#111}
  .yt-import-control{align-items:center;border-bottom:1px solid var(--line);display:flex;gap:12px;margin:-16px 0 28px;padding:0 0 16px}.yt-import-control[hidden]{display:none}.yt-import-control button{background:transparent;border:1px solid var(--line-strong);border-radius:5px;color:var(--text);cursor:pointer;font:inherit;font-size:11px;padding:7px 10px}.yt-import-control button:hover{border-color:#6b7584}.yt-import-control button:disabled{cursor:wait;opacity:.65}.yt-import-control span{color:var(--quiet);font-size:11px}
  .yt-stats{border-bottom:1px solid var(--line);border-top:1px solid var(--line);display:grid;grid-template-columns:repeat(6,minmax(0,1fr));margin-bottom:42px}
  .yt-stat{border-left:1px solid var(--line);padding:16px}.yt-stat:first-child{border-left:0;padding-left:0}.yt-stat strong{display:block;font-size:22px}.yt-stat span{color:var(--quiet);font-size:10px;text-transform:uppercase}
  .yt-section{margin-top:42px}.yt-heading{align-items:end;display:flex;justify-content:space-between;margin-bottom:14px}.yt-heading h2{font-size:18px;margin:0}.yt-heading span{color:var(--quiet);font-size:11px}
  .yt-bars{align-items:end;border-bottom:1px solid var(--line);display:flex;gap:3px;height:150px;overflow-x:auto;padding:0 0 1px}.yt-day{background:#ff453a;display:block;flex:1 0 7px;min-height:2px;opacity:.86}.yt-day:hover{opacity:1}
  .yt-columns{display:grid;gap:28px;grid-template-columns:minmax(0,1.25fr) minmax(260px,.75fr)}.yt-table{border-collapse:collapse;width:100%}.yt-table td,.yt-table th{border-bottom:1px solid var(--line);font-size:12px;padding:9px 8px;text-align:right}.yt-table th{color:var(--quiet);font-size:10px;text-transform:uppercase}.yt-table td:first-child,.yt-table th:first-child{text-align:left}.yt-table a{color:var(--text);text-decoration:none}.yt-channel{align-items:center;display:flex;gap:9px;min-width:0}.yt-channel img,.yt-channel-avatar{background:var(--surface-raised);border-radius:50%;display:grid;flex:0 0 30px;height:30px;object-fit:cover;place-items:center;width:30px}.yt-channel-avatar{color:var(--muted);font-size:11px;font-weight:700}.yt-sort a[aria-current=page]{color:var(--text);font-weight:700;text-decoration:underline;text-underline-offset:3px}
  .yt-distribution{display:grid;gap:8px}.yt-distribution-row{align-items:center;display:grid;gap:10px;grid-template-columns:70px minmax(0,1fr) 34px}.yt-distribution-row span{color:var(--muted);font-size:11px}.yt-distribution-track{background:var(--surface-raised);height:7px}.yt-distribution-track i{background:#63d8e6;display:block;height:100%}
  .yt-chase{border-bottom:1px solid var(--line);border-top:1px solid var(--line);padding:16px 0}.yt-chase-controls{align-items:center;display:grid;gap:12px;grid-template-columns:34px 90px minmax(0,1fr);margin-bottom:18px}.yt-chase-controls button{align-items:center;background:var(--surface-raised);border:1px solid var(--line-strong);border-radius:50%;color:var(--text);cursor:pointer;display:flex;font-size:12px;height:32px;justify-content:center;padding:0;width:32px}.yt-chase-controls input{accent-color:#ff453a;width:100%}.yt-chase-period{font-size:12px;white-space:nowrap}.yt-chase-rows{display:grid;gap:8px;min-height:280px}.yt-chase-row{align-items:center;display:grid;gap:9px;grid-template-columns:30px minmax(0,1fr) 62px}.yt-chase-row img,.yt-chase-row .yt-channel-avatar{height:30px;width:30px}.yt-chase-copy{min-width:0}.yt-chase-label{display:flex;font-size:11px;justify-content:space-between;margin-bottom:3px}.yt-chase-label strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.yt-chase-track{background:var(--surface-raised);height:8px;overflow:hidden}.yt-chase-track i{background:#ff453a;display:block;height:100%;transition:width .4s ease;width:var(--share)}.yt-chase-value{color:var(--muted);font-size:10px;text-align:right}
  .yt-taxonomy{display:grid;gap:28px;grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr)}.yt-topic-list{display:flex;flex-wrap:wrap;gap:7px}.yt-topic{border:1px solid var(--line);border-radius:6px;padding:8px 10px}.yt-topic strong{display:block;font-size:12px}.yt-topic span{color:var(--quiet);font-size:10px}.yt-keywords{align-content:center;align-items:center;display:flex;flex-wrap:wrap;gap:8px 13px;justify-content:center;min-height:190px;padding:8px}.yt-keywords a{color:var(--cloud-color);font-size:var(--cloud-size);font-weight:650;line-height:1;text-decoration:none}.yt-keywords a:hover{color:var(--text);text-decoration:underline;text-underline-offset:4px}
  .yt-recent{display:grid;gap:18px 14px;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}.yt-video{color:inherit;display:block;min-width:0;text-decoration:none}.yt-video-media{aspect-ratio:16/9;background:#20242a;border-radius:6px;display:block;overflow:hidden;width:100%}.yt-video img,.yt-video-placeholder{height:100%;object-fit:cover;transition:transform .2s ease;width:100%}.yt-video:hover img{transform:scale(1.025)}.yt-video h3{font-size:13px;line-height:1.35;margin:9px 0 4px}.yt-video p{color:var(--quiet);font-size:10px;line-height:1.4;margin:0}
  @media(max-width:760px){.yt-stats{grid-template-columns:repeat(2,1fr)}.yt-stat{border-bottom:1px solid var(--line)}.yt-stat:nth-child(odd){border-left:0}.yt-columns,.yt-taxonomy{grid-template-columns:1fr}.yt-recent{grid-template-columns:repeat(2,minmax(0,1fr))}.yt-table td,.yt-table th{padding-inline:4px}}
  @media(max-width:420px){.yt-recent{gap:16px 10px}.yt-video h3{font-size:12px}.yt-chase-row{grid-template-columns:28px minmax(0,1fr) 52px}.yt-chase-row img,.yt-chase-row .yt-channel-avatar{height:28px;width:28px}.yt-keywords{gap:8px 10px;padding-inline:0}}
`;

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
  const stats = `<div class="yt-stats">
    <div class="yt-stat"><strong>${compact(data.stats.watchEvents)}</strong><span>watch events</span></div>
    <div class="yt-stat"><strong>${compact(data.stats.uniqueVideos)}</strong><span>different videos</span></div>
    <div class="yt-stat"><strong>${compact(data.stats.uniqueChannels)}</strong><span>channels</span></div>
    <div class="yt-stat"><strong>${hours(data.stats.estimatedWatchSeconds)}</strong><span>estimated time</span></div>
    <div class="yt-stat"><strong>${hours(data.stats.contentCoveredSeconds)}</strong><span>content covered</span></div>
    <div class="yt-stat"><strong>${hours(data.stats.actualWatchedSeconds)}</strong><span>measured</span></div>
  </div>`;
  const maxDay = Math.max(1, ...data.daily.map((day) => day.watches));
  const bars = `<section class="yt-section"><div class="yt-heading"><h2>Daily volume</h2><span>${data.daily.length} active days</span></div>
    <div class="yt-bars">${data.daily.map((day) =>
      `<i class="yt-day" style="height:${Math.max(2, Math.round(day.watches / maxDay * 100))}%" title="${html(day.day)} · ${day.watches} videos"></i>`
    ).join('')}</div></section>`;
  const channels = [...data.topChannels].sort((a, b) =>
    sort === 'duration'
      ? b.estimatedWatchSeconds - a.estimatedWatchSeconds
      : b.watches - a.watches
  ).slice(0, 12);
  const channelTable = `<section><div class="yt-heading"><h2>Top channels</h2><span class="yt-sort"><a href="${basePath}?range=${data.range}&sort=watches"${sort === 'watches' ? ' aria-current="page"' : ''}>plays</a> · <a href="${basePath}?range=${data.range}&sort=duration"${sort === 'duration' ? ' aria-current="page"' : ''}>estimated time</a></span></div>
    <table class="yt-table"><thead><tr><th>Channel</th><th>Plays</th><th>Est. time</th></tr></thead><tbody>${channels.map((channel) =>
      `<tr><td><div class="yt-channel">${channelAvatar(channel)}${channel.channelId ? `<a href="https://www.youtube.com/channel/${html(channel.channelId)}">${html(channel.name)}</a>` : `<span>${html(channel.name)}</span>`}</div></td><td>${channel.watches}</td><td>${hours(channel.estimatedWatchSeconds)}</td></tr>`
    ).join('')}</tbody></table></section>`;
  const maxLength = Math.max(1, ...data.lengthBuckets.map((bucket) => bucket.videos));
  const distribution = `<section><div class="yt-heading"><h2>Length mix</h2><span>unique videos</span></div><div class="yt-distribution">${data.lengthBuckets.map((bucket) =>
    `<div class="yt-distribution-row"><span>${html(bucket.label)}</span><div class="yt-distribution-track"><i style="width:${Math.round(bucket.videos / maxLength * 100)}%"></i></div><span>${bucket.videos}</span></div>`
  ).join('')}</div></section>`;
  const maxKeywordVideos = Math.max(1, ...data.keywords.map((item) => item.videos));
  const taxonomy = `<section class="yt-section"><div class="yt-taxonomy"><div><div class="yt-heading"><h2>Stable topics</h2><span>AI-classified</span></div>
    <div class="yt-topic-list">${data.topics.length ? data.topics.map((topic) =>
      `<div class="yt-topic"><strong>${html(topic.name)}</strong><span>${topic.watches} watches · ${hours(topic.estimatedWatchSeconds)} est.</span></div>`
    ).join('') : '<span class="muted">Topic classification is pending.</span>'}</div></div>
    <div><div class="yt-heading"><h2>Trending keywords</h2><span>public metadata only</span></div>
    <div class="yt-keywords">${data.keywords.map((keyword, index) => {
      const size = 12 + Math.round(Math.sqrt(keyword.videos / maxKeywordVideos) * 19);
      const colors = ['#f4f6f8', '#63d8e6', '#ff746b', '#f2c14e'];
      const query = encodeURIComponent(keyword.term);
      return `<a href="https://www.youtube.com/results?search_query=${query}" title="${keyword.videos} videos" style="--cloud-size:${size}px;--cloud-color:${colors[index % colors.length]}">${html(keyword.term)}</a>`;
    }).join('')}</div></div></div></section>`;
  const recent = `<section class="yt-section"><div class="yt-heading"><h2>Recently watched</h2><span>10 different videos</span></div><div class="yt-recent">${data.recent.map((video) =>
    `<a class="yt-video" href="${html(video.url)}"><span class="yt-video-media">${video.thumbnailUrl ? `<img src="${html(video.thumbnailUrl)}" alt="" loading="eager">` : '<span class="yt-video-placeholder"></span>'}</span><h3>${html(video.title)}</h3><p>${html(video.channelTitle)} · ${duration(video.durationSeconds)}${video.watchCount > 1 ? ` · ${video.watchCount} plays` : ''}</p></a>`
  ).join('')}</div></section>`;
  const intro = `<style>${dashboardStyles}</style><section class="page-intro"><div><div class="eyebrow">YouTube · attention archive</div><h1>YouTube</h1><p>${html(ownerName)}'s viewing patterns, channels, topics, and recent videos.</p></div><div class="page-intro-aside">${Math.round(data.stats.metadataCoverage * 100)}% metadata coverage · ${rangeLabel(data.range)}</div></section>
    <div class="context-line"><a href="/">Home</a><span>→</span><strong>YouTube</strong></div>`;
  return shell(`${ownerName} · YouTube`, intro + (options.setupHtml ?? '') + rangeNav + importControl + stats + bars
    + `<section class="yt-section yt-columns">${channelTable}${distribution}</section>`
    + channelChase(data) + taxonomy + recent, options.nav ?? []);
}
