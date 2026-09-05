const $ = id => document.getElementById(id);
const labels = { gpt_classification: 'GPT 影片分類', gemini_embedding: 'Gemini tag 向量', channel_processing: '頻道類型處理', queued: '等待／續跑', running: '處理中', done: '工作完成', failed: '失敗', classification: '影片分類', embedding: 'tag 向量（本批）', channels: '頻道處理', ready: '可用', empty: '無此類興趣', insufficient: '資料不足', success: '成功', partial: '部分成功' };
const date = value => value ? new Date(value).toLocaleString('zh-TW', { hour12: false }) : '尚無紀錄';
const number = value => Number(value || 0).toLocaleString('zh-TW');
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function row(body, cells) { const tr = node('tr'); for (const content of cells) { const td = node('td'); td.append(content instanceof Node ? content : node('span', String(content))); tr.append(td); } body.append(tr); }
const REFRESH_INTERVAL = 30000, MAX_RETRY_INTERVAL = 120000;
let data, busy = false, timer, retryInterval = REFRESH_INTERVAL;
function renderUsers() {
  $('users').replaceChildren();
  for (const user of data.users.filter(u => u.handle.toLowerCase().includes($('search').value.toLowerCase()))) {
    const job = user.job, p = job?.progress;
    const phase = node('div', p ? `${labels[p.phase] || p.phase}：${number(p.processed)} / ${number(p.total)}` : '等待首次處理');
    if (p?.total) { const meter = node('progress'); meter.max = p.total; meter.value = p.processed; phase.append(meter); }
    const profile = node('div', user.usable ? '已有可用類別' : '尚無可用類別', user.usable ? 'good' : 'warn');
    if (user.profile) {
      profile.append(node('small', `${number(user.profile.processedVideos)} / ${number(user.profile.totalVideos)} 部影片 · ${user.currentVersion ? '目前版本' : '舊版本'}`));
      const detail = node('details'); detail.append(node('summary', '查看九類狀態'));
      for (const genre of data.genres) detail.append(node('small', `${genre}：${labels[user.profile.genres[genre]?.status] || '尚未建立'} · ${user.profile.genres[genre]?.clusterCount ?? 0} 個 cluster`));
      profile.append(detail, node('small', `建立於 ${date(user.profile.builtAt)}`));
    }
    const error = node('div', `${job?.attempts || 0} 次失敗`);
    if (job?.error) error.append(node('small', job.error));
    if (job?.state === 'queued' && job.retry_at > data.now) error.append(node('small', `下次 ${date(job.retry_at)}`));
    const retry = node('button', '重試'); retry.disabled = !job || job.state === 'running' || job.state === 'done';
    retry.addEventListener('click', async () => { retry.disabled = true; try {
      const response = await fetch(`/api/matching-v3/admin/retry/${user.id}`, { method: 'POST' });
      if (!response.ok) throw new Error('重試未成功，請重新登入或更新狀態。');
      $('feedback').textContent = `${user.handle} 已重新排程，沿用成功快取。`; await refresh();
    } catch (error) { $('feedback').textContent = error.message; } finally { retry.disabled = false; } });
    row($('users'), [user.handle, labels[job?.state] || '尚未排程', phase, profile, error, retry]);
  }
}
function render() {
  $('cards').replaceChildren();
  for (const [label, value, note] of [
    ['影片分類快取', data.cache.find(c => c.kind === 'classification')?.count, '全站共用，跨帳號去重'],
    ['Gemini 向量快取', data.cache.find(c => c.kind === 'embedding')?.count, '已成功寫入資料庫的 tag 向量'],
    ['有可用類別的輪廓', data.users.filter(u => u.usable).length, `共 ${data.users.length} 個使用者`],
    ['尚待完成工作', data.users.filter(u => u.job?.state !== 'done').length, '包含排程、處理中與失敗'],
  ]) { const card = node('div', label, 'card'); card.append(node('strong', number(value), 'value'), node('small', note)); $('cards').append(card); }
  const fresh = data.heartbeat && data.now - data.heartbeat < 60000;
  $('worker').textContent = `Worker：${fresh ? '心跳正常' : '尚無近期心跳，請檢查服務'} · 最後心跳 ${date(data.heartbeat)} · ${data.concurrency} 個並行工作 · 每人 backfill 最新 ${number(data.backfillVideoLimit || 2000)} 部 · 分類最多 ${data.batchSize} 部／批 · 請求模型 ${data.classificationModel} / effort ${data.reasoningEffort}`;
  $('worker').className = fresh ? 'good' : 'warn';
  $('budget').textContent = `今日操作 ${number(data.budget.calls)} · ${data.dailyLimit ? `每日上限 ${number(data.dailyLimit)}` : '目前未設每日上限（暫時開放）'} · 日界線為台灣時間上午 8 點`;
  $('providers').replaceChildren();
  for (const kind of ['gpt_classification', 'gemini_embedding', 'channel_processing']) {
    const stats = data.recent.filter(r => r.kind === kind), success = stats.find(r => r.status === 'success');
    const cacheKind = { gpt_classification: 'classification', gemini_embedding: 'embedding', channel_processing: 'channel' }[kind];
    row($('providers'), [labels[kind], number(stats.reduce((sum, s) => sum + s.calls, 0)), number(stats.reduce((n, r) => n + (r.valid_items ?? 0), 0)), `${number(stats.find(r => r.status === 'partial')?.calls)} / ${number(stats.find(r => r.status === 'failed')?.calls)}`, success?.average_ms != null ? `${(success.average_ms / 1000).toFixed(2)} 秒` : '—', date(data.cache.find(c => c.kind === cacheKind)?.latest)]);
  }
  renderUsers(); $('events').replaceChildren();
  for (const event of data.operations) row($('events'), [date(event.started_at), labels[event.kind] || event.kind, `${number(event.valid_items ?? (event.status === 'success' ? event.items : 0))} / ${number(event.items)}`, event.status === 'running' && data.now - event.started_at > 180000 ? '中斷／逾時' : (labels[event.status] || event.status) + (event.error ? ` · ${event.error}` : ''), event.finished_at ? `${((event.finished_at - event.started_at) / 1000).toFixed(1)} 秒` : '—', tokenText(event), timingText(event), rateText(event)]);
}
function timingText(event) {
  const u = event.usage_json ? JSON.parse(event.usage_json) : null;
  return u?.requestMs !== undefined ? `${(u.queueMs / 1000).toFixed(2)} / ${(u.requestMs / 1000).toFixed(2)} 秒` : '—';
}
function rateText(event) {
  const u = event.usage_json ? JSON.parse(event.usage_json) : null;
  const tokens = u?.outputTokens ?? u?.estimatedOutputTokens;
  const ms = u ? u.queueMs + u.requestMs : 0;
  return tokens != null && ms > 0 ? `${u.outputTokens == null ? '估算 ' : ''}${(tokens * 1000 / ms).toFixed(1)}` : '—';
}
function tokenText(event) {
  if (!event.usage_json) return '—';
  const usage = JSON.parse(event.usage_json);
  if (usage.inputTokens !== null && usage.outputTokens !== null) return `${number(usage.inputTokens)} / ${number(usage.outputTokens)}`;
  if (usage.estimatedInputTokens != null) return `估算 ${number(usage.estimatedInputTokens)} / ${usage.estimatedOutputTokens == null ? '—' : number(usage.estimatedOutputTokens)}（o200k_base）`;
  return `供應商未回傳（文字字元 ${number(usage.inputCharacters)} / ${number(usage.outputCharacters)}）`;
}
async function refresh() {
  clearTimeout(timer);
  if (busy || document.hidden) return;
  busy = true;
  try {
    const response = await fetch('/api/matching-v3/admin', { cache: 'no-store', signal: AbortSignal.timeout(35000) });
    if (!response.ok) throw new Error(response.status === 401 ? '登入已過期，請回配對頁重新登入。' : response.status === 403 ? '此帳號沒有管理員權限。' : '暫時無法取得資料');
    data = await response.json(); render(); $('connection').textContent = `已連線 · 資料更新於 ${date(data.sampledAt ?? data.now)}`;
    retryInterval = REFRESH_INTERVAL;
  } catch (error) {
    retryInterval = Math.min(retryInterval * 2, MAX_RETRY_INTERVAL);
    $('connection').textContent = `${error.message} · 以下可能為上次資料，稍後自動重試。`;
  } finally {
    busy = false;
    if (!document.hidden) timer = setTimeout(refresh, retryInterval);
  }
}
document.addEventListener('visibilitychange', () => {
  clearTimeout(timer);
  if (!document.hidden) refresh();
});
$('refresh').addEventListener('click', refresh); $('search').addEventListener('input', () => data && renderUsers()); refresh();
