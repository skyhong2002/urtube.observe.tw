/* Live UI: no demo people and no model-generated recommendation copy. */
const $ = id => document.getElementById(id);
const element = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
let state, selectedId, editId, mode, requestNumber = 0;
const lang = document.documentElement.lang.startsWith('zh') ? 'zh' : 'en';
const showView = view => {
  for (const [id, value] of [['mv-directory','all'],['mv-invitations','invites'],['mv-topic','topics']]) $(id).hidden = view !== value;
  $('mv-all').setAttribute('aria-current', String(view === 'all'));
  $('mv-invites').setAttribute('aria-current', String(view === 'invites'));
  const url = new URL(location.href); url.searchParams.set('view', view);
  if (view === 'topics' && selectedId) url.searchParams.set('topic', selectedId); else url.searchParams.delete('topic');
  history.replaceState(null, '', url);
};
$('mv-all').onclick = () => { requestNumber++; selectedId = null; showView('all'); renderTopics(); };
$('mv-invites').onclick = () => { requestNumber++; selectedId = null; showView('invites'); renderTopics(); };
const messages = { login_required: '登入已過期，請重新登入。', opt_in_required: '請先在「我的帳號」開啟參與配對。', profile_pending: '興趣輪廓尚未建立，請等待背景處理完成。', profile_changed: '輪廓剛更新，請重新配對。', matching_unavailable: '配對服務暫時無法使用，請稍後再試。', matching_in_progress: '配對仍在計算中。' };
async function api(path = '', method = 'GET', body) {
  const response = await fetch('/api/matching-v3' + path + '?lang=' + lang, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(messages[data?.error] || `服務暫時無法回應（HTTP ${response.status}），請稍後重試。`);
  if (!data) throw new Error('服務回應不完整，請重新嘗試配對。');
  return data;
}
function error(err) { showView('topics'); $('message').textContent = err.message; $('message').className = 'error'; }
async function load() {
  state = await api();
  $('status').replaceChildren();
  $('status').toggleAttribute('data-processing-status', state.optedIn);
  if (!state.optedIn) {
    $('status').append(element('span', '尚未開啟配對。請至 '));
    const link = element('a', '我的帳號'); link.href = '/account'; $('status').append(link, element('span', ' 開啟參與配對，再選擇興趣。'));
  } else {
    const profile = state.profile;
    $('status').append(element('span', profile ? `已建立 ${profile.processedVideos.toLocaleString()} 部不同影片的輪廓 · ${profile.complete ? '已有完整掃描紀錄' : '資料尚未齊全，配對為暫定'}${profile.currentVersion ? '' : ' · 演算法更新中'}` : '正在預先建立所有類別的配對輪廓，不需要先選擇興趣。'));
    if (state.job) $('status').append(element('p', `處理狀態：${({ queued: '排程中', running: '處理中', done: '完成', failed: '需重試' })[state.job.state] || state.job.state}`, 'small muted'));
    if (state.job?.progress && state.job.state !== 'done') {
      const p = state.job.progress;
      $('status').append(element('p', `${({ classification: '影片分類', embedding: 'Tag 向量', channels: '頻道分析' })[p.phase]}${p.genre ? ' · ' + p.genre : ''}：${p.processed.toLocaleString()} / ${p.total.toLocaleString()}`, 'small muted'));
    }
    if (state.job?.error === 'daily_budget_reached') $('status').append(element('p', '已達每日模型呼叫上限，將於台灣時間上午 8 點恢復處理。', 'small muted'));
    const retry = element('button', '更新處理狀態'); retry.onclick = () => load().catch(error); $('status').append(retry);
    if (state.job?.state === 'failed') {
      const rebuild = element('button', '重試建立輪廓'); rebuild.onclick = async () => { try { await api('/rebuild', 'POST'); await load(); } catch (err) { error(err); } }; $('status').append(rebuild);
    }
  }
  if (!state.preferences.topics.some(t => t.id === selectedId)) selectedId = null;
  const view = new URL(location.href).searchParams.get('view') || 'all';
  if (view === 'topics' && !selectedId) selectedId = state.preferences.topics.find(t => t.id === new URL(location.href).searchParams.get('topic'))?.id || state.preferences.topics[0]?.id;
  renderTopics(); renderDetail(); showView(view === 'topics' || view === 'invites' ? view : 'all');
}
function renderTopics() {
  const query = $('search').value.toLowerCase(); $('topics').replaceChildren();
  for (const topic of state.preferences.topics.filter(t => (t.name + t.genres.join(' ')).toLowerCase().includes(query))) {
    const button = element('button', undefined, 'topic'); button.setAttribute('aria-current', String(topic.id === selectedId));
    button.append(element('strong', topic.name), element('small', topic.genres.join(' · ')));
    button.onclick = () => { selectedId = topic.id; requestNumber++; showView('topics'); renderTopics(); renderDetail(); };
    $('topics').append(button);
  }
}
function renderDetail() {
  const topic = state.preferences.topics.find(t => t.id === selectedId); $('detail').replaceChildren();
  if (!topic) { $('detail').append(element('p', '先選擇興趣，再建立你的第一個配對主題。', 'empty')); return; }
  const top = element('div', undefined, 'detail-top'); top.append(element('h2', topic.name));
  const actions = element('div');
  const edit = element('button', '編輯'); edit.onclick = () => openEditor('topic', topic);
  const remove = element('button', '刪除'); remove.onclick = async () => {
    if (!confirm('刪除「' + topic.name + '」？')) return;
    try { await save({ ...state.preferences, topics: state.preferences.topics.filter(t => t.id !== topic.id) }); } catch (err) { error(err); }
  };
  actions.append(edit, remove); top.append(actions); $('detail').append(top);
  const chips = element('div', undefined, 'chips'); topic.genres.forEach(g => chips.append(element('span', g, 'chip'))); $('detail').append(chips);
  $('detail').append(element('p', '主題配對除錯模式：依所選類別的主題分數排序；分數尚未校準，不代表契合機率。', 'muted'));
  const match = element('button', '開始配對', 'primary');
  const result = element('div');
  match.onclick = async () => {
    const number = ++requestNumber; match.disabled = true; result.textContent = '正在比較核心興趣與比例…';
    try {
      const data = await api('/match', 'POST', { genres: topic.genres });
      if (number !== requestNumber) return;
      result.replaceChildren();
      if (!data.candidates.length) { result.append(element('p', '還沒有同意參與這些類別、且已完成輪廓處理的使用者。', 'empty')); return; }
      const cards = element('div', undefined, 'mt-grid');
      const rankedCards = data.candidates.flatMap(candidate => {
        // HTML comes from the same escaped server renderer as the member directory.
        const template = document.createElement('template');
        template.innerHTML = candidate.memberHtml || '';
        const card = template.content.querySelector('.mt-card');
        if (!card) return [];
        const score = typeof candidate.score === 'number' && Number.isFinite(candidate.score) ? candidate.score : null;
        card.dataset.topicScore = score === null ? '-1' : String(score);
        const debug = element('section', undefined, 'mv-topic-score');
        debug.append(element('strong', score === null ? '資料不足' : (score * 100).toFixed(1) + '%'));
        debug.append(element('small', '新版主題配對 · 除錯百分比（尚未校準，非機率）'));
        debug.append(element('p', candidate.provisional ? '暫定結果：部分資料尚未完成處理。' : '目前輪廓已完成處理。', 'muted'));
        debug.append(element('h3', '為什麼推薦給你'));
        if (candidate.detailsVisible) {
          const reasons = Array.isArray(candidate.reasons) ? candidate.reasons : [];
          reasons.forEach(reason => debug.append(element('p', reason.text)));
          if (!reasons.length) debug.append(element('p', '目前沒有足夠的共同興趣可說明。'));
          const coverage = element('details', undefined, 'mv-reasons');
          coverage.append(element('summary', '查看各類別與資料覆蓋'));
          (Array.isArray(candidate.details) ? candidate.details : []).forEach(detail => {
            const scoreText = typeof detail.score === 'number' && Number.isFinite(detail.score) ? (detail.score * 100).toFixed(1) + '%' : '資料不足';
            const percent = value => typeof value === 'number' && Number.isFinite(value) ? (value * 100).toFixed(1) + '%' : '—';
            coverage.append(element('p', detail.genre + '：' + scoreText + '；保留權重覆蓋 ' + percent(detail.leftCoverage) + ' / ' + percent(detail.rightCoverage)));
          });
          debug.append(coverage);
        } else {
          debug.append(element('p', '對方公開頁面或成為好友後，才可查看詳細配對理由與覆蓋資料。'));
        }
        card.insertBefore(debug, card.querySelector('.mt-actions'));
        return [card];
      });
      const compatibility = card => {
        const score = Number(card.dataset.topicScore ?? -1);
        return Number.isFinite(score) ? score : -1;
      };
      rankedCards.sort((a, b) => compatibility(b) - compatibility(a));
      rankedCards.forEach(card => cards.append(card)); result.append(cards);
    } catch (err) { if (number === requestNumber) result.textContent = err.message; }
    finally { match.disabled = false; }
  };
  $('detail').append(match, result);
}
async function save(preferences) { requestNumber++; await api('/preferences', 'PUT', preferences); await load(); }
function openEditor(kind, topic) {
  if (!state) return;
  mode = kind; editId = topic?.id;
  if (kind === 'topic' && !state.preferences.genres.length) return openEditor('interests');
  $('editor-title').textContent = kind === 'interests' ? '我的興趣與配對類別' : topic ? '編輯配對主題' : '新增配對主題';
  $('name-label').classList.toggle('hidden', kind === 'interests'); $('consent').classList.toggle('hidden', kind !== 'interests');
  $('topic-name').value = topic?.name || ''; $('topic-name').required = kind !== 'interests';
  $('form-error').textContent = ''; $('choices').replaceChildren();
  const checked = kind === 'interests' ? state.preferences.genres : topic?.genres || [];
  const options = kind === 'interests' ? state.genres : state.preferences.genres;
  options.forEach(genre => {
    const label = element('label'), input = document.createElement('input'); input.type = 'checkbox'; input.value = genre; input.checked = checked.includes(genre); input.onchange = count;
    label.append(input, document.createTextNode(genre)); $('choices').append(label);
  }); count(); $('editor').showModal();
}
function chosen() { return [...$('choices').querySelectorAll('input:checked')].map(input => input.value); }
function count() { $('selection-count').textContent = '已選 ' + chosen().length + ' 個分類' + (mode === 'interests' ? '；取消全部可撤回新版類別授權。' : '；至少 1 個，最多全部 9 個。'); }
$('editor-form').onsubmit = async event => {
  event.preventDefault(); const genres = chosen();
  if (mode === 'topic' && !genres.length) { $('form-error').textContent = '請至少選擇一個分類。'; return; }
  const prefs = structuredClone(state.preferences);
  if (mode === 'interests') {
    prefs.genres = genres; prefs.topics = prefs.topics.map(t => ({ ...t, genres: t.genres.filter(g => genres.includes(g)) })).filter(t => t.genres.length);
  } else {
    const name = $('topic-name').value.trim(); if (!name) return;
    const topic = { id: editId || crypto.randomUUID(), name, genres };
    prefs.topics = editId ? prefs.topics.map(t => t.id === editId ? topic : t) : [...prefs.topics, topic]; selectedId = topic.id; showView('topics');
  }
  const submit = $('editor-form').querySelector('button[type=submit]'); submit.disabled = true;
  try { await save(prefs); $('editor').close(); } catch (err) { $('form-error').textContent = err.message; }
  finally { submit.disabled = false; }
};
$('cancel').onclick = () => $('editor').close(); $('interests').onclick = () => openEditor('interests'); $('add').onclick = () => openEditor('topic'); $('search').oninput = renderTopics;
load().catch(error);
