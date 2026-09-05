import { hours, html } from './pages.js';

export interface RankRace {
  kind: 'channels' | 'topics';
  title: string;
  subtitle: string;
  playLabel: string;
  pauseLabel: string;
  empty: string;
  format: 'hours' | 'percent';
  channels: Array<{ name: string; thumbnailUrl?: string; color?: string }>;
  frames: Array<{ period: string; entries: Array<[number, number]>; note?: string }>;
}

// Both overview animations use the same rows, timing, controls and transitions.
const RACE_ROW_PITCH = 41;

export function rankRaceSection(race: RankRace): string {
  if (!race.frames.length) return `<section class="section" data-rank-race="${race.kind}"><div class="section-head"><h2>${html(race.title)}</h2></div><p class="muted">${html(race.empty)}</p></section>`;
  const payload = JSON.stringify({ channels: race.channels, frames: race.frames, format: race.format })
    .replace(/</g, '\\u003c');
  const latest = race.frames.at(-1)!;
  const maxRows = Math.max(...race.frames.map((frame) => frame.entries.length));
  const trackHeight = Math.max(1, maxRows) * RACE_ROW_PITCH - 9;
  const formatValue = (value: number) => race.format === 'percent' ? `${(value * 100).toFixed(1)}%` : hours(value);
  const max = Math.max(0.0001, latest.entries[0]?.[1] ?? 1);
  const initialRows = latest.entries.map(([index, score], rank) => {
    const channel = race.channels[index];
    return `<div class="yt-chase-row" data-chase-index="${index}" style="transform:translateY(${rank * RACE_ROW_PITCH}px)">
    ${channel.thumbnailUrl ? `<img src="${html(channel.thumbnailUrl)}" alt="" loading="lazy">` : `<span class="yt-channel-avatar" aria-hidden="true">${html([...channel.name][0] ?? '?')}</span>`}
    <div class="yt-chase-copy"><div class="yt-chase-label"><strong>${html(channel.name)}</strong></div>
      <div class="yt-chase-track"><i style="--share:${(score / max).toFixed(4)};--race-color:${html(channel.color ?? 'var(--accent)')}"></i></div></div>
    <span class="yt-chase-value">${formatValue(score)}</span>
  </div>`;
  }).join('');
  return `<section class="section" data-rank-race="${race.kind}"><div class="section-head"><h2>${html(race.title)}</h2><span>${html(race.subtitle)}</span></div>
    <div class="yt-chase">
      <div class="yt-chase-controls">
        <button type="button" data-chase-play data-label-play="${html(race.playLabel)}" data-label-pause="${html(race.pauseLabel)}" aria-label="${html(race.playLabel)}" title="${html(race.playLabel)}">▶</button>
        <strong class="yt-chase-period" data-chase-period>${html(latest.period)}</strong>
        <input type="range" min="0" max="${race.frames.length - 1}" value="${race.frames.length - 1}" aria-label="${html(race.title)}" data-chase-range>
      </div>
      <p class="yt-chase-note" data-chase-note style="visibility:${latest.note ? 'visible' : 'hidden'}">${html(latest.note ?? '')}</p>
      <p class="muted" data-chase-empty${latest.entries.length ? ' hidden' : ''}>${html(race.empty)}</p>
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
        const formatValue = (value) => race.format === 'percent' ? (value * 100).toFixed(1) + '%' : (Math.round(value / 360) / 10) + 'h';
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
          row.dataset.chaseIndex = String(index);
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
          bar.style.setProperty('--race-color', channel.color || 'var(--accent)');
          bar.style.setProperty('--share', '0');
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
          const max = Math.max(0.0001, frame.entries[0] ? frame.entries[0][1] : 1);
          const seen = new Set();
          frame.entries.forEach((pair, rank) => {
            const cached = rowCache.get(pair[0]) || makeRow(pair[0]);
            seen.add(pair[0]);
            cached.row.style.transform = 'translateY(' + (rank * pitch) + 'px)';
            cached.row.style.opacity = '1';
            cached.row.removeAttribute('aria-hidden');
            cached.bar.style.setProperty('--share', String(pair[1] / max));
            cached.value.textContent = formatValue(pair[1]);
          });
          for (const [index, cached] of rowCache) {
            if (seen.has(index)) continue;
            cached.row.style.opacity = '0';
            cached.row.setAttribute('aria-hidden', 'true');
            cached.row.style.transform = 'translateY(' + hiddenY + 'px)';
          }
          const note = root.querySelector('[data-chase-note]');
          note.textContent = frame.note || '';
          note.style.visibility = frame.note ? 'visible' : 'hidden';
          root.querySelector('[data-chase-empty]').hidden = frame.entries.length > 0;
          period.textContent = frame.period;
          range.value = String(frameIndex);
        };
        const stop = () => {
          if (timer !== null) window.clearInterval(timer);
          timer = null;
          play.textContent = '▶';
          play.setAttribute('aria-label', play.dataset.labelPlay);
          play.title = play.dataset.labelPlay;
          play.setAttribute('aria-pressed', 'false');
        };
        render(frames.length - 1);
        stop();
        const reducedMotion = matchMedia('(prefers-reduced-motion:reduce)');
        const syncMotion = () => { if (reducedMotion.matches) stop(); play.disabled = reducedMotion.matches || frames.length < 2; };
        syncMotion();
        reducedMotion.addEventListener('change', syncMotion, { signal: window.urtubePageController.signal });
        range.disabled = frames.length < 2;
        document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); }, { signal: window.urtubePageController.signal });
        window.urtubePageController.signal.addEventListener('abort', stop, { once: true });
        range.addEventListener('input', () => {
          stop();
          render(Number(range.value));
        });
        play.addEventListener('click', () => {
          if (timer !== null) return stop();
          if (reducedMotion.matches || frames.length < 2) return;
          if (Number(range.value) >= frames.length - 1) render(0);
          play.textContent = '❚❚';
          play.setAttribute('aria-label', play.dataset.labelPause);
          play.title = play.dataset.labelPause;
          play.setAttribute('aria-pressed', 'true');
          timer = window.setInterval(() => {
            const next = Number(range.value) + 1;
            if (next >= frames.length) return stop();
            render(next);
            if (next === frames.length - 1) stop();
          }, stepMs);
        });
      })();
    </script>
  </section>`;
}

