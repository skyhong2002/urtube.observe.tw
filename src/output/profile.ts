import { normalizeSocialUrl } from '../social-links.js';
import { SOCIAL_PRESETS, socialIcon, socialPlatform } from './social-icons.js';
import type { User } from '../users.js';
import type { ProfileInput } from '../profile.js';
import { html, primaryNav, shell } from './pages.js';
import { formStyles } from './onboarding.js';
import type { Lang } from './i18n.js';

export function profileMessages(lang: Lang) {
  return lang === 'zh' ? {
    title: '編輯個人檔案', name: '顯示名稱', handle: '使用者 ID', bio: '個人簡介', links: '社群連結',
    help: '選擇平台後，輸入使用者名稱或 @ID 即可。個人網站與自訂連結請填網址，最多 5 筆。',
    username: '使用者名稱或 @ID', usernameHint: '也可以貼上完整的個人頁面網址。',
    website: '個人網站', custom: '自訂連結', choose: '新增社群連結',
    linkName: '連結名稱', url: '網址（http / https）', add: '新增連結', remove: '刪除', up: '上移', down: '下移',
    save: '儲存變更', cancel: '取消', saved: '個人檔案已儲存。', remaining: '剩餘字數：',
    // Explain user-visible URL changes, not reservation or redirect implementation.
    hint: '2–32 字元，以小寫英文字母或數字開頭，可含小寫英文字母、數字、點及連字號。',
    warning: '修改 ID 會改變個人頁面網址，舊連結仍可使用。',
    confirm: '我了解個人頁面網址將變更。',
    errors: { displayName: '請填寫 1–80 字的顯示名稱。', handle: 'ID 格式不正確或為保留字。', bio: '個人簡介不可超過 300 字。', socialLinks: '請使用有效的網址與簡短名稱，最多可新增 5 筆連結。網址不可包含帳號密碼。', taken: '此 ID 已被使用或保留，請選擇其他 ID。', confirm: '儲存前請勾選網址變更確認。', failed: '儲存失敗，請重試。', csrf: '表單已失效，請重新整理後再試。' },
  } : {
    title: 'Edit profile', name: 'Display name', handle: 'User ID', bio: 'Bio', links: 'Social links',
    help: 'Choose a platform and enter your username or @ID. For websites and custom links, enter a URL. Up to 5 links.',
    username: 'Username or @ID', usernameHint: 'You can also paste a full profile URL.',
    website: 'Website', custom: 'Custom link', choose: 'Add social link',
    linkName: 'Link name', url: 'URL (http / https)', add: 'Add link', remove: 'Remove', up: 'Move up', down: 'Move down',
    save: 'Save changes', cancel: 'Cancel', saved: 'Profile saved.', remaining: 'Characters remaining: ',
    hint: '2–32 lowercase letters, digits, dots or dashes. Start with a letter or digit.',
    warning: 'Changing your ID changes your profile URL. Existing links will still work.',
    confirm: 'I understand my profile URL will change.',
    errors: { displayName: 'Enter a display name of 1–80 characters.', handle: 'Invalid or reserved ID.', bio: 'Bio must be 300 characters or fewer.', socialLinks: 'Use valid URLs and short names for up to 5 links. URLs must not contain passwords or sign-in details.', taken: 'This ID is already used or reserved. Choose another ID.', confirm: 'Confirm the URL change before saving.', failed: 'Could not save. Please try again.', csrf: 'This form has expired. Reload and try again.' },
  };
}

export function profileDetails(user: User, owns: boolean, lang: Lang): string {
  return `<div class="profile-details"><p class="muted">@${html(user.handle)}</p>
    ${user.bio ? `<p style="white-space:pre-wrap;overflow-wrap:anywhere">${html(user.bio)}</p>` : ''}
    ${user.socialLinks.length || owns ? '<div class="profile-action-row">' : ''}
    ${user.socialLinks.length ? `<ul class="profile-social-buttons">${user.socialLinks.map(link => `<li><a class="profile-icon-button" href="${html(link.url)}" target="_blank" rel="noopener noreferrer" aria-label="${html(link.name)}" title="${html(link.name)}">${socialIcon(socialPlatform(link.url))}</a></li>`).join('')}</ul>` : ''}
    ${owns ? `<a class="profile-edit-button" href="/account/profile" aria-label="${profileMessages(lang).title}" title="${profileMessages(lang).title}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z"/></svg></a>` : ''}
    ${user.socialLinks.length || owns ? '</div>' : ''}</div>`;
}

export function profileEditPage(user: User, csrf: string, lang: Lang, value: ProfileInput = user, error = '', saved = false): string {
  const t = profileMessages(lang);
  const platformName = (id: string) => id === 'website' ? t.website : SOCIAL_PRESETS.find(preset => preset.id === id)!.name;
  const row = (link: { name: string; url: string; platform?: string }) => {
    const platform = SOCIAL_PRESETS.some(p => p.id === link.platform) ? link.platform! : socialPlatform(link.url);
    const usernameMode = platform !== 'website';
    // Only shorten URLs we can reconstruct exactly. Keep videos, channel IDs,
    // legacy Threads domains and query strings as full URLs.
    let input = link.url;
    try {
      const path = new URL(link.url).pathname.replace(/^\//, '').replace(/\/$/, '');
      const candidate = decodeURIComponent(path).replace(/^@/, '');
      if (normalizeSocialUrl(platform, candidate) === link.url || normalizeSocialUrl(platform, candidate) + '/' === link.url) input = candidate;
    } catch { /* Preserve invalid input for correction. */ }
    return `<fieldset class="profile-link" data-input-platform="${html(platform)}"><legend><span data-link-icon>${socialIcon(platform as Parameters<typeof socialIcon>[0])}</span> <span data-link-platform>${platformName(platform)}</span></legend>
    <input type="hidden" name="linkPlatform" value="${html(platform)}">
    <input type="hidden" name="linkName" value="${html(link.name || platformName(platform))}">
    <label><span data-input-label>${usernameMode ? t.username : t.url}</span><input type="${usernameMode ? 'text' : 'url'}" name="linkUrl" required maxlength="2048" autocapitalize="none" spellcheck="false" placeholder="${usernameMode ? '@username' : 'https://'}" value="${html(input)}"></label>
    <small data-input-hint ${usernameMode ? '' : 'hidden'}>${t.usernameHint}</small>
    <small data-url-preview style="overflow-wrap:anywhere" aria-live="polite">${html(link.url)}</small>
    <div class="profile-actions"><button type="button" data-action="up" aria-label="${t.up}" title="${t.up}">↑</button><button type="button" data-action="down" aria-label="${t.down}" title="${t.down}">↓</button><button type="button" data-action="remove" aria-label="${t.remove}" title="${t.remove}">×</button></div></fieldset>`;
  };
  const body = `<style>${formStyles}
    .profile-form{max-width:660px}.profile-form textarea,.profile-form input[type=url]{background:var(--raised);border:1px solid var(--line-strong);border-radius:8px;color:var(--ink);font:inherit;padding:11px 12px;width:100%}
    .profile-form textarea{resize:vertical;min-height:130px}.profile-form small{color:var(--ink-2)}.profile-form label{display:block}.profile-link{min-width:0;border:1px solid var(--line-strong);border-radius:10px;margin:12px 0;padding:14px}.profile-form .ob-form button{font-size:13px;padding:7px 12px;margin-top:0}.profile-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.profile-actions button{min-height:34px;margin:0}.profile-actions a{padding:7px 12px;border:1px solid var(--line-strong);border-radius:999px;text-decoration:none;background:var(--raised);color:var(--ink);font-size:13px;font-weight:600;min-height:34px}.profile-actions a:hover{border-color:var(--accent-text)}.profile-form button:disabled{opacity:.4;cursor:default}.profile-form [hidden]{display:none}.profile-form input[type=checkbox]{min-width:20px;min-height:20px;vertical-align:middle}.profile-form textarea:focus-visible{outline:2px solid var(--accent-text)}
    .profile-presets{display:flex;flex-wrap:wrap;gap:6px}.profile-form .profile-presets button{display:flex;align-items:center;justify-content:center;gap:6px;min-height:34px;margin:0;padding:6px 10px;background:var(--raised);border:1px solid var(--line-strong);border-radius:10px;color:var(--ink);font-size:13px}.profile-presets button:hover{background:var(--surface);border-color:var(--accent-text)}.profile-link legend{padding:0 6px;font-size:13px;color:var(--ink-2)}
    .profile-presets .social-icon{width:16px;height:16px}.profile-form .profile-link .profile-actions button{display:inline-flex;align-items:center;justify-content:center;width:32px;min-height:32px;padding:0;border:1px solid var(--line-strong);background:var(--raised);color:var(--ink-2);font-size:18px;font-weight:400}.profile-form .profile-link .profile-actions button:hover{border-color:var(--accent-text);color:var(--ink)}
    @media(max-width:600px){.profile-form{padding:18px}.profile-actions button{flex:0 0 auto}.site-nav{flex-wrap:wrap}}
    </style><section class="ob-intro"><h1>${t.title}</h1>${user.googleSub && !user.avatarUrl ? `<p>${lang === 'zh' ? '尚未取得 Google 頭貼。' : 'Your Google picture is not available yet.'} <a href="/auth/google?next=%2Faccount%2Fprofile">${lang === 'zh' ? '重新登入以取得 Google 頭貼' : 'Sign in again to get your Google picture'}</a></p>` : ''}</section>
    <div class="ob-card profile-form">
    ${error ? `<div class="ob-error" role="alert" tabindex="-1" id="profile-error">${html(error)}</div>` : ''}
    ${saved ? `<div class="ob-success" role="status">${t.saved}</div>` : ''}
    <form method="post" action="/account/profile" class="ob-form" id="profile-form">
    <input type="hidden" name="csrf" value="${html(csrf)}">
    <label for="displayName">${t.name}</label><input id="displayName" type="text" name="displayName" required value="${html(value.displayName)}">
    <label for="handle">${t.handle}</label><input id="handle" type="text" name="handle" required minlength="2" maxlength="32" pattern="[a-z0-9][a-z0-9.\\-]{1,31}" autocapitalize="none" spellcheck="false" value="${html(value.handle)}" aria-describedby="handle-hint handle-warning">
    <small id="handle-hint">${t.hint}</small><div class="ob-warn" id="handle-warning">${t.warning}<p><code>/${html(user.handle)}</code> → <code id="new-url">/${html(value.handle)}</code></p>
    <label><input type="checkbox" name="confirmHandleChange" value="1" id="confirm-change"> ${t.confirm}</label></div>
    <label for="bio">${t.bio}</label><textarea id="bio" name="bio" rows="5" aria-describedby="bio-count">
${html(value.bio)}</textarea><small id="bio-count" aria-live="polite">${t.remaining}<span id="remaining">${300 - [...value.bio].length}</span></small>
    <h2>${t.links}</h2><p>${t.help}</p>
    <div class="profile-presets" role="group" aria-label="${t.choose}">
    ${SOCIAL_PRESETS.map(preset => `<button type="button" data-preset="${preset.id}">${socialIcon(preset.id)}${platformName(preset.id)}</button>`).join('')}
    <button type="button" id="add-link" data-preset="custom"><span aria-hidden="true">＋</span>${t.custom}</button></div>
    <div id="profile-links">${value.socialLinks.map(row).join('')}</div>
    <div class="profile-actions"><button type="submit">${t.save}</button><a href="/${html(user.handle)}">${t.cancel}</a></div>
    </form><template id="link-template">${row({ name: '', url: '' })}</template></div>
    <script>(()=>{
      const form=document.querySelector('#profile-form'), links=document.querySelector('#profile-links'), add=document.querySelector('#add-link'), bio=document.querySelector('#bio'), handle=document.querySelector('#handle'), confirm=document.querySelector('#confirm-change');
      const presets=${JSON.stringify(SOCIAL_PRESETS)}, icons=${JSON.stringify(Object.fromEntries(SOCIAL_PRESETS.map(preset => [preset.id, socialIcon(preset.id)]))).replace(/</g, '\\u003c')}, websiteName=${JSON.stringify(t.website)};
      const normalizeUrl=${normalizeSocialUrl.toString()};
      const usernameLabel=${JSON.stringify(t.username)}, urlLabel=${JSON.stringify(t.url)};
      const presetButtons=[...document.querySelectorAll('[data-preset]')];
      const original=${JSON.stringify(user.handle).replace(/</g, '\\u003c')};
      const refresh=()=>{presetButtons.forEach(button=>button.disabled=links.children.length>=5);[...links.children].forEach((row,i)=>{row.querySelector('[data-action=up]').disabled=i===0;row.querySelector('[data-action=down]').disabled=i===links.children.length-1;});};
      const updateIcon=row=>{const input=row.querySelector('[name=linkUrl]'), platform=row.querySelector('[name=linkPlatform]').value;const value=normalizeUrl(platform,input.value);let id=platform||'website';if(value){try{const host=new URL(value).hostname.toLowerCase();id=presets.find(p=>p.hosts.some(domain=>host===domain||host.endsWith('.'+domain)))?.id||'website';}catch{}}row.querySelector('[data-link-icon]').innerHTML=icons[id];row.querySelector('[data-link-platform]').textContent=id==='website'?websiteName:presets.find(p=>p.id===id).name;row.querySelector('[data-url-preview]').textContent=/^https?:/.test(value)?value:'';let name=id==='website'?websiteName:presets.find(p=>p.id===id).name;if(id==='website'){try{name=new URL(value).hostname;}catch{}}row.querySelector('[name=linkName]').value=[...name].slice(0,40).join('');};
      presetButtons.forEach(button=>button.addEventListener('click',()=>{if(links.children.length>=5)return;links.append(document.querySelector('#link-template').content.cloneNode(true));const row=links.lastElementChild,preset=presets.find(p=>p.id===button.dataset.preset);if(preset){row.querySelector('[name=linkPlatform]').value=preset.id;row.querySelector('[name=linkName]').value=preset.id==='website'?websiteName:preset.name;}const usernameMode=preset&&preset.id!=='website',input=row.querySelector('[name=linkUrl]');input.type=usernameMode?'text':'url';input.placeholder=usernameMode?'@username':(preset?.placeholder||'https://');row.querySelector('[data-input-label]').textContent=usernameMode?usernameLabel:urlLabel;row.querySelector('[data-input-hint]').hidden=!usernameMode;updateIcon(row);refresh();row.querySelector('[name=linkUrl]').focus();}));
      links.addEventListener('input',event=>{if(event.target.name==='linkUrl')updateIcon(event.target.closest('fieldset'));});
      links.addEventListener('click',e=>{const button=e.target.closest('button');if(!button)return;const row=button.closest('fieldset');if(button.dataset.action==='remove'){const next=row.nextElementSibling||row.previousElementSibling;row.remove();(next?.querySelector('[name=linkUrl]')||add).focus();}else if(button.dataset.action==='up'&&row.previousElementSibling){links.insertBefore(row,row.previousElementSibling);button.focus();}else if(button.dataset.action==='down'&&row.nextElementSibling){links.insertBefore(row.nextElementSibling,row);button.focus();}refresh();});
      const count=()=>{const remaining=300-[...bio.value.replace(/\\r\\n/g,'\\n')].length;document.querySelector('#remaining').textContent=remaining;bio.setCustomValidity(remaining<0?${JSON.stringify(t.errors.bio)}:'');};
      const handleChange=()=>{const changed=handle.value!==original;document.querySelector('#handle-warning').hidden=!changed;confirm.required=changed;document.querySelector('#new-url').textContent='/'+handle.value;};
      handle.addEventListener('input',handleChange);bio.addEventListener('input',count);refresh();count();handleChange();document.querySelector('#profile-error')?.focus();
    })();</script>`;
  return shell(t.title, body, primaryNav(lang, { active: 'account', dashboardHref: `/${user.handle}`, languageHref: '/account/profile?lang=' + (lang === 'zh' ? 'en' : 'zh') }), '', lang);
}
