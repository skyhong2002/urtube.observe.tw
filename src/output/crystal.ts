import type { CrystalComparison, CrystalShift, YoutubeCrystal } from '../youtube/crystal.js';
import { messages, type Lang, type Messages } from './i18n.js';
import { html, shell } from './pages.js';

// Shifts are polarity, so they wear the diverging pair: warm red up, cool
// blue down (never good/bad status colors — more attention isn't "good").
const crystalStyles = `
  .cx-shifts{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
  .cx-shift{align-items:center;background:var(--raised);border:1px solid var(--line);border-radius:11px;display:flex;gap:12px;padding:10px 12px}
  .cx-shift-delta{font-size:13px;font-variant-numeric:tabular-nums;font-weight:700;min-width:62px}
  .cx-up{color:var(--accent-text)}.cx-down{color:var(--blue-text)}
  .cx-shift-copy{min-width:0}
  .cx-shift-copy strong{display:block;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cx-shift-copy span{color:var(--muted);font-size:10px;letter-spacing:.05em;text-transform:uppercase}
  .cx-sim{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:22px}
  .cx-sim div{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:18px 20px}
  .cx-sim strong{display:block;font-size:34px;font-weight:750;letter-spacing:-.03em}
  .cx-sim span{color:var(--muted);font-size:10px;font-weight:700;letter-spacing:.09em;text-transform:uppercase}
  .cx-columns{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
  .cx-columns>div{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:20px 22px}
  .cx-list{border-top:1px solid var(--line)}
  .cx-row{align-items:center;border-bottom:1px solid var(--line);display:grid;font-size:13px;gap:10px;grid-template-columns:minmax(0,1fr) auto;padding:8px 2px}
  .cx-row em{color:var(--muted);font-size:11px;font-style:normal;font-variant-numeric:tabular-nums}
  .cx-tag{border:1px solid var(--line-strong);border-radius:999px;color:var(--muted);font-size:9px;letter-spacing:.06em;padding:1px 7px;text-transform:uppercase}
  .cx-intro{margin:14px 0 24px}
  .cx-intro h1{font-size:clamp(28px,4vw,40px);letter-spacing:-.03em;line-height:1.08;margin:7px 0 10px}
  .cx-intro p{color:var(--ink-2);margin:0;max-width:640px}
`;

function sharePct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function shiftRow(shift: CrystalShift, t: Messages): string {
  const arrow = shift.delta > 0 ? '▲' : '▼';
  const label = shift.status === 'new'
    ? t.shiftNew
    : shift.status === 'gone'
      ? t.shiftGone
      : shift.kind === 'topic' ? t.shiftTopic : t.shiftChannel;
  return `<div class="cx-shift"><span class="cx-shift-delta ${shift.delta > 0 ? 'cx-up' : 'cx-down'}">${arrow} ${(Math.abs(shift.delta) * 100).toFixed(1)}pp</span>
    <div class="cx-shift-copy"><strong>${html(shift.name)}</strong><span>${html(label)} · ${sharePct(shift.priorShare)} → ${sharePct(shift.recentShare)}</span></div></div>`;
}

// The "what changed" section injected into a dashboard: recent window vs the
// one before it. This is the single-user difference question the crystal
// design starts from.
export function shiftsSection(crystal: YoutubeCrystal, lang: Lang = 'en'): string {
  const t = messages(lang);
  if (!crystal.shifts.length && crystal.volumeChange === null) return '';
  const volume = crystal.volumeChange === null
    ? ''
    : t.changedVolume(`${crystal.volumeChange >= 0 ? '+' : ''}${Math.round(crystal.volumeChange * 100)}%`, crystal.windowDays);
  const rows = crystal.shifts.slice(0, 12).map((shift) => shiftRow(shift, t)).join('');
  return `<style>${crystalStyles}</style>
    <section class="section"><div class="section-head"><h2>${t.whatChanged}</h2>
    <span>${t.changedSub(crystal.windowDays)}${volume} · <a href="/u/${html(crystal.handle)}/crystal.json">crystal.json</a></span></div>
    ${rows ? `<div class="cx-shifts">${rows}</div>` : `<p class="muted">${t.noShifts}</p>`}</section>`;
}

export function comparePage(comparison: CrystalComparison, requesterPath: string, lang: Lang = 'en'): string {
  const t = messages(lang);
  const list = (
    title: string,
    rows: Array<{ name: string; aShare?: number; bShare?: number; share?: number; kind?: string }>,
    render: (row: any) => string,
  ) => `<div><div class="section-head"><h2>${html(title)}</h2></div>
    <div class="cx-list">${rows.length ? rows.map(render).join('') : `<div class="cx-row"><em>${t.nothingHere}</em></div>`}</div></div>`;
  const sharedRow = (row: { name: string; aShare: number; bShare: number }) =>
    `<div class="cx-row"><span>${html(row.name)}</span><em>${sharePct(row.aShare)} · ${sharePct(row.bShare)}</em></div>`;
  const onlyRow = (row: { name: string; kind: string; share: number }) =>
    `<div class="cx-row"><span>${html(row.name)} <span class="cx-tag">${html(row.kind === 'topic' ? t.shiftTopic : t.shiftChannel)}</span></span><em>${sharePct(row.share)}</em></div>`;
  const body = `<style>${crystalStyles}</style>
    <section class="cx-intro"><div class="eyebrow">${t.crystalCompare}</div>
    <h1>${html(comparison.a.displayName)} × ${html(comparison.b.displayName)}</h1>
    <p>${t.comparePara}</p></section>
    <div class="cx-sim">
      <div><strong>${Math.round(comparison.channelSimilarity * 100)}%</strong><span>${t.channelSimilarity}</span></div>
      <div><strong>${Math.round(comparison.topicSimilarity * 100)}%</strong><span>${t.topicSimilarity}</span></div>
    </div>
    <div class="cx-columns">
      ${list(t.sharedChannels, comparison.sharedChannels, sharedRow)}
      ${list(t.sharedTopics, comparison.sharedTopics, sharedRow)}
      ${list(t.onlyList(comparison.a.displayName, comparison.b.displayName), comparison.onlyA, onlyRow)}
      ${list(t.onlyList(comparison.b.displayName, comparison.a.displayName), comparison.onlyB, onlyRow)}
    </div>`;
  return shell(
    `${comparison.a.displayName} × ${comparison.b.displayName}`,
    body,
    [{ label: t.navBack, href: requesterPath }],
    '',
    lang,
  );
}
