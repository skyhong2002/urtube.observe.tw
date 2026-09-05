import { friendshipActions, type ActionableMatchingCandidateCard } from './matches.js';
import { messages, type Lang } from './i18n.js';
import { html, primaryNav, shell } from './pages.js';

export interface MemberProfileData {
  handle: string;
  displayName: string;
  avatarVisible: boolean;
  interests: string[];
  comparisonHref: string | null;
  friendship?: ActionableMatchingCandidateCard | null;
}

export function memberProfilePage(viewerHandle: string, profile: MemberProfileData, lang: Lang): string {
  const t = messages(lang);
  const avatar = profile.avatarVisible
    ? `<img src="/avatar/member/${html(profile.handle)}" alt="" width="88" height="88">`
    : `<span class="mp-initial" aria-hidden="true">${html([...profile.displayName][0] ?? '?')}</span>`;
  const body = `<style>
    .mp-profile .mt-actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin:24px auto}.mp-profile .mt-actions form{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin:0}.mp-profile .mt-actions button{border:0;border-radius:999px;cursor:pointer;font:inherit;font-size:15px;font-weight:700;min-height:48px;min-width:140px;padding:12px 24px}.mp-profile .mt-want{background:var(--accent);color:white}.mp-profile .mt-secondary{background:var(--raised);color:var(--ink-2)}.mp-profile .mt-state{color:var(--muted);font-size:13px}
    .mp-profile{margin:28px auto 64px;max-width:720px;text-align:center}.mp-back{color:var(--muted);font-size:12px;text-decoration:none}.mp-profile header{margin-top:28px}.mp-profile header img,.mp-initial{background:var(--raised);border-radius:50%;display:grid;font-size:32px;height:88px;margin:0 auto 16px;object-fit:cover;place-items:center;width:88px}.mp-profile h1{font-size:32px;letter-spacing:-.03em;margin:0}.mp-handle{color:var(--muted);font-size:13px;margin:5px 0 20px}.mp-interests{margin-top:32px}.mp-interests h2{font-size:16px;margin:0 0 14px}.mp-pills{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}.mp-pills span{background:var(--raised);border-radius:999px;color:var(--ink-2);font-size:13px;padding:6px 14px}.mp-blend{background:var(--accent);border-radius:999px;color:white;display:inline-block;font-size:13px;font-weight:700;margin-top:28px;padding:10px 20px;text-decoration:none}.mp-note{color:var(--muted);font-size:12px;line-height:1.7;margin:32px auto 0;max-width:420px}
  </style><article class="mp-profile"><a class="mp-back" href="/matches?lang=${lang}">← ${html(t.navMatches)}</a><header>${avatar}<h1>${html(profile.displayName)}</h1><p class="mp-handle">@${html(profile.handle)}</p></header>${profile.friendship ? `<div class="mt-actions">${friendshipActions(profile.friendship, viewerHandle, t, `/${profile.handle}`)}</div>` : ''}${profile.interests.length ? `<section class="mp-interests"><h2>${html(t.memberProfileInterests)}</h2><div class="mp-pills">${profile.interests.map(interest => `<span>${html(interest)}</span>`).join('')}</div></section>` : ''}${profile.comparisonHref ? `<a class="mp-blend" href="${html(profile.comparisonHref)}">${html(t.memberProfileBlend)}</a>` : ''}<p class="mp-note">${html(t.memberProfilePrivate)}</p></article>`;
  return shell(profile.displayName, body, primaryNav(lang, {
    dashboardHref: `/${viewerHandle}`,
    languageHref: `/${profile.handle}?lang=${lang === 'zh' ? 'en' : 'zh'}`,
  }), '', lang);
}
