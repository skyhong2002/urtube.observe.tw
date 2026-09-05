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
  let timer, busy = false, stopped = false, retry = 30000;
  const visible = () => document.documentElement?.dataset.processingVisibility !== 'hidden';
  const node = (tag, text) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
  const states = {
    queued: t('等待處理', 'Queued'), running: t('處理中', 'Running'),
    failed: t('處理失敗，目前未在執行', 'Failed; not currently running'),
    done: t('工作已完成', 'Job completed'), missing: t('尚未排程', 'Not scheduled'),
  };
  const genres = { Politic: '政治', Music: '音樂', Sport: '運動', Education: '教育',
    'Video gaming': '電玩', Streaming: '直播', News: '新聞', Podcast: 'Podcast', 'channel type': '頻道類型' };
  function render(data) {
    const job = data.job, profile = data.profile, progress = job?.progress;
    const state = job?.state || 'missing';
    const label = states[state] || t('狀態未知', 'Unknown state');
    const fragment = document.createDocumentFragment();
    fragment.append(node('p', label));
    if (state === 'failed') fragment.append(node('p', t('已儲存的結果仍可使用；失敗不代表工作仍在背景執行。', 'Saved results remain available. A failed job is not still running in the background.')));
    if (progress) {
      const phase = progress.phase === 'classification' ? t('影片分類', 'Video classification')
        : progress.phase === 'embedding' ? t('標籤向量（目前批次）', 'Tag embeddings (current batch)')
        : t('頻道類型處理', 'Channel-type processing');
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
      const incomplete = !profile.complete || Object.values(profile.genres).some(g => g.status === 'insufficient');
      if (incomplete) fragment.append(node('p', t('影片分類完成不等於所有類別都已可用，請查看下方各類別狀態。', 'Classified videos do not mean every category is ready. Check the category statuses below.')));
      const details = node('details'); details.open = true;
      details.append(node('summary', t('九類處理結果', 'Results by category')));
      const list = node('dl'); list.className = 'yt-monitor-genres';
      const labels = { ready: t('可用', 'Ready'), empty: t('無此類興趣', 'No interests in this category'), insufficient: t('資料不足', 'Insufficient data') };
      for (const genre of data.genres) {
        const result = profile.genres[genre];
        list.append(node('dt', zh ? (genres[genre] || genre) : genre), node('dd', (labels[result?.status] || t('尚未建立', 'Not built'))
          + (result ? ' · ' + number(result.videoCount) + t(' 部影片', ' videos') : '')));
      }
      details.append(list); fragment.append(details);
    } else fragment.append(node('p', t('尚無已儲存輪廓。', 'No saved profile yet.')));
    content.replaceChildren(fragment);
    panel.querySelector('[data-v3-snapshot]').hidden = true;
    panel.querySelector('[data-v3-state-label]').textContent = label;
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
      const response = await fetch('/api/matching-v3', { cache: 'no-store', signal: request.signal });
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
  return `<div class="yt-processing-monitor" data-processing-monitor data-lang="${lang}"><div class="yt-monitor-controls"><button type="button">${zh ? '更新狀態' : 'Refresh status'}</button><span data-monitor-connection role="status">${zh ? '正在讀取最新工作狀態…' : 'Loading current job status…'}</span></div><div data-monitor-content></div><details class="yt-monitor-admin"><summary>${zh ? '全站監控' : 'Site-wide monitoring'}</summary><p><a href="/matching-v3/admin">${zh ? '開啟原監控面板（限管理員）' : 'Open the original monitor (administrators only)'}</a></p></details></div><script>${processingMonitorScript}</script>`;
}
