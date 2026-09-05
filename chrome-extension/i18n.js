// Runtime UI language for the extension pages: Traditional Chinese when the
// browser reports any zh locale, English otherwise. The HTML markup is the
// English source of truth; zh overrides static text via data-i18n attributes,
// and urtubeT carries only the strings the scripts compose dynamically.
const urtubeZh = (navigator.language || '').toLowerCase().startsWith('zh');

// The narrow popup presents status and next steps as separate sentences for easier scanning.
const urtubeT = urtubeZh ? {
  paused: '觀看時間記錄已暫停',
  active: '正在記錄觀看時間',
  setupRequired: '需要完成設定',
  never: '從未',
  notSynced: '尚未同步',
  notImported: '尚未匯入',
  syncNow: '立即同步',
  cancelSync: '取消同步',
  rescanAll: '重新掃描全部紀錄',
  cancelScan: '取消掃描',
  videos: (n) => `${n} 部影片`,
  deepHistoryProgress: (events) => `已掃描 ${events} 筆紀錄`,
  importedVideos: (n) => `已匯入 ${n} 部`,
  historyResult: (reason, n) => ({
    'history-paused': '觀看紀錄已暫停，請開啟後重試',
    'signed-out': '尚未登入 YouTube，請登入後重試',
    'no-content': '找不到觀看紀錄，請檢查登入與紀錄設定',
    stalled: `載入停住（已保存 ${n} 部），請重試以繼續`,
    'segment-limit': `已保存 ${n} 筆。使用「重新掃描全部紀錄」匯入更早的紀錄`,
    'time-limit': `已保存 ${n} 部，請重試以繼續`,
    covered: `已同步至既有紀錄（${n} 部）`,
    'history-start': `完整匯入 ${n} 部`,
  }[reason] ?? `已匯入 ${n} 部`),
  importFailed: '匯入失敗',
  upToDate: '已是最新',
  syncFailed: '同步失敗',
  events: (n) => `${n} 筆觀看紀錄`,
  progressRows: (n) => `${n} 筆播放進度`,
  saved: '設定已儲存。',
  testing: '測試連線中…',
  connectionReady: '連線就緒。',
  googleAccountInvalid: 'Google 帳號請填完整的 email 地址。',
  updateAvailable: (v) => `有新版 v${v} 可用——點這裡看更新方式`,
} : {
  paused: 'Watch-time recording paused',
  active: 'Recording watch time',
  setupRequired: 'Setup required',
  never: 'Never',
  notSynced: 'Not synced',
  notImported: 'Not imported',
  syncNow: 'Sync now',
  cancelSync: 'Cancel sync',
  rescanAll: 'Rescan all history',
  cancelScan: 'Cancel scan',
  videos: (n) => `${n} videos`,
  deepHistoryProgress: (events) => `${events} records scanned`,
  importedVideos: (n) => `${n} imported`,
  historyResult: (reason, n) => ({
    'history-paused': 'Watch history is paused — turn it on and retry',
    'signed-out': 'YouTube is signed out — sign in and retry',
    'no-content': 'No history found — check sign-in and history settings',
    stalled: `Loading stopped (${n} saved) — retry to continue`,
    'segment-limit': `${n} saved. Use Rescan all history to import earlier records`,
    'time-limit': `${n} saved — retry to continue`,
    covered: `Synced to saved coverage (${n} videos)`,
    'history-start': `Full history imported (${n} videos)`,
  }[reason] ?? `${n} imported`),
  importFailed: 'Import failed',
  upToDate: 'Up to date',
  syncFailed: 'Sync failed',
  events: (n) => `${n} watch records`,
  progressRows: (n) => `${n} playback records`,
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
    rescanAll: urtubeT.rescanAll,
    settings: '設定',
    scanHelp: '立即同步會檢查新增紀錄。重新掃描會再次檢查全部歷史紀錄。',
    optionsTitle: 'urtube YouTube 擷取設定',
    optionsHeader: 'urtube YouTube 擷取',
    optionsSub: '私人連線設定',
    endpointLabel: '伺服器網址',
    tokenLabel: '連線碼',
    googleAccountLabel: 'Google 帳號（選填——Chrome 同時登入多個帳號時務必填寫）',
    captureToggle: '記錄觀看時間',
    dailySyncToggle: '每天同步帳號紀錄',
    save: '儲存',
    test: '測試連線',
    privacy: '同步會讀取你的 YouTube 觀看與搜尋紀錄並傳送至 urtube，搜尋詞加密保存。',
  };
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const value = staticZh[el.dataset.i18n];
    if (typeof value === 'string') el.textContent = value;
  }
  const title = staticZh[document.body.dataset.i18nTitle];
  if (title) document.title = title;
  document.documentElement.lang = 'zh-Hant';
}

// Display known recovery actions instead of raw worker, provider or browser errors.
function urtubeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (!message) return '';
  const t = (zh, en) => urtubeZh ? zh : en;
  if (message === urtubeT.googleAccountInvalid) return message;
  if (/Capture token is not configured|invalid_token|unauthorized|HTTP 401|HTTP 403|connection-settings/i.test(message)) {
    return t('連線設定不正確，請到 urtube 重新連接擴充功能。', 'Check your connection settings or reconnect the extension from urtube.');
  }
  if (/signed.out/i.test(message)) return t('請先登入 YouTube，再重新同步。', 'Sign in to YouTube, then sync again.');
  if (/history.paused/i.test(message)) return t('請先開啟 YouTube 觀看紀錄，再重新同步。', 'Turn on YouTube watch history, then sync again.');
  if (/already running/i.test(message)) return t('同步正在進行，請稍候。', 'A sync is already in progress. Please wait.');
  if (/use Takeout/i.test(message)) return t('這段紀錄太多，請使用 Google Takeout 匯入。', 'This history is too large to sync. Import it using Google Takeout.');
  return t('操作未完成，請稍後重試。若持續失敗，請重新連接擴充功能。', 'The action could not be completed. Try again later, or reconnect the extension if the problem continues.');
}
