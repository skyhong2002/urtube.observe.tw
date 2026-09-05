"use strict";
// Isolated UI preview: no API calls or production account data.
const CATEGORIES = Object.freeze([
  "Politic",
  "Music",
  "Sport",
  "Education",
  "Video gaming",
  "Streaming",
  "News",
  "Podcast",
  "channel type",
]);
const SYMBOLS = ["◈", "♫", "◉", "✳", "⌘", "▷", "▤", "◍", "▦"];
const PEOPLE = [
  {
    id: "lin",
    name: "Lin",
    tone: "",
    subtitle: "在旋律裡發現新世界",
    bio: "歌單總是很長，週末喜歡聽一集訪談。想交換最近循環播放的那首歌。",
    interests: ["Music", "Podcast", "Education"],
  },
  {
    id: "nora",
    name: "Nora",
    tone: "tone-plum",
    subtitle: "耳機裡的日常探險",
    bio: "從獨立音樂到創作者的幕後故事，喜歡聽見不同的聲音。",
    interests: ["Music", "Streaming", "channel type"],
  },
  {
    id: "kai",
    name: "Kai",
    tone: "tone-blue",
    subtitle: "下一場，組隊嗎？",
    bio: "平日看實況，假日打合作遊戲。比起輸贏，更喜歡一起破關的過程。",
    interests: ["Video gaming", "Streaming", "Sport"],
  },
  {
    id: "ada",
    name: "Ada",
    tone: "",
    subtitle: "每天學一點新的",
    bio: "收藏解說影片，也收藏好問題。想找能一起交換學習筆記的人。",
    interests: ["Education", "Podcast", "channel type"],
  },
  {
    id: "theo",
    name: "Theo",
    tone: "tone-plum",
    subtitle: "把好奇心留給生活",
    bio: "最近開始研究遊戲設計，也會追蹤創作者的直播與製作過程。",
    interests: ["Video gaming", "Education", "Streaming"],
  },
  {
    id: "ren",
    name: "Ren",
    tone: "tone-blue",
    subtitle: "跑步前先選好歌",
    bio: "運動精華和現場演出佔滿了我的收藏，偶爾也聊聊最近的新聞。",
    interests: ["Sport", "Music", "News"],
  },
];
const KEY = "urtube.match-topic-preview.v1";
const $ = (s) => document.querySelector(s);
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const validCategories = (a) =>
  Array.isArray(a) &&
  a.length <= 9 &&
  new Set(a).size === a.length &&
  a.every((x) => CATEGORIES.includes(x));
let state = { interests: [], topics: [], selectedId: null };
let storageAvailable = true;
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || "null");
  if (
    saved &&
    validCategories(saved.interests) &&
    Array.isArray(saved.topics)
  ) {
    const ids = new Set();
    const topics = saved.topics.filter((t) => {
      const valid =
        t &&
        typeof t.id === "string" &&
        !ids.has(t.id) &&
        typeof t.name === "string" &&
        t.name.trim().length > 0 &&
        t.name.length <= 30 &&
        validCategories(t.categories) &&
        t.categories.length >= 1 &&
        t.categories.length <= CATEGORIES.length &&
        t.categories.every((c) => saved.interests.includes(c));
      if (valid) ids.add(t.id);
      return valid;
    });
    state = {
      interests: saved.interests,
      topics,
      selectedId: topics.some((t) => t.id === saved.selectedId)
        ? saved.selectedId
        : (topics[0]?.id ?? null),
    };
  }
} catch {
  storageAvailable = false;
}
let editingId = null,
  confirmAction = null,
  loadingTimer,
  toastTimer,
  resumeTopic = false;
function toast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 3400);
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    toast("瀏覽器無法儲存；目前變更只保留到分頁關閉。");
  }
}
function candidates(topic) {
  return PEOPLE.map((p) => ({
    ...p,
    common: topic.categories.filter((c) => p.interests.includes(c)),
  }))
    .filter((p) => p.common.length)
    .map((p) => ({
      ...p,
      // Placeholder presentation data only; replace with the matching service's
      // explanation when that backend integration is approved.
      matchReason: {
        text: `你在這個主題選擇的 ${p.common.join("、")}，也出現在 ${p.name} 的示範興趣中。這些共同話題可以成為認識彼此的起點。`,
        isExample: true,
      },
    }))
    .sort((a, b) => b.common.length - a.common.length);
}
function tags(items, secondary = false) {
  return items
    .map(
      (x) =>
        `<span class="tag${secondary ? " secondary" : ""}">${esc(x)}</span>`,
    )
    .join("");
}
function options(selected, available = CATEGORIES) {
  return available
    .map(
      (c) =>
        `<label class="category-choice"><input type="checkbox" value="${esc(c)}"${selected.includes(c) ? " checked" : ""}><span class="check" aria-hidden="true">✓</span><span class="category-text">${esc(c)}</span></label>`,
    )
    .join("");
}
const selected = (container) =>
  [...document.querySelectorAll(`${container} input:checked`)].map(
    (x) => x.value,
  );
const currentTopic = () => state.topics.find((t) => t.id === state.selectedId);
function renderList() {
  $("#topic-count").textContent = state.topics.length;
  const query = $("#search").value.trim().toLocaleLowerCase();
  const topics = state.topics.filter((t) =>
    `${t.name} ${t.categories.join(" ")}`.toLocaleLowerCase().includes(query),
  );
  $("#topic-list").innerHTML = topics.length
    ? topics
        .map(
          (t) =>
            `<button class="topic-row${t.id === state.selectedId ? " active" : ""}" data-topic="${esc(t.id)}"${t.id === state.selectedId ? ' aria-current="true"' : ""}><span class="topic-icon" aria-hidden="true">${SYMBOLS[CATEGORIES.indexOf(t.categories[0])]}</span><span class="topic-text"><strong>${esc(t.name)}</strong><small>${esc(t.categories.join(" · "))}</small><small class="topic-result">${candidates(t).length} 位示範配對</small></span><span class="row-arrow" aria-hidden="true">›</span></button>`,
        )
        .join("")
    : `<div class="sidebar-empty"><strong>${query ? "找不到這個主題" : "你的第一個主題，從這裡開始"}</strong>${query ? "試試其他名稱或分類。" : "點右上角 ＋，整理想聊的興趣。"}</div>`;
}
function matchReasonSection(reason) {
  const text = typeof reason?.text === "string" && reason.text.trim()
    ? reason.text.trim()
    : "配對說明尚未提供，之後會在這裡說明推薦原因。";
  return `<section class="match-reason" aria-label="為什麼推薦給你"><div class="match-reason-heading"><h4>為什麼推薦給你</h4>${reason?.isExample ? '<span>示範說明</span>' : ''}</div><p>${esc(text)}</p></section>`;
}
function personCard(p) {
  return `<article class="candidate-card"><div class="person-top"><span class="avatar ${p.tone}" aria-hidden="true">${p.name[0]}</span><div><h3>${p.name}</h3><small>${p.subtitle}</small></div><span class="candidate-badge">示範人物</span></div><p class="person-bio">${p.bio}</p><p class="common-label">你們在這個主題的交集</p><div class="tags">${tags(p.common)}</div>${matchReasonSection(p.matchReason)}<button class="card-action" data-person="${p.id}" aria-label="查看 ${p.name} 的興趣比較">看看共同話題 <span aria-hidden="true">↗</span></button></article>`;
}
function renderDetail(loading = false) {
  const topic = currentTopic();
  $("#detail").setAttribute("aria-busy", String(loading));
  if (!topic) {
    $("#detail").innerHTML =
      '<div class="empty-state"><div class="empty-symbol" aria-hidden="true">✳</div><p class="eyebrow">MAKE ROOM FOR COMMON GROUND</p><h2>你的興趣，值得有人一起聊。</h2><p>從音樂、運動到遊戲，把想聊的事分成主題，<br>找到有共同興趣的人。</p><button class="button primary" data-action="create">＋ 建立第一個主題</button><button class="text-button" data-action="examples">先看看示範主題</button></div>';
    return;
  }
  const people = candidates(topic);
  const cards = loading
    ? '<p class="loading-label" role="status">正在切換示範名單…</p><div class="candidate-grid" aria-hidden="true"><div class="skeleton"></div><div class="skeleton"></div></div>'
    : people.length
      ? `<div class="candidate-grid">${people.map(personCard).join("")}</div><p class="detail-footnote">每個主題都是一個新的起點。這份名單不代表正式配對結果。</p>`
      : '<div class="empty-state"><div class="empty-symbol" aria-hidden="true">◌</div><h2>還沒有共同話題的示範人物</h2><p>此分類目前沒有示範資料。可以編輯主題加入另一個分類，或保留這個主題。</p><button class="button subtle" data-action="edit">調整主題分類</button></div>';
  $("#detail").innerHTML =
    `<button class="mobile-back" data-action="back">← 所有配對主題</button><div class="detail-heading"><div><p class="eyebrow">A SPACE FOR YOUR INTERESTS</p><h2 tabindex="-1" id="active-topic-title">${esc(topic.name)}</h2><div class="tags">${tags(topic.categories)}</div></div><div class="detail-actions"><button class="icon-button" data-action="edit" aria-label="編輯主題" title="編輯主題">✎</button><button class="icon-button" data-action="delete" aria-label="刪除主題" title="刪除主題">×</button></div></div><p class="detail-explainer">從這 ${topic.categories.length} 個分類，發現值得開始的對話。這裡預覽至少有一項共同分類的示範人物。</p><div class="results-header"><h3>為這個主題找到的人 <span>${loading ? "…" : people.length}</span></h3><span class="sort-note">示範排序 · 共同分類優先</span></div>${cards}`;
}
function render() {
  renderList();
  renderDetail();
}
function selectTopic(id, focus = false) {
  state.selectedId = id;
  save();
  renderList();
  $(".workspace").classList.add("detail-open");
  clearTimeout(loadingTimer);
  renderDetail(true);
  if (focus) $("#active-topic-title")?.focus();
  loadingTimer = setTimeout(() => {
    const restore = document.activeElement?.id === "active-topic-title";
    renderDetail();
    if (restore) $("#active-topic-title")?.focus();
  }, 220);
}
function updateInterestCount() {
  $("#interest-selection-count").textContent =
    `已選 ${selected("#interest-options").length} 個興趣`;
}
function openInterests() {
  $("#interest-options").innerHTML = options(state.interests);
  const used = new Set(state.topics.flatMap((t) => t.categories));
  for (const input of $("#interest-options").querySelectorAll("input"))
    if (used.has(input.value)) {
      input.disabled = true;
      input.closest("label").title = "已有主題使用此分類";
    }
  $("#interests-error").textContent = "";
  $("#interests-dialog [data-close]").hidden = !state.interests.length;
  updateInterestCount();
  $("#interests-dialog").showModal();
}
function updateCategoryCount() {
  const inputs = [...$("#topic-options").querySelectorAll("input")];
  const count = selected("#topic-options").length;
  $("#category-count").textContent = `已選 ${count}／${inputs.length}`;
  $("#topic-error").textContent = "";
  $("#category-help").textContent = "至少選擇 1 個分類，也可以選取全部已確認的興趣。";
}
function openTopic(id = null, restoreDraft = false) {
  if (!state.interests.length) {
    openInterests();
    return;
  }
  editingId = id;
  const topic = state.topics.find((t) => t.id === id);
  $("#topic-dialog-title").textContent = topic
    ? "編輯配對主題"
    : "建立配對主題";
  $("#save-topic").textContent = topic
    ? "儲存並更新名單 →"
    : "建立並查看名單 →";
  const choices = restoreDraft
    ? selected("#topic-options")
    : (topic?.categories ?? []);
  if (!restoreDraft) $("#topic-name").value = topic?.name ?? "";
  $("#topic-options").innerHTML = options(
    choices,
    CATEGORIES.filter((c) => state.interests.includes(c)),
  );
  updateCategoryCount();
  $("#topic-dialog").showModal();
  $("#topic-name").focus();
}
function openConfirm(title, description, action, label = "確認刪除") {
  $("#confirm-title").textContent = title;
  $("#confirm-description").textContent = description;
  $('#confirm-form [type="submit"]').textContent = label;
  confirmAction = action;
  $("#confirm-dialog").showModal();
  $("#confirm-dialog [data-close]").focus();
}
function showPerson(id) {
  const topic = currentTopic();
  const p = topic && candidates(topic).find((x) => x.id === id);
  if (!p) return;
  $("#compare-content").innerHTML =
    `<div class="dialog-top"><span class="eyebrow">COMMON GROUND / 示範比較</span><button class="icon-button" data-close aria-label="關閉比較">×</button></div><div class="compare-top"><span class="avatar ${p.tone}" aria-hidden="true">${p.name[0]}</span><div><h2 id="compare-title">和 ${p.name}，從這裡聊起。</h2><span class="muted">示範人物 · ${p.subtitle}</span></div></div><p class="dialog-copy">${p.bio}</p><div class="comparison"><section><p class="eyebrow">YOUR TOPIC</p><h3>${esc(topic.name)}</h3><div class="tags">${tags(topic.categories)}</div></section><section><p class="eyebrow">THEIR INTERESTS</p><h3>${p.name} 的興趣</h3><div class="tags">${tags(p.interests, true)}</div></section></div><p class="common-label">可以開始的共同話題</p><div class="tags">${tags(p.common)}</div>${matchReasonSection(p.matchReason)}<p class="compare-callout" style="margin-top:22px">「最近有沒有一支關於 ${esc(p.common[0])} 的影片，讓你想推薦給別人？」</p><div class="dialog-actions"><span class="muted">此階段僅預覽比較，尚未開放傳訊。</span><button class="button subtle" data-close>返回名單</button></div>`;
  $("#compare-dialog").showModal();
}
function examples() {
  if (!state.interests.length) {
    openInterests();
    return;
  }
  const choices = state.interests.slice(0, 6);
  const sets = [choices.slice(0, 3), choices.slice(3, 6)].filter(
    (a) => a.length,
  );
  for (const a of sets)
    state.topics.push({
      id: crypto.randomUUID(),
      name: `${a[0]} 同好`,
      categories: a,
    });
  selectTopic(state.topics[0].id, true);
  toast("已加入示範主題，可自由編輯或刪除。");
}
$("#interests-button").addEventListener("click", openInterests);
$("#create-button").addEventListener("click", () => openTopic());
$("#search").addEventListener("input", renderList);
$("#topic-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-topic]");
  if (b) selectTopic(b.dataset.topic, true);
});
$("#detail").addEventListener("click", (e) => {
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (action === "create") openTopic();
  if (action === "examples") examples();
  if (action === "back") {
    $(".workspace").classList.remove("detail-open");
    $("#topic-list [aria-current]")?.focus();
  }
  if (action === "edit") openTopic(state.selectedId);
  if (action === "delete") {
    const topic = currentTopic();
    openConfirm(
      `刪除「${topic.name}」？`,
      "只會刪除此瀏覽器的配對主題，不會刪除你的興趣或任何使用者資料。",
      () => {
        clearTimeout(loadingTimer);
        state.topics = state.topics.filter((t) => t.id !== topic.id);
        state.selectedId = state.topics[0]?.id ?? null;
        if (!state.topics.length)
          $(".workspace").classList.remove("detail-open");
        save();
        render();
        toast("已刪除配對主題。");
        $("#create-button").focus();
      },
    );
  }
  const p = e.target.closest("[data-person]");
  if (p) showPerson(p.dataset.person);
});
$("#interest-options").addEventListener("change", updateInterestCount);
$("#topic-options").addEventListener("change", updateCategoryCount);
$("#interests-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const interests = selected("#interest-options");
  if (!interests.length) {
    $("#interests-error").textContent = "請至少選擇一個興趣分類。";
    return;
  }
  state.interests = interests;
  save();
  $("#interests-dialog").close();
  render();
  toast("興趣已儲存在此瀏覽器。");
});
$("#interests-dialog").addEventListener("cancel", (e) => {
  if (!state.interests.length) e.preventDefault();
});
$("#interests-dialog").addEventListener("close", () => {
  if (resumeTopic) {
    resumeTopic = false;
    openTopic(editingId, true);
  }
});
$("#edit-interests-from-topic").addEventListener("click", () => {
  resumeTopic = true;
  $("#topic-dialog").close();
  openInterests();
});
$("#topic-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("#topic-name").value.trim();
  const categories = selected("#topic-options");
  if (!name || name.length > 30) {
    $("#topic-error").textContent = "請輸入 1～30 個字的主題名稱。";
    $("#topic-name").focus();
    return;
  }
  if (
    categories.length < 1 ||
    categories.length > CATEGORIES.length ||
    !categories.every((c) => state.interests.includes(c))
  ) {
    $("#topic-error").textContent = "請至少選擇 1 個已確認的固定分類，可選全部。";
    return;
  }
  if (
    state.topics.some(
      (t) =>
        t.id !== editingId &&
        t.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  ) {
    $("#topic-error").textContent = "已有同名主題，請換一個名稱。";
    return;
  }
  const id = editingId ?? crypto.randomUUID();
  const topic = { id, name, categories };
  if (editingId)
    state.topics = state.topics.map((t) => (t.id === id ? topic : t));
  else state.topics.push(topic);
  $("#search").value = "";
  $("#topic-dialog").close();
  selectTopic(id, true);
  toast(editingId ? "已更新主題與示範名單。" : "配對主題建立完成。");
});
$("#confirm-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const action = confirmAction;
  confirmAction = null;
  $("#confirm-dialog").close();
  action?.();
});
$("#reset-button").addEventListener("click", () =>
  openConfirm(
    "重新開始這份原型？",
    "將清除這台瀏覽器中的興趣與配對主題，正式帳號與資料不受影響。",
    () => {
      clearTimeout(loadingTimer);
      state = { interests: [], topics: [], selectedId: null };
      $("#search").value = "";
      $(".workspace").classList.remove("detail-open");
      save();
      render();
      openInterests();
    },
    "確認重設",
  ),
);
for (const dialog of document.querySelectorAll("dialog"))
  dialog.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) dialog.close();
  });
render();
if (!state.interests.length) openInterests();
if (!storageAvailable) toast("儲存功能目前不可用，仍可在此分頁操作原型。");
