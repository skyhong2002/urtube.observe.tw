// Uses the existing session-scoped API. No administrator data or job mutations.
export const processingMonitorScript = String.raw`
(() => {
  const root = document.currentScript.previousElementSibling;
  const panel = root.closest('[data-v3-processing]');
  const zh = root.dataset.lang === 'zh';
  const t = (a, b) => zh ? a : b;
  const number = value => Number(value || 0).toLocaleString(zh ? 'zh-TW' : 'en');
  const date = value => value && Number.isFinite(new Date(value).getTime())
    ? new Date(value).toLocaleString(zh ? 'zh-TW' : 'en', { timeZone: 'Asia/Taipei', hour12: false }) : '—';
  const content = root.querySelector('[data-monitor-content]');
  const connection = root.querySelector('[data-monitor-connection]');
  const button = root.querySelector('button');
  const controller = window.urtubePageController || new AbortController();
  let detailsOpen = false;
  let timer, busy = false, stopped = false, retry = 30000;
  const visible = () => document.documentElement?.dataset.processingVisibility !== 'hidden';
  const node = (tag, text) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
  const states = {
    queued: t('等待處理', 'Queued'), running: t('處理中', 'Running'),
    failed: t('處理失敗，目前未在執行', 'Failed; not currently running'),
    done: t('工作已完成', 'Job completed'), missing: t('尚未排程', 'Not scheduled'),
  };
  function render(data) {
    const job = data.job, profile = data.profile, progress = job?.progress;
    const state = job?.state || 'missing';
    const label = states[state] || t('狀態未知', 'Unknown state');
    const output = document.createDocumentFragment();
    let fragment = output;
    const explanations = [];
    if (data.pipeline) {
      const names = { metadata: t('影片資料', 'Video metadata'), topics: t('主題動態分類', 'Topic dynamics classification'),
        keywords: t('常見關鍵字來源', 'Common keyword sources'), v3: t('v3 興趣分類', 'v3 interest classification'),
        embedding: t('v3 標籤向量', 'v3 tag embeddings'), channels: t('v3 頻道分析', 'v3 channel analysis') };
      const labels = { waiting: t('等待資料', 'Waiting for data'), queued: t('等待背景服務', 'Waiting for worker'),
        running: t('處理中', 'Running'), done: t('已完成', 'Complete'), disabled: t('未啟用', 'Disabled'),
        failed: t('等待重試', 'Awaiting retry'), blocked: t('未通過品質門檻', 'Quality requirements not met'),
        review: t('等待啟用結果', 'Awaiting activation'), retained: t('保留既有版本', 'Existing version retained') };
      const notes = {
        'video-metadata': t('已查詢影片資料；無法取得的影片也算已查詢。', 'Videos checked, including unavailable videos.'),
        'keyword-source': t('關鍵字在開啟總覽／洞察時依影片標題、tags 與描述即時計算，沒有獨立的 AI 排程。此列顯示來源資料完成率。', 'Keywords are computed from titles, tags and descriptions when a dashboard opens, without a separate AI job. This bar tracks source metadata.'),
        'readiness': t('至少需要 24 部可用影片、98% 影片資料完成，之後自動開始分類。', 'Classification starts automatically after at least 24 available videos and 98% metadata coverage.'),
        'quality-gate': t('分類已處理，但品質不足，不能當作已完成的主題結果。', 'Classification was processed, but the result does not meet quality requirements.'),
        'activation-pending': t('分類通過門檻，等待啟用；新帳號第一版會由下一輪背景工作自動啟用。', 'Classification passed quality checks. The worker automatically activates the first version for new accounts.'),
        'legacy-retained': t('既有主題版本保留，不會自動重新分類。', 'The existing topic version is retained without automatic reclassification.'),
        'embedding-batch': t('向量數量是目前批次／類別的 tags，不是全帳號進度。', 'Embedding counts cover the current batch or category, not the entire account.'),
        'channel-count-unavailable': t('目前背景服務未回報逐頻道完成數，不以來源影片數冒充頻道完成率。', 'Per-channel completion counts are not reported; source video counts are not a channel completion percentage.'),
      };
      for (const stage of data.pipeline) {
        const section = node('section'); section.className = 'yt-pipeline-stage'; section.dataset.pipelineStage = stage.id;
        const heading = node('div'); heading.className = 'yt-pipeline-heading';
        heading.append(node('h3', names[stage.id]), node('span', labels[stage.state])); section.append(heading);
        const meter = node('progress'); meter.setAttribute('aria-label', names[stage.id]);
        if (stage.total > 0 && stage.done !== null) { meter.max = stage.total; meter.value = Math.max(0, Math.min(stage.total, stage.done)); }
        else if (stage.state !== 'running') { meter.max = 1; meter.value = stage.state === 'done' ? 1 : 0; }
        section.append(meter);
        if (stage.done !== null && stage.total !== null) section.append(node('p', number(stage.done) + ' / ' + number(stage.total) + (stage.id === 'embedding' ? ' tags' : t(' 部影片', ' videos'))));
        const eta = stage.state === 'done' ? t('剩餘時間：0 分鐘', 'Time remaining: 0 minutes')
          : stage.estimatedMinutes !== null ? t('依近期速度估計約 ', 'Estimated from recent progress: about ') + number(stage.estimatedMinutes) + t(' 分鐘（不含等待與重試）', ' minutes (excluding queueing and retries)')
          : stage.state === 'running' ? t('時間估算中', 'Estimating time')
          : t('時間待估', 'ETA pending');
        section.append(node('p', eta));
        if (stage.state === 'queued' && ['metadata', 'topics', 'keywords'].includes(stage.id)) explanations.push(node('p', t('背景服務閒置時約每 5 分鐘檢查新工作。', 'The idle worker checks for new work about every 5 minutes.')));
        if (notes[stage.detail]) explanations.push(node('p', names[stage.id] + '：' + notes[stage.detail]));
        fragment.append(section);
      }
      panel.dataset.processingLive = 'true';
    }
    const details = node('details'); details.className = 'yt-monitor-details'; details.open = detailsOpen;
    details.addEventListener('toggle', () => { detailsOpen = details.open; });
    details.append(node('summary', t('處理明細與說明', 'Processing details')));
    output.append(details); fragment = details; fragment.append(...explanations);
    if (data.pipeline) fragment.append(node('h3', t('v3 工作明細', 'v3 job details')));
    fragment.append(node('p', label));
    if (state === 'failed') fragment.append(node('p', t('已儲存的結果仍可使用；失敗不代表工作仍在背景執行。', 'Saved results remain available. A failed job is not still running in the background.')));
    if (progress) {
      const phase = progress.phase === 'classification' ? t('影片分類', 'Video classification')
        : progress.phase === 'embedding' ? t('標籤向量（目前批次）', 'Tag embeddings (current batch)')
        : t('其他類別處理', 'Channel-type processing');
      const prefix = state === 'running' ? t('目前階段：', 'Current phase: ') : t('最後回報階段：', 'Last reported phase: ');
      const counts = progress.phase === 'channels' ? t('來源影片 ', 'Source videos: ') + number(progress.total)
        : number(progress.processed) + ' / ' + number(progress.total) + (progress.phase === 'embedding' ? ' tags' : t(' 部影片', ' videos'));
      fragment.append(node('p', prefix + phase + (progress.genre ? ' · ' + progress.genre : '') + ' · ' + counts));
      if (progress.phase !== 'channels' && progress.total > 0) {
        const meter = node('progress'); meter.max = progress.total; meter.value = Math.max(0, Math.min(progress.total, progress.processed));
        meter.setAttribute('aria-label', prefix + phase); fragment.append(meter);
      }
      if (progress.phase === 'embedding') fragment.append(node('p', t('這是目前批次的 tags 進度，不是全部影片的完成比例。', 'This is tag progress for the current batch, not completion across all videos.')));
    } else fragment.append(node('p', t('尚無階段進度回報。', 'No phase progress has been reported.')));
    if (job) {
      fragment.append(node('p', t('失敗次數：', 'Failed attempts: ') + number(job.attempts)));
      if (job.error) { const error = node('p', t('最近錯誤：', 'Last error: ') + job.error); error.className = 'yt-monitor-error'; fragment.append(error); }
      if (state === 'queued') fragment.append(node('p', job.retry_at > Date.now()
        ? t('預定重試：', 'Retry scheduled for: ') + date(job.retry_at)
        : t('已進入佇列，等待背景服務接手。', 'Queued, waiting for a worker.')));
    }
    if (profile) {
      fragment.append(node('p', t('已儲存輪廓：', 'Saved profile: ') + number(profile.processedVideos) + ' / ' + number(profile.totalVideos) + t(' 部影片已分類', ' videos classified')
        + ' · ' + (profile.currentVersion ? t('目前版本', 'Current version') : t('舊版本', 'Older version'))));
      fragment.append(node('p', t('最近輪廓更新（台灣時間）：', 'Profile updated (Taipei time): ') + date(profile.builtAt)));
    } else fragment.append(node('p', t('尚無已儲存輪廓。', 'No saved profile yet.')));
    content.replaceChildren(output);
    panel.querySelector('[data-v3-snapshot]').hidden = true;
    panel.querySelector('[data-v3-state-label]').textContent = data.pipeline ? t('各項處理進度', 'Processing progress by stage') : label;
    panel.dataset.v3Processing = state;
  }
  async function refresh() {
    clearTimeout(timer);
    if (busy || stopped || controller.signal.aborted || document.hidden || !visible()) return;
    busy = true; button.disabled = true;
    let timedOut = false;
    const request = new AbortController();
    const abort = () => request.abort();
    controller.signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; request.abort(); }, 15000);
    try {
      const response = await fetch('/api/processing', { cache: 'no-store', signal: request.signal });
      if (response.status === 401 || response.status === 403) {
        stopped = true; content.replaceChildren(); panel.querySelector('[data-v3-snapshot]').hidden = true;
        panel.querySelector('[data-v3-state-label]').textContent = t('登入狀態已變更', 'Session changed');
        throw new Error(t('登入已失效或無法存取，請重新登入後查看。', 'Your session expired or access is unavailable. Sign in again.'));
      }
      if (!response.ok) throw new Error(t('暫時無法取得最新進度。', 'Latest progress is temporarily unavailable.'));
      const data = await response.json();
      if (controller.signal.aborted) return;
      render(data); retry = 30000;
      connection.textContent = t('狀態讀取於 ', 'Status checked at ') + date(Date.now()) + t(' · 每 30 秒更新', ' · refreshes every 30 seconds');
    } catch (error) {
      if (controller.signal.aborted) return;
      retry = Math.min(retry * 2, 120000);
      connection.textContent = (timedOut ? t('讀取進度逾時。', 'Progress request timed out.') : error.message)
        + (stopped ? '' : t(' 顯示內容可能是上次資料，稍後自動重試。', ' Displayed data may be stale; retrying automatically.'));
    } finally {
      clearTimeout(timeout); controller.signal.removeEventListener('abort', abort);
      busy = false; button.disabled = stopped;
      if (!stopped && !controller.signal.aborted && !document.hidden && visible()) timer = setTimeout(refresh, retry);
    }
  }
  button.addEventListener('click', refresh, { signal: controller.signal });
  document.addEventListener('visibilitychange', () => { clearTimeout(timer); if (!document.hidden) refresh(); }, { signal: controller.signal });
  window.addEventListener('urtube:processing-visibility', () => { clearTimeout(timer); if (visible()) refresh(); }, { signal: controller.signal });
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  refresh();
})();`;

export function processingMonitor(lang: 'en' | 'zh'): string {
  const zh = lang === 'zh';
  return `<div class="yt-processing-monitor" data-processing-monitor data-lang="${lang}"><div class="yt-monitor-controls"><button type="button">${zh ? '更新狀態' : 'Refresh status'}</button><span data-monitor-connection role="status">${zh ? '正在讀取最新工作狀態…' : 'Loading current job status…'}</span></div><div data-monitor-content></div></div><script>${processingMonitorScript}</script>`;
}
