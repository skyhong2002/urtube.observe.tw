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
// Localize presentation labels only: API genre values and saved preferences remain unchanged.
const t = (zh, en) => lang === 'zh' ? zh : en;
const genreNames = JSON.parse(document.querySelector('.mv-workspace').dataset.genreLabels);
const genreName = genre => genreNames[genre];
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
const messages = { login_required: t('登入已過期，請重新登入。', 'Your sign-in expired. Please sign in again.'), opt_in_required: t('請先到設定開啟好友探索。', 'Enable friend discovery in Settings first.'), profile_pending: t('興趣分析尚未完成。', 'Interest analysis is not yet complete.'), profile_changed: t('興趣資料已更新，請再試一次。', 'Your interests have been updated. Please try again.'), matching_unavailable: t('配對暫時無法使用，請稍後再試。', 'Matching is unavailable. Please try again later.'), matching_in_progress: t('正在尋找合拍的人…', 'Finding people on your wavelength…') };
async function api(path = '', method = 'GET', body) {
  const response = await fetch('/api/matching-v3' + path + '?lang=' + lang, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(messages[data?.error] || t('暫時無法完成操作，請稍後重試。', 'This action could not be completed. Please try again later.'));
  if (!data) throw new Error(t('暫時無法取得結果，請再試一次。', 'Results are unavailable. Please try again.'));
  return data;
}
// Network failures use a stable recovery message; API errors already have localized labels.
function userError(err) { return Object.values(messages).includes(err.message) ? err.message : t('暫時無法完成操作，請稍後重試。', 'This action could not be completed. Please try again later.'); }
function error(err) { showView('topics'); $('message').textContent = userError(err); $('message').className = 'error'; }
async function load() {
  state = await api();
  $('status').replaceChildren();
  $('status').hidden = state.optedIn;
  if (!state.optedIn) {
    $('status').append(element('span', t('請至 ', 'Open ')));
    const link = element('a', t('設定', 'Settings')); link.href = '/account'; $('status').append(link, element('span', t(' 開啟好友探索，再選擇興趣。', ' to enable friend discovery, then choose your interests.')));
  }
  if (!state.preferences.topics.some(t => t.id === selectedId)) selectedId = null;
  const view = new URL(location.href).searchParams.get('view') || 'all';
  if (view === 'topics' && !selectedId) selectedId = state.preferences.topics.find(t => t.id === new URL(location.href).searchParams.get('topic'))?.id || state.preferences.topics[0]?.id;
  renderTopics(); renderDetail(); showView(view === 'topics' || view === 'invites' ? view : 'all');
}
function renderTopics() {
  const query = $('search').value.toLowerCase(); $('topics').replaceChildren();
  for (const topic of state.preferences.topics.filter(t => (t.name + t.genres.map(genreName).join(' ')).toLowerCase().includes(query))) {
    const button = element('button', undefined, 'topic'); button.setAttribute('aria-current', String(topic.id === selectedId));
    button.append(element('strong', topic.name), element('small', topic.genres.map(genreName).join(' · ')));
    button.onclick = () => { selectedId = topic.id; requestNumber++; showView('topics'); renderTopics(); renderDetail(); };
    $('topics').append(button);
  }
}
function renderDetail() {
  const topic = state.preferences.topics.find(t => t.id === selectedId); $('detail').replaceChildren();
  if (!topic) { $('detail').append(element('p', t('選擇興趣，建立你的第一個配對主題。', 'Choose your interests to create your first matching topic.'), 'empty')); return; }
  const top = element('div', undefined, 'detail-top'); top.append(element('h2', topic.name));
  const actions = element('div');
  const edit = element('button', t('編輯', 'Edit')); edit.onclick = () => openEditor('topic', topic);
  const remove = element('button', t('刪除', 'Delete')); remove.onclick = async () => {
    if (!confirm(t('刪除「' + topic.name + '」？', 'Delete “' + topic.name + '”?'))) return;
    try { await save({ ...state.preferences, topics: state.preferences.topics.filter(t => t.id !== topic.id) }); } catch (err) { error(err); }
  };
  actions.append(edit, remove); top.append(actions); $('detail').append(top);
  const chips = element('div', undefined, 'chips'); topic.genres.forEach(g => chips.append(element('span', genreName(g), 'chip'))); $('detail').append(chips);
  $('detail').append(element('p', t('依共同興趣的合拍程度排序', 'Sorted by compatibility across your chosen interests'), 'muted'));
  const result = element('div'); result.setAttribute('aria-live', 'polite');
  $('detail').append(result);
  queueMatch(topic, result);
}
// Keep one request in flight: the server also serializes matching per account.
// Rapid switches replace the pending selection, never the currently displayed result.
let pendingMatch = null, matching = false;
function queueMatch(topic, result) {
  const number = ++requestNumber;
  result.textContent = t('正在尋找合拍的人…', 'Finding people on your wavelength…');
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
        job.result.replaceChildren(element('p', userError(err)));
        const retry = element('button', t('重試配對', 'Try matching again'));
        retry.onclick = () => queueMatch({ genres: job.genres }, job.result);
        job.result.append(retry);
      }
    }
  } finally { matching = false; }
}
function renderMatches(data, result) {
  result.replaceChildren();
  if (!data.candidates.length) {
    result.append(element('p', t('這個主題目前還沒有配對結果，試試其他興趣組合。', 'No results for this topic yet. Try a different combination of interests.'), 'empty')); return;
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
  $('editor-title').textContent = kind === 'interests' ? t('選擇興趣', 'Choose interests') : topic ? t('編輯配對主題', 'Edit matching topic') : t('新增配對主題', 'New matching topic');
  $('name-label').classList.toggle('hidden', kind === 'interests'); $('consent').classList.toggle('hidden', kind !== 'interests');
  $('topic-name').value = topic?.name || ''; $('topic-name').required = kind !== 'interests';
  $('form-error').textContent = ''; $('choices').replaceChildren();
  const checked = kind === 'interests' ? state.preferences.genres : topic?.genres || [];
  const options = kind === 'interests' ? state.genres : state.preferences.genres;
  options.forEach(genre => {
    const label = element('label'), input = document.createElement('input'); input.type = 'checkbox'; input.value = genre; input.checked = checked.includes(genre); input.onchange = count;
    label.append(input, document.createTextNode(genreName(genre)));
    if (genre === 'Politic') label.append(element('small', t('依觀看內容分類，不代表個人立場。', 'Describes viewing topics, not personal political views.'))); $('choices').append(label);
  }); count(); $('editor').showModal();
}
function chosen() { return [...$('choices').querySelectorAll('input:checked')].map(input => input.value); }
function count() {
  const genres = chosen();
  $('selection-count').textContent = t('已選 ' + genres.length + ' 項', genres.length + ' selected');
  // Removing interests can delete saved topics; surface that consequence at the actual edit.
  const removed = mode === 'interests' ? state.preferences.topics.filter(topic => !topic.genres.some(g => genres.includes(g))) : [];
  const changed = mode === 'interests' && state.preferences.topics.some(topic => topic.genres.some(g => !genres.includes(g)));
  $('selection-impact').textContent = removed.length
    ? t('儲存後將刪除沒有剩餘興趣的主題：', 'Saving will delete topics with no remaining interests: ') + removed.map(topic => topic.name).join('、')
    : changed ? t('取消的興趣也會從既有主題中移除。', 'Deselected interests will also be removed from existing topics.')
    : mode === 'interests' && !genres.length ? t('儲存後將停止主題配對。', 'Saving will turn off topic matching.') : '';
}
$('editor-form').onsubmit = async event => {
  event.preventDefault(); const genres = chosen();
  if (mode === 'topic' && !genres.length) { $('form-error').textContent = t('請至少選擇一項興趣。', 'Choose at least one interest.'); return; }
  const prefs = structuredClone(state.preferences);
  if (mode === 'interests') {
    prefs.genres = genres; prefs.topics = prefs.topics.map(t => ({ ...t, genres: t.genres.filter(g => genres.includes(g)) })).filter(t => t.genres.length);
  } else {
    const name = $('topic-name').value.trim(); if (!name) return;
    const topic = { id: editId || crypto.randomUUID(), name, genres };
    prefs.topics = editId ? prefs.topics.map(t => t.id === editId ? topic : t) : [...prefs.topics, topic]; selectedId = topic.id; showView('topics');
  }
  const submit = $('editor-form').querySelector('button[type=submit]'); submit.disabled = true;
  try { await save(prefs); $('editor').close(); } catch (err) { $('form-error').textContent = userError(err); }
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
    feedback.textContent = lang === 'zh' ? '無法確認邀請狀態，請稍後再試。若登入已過期，請重新登入。' : 'Could not confirm the request. Try again later, or sign in if your session expired.';
  } finally {
    controls.forEach((button, index) => { button.disabled = originallyDisabled[index]; });
    friendshipPending = false;
  }
}, { signal: window.urtubePageController?.signal });
