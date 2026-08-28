// Runtime UI language for the extension pages: Traditional Chinese when the
// browser reports any zh locale, English otherwise. Static markup opts in via
// data-i18n / data-i18n-title attributes; dynamic strings read urtubeT.
const urtubeZh = (navigator.language || '').toLowerCase().startsWith('zh');

const urtubeT = urtubeZh ? {
  popupTitle: 'YouTube 擷取',
  checking: '檢查狀態中…',
  paused: '擷取已暫停',
  active: '擷取運作中',
  setupRequired: '需要完成設定',
  pending: '待送出',
  accountSync: '帳號同步',
  lastSync: '上次同步',
  historyProgress: '歷史進度',
  never: '從未',
  notSynced: '尚未同步',
  notImported: '尚未匯入',
  syncNow: '立即同步',
  cancelSync: '取消同步',
  fullScan: '完整進度掃描',
  cancelScan: '取消掃描',
  settings: '設定',
  videos: (n) => `${n} 部影片`,
  importedVideos: (n) => `已匯入 ${n} 部`,
  importFailed: '匯入失敗',
  upToDate: '已是最新',
  syncFailed: '同步失敗',
  events: (n) => `${n} 筆事件`,
  progressRows: (n) => `${n} 筆進度`,

  optionsTitle: 'urtube YouTube 擷取設定',
  optionsHeader: 'urtube YouTube 擷取',
  optionsSub: '私人連線設定',
  endpointLabel: '擷取 endpoint',
  tokenLabel: '擷取 token',
  captureToggle: '擷取觀看工作階段',
  dailySyncToggle: '每天同步帳號紀錄',
  save: '儲存',
  test: '測試連線',
  saved: '設定已儲存。',
  testing: '測試連線中…',
  connectionReady: '連線就緒。',
  privacy: 'Token 和待送出的擷取資料只存在這個 Chrome 設定檔裡。每日同步會讀取已登入的 Google 我的活動 YouTube 頁面；搜尋詞會先由 urtube 加密再儲存。',
} : {
  popupTitle: 'YouTube Capture',
  checking: 'Checking status...',
  paused: 'Capture paused',
  active: 'Capture active',
  setupRequired: 'Setup required',
  pending: 'Pending',
  accountSync: 'Account sync',
  lastSync: 'Last sync',
  historyProgress: 'History progress',
  never: 'Never',
  notSynced: 'Not synced',
  notImported: 'Not imported',
  syncNow: 'Sync now',
  cancelSync: 'Cancel sync',
  fullScan: 'Full progress scan',
  cancelScan: 'Cancel scan',
  settings: 'Settings',
  videos: (n) => `${n} videos`,
  importedVideos: (n) => `${n} imported`,
  importFailed: 'Import failed',
  upToDate: 'Up to date',
  syncFailed: 'Sync failed',
  events: (n) => `${n} events`,
  progressRows: (n) => `${n} progress rows`,

  optionsTitle: 'urtube YouTube Capture settings',
  optionsHeader: 'urtube YouTube Capture',
  optionsSub: 'Private connection settings',
  endpointLabel: 'Capture endpoint',
  tokenLabel: 'Capture token',
  captureToggle: 'Capture viewing sessions',
  dailySyncToggle: 'Sync account history daily',
  save: 'Save',
  test: 'Test connection',
  saved: 'Settings saved.',
  testing: 'Testing connection...',
  connectionReady: 'Connection ready.',
  privacy: 'The token and pending captures stay in this Chrome profile. Daily sync reads the signed-in Google My Activity YouTube page; search terms are encrypted by urtube before storage.',
};

for (const el of document.querySelectorAll('[data-i18n]')) {
  const value = urtubeT[el.dataset.i18n];
  if (typeof value === 'string') el.textContent = value;
}
if (document.title && urtubeT[document.body.dataset.i18nTitle]) {
  document.title = urtubeT[document.body.dataset.i18nTitle];
}
if (urtubeZh) document.documentElement.lang = 'zh-Hant';
