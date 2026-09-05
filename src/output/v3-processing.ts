import type { V3ProcessingStatus } from '../youtube/v3-processing.js';
import type { Lang } from './i18n.js';
import { html } from './pages.js';
import { processingMonitor } from './processing-monitor.js';

export const v3ProcessingStyles = `
.yt-v3-processing{background:rgba(250,178,25,.07);border:1px solid rgba(250,178,25,.28);border-radius:12px;margin:0 0 18px;padding:14px 16px}
.yt-v3-processing header{align-items:baseline;display:flex;flex-wrap:wrap;gap:6px 14px}
.yt-v3-processing strong{color:var(--ink);font-size:14px}.yt-v3-processing header span{color:var(--muted);font-size:12px}
.yt-v3-processing p{color:var(--ink-2);font-size:13px;line-height:1.55;margin:8px 0 0}
.yt-v3-processing progress{accent-color:#e7ae35;display:block;height:6px;margin-top:8px;width:100%}
.yt-monitor-controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:12px}.yt-monitor-controls button{background:var(--raised);border:1px solid var(--line-strong);border-radius:6px;color:var(--ink);cursor:pointer;font:inherit;padding:8px 12px;min-height:44px}.yt-monitor-controls span{color:var(--muted);font-size:12px}.yt-monitor-genres{display:grid;grid-template-columns:minmax(80px,1fr) minmax(0,2fr);gap:6px 14px;font-size:13px}.yt-monitor-genres dd{margin:0;color:var(--ink-2)}.yt-monitor-error{overflow-wrap:anywhere}.yt-processing-monitor details{margin-top:12px}.yt-processing-monitor summary{cursor:pointer;font-size:13px}
[data-processing-live] [data-v3-static]{display:none}.yt-pipeline-stage{border-top:1px solid var(--line);padding:8px 0;min-width:0}.yt-pipeline-stage h3{font-size:14px;margin:0}.yt-pipeline-stage p{font-size:12px}.yt-pipeline-stage progress{height:5px;margin-top:5px}.yt-pipeline-stage p{margin:4px 0 0}.yt-pipeline-heading{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.yt-pipeline-heading h3{font-size:13px}.yt-pipeline-heading span{font-size:12px;color:var(--muted)}.yt-processing-monitor [data-monitor-content]{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));column-gap:20px}.yt-monitor-details{grid-column:1/-1}.yt-monitor-controls{margin-top:4px}.yt-monitor-details h3{font-size:13px}@media(max-width:900px){.yt-processing-monitor [data-monitor-content]{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:520px){.yt-processing-monitor [data-monitor-content]{grid-template-columns:minmax(0,1fr)}}
.yt-v3-processing a{color:var(--ink);font-weight:600}
`;

export interface V3ProcessingNoticeOptions {
  ownerDetails?: boolean;
  alwaysShow?: boolean;
  dashboardHref?: string;
}

export function v3ProcessingNotice(status: V3ProcessingStatus | undefined, lang: Lang = 'en', options: V3ProcessingNoticeOptions = {}): string {
  if (!status) return '';
  const metadataPending = status.metadata.enabled
    && status.metadata.videosPendingMetadata + status.metadata.channelsPendingMetadata > 0;
  if (!options.alwaysShow && !options.ownerDetails && !metadataPending && ['done', 'disabled'].includes(status.state)) return '';
  const zh = lang === 'zh';
  const number = (value: number) => new Intl.NumberFormat(zh ? 'zh-TW' : 'en').format(value);
  // A release interface names the analysis outcome, not the backend version.
  const label = {
    disabled: zh ? '興趣分析暫不可用' : 'Interest analysis is unavailable',
    missing: zh ? '等待興趣分析' : 'Awaiting interest analysis',
    queued: zh ? '等待興趣分析' : 'Awaiting interest analysis',
    running: zh ? '興趣分析進行中' : 'Interest analysis in progress',
    retry: zh ? '興趣分析等待重試' : 'Interest analysis awaiting retry',
    failed: zh ? '興趣分析暫停' : 'Interest analysis paused',
    done: zh ? '興趣分析已完成' : 'Interest analysis ready',
    provisional: zh ? '興趣資料尚未齊全' : 'Interest data is incomplete',
    stale: zh ? '等待更新興趣分析' : 'Awaiting updated interest analysis',
  }[status.state];
  const details: string[] = [];
  let fixedDetails = 0;
  if (options.ownerDetails) {
    const m = status.metadata;
    const completed = Math.max(0, m.videos - m.videosPendingMetadata);
    // Video progress and pending channels are separate facts; separate lines scan better on small screens.
    details.push(zh
      ? `影片資料：${number(completed)} / ${number(m.videos)} 部影片已查詢。`
      : `Video information: ${number(completed)} / ${number(m.videos)} videos checked.`);
    if (m.channelsPendingMetadata) details.push(zh
      ? `${number(m.channelsPendingMetadata)} 個頻道待更新。`
      : `${number(m.channelsPendingMetadata)} channels awaiting refresh.`);
    if (!m.enabled && m.videosPendingMetadata + m.channelsPendingMetadata > 0) details.push(zh
      ? '影片資訊更新暫不可用。' : 'Video information updates are unavailable.');
    fixedDetails = details.length;
    const progress = status.progress;
    // Only video classification has a denominator users can interpret as video progress.
    if (progress?.phase === 'classification') details.push(zh
      ? `影片分類：${number(progress.processed)} / ${number(progress.total)} 部影片。`
      : `Video classification: ${number(progress.processed)} / ${number(progress.total)} videos.`);
    if (status.profile && Number.isFinite(Date.parse(status.profile.builtAt))) details.push(zh
      ? `分析更新於 ${html(new Date(status.profile.builtAt).toLocaleString('zh-TW', { hour12: false }))}。`
      : `Analysis updated: ${html(new Date(status.profile.builtAt).toLocaleString('en', { hour12: false }))}.`);
    if (status.state === 'failed') details.push(zh
      ? '分析暫時遇到問題，已完成的結果仍可查看。'
      : 'Analysis encountered a problem. Completed results remain available.');
  } else if (metadataPending || ['queued', 'running', 'retry', 'missing', 'stale', 'provisional'].includes(status.state)) {
    details.push(zh ? '影片資訊或興趣分析尚未完成，結果可能調整。' : 'Video information or interest analysis is not yet complete. Results may change.');
  }
  const p = status.progress;
  const meter = options.ownerDetails && status.state === 'running' && p && p.phase === 'classification' && p.total > 0
    ? `<progress aria-label="${zh ? '目前分析階段' : 'Current analysis phase'}" max="${p.total}" value="${Math.max(0, Math.min(p.total, p.processed))}"></progress>` : '';
  const link = options.ownerDetails && options.dashboardHref ? `<p><a href="${html(options.dashboardHref)}">${zh ? '查看分析' : 'View analysis'}</a></p>` : '';
  return `<aside class="yt-v3-processing" role="status" aria-live="polite" data-v3-processing="${status.state}"><header><strong>${zh ? '資料處理狀態' : 'Data processing status'}</strong><span data-v3-state-label>${label}</span></header>${details.slice(0, fixedDetails).map(text => `<p data-v3-static>${text}</p>`).join('')}<div data-v3-snapshot>${details.slice(fixedDetails).map(text => `<p>${text}</p>`).join('')}${meter}</div>${options.ownerDetails ? processingMonitor(lang) : ''}${link}</aside>`;
}
