import type { User } from '../users.js';
import type { Lang } from './i18n.js';
import { html } from './pages.js';

// A disclosure preview, not an authorization check. Actual routes still enforce
// current consent, relationships and genre selections on every request.
export function sharingPreview(user: Pick<User, 'displayName' | 'handle' | 'matchingOptIn' | 'dashboardPublic'>, lang: Lang): string {
  const zh = lang === 'zh';
  const variants = [false, true].flatMap(matching => [false, true].map(publicPage => {
    const key = `${Number(matching)}${Number(publicPage)}`;
    const current = matching === user.matchingOptIn && publicPage === user.dashboardPublic;
    const profile = zh ? '姓名、頭像、個人簡介、總覽與洞察' : 'Name, avatar, bio, Overview and Insights';
    const hidden = zh ? '看不到你的個人頁面' : 'Cannot view your profile';
    const member = publicPage ? `${profile}${zh ? '，並可進行 Blend' : ', and can start a Blend'}`
      : matching ? (zh ? '探索名單中的姓名、頭像、合拍度與共同興趣；可送好友邀請。頻道頁會顯示觀看排行及合計統計。'
        : 'Name, avatar, compatibility and shared interests in discovery; can send friend requests. Channel pages include viewing rankings and combined statistics.') : hidden;
    const friend = publicPage || matching ? `${profile}${zh ? '，並可進行 Blend' : ', and can start a Blend'}` : hidden;
    return `<div data-sharing-variant="${key}"${current ? '' : ' hidden'}>
      <p><strong>${matching || publicPage ? `${html(user.displayName)} · @${html(user.handle)}` : zh ? '你的檔案保持私人' : 'Your archive stays private'}</strong></p>
      <dl class="sp-audiences">
        <div><dt>${zh ? '未登入的訪客' : 'Signed-out visitors'}</dt><dd>${publicPage ? profile : hidden}</dd></div>
        <div><dt>${zh ? '其他成員（非好友）' : 'Other members (not friends)'}</dt><dd>${member}</dd></div>
        <div><dt>${zh ? '雙方同意的好友' : 'Mutual friends'}</dt><dd>${friend}</dd></div>
      </dl>
      ${matching && publicPage ? `<p>${zh ? '好友探索也會讓你出現在成員探索名單及頻道觀看排行與合計統計中。' : 'Discovery also includes you in member discovery, channel viewing rankings and combined statistics.'}</p>` : ''}
      ${!matching && user.matchingOptIn ? `<p class="sp-warning">${zh ? '儲存關閉好友探索後，現有好友關係與邀請會撤銷。' : 'Saving with discovery off removes existing friendships and requests.'}</p>` : ''}
    </div>`;
  })).join('');
  return `<section class="sharing-preview" aria-label="${zh ? '分享範圍預覽' : 'Sharing preview'}">
    <h3>${zh ? '別人會看到什麼？' : 'What will others see?'}</h3>
    <p>${zh ? '以下依你勾選的設定預覽，按下完成設定才會儲存。成員的配對內容仍取決於雙方的分享選擇與可用資料。' : 'Preview your choices below. They are saved only when you finish setup. Matching content also depends on both members’ sharing choices and available data.'}</p>
    <div aria-live="polite" aria-atomic="true" data-sharing-preview>${variants}</div>
    <p>${zh ? '觀看紀錄與回顧不會因以上選項而公開，仍限本人或持有私人存取金鑰的人查看。請勿分享金鑰。' : 'These choices never publish History or Recap. Access still requires your account or private access key. Do not share that key.'}</p>
    <p>${zh ? '私人是對其他使用者的可見範圍：紀錄仍儲存在 urtube 伺服器，公開影片資訊會交由 AI 服務分析。' : 'Private describes visibility to other users: records are still stored on urtube servers, and public video information is processed by AI services.'} <a href="/privacy">${zh ? '資料與隱私說明' : 'Data and privacy'}</a></p>
    <noscript><p>${zh ? '即時預覽需要 JavaScript；目前顯示的是已儲存設定。' : 'Live preview requires JavaScript; the preview currently reflects saved settings.'}</p></noscript>
  </section>`;
}

export const sharingPreviewStyles = `
.sharing-preview{border:1px solid var(--line);border-radius:12px;background:var(--raised);padding:18px;margin:12px 0}
.sharing-preview h3{margin:0 0 8px;font-size:16px}.sharing-preview p{font-size:13px;line-height:1.7}
.sharing-preview [hidden]{display:none}.sp-audiences{margin:12px 0}.sp-audiences>div{padding:12px 0;border-top:1px solid var(--line)}
.sp-audiences dt{font-size:13px;font-weight:700}.sp-audiences dd{margin:5px 0 0;font-size:13px;color:var(--ink-2);line-height:1.7}
.sp-warning{color:var(--accent-text)}
`;

export const sharingPreviewScript = `<script>(()=>{
  const preview=document.querySelector('[data-sharing-preview]');
  const form=preview?.closest('form');
  if(!form)return;
  const matching=form.elements.namedItem('matchingOptIn');
  const publicPage=form.elements.namedItem('dashboardPublic');
  const update=()=>{
    const key=String(Number(matching.checked))+String(Number(publicPage.checked));
    preview.querySelectorAll('[data-sharing-variant]').forEach(panel=>{panel.hidden=panel.dataset.sharingVariant!==key;});
  };
  form.addEventListener('change',update);window.addEventListener('pageshow',update);update();
})();</script>`;
