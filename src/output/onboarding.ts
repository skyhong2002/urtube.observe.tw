import { config } from '../config.js';
import type { CreatedUser, User } from '../users.js';
import { messages, type Lang } from './i18n.js';
import { html, shell } from './pages.js';

const formStyles = `
  .ob-intro{margin:14px 0 26px}
  .ob-intro h1{font-size:clamp(28px,4vw,40px);letter-spacing:-.03em;line-height:1.08;margin:7px 0 10px}
  .ob-intro p{color:var(--ink-2);margin:0;max-width:640px}
  .ob-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);margin:0 auto;max-width:560px;padding:28px}
  .ob-card h2{font-size:16px;margin:0 0 6px}
  .ob-card p{color:var(--ink-2);font-size:13px;margin:0 0 16px}
  .ob-form{display:grid;gap:10px}
  .ob-form label{color:var(--ink-2);font-size:12px;font-weight:700;margin-top:6px}
  .ob-form input[type=text]{background:var(--raised);border:1px solid var(--line-strong);border-radius:8px;color:var(--ink);font:inherit;padding:11px 12px;width:100%}
  .ob-form input:focus{border-color:var(--accent);outline:2px solid rgba(208,59,59,.3)}
  .ob-check{align-items:center;color:var(--ink-2);display:flex;font-size:13px;gap:8px;margin-top:6px}
  .ob-check input{accent-color:var(--accent)}
  .ob-form button{background:var(--accent);border:1px solid var(--accent);border-radius:999px;color:#fff;cursor:pointer;font:inherit;font-weight:700;margin-top:14px;padding:11px 16px}
  .ob-form button:hover{background:#b02f2f}
  .ob-error{background:rgba(208,59,59,.12);border:1px solid rgba(208,59,59,.4);border-radius:10px;color:var(--accent-text);font-size:13px;margin-bottom:14px;padding:10px 12px}
  .ob-token{background:var(--raised);border:1px solid var(--line);border-radius:8px;display:block;font-family:ui-monospace,monospace;font-size:12px;margin:6px 0 14px;overflow-wrap:anywhere;padding:10px 12px;user-select:all}
  .ob-warn{background:rgba(250,178,25,.1);border:1px solid rgba(250,178,25,.35);border-radius:10px;color:#f5c95e;font-size:13px;margin:14px 0;padding:10px 12px}
  .ob-steps{color:var(--ink-2);font-size:14px;line-height:1.7;padding-left:20px}
  .ob-steps strong{color:var(--ink)}
`;

function signupNav(lang: Lang) {
  const t = messages(lang);
  return [
    { label: t.navHome, href: '/' },
    { label: t.navSignup, href: '/signup', active: true },
  ];
}

export function signupPage(error = '', lang: Lang = 'en'): string {
  const t = messages(lang);
  const body = `<style>${formStyles}</style><section class="ob-intro"><div class="eyebrow">${t.signupEyebrow}</div><h1>${t.signupTitle}</h1>
    <p>${t.signupPara}</p></section>
    <div class="ob-card">${error ? `<div class="ob-error">${html(error)}</div>` : ''}
    <form class="ob-form" method="post" action="/signup">
      <label for="handle">${t.signupHandle}</label>
      <input id="handle" name="handle" type="text" required minlength="2" maxlength="32" pattern="[a-z0-9][a-z0-9-]{1,31}" placeholder="dad">
      <label for="displayName">${t.signupName}</label>
      <input id="displayName" name="displayName" type="text" required maxlength="80" placeholder="Sky's Dad">
      <label class="ob-check"><input type="checkbox" name="dashboardPublic" value="1"> ${t.signupPublic}</label>
      <button type="submit">${t.signupSubmit}</button>
    </form></div>`;
  return shell(t.signupTitle, body, signupNav(lang), '', lang);
}

export function welcomePage(user: CreatedUser, lang: Lang = 'en'): string {
  const t = messages(lang);
  const endpoint = `${config.publicBaseUrl}/api/ingest/youtube/capture`;
  const dashboardUrl = user.dashboardPublic
    ? `${config.publicBaseUrl}/${user.handle}`
    : `${config.publicBaseUrl}/${user.handle}?key=${user.dashboardToken}`;
  const steps = t.welcomeSteps(html(endpoint)).map((step) => `<li>${step}</li>`).join('\n        ');
  const body = `<style>${formStyles}</style><section class="ob-intro"><div class="eyebrow">${t.welcomeEyebrow(html(user.displayName))}</div><h1>${t.welcomeTitle}</h1>
    <p>${t.welcomePara}</p></section>
    <div class="ob-card">
      <div class="ob-warn">${t.welcomeWarn}</div>
      <h2>${t.welcomeDash}</h2>
      <p>${t.welcomeDashPara(user.dashboardPublic)}</p>
      <code class="ob-token"><a href="${html(dashboardUrl)}">${html(dashboardUrl)}</a></code>
      <h2>${t.welcomeToken}</h2>
      <p>${t.welcomeTokenPara}</p>
      <code class="ob-token">${html(user.captureToken)}</code>
      <h2>${t.welcomeExtension}</h2>
      <ol class="ob-steps">
        ${steps}
      </ol>
      <p style="margin-top:16px">${t.welcomeLost}</p>
    </div>`;
  return shell(t.welcomeTitle, body, signupNav(lang), '', lang);
}

export function dashboardSetupSection(user: User, hasData: boolean, lang: Lang = 'en'): string {
  if (hasData) return '';
  const t = messages(lang);
  const endpoint = `${config.publicBaseUrl}/api/ingest/youtube/capture`;
  const steps = t.setupSteps(html(endpoint)).map((step) => `<li>${step}</li>`).join('\n      ');
  return `<style>${formStyles}</style><div class="ob-card" style="margin:18px 0 0;max-width:none">
    <h2>${t.setupTitle}</h2>
    <ol class="ob-steps">
      ${steps}
    </ol>
  </div>`;
}
