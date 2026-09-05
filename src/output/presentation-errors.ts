import type { Lang } from './i18n.js';

// Translate errors only at the browser presentation boundary. Never expose provider
// responses, paths or configuration names; validation and HTTP status codes stay intact.
export function presentationError(error: unknown, lang: Lang, context: 'login' | 'signup' | 'takeout' | 'settings' | 'delete'): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;
  if (context === 'login') return t('登入未完成，請稍後重新登入。', 'Sign-in could not be completed. Please try again shortly.');
  if (context === 'signup') {
    if (message === 'Handle must be 2-32 chars of lowercase letters, digits, dots, or dashes') {
      return t('使用者 ID 需為 2–32 個小寫字母、數字、點或連字號，並以字母或數字開頭。', 'Use 2–32 lowercase letters, digits, dots or dashes for your user ID, starting with a letter or digit.');
    }
    if (message === 'That Google account is already linked to another user') return t('這個 Google 帳號已綁定其他帳號，請重新登入。', 'This Google account is already linked. Please sign in again.');
    return t('無法完成帳號設定，請確認輸入內容後再試一次。', 'Account setup could not be completed. Check your details and try again.');
  }
  if (context === 'takeout') {
    if (message === 'Archive contains no recognized YouTube watch or search history') return t('檔案中找不到 YouTube 歷史紀錄，請確認匯出項目。', 'No YouTube history was found in the archive. Check the data selected for export.');
    if (message === 'YouTube archive exceeds compressed size limit' || message === 'YouTube archive exceeds uncompressed size limit') return t('檔案內容過大，請只匯出 YouTube 歷史紀錄後再試。', 'The archive contents are too large. Export only YouTube history and try again.');
    return t('無法讀取這份檔案，請確認是 Google Takeout 原始 ZIP 後再試。', 'This archive could not be read. Check that it is the original Google Takeout ZIP and try again.');
  }
  if (context === 'delete') return t('無法完成刪除要求，請重新整理後再試。', 'Your deletion request could not be completed. Refresh the page and try again.');
  return t('暫時無法儲存變更，請重新整理後再試。', 'Your changes could not be saved. Refresh the page and try again.');
}
