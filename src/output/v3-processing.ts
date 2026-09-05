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
  if (!options.alwaysShow && !(options.ownerDetails && status.state !== 'disabled') && !metadataPending && ['done', 'disabled'].includes(status.state)) return '';
  const zh = lang === 'zh';
  const number = (value: number) => new Intl.NumberFormat(zh ? 'zh-TW' : 'en').format(value);
  const label = 'v3 ' + {
    disabled: zh ? '興趣分析尚未啟用' : 'Interest analysis is not enabled',
    missing: zh ? '等待建立興趣輪廓' : 'Waiting for an interest profile',
    queued: zh ? '興趣分析已排程' : 'Interest analysis queued',
    running: zh ? '興趣分析進行中' : 'Interest analysis in progress',
    retry: zh ? '興趣分析等待重試' : 'Interest analysis awaiting retry',
    failed: zh ? '興趣分析暫時未完成' : 'Interest analysis could not finish',
    done: zh ? '興趣輪廓已建立' : 'Interest profile ready',
    provisional: zh ? '興趣輪廓為暫定結果' : 'Interest profile is provisional',
    stale: zh ? '等待更新興趣輪廓' : 'Waiting for an updated interest profile',
  }[status.state];
  const details: string[] = [];
  let fixedDetails = 0;
  if (options.ownerDetails) {
    const m = status.metadata;
    const completed = Math.max(0, m.videos - m.videosPendingMetadata);
    details.push(zh
      ? `影片資料：${number(completed)} / ${number(m.videos)} 部影片已查詢${m.channelsPendingMetadata ? `；${number(m.channelsPendingMetadata)} 個頻道待更新` : ''}。`
      : `Video metadata: ${number(completed)} / ${number(m.videos)} videos checked${m.channelsPendingMetadata ? `; ${number(m.channelsPendingMetadata)} channels awaiting refresh` : ''}.`);
    if (!m.enabled && m.videosPendingMetadata + m.channelsPendingMetadata > 0) details.push(zh
      ? '此部署未啟用影片與頻道資料更新。' : 'Video and channel metadata updates are not enabled on this deployment.');
    if (status.state !== 'disabled') details.push(zh
      ? `興趣分析範圍：最近觀看的最多 ${number(status.backfillVideoLimit)} 部不同影片。`
      : `Interest analysis covers up to ${number(status.backfillVideoLimit)} most recently watched distinct videos.`);
    fixedDetails = details.length;
    const progress = status.progress;
    if (progress) {
      const phase = progress.phase === 'classification'
        ? (zh ? '本輪影片分類' : 'Video classification in this run')
        : progress.phase === 'embedding'
          ? (progress.genre ? (zh ? `${progress.genre} 的 tag 向量` : `${progress.genre} tag embeddings`) : (zh ? '目前批次的 tag 向量' : 'Tag embeddings in the current batch'))
          : (zh ? '頻道類型分析' : 'Channel-type analysis');
      const counts = progress.phase === 'channels'
        // The worker reports the source-video count here, not channel completion.
        ? (zh ? `來源 ${number(progress.total)} 部影片` : `${number(progress.total)} source videos`)
        : `${number(progress.processed)} / ${number(progress.total)} ${progress.phase === 'embedding' ? 'tags' : zh ? '部影片' : 'videos'}`;
      details.push(`${status.state === 'retry' ? (zh ? '上次進度：' : 'Last reported progress: ') : ''}${html(phase)}${zh ? '：' : ': '}${counts}${zh ? '。' : '.'}`);
      if (progress.phase === 'embedding') details.push(zh
        ? '此數量僅代表該批次或類別的 tags，不代表全部影片的完成比例。'
        : 'These counts describe batch or category tags, not completion across all videos.');
    }
    if (status.profile) {
      const p = status.profile;
      details.push(zh
        ? `${p.currentVersion ? '已儲存' : '前次'} v3 輪廓：已分類 ${number(p.processedVideos)} / ${number(p.totalVideos)} 部來源影片${p.provisional ? '，結果仍為暫定' : ''}。`
        : `${p.currentVersion ? 'Saved' : 'Previous'} v3 profile: ${number(p.processedVideos)} / ${number(p.totalVideos)} source videos classified${p.provisional ? '; results remain provisional' : ''}.`);
      if (Number.isFinite(Date.parse(p.builtAt))) details.push(zh
        ? `最近輪廓更新：${html(new Date(p.builtAt).toLocaleString('zh-TW', { hour12: false }))}。`
        : `Profile last updated: ${html(new Date(p.builtAt).toLocaleString('en', { hour12: false }))}.`);
    }
    if (status.retryAt) details.push(zh
      ? `背景工作將於 ${html(new Date(status.retryAt).toLocaleString('zh-TW', { hour12: false }))} 之後重試。`
      : `The background job is scheduled to retry after ${html(new Date(status.retryAt).toLocaleString('en', { hour12: false }))}.`);
  } else if (metadataPending || ['queued', 'running', 'retry', 'missing', 'stale', 'provisional'].includes(status.state)) {
    details.push(zh ? '影片資料或興趣輪廓仍在更新，分析結果可能調整。' : 'Video metadata or the interest profile is still being updated; analysis may change.');
  }
  const p = status.progress;
  const meter = options.ownerDetails && status.state === 'running' && p && p.phase !== 'channels' && p.total > 0
    ? `<progress aria-label="${zh ? '目前分析階段' : 'Current analysis phase'}" max="${p.total}" value="${Math.max(0, Math.min(p.total, p.processed))}"></progress>` : '';
  const link = options.ownerDetails && options.dashboardHref ? `<p><a href="${html(options.dashboardHref)}">${zh ? '查看分析' : 'View analysis'}</a></p>` : '';
  return `<aside class="yt-v3-processing" role="status" aria-live="polite" data-v3-processing="${status.state}"><header><strong>${zh ? '資料處理狀態' : 'Data processing status'}</strong><span data-v3-state-label>${label}</span></header>${details.slice(0, fixedDetails).map(text => `<p>${text}</p>`).join('')}<div data-v3-snapshot>${details.slice(fixedDetails).map(text => `<p>${text}</p>`).join('')}${meter}</div>${options.ownerDetails && status.state !== 'disabled' ? processingMonitor(lang) : ''}${link}</aside>`;
}
