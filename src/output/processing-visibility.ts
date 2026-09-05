// Display preference only: scoped to the signed-in account in this browser.
export const processingVisibilityStyles = `
[data-processing-complete="true"],[data-processing-loading="true"]{display:none!important}
html[data-processing-visibility="hidden"] :is([data-processing-status],.yt-v3-processing,.yt-processing,.yt-provisional,.mt-provisional){display:none!important}
.processing-display-setting{background:var(--surface);border:1px solid var(--line);border-radius:12px;margin-bottom:16px;padding:18px 22px}
.processing-display-setting label{align-items:center;display:flex;gap:12px;min-height:44px;cursor:pointer;font-size:15px;font-weight:700}
.processing-display-setting input{accent-color:var(--accent);width:20px;height:20px;flex-shrink:0}
.processing-display-setting p{color:var(--ink-2);font-size:13px;margin:6px 0}
`;

// Runs in the head before any notices are painted; survives range navigation.
export const processingVisibilityScript = String.raw`
(() => {
  const account = document.documentElement.dataset.processingAccount;
  const key = account ? 'urtube:show-processing:' + account : null;
  let shown = true;
  try { if (key) shown = localStorage.getItem(key) !== 'false'; } catch {}
  function apply() {
    document.documentElement.dataset.processingVisibility = shown ? 'shown' : 'hidden';
    for (const input of document.querySelectorAll('[data-processing-visibility-toggle]')) input.checked = shown;
    for (const status of document.querySelectorAll('[data-processing-preference-status]')) {
      const zh = status.dataset.lang === 'zh';
      status.textContent = shown ? (zh ? '處理狀態已開啟' : 'Processing status is on')
        : (zh ? '已隱藏處理進度' : 'Processing progress is hidden');
    }
    window.dispatchEvent(new Event('urtube:processing-visibility'));
  }
  apply();
  document.addEventListener('DOMContentLoaded', apply, { once: true });
  window.addEventListener('urtube:page-updated', apply);
  document.addEventListener('change', event => {
    if (!event.target.matches?.('[data-processing-visibility-toggle]') || !key) return;
    shown = event.target.checked;
    let saved = true;
    try { localStorage.setItem(key, String(shown)); } catch { saved = false; }
    apply();
    if (!saved) for (const status of document.querySelectorAll('[data-processing-preference-status]')) {
      status.textContent += status.dataset.lang === 'zh' ? '。瀏覽器無法儲存，下次開啟可能需要重新設定。'
        : '. Browser storage is unavailable. You may need to set this again next time.';
    }
  });
  window.addEventListener('storage', event => {
    if (key && (event.key === key || event.key === null)) {
      try { shown = localStorage.getItem(key) !== 'false'; } catch { shown = true; }
      apply();
    }
  });
})();`;

// This control changes display only; browser storage mechanics do not belong in its help text.
export function processingVisibilitySetting(lang: 'zh' | 'en'): string {
  const zh = lang === 'zh';
  return `<section class="processing-display-setting" id="processing-display"><label><input type="checkbox" role="switch" checked data-processing-visibility-toggle aria-describedby="processing-display-help"><span>${zh ? '顯示處理狀態' : 'Show processing status'}</span></label><p id="processing-display-help">${zh ? '在頁面上顯示資料整理進度。' : 'Show data preparation progress on pages.'}</p><p data-processing-preference-status data-lang="${lang}" role="status">${zh ? '處理狀態已開啟' : 'Processing status is on'}</p></section>`;
}
