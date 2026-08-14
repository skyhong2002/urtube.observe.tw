import type { CrystalComparison, CrystalShift, YoutubeCrystal } from '../youtube/crystal.js';
import { hours, html, shell } from './pages.js';

const crystalStyles = `
  .cx-shifts{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
  .cx-shift{align-items:center;border:1px solid var(--line);border-radius:8px;display:flex;gap:10px;padding:10px 12px}
  .cx-shift-delta{font-size:13px;font-weight:700;min-width:58px}
  .cx-up{color:#63d8e6}.cx-down{color:#ff746b}
  .cx-shift-copy{min-width:0}.cx-shift-copy strong{display:block;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cx-shift-copy span{color:var(--quiet);font-size:10px;text-transform:uppercase}
  .cx-sim{display:flex;gap:12px;margin-bottom:24px}.cx-sim div{border:1px solid var(--line);border-radius:10px;flex:1;padding:14px}.cx-sim strong{display:block;font-size:26px}.cx-sim span{color:var(--quiet);font-size:11px;text-transform:uppercase}
  .cx-columns{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
  .cx-list{border-top:1px solid var(--line)}.cx-row{align-items:center;border-bottom:1px solid var(--line);display:grid;gap:10px;grid-template-columns:minmax(0,1fr) auto;font-size:13px;padding:8px 2px}
  .cx-row em{color:var(--quiet);font-size:11px;font-style:normal}
  .cx-tag{border:1px solid var(--line-strong);border-radius:999px;color:#9ca5af;font-size:10px;padding:1px 7px;text-transform:uppercase}
`;

function sharePct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function shiftRow(shift: CrystalShift): string {
  const arrow = shift.delta > 0 ? '▲' : '▼';
  const label = shift.status === 'new' ? 'new' : shift.status === 'gone' ? 'gone' : shift.kind;
  return `<div class="cx-shift"><span class="cx-shift-delta ${shift.delta > 0 ? 'cx-up' : 'cx-down'}">${arrow} ${(Math.abs(shift.delta) * 100).toFixed(1)}pp</span>
    <div class="cx-shift-copy"><strong>${html(shift.name)}</strong><span>${html(label)} · ${sharePct(shift.priorShare)} → ${sharePct(shift.recentShare)}</span></div></div>`;
}

// The "what changed" section injected into a dashboard: recent window vs the
// one before it. This is the single-user difference question the crystal
// design starts from.
export function shiftsSection(crystal: YoutubeCrystal): string {
  if (!crystal.shifts.length && crystal.volumeChange === null) return '';
  const volume = crystal.volumeChange === null
    ? ''
    : ` · volume ${crystal.volumeChange >= 0 ? '+' : ''}${Math.round(crystal.volumeChange * 100)}% vs prior ${crystal.windowDays}d`;
  const rows = crystal.shifts.slice(0, 12).map(shiftRow).join('');
  return `<style>${crystalStyles}</style>
    <section class="yt-section"><div class="yt-heading"><h2>What changed</h2>
    <span>last ${crystal.windowDays}d vs the ${crystal.windowDays}d before${volume} · <a href="crystal.json" style="color:inherit">crystal.json</a></span></div>
    ${rows ? `<div class="cx-shifts">${rows}</div>` : '<p class="muted">No attention shifts above 2 share-points yet.</p>'}</section>`;
}

export function comparePage(comparison: CrystalComparison, requesterPath: string): string {
  const list = (
    title: string,
    rows: Array<{ name: string; aShare?: number; bShare?: number; share?: number; kind?: string }>,
    render: (row: any) => string,
  ) => `<div><div class="yt-heading"><h2>${html(title)}</h2></div>
    <div class="cx-list">${rows.length ? rows.map(render).join('') : '<div class="cx-row"><em>Nothing here.</em></div>'}</div></div>`;
  const sharedRow = (row: { name: string; aShare: number; bShare: number }) =>
    `<div class="cx-row"><span>${html(row.name)}</span><em>${sharePct(row.aShare)} · ${sharePct(row.bShare)}</em></div>`;
  const onlyRow = (row: { name: string; kind: string; share: number }) =>
    `<div class="cx-row"><span>${html(row.name)} <span class="cx-tag">${html(row.kind)}</span></span><em>${sharePct(row.share)}</em></div>`;
  const body = `<style>${crystalStyles}</style>
    <section class="page-intro"><div><div class="eyebrow">Crystal comparison</div>
    <h1>${html(comparison.a.displayName)} × ${html(comparison.b.displayName)}</h1>
    <p>All-time attention compared as share-weighted vectors. Aggregates only — nobody's raw history, searches, or timestamps are exposed.</p></div></section>
    <div class="cx-sim">
      <div><strong>${Math.round(comparison.channelSimilarity * 100)}%</strong><span>channel similarity</span></div>
      <div><strong>${Math.round(comparison.topicSimilarity * 100)}%</strong><span>topic similarity</span></div>
    </div>
    <div class="cx-columns">
      ${list(`Shared ground`, comparison.sharedChannels, sharedRow)}
      ${list(`Shared topics`, comparison.sharedTopics, sharedRow)}
      ${list(`Only ${comparison.a.displayName} — ${comparison.b.displayName} is missing these`, comparison.onlyA, onlyRow)}
      ${list(`Only ${comparison.b.displayName} — ${comparison.a.displayName} is missing these`, comparison.onlyB, onlyRow)}
    </div>`;
  return shell(
    `${comparison.a.displayName} × ${comparison.b.displayName}`,
    body,
    [{ label: 'Back to dashboard', href: requesterPath }],
  );
}
