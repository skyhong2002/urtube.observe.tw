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
  // Personal progress reports outcomes, not job diagnostics or internal batch denominators.
  const states = {
    queued: t('等待處理', 'Waiting'), running: t('處理中', 'In progress'),
    failed: t('分析暫停', 'Analysis paused'), done: t('已完成', 'Complete'),
    missing: t('等待分析', 'Awaiting analysis'),
  };
  function render(data) {
    const job = data.job, profile = data.profile, progress = job?.progress;
    const state = job?.state || 'missing';
    const label = states[state] || t('暫時無法確認進度', 'Progress is unavailable');
    const output = document.createDocumentFragment();
    if (data.pipeline) {
      const names = { metadata: t('影片資訊', 'Video information'), topics: t('觀看主題', 'Viewing topics'),
        keywords: t('常見關鍵字', 'Common keywords'), v3: t('興趣分類', 'Interest categories'),
        embedding: t('共同興趣分析', 'Shared interest analysis'), channels: t('頻道興趣', 'Channel interests') };
      const labels = { waiting: t('等待資料', 'Awaiting data'), queued: t('等待處理', 'Waiting'),
        running: t('處理中', 'In progress'), done: t('已完成', 'Complete'), disabled: t('暫不可用', 'Unavailable'),
        failed: t('等待重試', 'Awaiting retry'), blocked: t('資料尚未齊全', 'Incomplete data'),
        review: t('結果準備中', 'Preparing results'), retained: t('已有分析結果', 'Results available') };
      for (const stage of data.pipeline) {
        const section = node('section'); section.className = 'yt-pipeline-stage'; section.dataset.pipelineStage = stage.id;
        const heading = node('div'); heading.className = 'yt-pipeline-heading';
        heading.append(node('h3', names[stage.id]), node('span', labels[stage.state])); section.append(heading);
        // Embedding batches and channel source counts are not overall completion percentages.
        const hasVideoCount = !['embedding', 'channels'].includes(stage.id) && stage.total > 0 && stage.done !== null;
        const meter = node('progress'); meter.setAttribute('aria-label', names[stage.id]);
        if (hasVideoCount) { meter.max = stage.total; meter.value = Math.max(0, Math.min(stage.total, stage.done)); }
        else if (stage.state !== 'running') { meter.max = 1; meter.value = stage.state === 'done' ? 1 : 0; }
        section.append(meter);
        if (hasVideoCount) section.append(node('p', number(stage.done) + ' / ' + number(stage.total) + t(' 部影片', ' videos')));
        if (stage.state === 'running' && stage.estimatedMinutes !== null) section.append(node('p',
          t('估計約 ', 'About ') + number(stage.estimatedMinutes) + t(' 分鐘，不含等待時間', ' minutes, excluding wait time')));
        output.append(section);
      }
      panel.dataset.processingLive = 'true';
    } else {
      output.append(node('p', label));
      if (progress?.phase === 'classification') output.append(node('p', number(progress.processed) + ' / ' + number(progress.total) + t(' 部影片', ' videos')));
    }
    if (state === 'failed') output.append(node('p', t('分析暫時遇到問題，已完成的結果仍可查看。', 'Analysis encountered a problem. Completed results remain available.')));
    if (profile) {
      const details = node('details'); details.className = 'yt-monitor-details'; details.open = detailsOpen;
      details.addEventListener('toggle', () => { detailsOpen = details.open; });
      details.append(node('summary', t('分析資料', 'Analysis data')));
      details.append(node('p', number(profile.processedVideos) + ' / ' + number(profile.totalVideos) + t(' 部影片已分類', ' videos classified')));
      if (date(profile.builtAt) !== '—') details.append(node('p', t('更新於 ', 'Updated ') + date(profile.builtAt)));
      output.append(details);
    }
    content.replaceChildren(output);
    panel.querySelector('[data-v3-snapshot]').hidden = true;
    panel.querySelector('[data-v3-state-label]').textContent = data.pipeline ? t('整理進度', 'Preparation progress') : label;
    panel.dataset.v3Processing = state;
  }
  async function refresh() {
    clearTimeout(timer);
    if (busy || stopped || controller.signal.aborted || document.hidden || !visible()) return;
    busy = true; if (button) button.disabled = true;
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
      connection.textContent = t('更新於 ', 'Updated ') + date(Date.now());
    } catch (error) {
      if (controller.signal.aborted) return;
      retry = Math.min(retry * 2, 120000);
      connection.textContent = (timedOut ? t('讀取進度逾時。', 'Progress request timed out.') : stopped ? t('請重新登入以查看進度。', 'Sign in again to view progress.') : t('暫時無法更新進度。', 'Progress could not be updated.'))
        + (stopped ? '' : t(' 顯示內容可能是上次資料，稍後自動重試。', ' Displayed data may be stale. Retrying automatically.'));
    } finally {
      clearTimeout(timeout); controller.signal.removeEventListener('abort', abort);
      busy = false; if (button) button.disabled = stopped;
      if (!stopped && !controller.signal.aborted && !document.hidden && visible()) timer = setTimeout(refresh, retry);
    }
  }
  button?.addEventListener('click', refresh, { signal: controller.signal });
  document.addEventListener('visibilitychange', () => { clearTimeout(timer); if (!document.hidden) refresh(); }, { signal: controller.signal });
  window.addEventListener('urtube:processing-visibility', () => { clearTimeout(timer); if (visible()) refresh(); }, { signal: controller.signal });
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  refresh();
})();`;

export function processingMonitor(lang: 'en' | 'zh'): string {
  const zh = lang === 'zh';
  return `<div class="yt-processing-monitor" data-processing-monitor data-lang="${lang}"><div class="yt-monitor-controls"><span data-monitor-connection role="status">${zh ? '正在讀取進度…' : 'Loading progress…'}</span></div><div data-monitor-content></div></div><script>${processingMonitorScript}</script>`;
}
