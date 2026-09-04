import type { YoutubeProcessingStatus } from '../youtube/processing.js';
import { messages, type Lang } from './i18n.js';
import { html, timeAgo } from './pages.js';

export const processingStyles = `
  .yt-processing{background:rgba(250,178,25,.08);border:1px solid rgba(250,178,25,.32);border-radius:12px;margin:0 0 18px;padding:14px 16px}
  .yt-processing-head{align-items:baseline;display:flex;flex-wrap:wrap;gap:6px 14px}
  .yt-processing-head strong{color:#f5c95e;font-size:14px}
  .yt-processing-head span{color:var(--muted);font-size:11px}
  .yt-processing p{color:var(--ink-2);font-size:13px;line-height:1.55;margin:8px 0 0}
  .yt-processing-stages{display:grid;gap:8px 18px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-top:10px}
  .yt-processing-stage{font-size:12px}
  .yt-processing-stage span{color:var(--ink-2);display:flex;font-variant-numeric:tabular-nums;justify-content:space-between}
  .yt-processing-stage i{background:var(--line);border-radius:999px;display:block;height:5px;margin-top:5px;overflow:hidden}
  .yt-processing-stage i b{background:#f5c95e;display:block;height:100%}
  .yt-processing-error{color:var(--accent-text)}
  .yt-processing a{color:var(--ink);font-weight:600}
  .yt-provisional{background:rgba(250,178,25,.16);border-radius:999px;color:#f5c95e;font-size:11px;font-weight:700;letter-spacing:.02em;margin-left:10px;padding:3px 8px;vertical-align:middle}
  .yt-hero-figure .yt-provisional{color:#f5c95e;display:inline-block;font-size:11px;margin-top:0}
`;

export interface ProcessingNoticeOptions {
  // Where to send the reader for the numbers this work will change.
  dashboardHref?: string;
  now?: number;
}

// The buffer between "imported" and "trustworthy": what the worker is still
// doing, how far along it is, and that the numbers on screen will move.
// Renders nothing once there is no actionable work, so pages read normally
// the moment processing is over.
export function processingNotice(
  status: YoutubeProcessingStatus | undefined,
  lang: Lang = 'en',
  options: ProcessingNoticeOptions = {},
): string {
  if (!status || status.pending <= 0) return '';
  const t = messages(lang);
  const format = (value: number) => new Intl.NumberFormat('en').format(value);
  const stage = (label: string, item: { done: number; total: number } | null, started: boolean) => {
    if (!item) return '';
    const pct = item.total ? Math.round(item.done / item.total * 100) : 0;
    const text = started || item.done > 0
      ? `${format(item.done)} / ${format(item.total)}`
      : t.processingNotStarted;
    return `<div class="yt-processing-stage"><span>${label}<em>${text}</em></span><i><b style="width:${pct}%"></b></i></div>`;
  };
  const eta = status.estimatedMinutes === null ? '' : `<span>${t.processingEta(status.estimatedMinutes)}</span>`;
  const last = status.lastCycleAt
    ? `<span>${t.processingLastCycle(timeAgo(status.lastCycleAt, lang, options.now))}</span>`
    : `<span>${t.processingChecks}</span>`;
  const error = status.lastError ? `<p class="yt-processing-error">${t.processingError}</p>` : '';
  const link = options.dashboardHref
    ? ` <a href="${html(options.dashboardHref)}">${t.processingOpenDashboard}</a>` : '';
  return `<aside class="yt-processing" role="status" aria-live="polite" data-youtube-processing="${status.stage}">
    <div class="yt-processing-head"><strong>${t.processingTitle}</strong>${eta}${last}</div>
    <div class="yt-processing-stages">
      ${stage(t.processingMetadata, status.metadata, status.stage === 'metadata' || status.stage === 'topics')}
      ${stage(t.processingTopics, status.topics, status.stage === 'topics')}
    </div>
    <p>${t.processingProvisional} ${t.processingAffects}${link}</p>
    ${error}
  </aside>`;
}
