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
  const notes = availabilityNotes(state, topic.genres);
  if (notes.length) {
    const box = element('div', undefined, 'notice mv-availability'); box.setAttribute('role', 'status');
    box.append(element('strong', t('你的資料狀態', 'Your data status')));
    const list = element('ul'); notes.forEach(note => list.append(element('li', note))); box.append(list);
    $('detail').append(box);
  }
  const result = element('div'); result.setAttribute('aria-live', 'polite');
  $('detail').append(result);
  queueMatch(topic, result);
}
// Explain uncertainty from the viewer's OWN profile and source counts only;
// other members' coverage is never shown here. Each note states the effect and
// the next step. Genres without a full result are left out of the score, not zeroed.
function availabilityNotes(data, genres) {
  const notes = [], profile = data.profile, job = data.job, source = data.source;
  const number = value => new Intl.NumberFormat(lang === 'zh' ? 'zh-TW' : 'en').format(value);
  if (!profile) {
    notes.push(job?.state === 'failed'
      ? t('興趣分析暫時遇到問題，尚未產生結果。系統會自動重試，不需要重新匯入。', 'Interest analysis hit a problem and has no result yet. It retries automatically; there is no need to re-import.')
      : t('興趣分析尚未完成，完成後才會出現這個主題的分數。分析會自動進行，請稍後再回來看看。', 'Interest analysis is not finished yet; scores for this topic appear once it is. It runs automatically, so check back later.'));
    return notes;
  }
  if (!profile.currentVersion) notes.push(t('分析方式已更新，正在重新整理你的資料；完成前配對可能暫時無法使用。', 'The analysis method was updated and your data is being refreshed; matching may be unavailable until it finishes.'));
  if (['queued', 'running'].includes(job?.state) && profile.currentVersion) notes.push(t('你的新資料正在處理中，目前顯示上次完成的結果，處理完會自動更新。', 'New data is being processed. You are seeing the last completed result; it updates automatically.'));
  if (!profile.complete) notes.push(t('觀看紀錄尚未完整同步，分數為暫定。完成 YouTube 紀錄同步後會自動更新。', 'Your watch history is not fully synced, so scores are provisional. They update automatically after the YouTube history sync completes.'));
  if (profile.processedVideos < profile.totalVideos) notes.push(t(`已分類 ${number(profile.processedVideos)} / ${number(profile.totalVideos)} 部影片，其餘仍在處理，分數為暫定。`, `${number(profile.processedVideos)} of ${number(profile.totalVideos)} videos are classified; the rest are still processing, so scores are provisional.`));
  if (source?.limitReached) notes.push(t(`只分析最近觀看的 ${number(source.videoLimit)} 部不同影片，更早的紀錄不列入配對。這是目前的處理上限，不需要操作。`, `Only your ${number(source.videoLimit)} most recently watched distinct videos are analyzed; older history is not used for matching. This is the current processing limit; no action is needed.`));
  if (source?.unavailableVideos) notes.push(t(`${number(source.unavailableVideos)} 部影片已刪除或無法取得資訊，只能依標題判斷類別，沒有 tag 可比較。`, `${number(source.unavailableVideos)} videos were deleted or their details are unavailable; they are classified from the title only and have no tags to compare.`));
  if (source?.pendingMetadataVideos) notes.push(t(`${number(source.pendingMetadataVideos)} 部影片的資訊仍在查詢，完成後會自動重新分析。`, `Details for ${number(source.pendingMetadataVideos)} videos are still being fetched; analysis reruns automatically once they arrive.`));
  for (const genre of genres) {
    const value = profile.genres?.[genre], name = genreName(genre) || genre;
    const reason = value?.reason || 'unclassified';
    if (reason === 'missing_tags') notes.push(t(`${name}：已辨識出 ${number(value.videoCount)} 部相關影片，但它們沒有原始 tag，無法比較細部主題，此類別暫不計分。系統只判斷類別、不自動產生 tag；觀看含 tag 的這類影片後會自動納入。`, `${name}: ${number(value.videoCount)} related videos were recognized, but they have no original tags, so detailed topics cannot be compared and this interest is not scored yet. Only interests are detected; tags are never generated. Watching tagged videos of this kind adds it automatically.`));
    else if (reason === 'sparse_tags') notes.push(t(`${name}：相關 tag 太少或太分散，尚未形成可比較的主題群，此類別暫不計分。累積更多這類觀看後會自動更新。`, `${name}: too few or too scattered tags to form a comparable group, so this interest is not scored yet. It updates as you watch more of it.`));
    else if (reason === 'low_coverage') notes.push(t(`${name}：只有 ${Math.round(100 * value.retainedCoverage)}% 的 tag 權重形成穩定主題群，分數為暫定；未被代表的部分不會算成共同興趣。`, `${name}: only ${Math.round(100 * value.retainedCoverage)}% of tag weight forms stable groups, so the score is provisional; the rest is never counted as a shared interest.`));
    else if (reason === 'unclassified' && genre === 'channel type') notes.push(t(`${name}：你看過的頻道大多沒有可用的公開說明，暫時無法判斷頻道類型，此類別暫不計分。`, `${name}: most channels you watched have no usable public description, so channel types cannot be assessed and this is not scored yet.`));
    else if (reason === 'unclassified') notes.push(t(`${name}：仍有影片尚未分類，暫時無法判斷這類興趣，分類完成後會自動更新。`, `${name}: some videos are not classified yet, so this interest cannot be assessed until they are. It updates automatically.`));
    else if (reason === 'empty') notes.push(t(`${name}：你的觀看紀錄中沒有這類影片，此類別不計分。`, `${name}: your history has no videos of this kind, so it is not scored.`));
  }
  return notes;
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
  // Server order is the ranking contract (complete before provisional, then
  // score); never re-sort here. Only complete, positive scores are top matches.
  let position = 0;
  for (const candidate of data.candidates) {
    // HTML comes from the same escaped server renderer as the member directory.
    const template = document.createElement('template');
    template.innerHTML = candidate.memberHtml || '';
    const card = template.content.querySelector('.mt-card');
    if (!card) continue;
    if (position++ < 3 && candidate.provisional === false && typeof candidate.score === 'number' && candidate.score > 0) {
      const name = card.querySelector('.mt-person-link > div');
      if (name) name.append(element('span', lang === 'zh' ? '最佳拍檔' : 'Top match', 'mt-partner'));
    }
    cards.append(card);
  }
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
  // Ask for the directory page being viewed so cards beyond page 1 update too.
  const page = new URL(location.href).searchParams.get('page');
  body.set('returnTo', page && /^[1-9]\d{0,3}$/.test(page) ? '/matches?page=' + page : '/matches');
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
