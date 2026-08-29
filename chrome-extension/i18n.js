// Runtime UI language for the extension pages: Traditional Chinese when the
// browser reports any zh locale, English otherwise. The HTML markup is the
// English source of truth; zh overrides static text via data-i18n attributes,
// and urtubeT carries only the strings the scripts compose dynamically.
const urtubeZh = (navigator.language || '').toLowerCase().startsWith('zh');

const urtubeT = urtubeZh ? {
  paused: '擷取已暫停',
  active: '擷取運作中',
  setupRequired: '需要完成設定',
  never: '從未',
  notSynced: '尚未同步',
  notImported: '尚未匯入',
  syncNow: '立即同步',
  cancelSync: '取消同步',
  fullScan: '完整進度掃描',
  cancelScan: '取消掃描',
  videos: (n) => `${n} 部影片`,
  importedVideos: (n) => `已匯入 ${n} 部`,
  importFailed: '匯入失敗',
  upToDate: '已是最新',
  syncFailed: '同步失敗',
  events: (n) => `${n} 筆事件`,
  progressRows: (n) => `${n} 筆進度`,
  saved: '設定已儲存。',
  testing: '測試連線中…',
  connectionReady: '連線就緒。',
  googleAccountInvalid: 'Google 帳號請填完整的 email 地址。',
  updateAvailable: (v) => `有新版 v${v} 可用——點這裡看更新方式`,
} : {
  paused: 'Capture paused',
  active: 'Capture active',
  setupRequired: 'Setup required',
  never: 'Never',
  notSynced: 'Not synced',
  notImported: 'Not imported',
  syncNow: 'Sync now',
  cancelSync: 'Cancel sync',
  fullScan: 'Full progress scan',
  cancelScan: 'Cancel scan',
  videos: (n) => `${n} videos`,
  importedVideos: (n) => `${n} imported`,
  importFailed: 'Import failed',
  upToDate: 'Up to date',
  syncFailed: 'Sync failed',
  events: (n) => `${n} events`,
  progressRows: (n) => `${n} progress rows`,
  saved: 'Settings saved.',
  testing: 'Testing connection...',
  connectionReady: 'Connection ready.',
  googleAccountInvalid: 'Enter the full email address of the Google account.',
  updateAvailable: (v) => `Version ${v} is available — click for update steps`,
};

// Static zh overrides: keys match data-i18n attributes in popup/options HTML.
if (urtubeZh) {
  const staticZh = {
    popupTitle: 'YouTube 擷取',
    checking: '檢查狀態中…',
    pending: '待送出',
    accountSync: '帳號同步',
    lastSync: '上次同步',
    historyProgress: '歷史進度',
    syncNow: urtubeT.syncNow,
    fullScan: urtubeT.fullScan,
    settings: '設定',
    optionsTitle: 'urtube YouTube 擷取設定',
    optionsHeader: 'urtube YouTube 擷取',
    optionsSub: '私人連線設定',
    endpointLabel: '擷取 endpoint',
    tokenLabel: '擷取 token',
    googleAccountLabel: 'Google 帳號（選填——Chrome 同時登入多個帳號時務必填寫）',
    captureToggle: '擷取觀看工作階段',
    dailySyncToggle: '每天同步帳號紀錄',
    save: '儲存',
    test: '測試連線',
    privacy: 'Token 和待送出的擷取資料只存在這個 Chrome 設定檔裡。每日同步會讀取已登入的 Google 我的活動 YouTube 頁面；搜尋詞會先由 urtube 加密再儲存。',
  };
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const value = staticZh[el.dataset.i18n];
    if (typeof value === 'string') el.textContent = value;
  }
  const title = staticZh[document.body.dataset.i18nTitle];
  if (title) document.title = title;
  document.documentElement.lang = 'zh-Hant';
}
