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
  $('status').hidden = state.optedIn;
  if (!state.optedIn) {
    $('status').append(element('span', '尚未開啟配對。請至 '));
    const link = element('a', '我的帳號'); link.href = '/account'; $('status').append(link, element('span', ' 開啟參與配對，再選擇興趣。'));
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
  $('detail').append(element('p', '依所選類別的合拍度排序，前三名為最佳拍檔。', 'muted'));
  const result = element('div'); result.setAttribute('aria-live', 'polite');
  $('detail').append(result);
  queueMatch(topic, result);
}
// Keep one request in flight: the server also serializes matching per account.
// Rapid switches replace the pending selection, never the currently displayed result.
let pendingMatch = null, matching = false;
function queueMatch(topic, result) {
  const number = ++requestNumber;
  result.textContent = '正在尋找合拍的人…';
  pendingMatch = { genres: [...topic.genres], result, number };
  void drainMatches();
}
async function drainMatches() {
  if (matching) return;
  matching = true;
  try {
    while (pendingMatch) {
      const job = pendingMatch; pendingMatch = null;
      if (job.number !== requestNumber) continue;
      try {
        const data = await api('/match', 'POST', { genres: job.genres });
        if (job.number !== requestNumber) continue;
        renderMatches(data, job.result);
      } catch (err) {
        if (job.number !== requestNumber) continue;
        job.result.replaceChildren(element('p', err.message));
        const retry = element('button', '重試配對');
        retry.onclick = () => queueMatch({ genres: job.genres }, job.result);
        job.result.append(retry);
      }
    }
  } finally { matching = false; }
}
function renderMatches(data, result) {
  result.replaceChildren();
  if (!data.candidates.length) {
    result.append(element('p', '還沒有同意參與這些類別、且已完成輪廓處理的使用者。', 'empty')); return;
  }
  const cards = element('div', undefined, 'mt-grid');
  const ranked = data.candidates.flatMap(candidate => {
    // HTML comes from the same escaped server renderer as the member directory.
    const template = document.createElement('template');
    template.innerHTML = candidate.memberHtml || '';
    const card = template.content.querySelector('.mt-card');
    if (!card) return [];
    const score = typeof candidate.score === 'number' && Number.isFinite(candidate.score) ? candidate.score : -1;
    return [{ card, score }];
  }).sort((a, b) => b.score - a.score);
  ranked.forEach(({ card, score }, index) => {
    if (index < 3 && score >= 0) {
      const name = card.querySelector('.mt-person-link > div');
      if (name) name.append(element('span', lang === 'zh' ? '最佳拍檔' : 'Top match', 'mt-partner'));
    }
    cards.append(card);
  });
  result.append(cards);
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


// Keep the existing session/token-protected HTML endpoints; update cards in place.
let friendshipPending = false;
document.addEventListener('submit', async event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.closest('.mv-workspace')) return;
  const path = new URL(form.action, location.href).pathname;
  if (!['/matches/request', '/matches/respond', '/matches/withdraw'].includes(path)) return;
  event.preventDefault();
  if (friendshipPending) return;
  friendshipPending = true;
  const submitter = event.submitter;
  const cardHref = form.closest('.mt-card')?.querySelector('.mt-person-link')?.getAttribute('href');
  const controls = [...document.querySelectorAll('.mv-workspace form[action^="/matches/"] button')];
  const originallyDisabled = controls.map(button => button.disabled);
  const body = new URLSearchParams();
  for (const [key, value] of new FormData(form)) if (typeof value === 'string') body.append(key, value);
  body.set('returnTo', '/matches');
  if (submitter?.name) body.set(submitter.name, submitter.value);
  let feedback = document.querySelector('.mt-friend-feedback');
  if (!feedback) {
    feedback = element('p', '', 'mt-friend-feedback'); feedback.setAttribute('role', 'status');
    document.querySelector('.mv-detail').prepend(feedback);
  }
  feedback.textContent = lang === 'zh' ? '正在更新好友邀請…' : 'Updating friend request…';
  controls.forEach(button => { button.disabled = true; });
  try {
    const response = await fetch(path, { method: 'POST', body, credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok || new URL(response.url).pathname !== '/matches') throw new Error('request_failed');
    const page = new DOMParser().parseFromString(await response.text(), 'text/html');
    const directory = page.getElementById('mv-directory');
    const invitations = page.getElementById('mv-invitations');
    if (!directory || !invitations) throw new Error('session_changed');
    const replacements = new Map([...directory.querySelectorAll('.mt-card')].map(card => [card.querySelector('.mt-person-link')?.getAttribute('href'), card]));
    for (const card of $('mv-directory').querySelectorAll('.mt-card')) {
      const replacement = replacements.get(card.querySelector('.mt-person-link')?.getAttribute('href'));
      if (replacement) card.replaceWith(document.importNode(replacement, true));
    }
    $('mv-invitations').replaceChildren(...[...invitations.childNodes].map(node => document.importNode(node, true)));
    feedback.textContent = lang === 'zh' ? '好友邀請狀態已更新。' : 'Friend request updated.';
    const visibleCards = [...document.querySelectorAll('.mv-detail .mt-card')];
    const updated = visibleCards.find(card => !card.closest('[hidden]') && card.querySelector('.mt-person-link')?.getAttribute('href') === cardHref);
    (updated?.querySelector('[data-friendship-tools] button') || $('mv-invites')).focus({ preventScroll: true });
  } catch {
    feedback.textContent = lang === 'zh' ? '無法確認邀請狀態，請稍後再試；若登入已過期，請重新登入。' : 'Could not confirm the request. Try again later, or sign in if your session expired.';
  } finally {
    controls.forEach((button, index) => { button.disabled = originallyDisabled[index]; });
    friendshipPending = false;
  }
}, { signal: window.urtubePageController?.signal });
