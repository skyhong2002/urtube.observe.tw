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
  .ob-card h2:not(:first-child){margin-top:34px}
  .ob-card details:not(:first-child){margin-top:26px}
  .ob-card p{color:var(--ink-2);font-size:13px;margin:0 0 16px}
  .ob-form{display:grid;gap:10px}
  .ob-form label{color:var(--ink-2);font-size:12px;font-weight:700;margin-top:6px}
  .ob-form input[type=text]{background:var(--raised);border:1px solid var(--line-strong);border-radius:8px;color:var(--ink);font:inherit;padding:11px 12px;width:100%}
  .ob-form input[type=file]{background:var(--raised);border:1px dashed var(--line-strong);border-radius:8px;color:var(--ink-2);font:inherit;font-size:13px;padding:14px 12px;width:100%}
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
  .ob-google{align-items:center;background:var(--raised);border:1px solid var(--line-strong);border-radius:999px;color:var(--ink);display:inline-flex;font-size:14px;font-weight:700;gap:10px;padding:11px 20px;text-decoration:none}
  .ob-google:hover{border-color:var(--muted)}
`;

function signupNav(lang: Lang) {
  const t = messages(lang);
  return [
    { label: t.navHome, href: '/' },
    { label: t.navSignup, href: '/signup', active: true },
  ];
}

const googleButton = (label: string) => `
  <a class="ob-google" href="/auth/google"><svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>${label}</a>`;

// Step 1: a verified Google identity is the only way in.
export function signupStartPage(error = '', lang: Lang = 'en'): string {
  const t = messages(lang);
  const body = `<style>${formStyles}</style><section class="ob-intro"><div class="eyebrow">${t.signupEyebrow}</div><h1>${t.signupTitle}</h1>
    <p>${t.signupStartPara}</p></section>
    <div class="ob-card">${error ? `<div class="ob-error">${html(error)}</div>` : ''}
    ${googleButton(t.signinGoogle)}</div>`;
  return shell(t.signupTitle, body, signupNav(lang), '', lang);
}

// Step 2: Google identity verified, pick a handle (or claim a pre-Google
// account by proving ownership with its dashboard key).
export function signupCompletePage(
  pending: { email: string; suggestedHandle: string },
  error = '',
  lang: Lang = 'en',
): string {
  const t = messages(lang);
  const body = `<style>${formStyles}</style><section class="ob-intro"><div class="eyebrow">${t.signupEyebrow}</div><h1>${t.signupCompleteTitle}</h1>
    <p>${t.signupCompletePara(html(pending.email))}</p></section>
    <div class="ob-card">${error ? `<div class="ob-error">${html(error)}</div>` : ''}
    <form class="ob-form" method="post" action="/signup">
      <label for="handle">${t.signupHandle} <span id="handle-hint" style="font-weight:400"></span></label>
      <input id="handle" name="handle" type="text" required minlength="2" maxlength="32" pattern="[a-z0-9][a-z0-9.-]{1,31}" value="${html(pending.suggestedHandle)}" placeholder="dad" autocomplete="off">
      <label for="displayName">${t.signupName}</label>
      <input id="displayName" name="displayName" type="text" required maxlength="80" value="${html(pending.email.split('@')[0] ?? '')}" placeholder="Sky's Dad">
      <label class="ob-check"><input type="checkbox" name="dashboardPublic" value="1"> ${t.signupPublic}</label>
      <button type="submit">${t.signupSubmit}</button>
    </form>
    <details style="margin-top:18px"><summary style="cursor:pointer;color:var(--ink-2);font-size:13px">${t.signupClaimSummary}</summary>
    <form class="ob-form" method="post" action="/signup" style="margin-top:10px">
      <p style="margin:0">${t.signupClaimPara}</p>
      <label for="claimHandle">${t.signupClaimHandle}</label>
      <input id="claimHandle" name="claimHandle" type="text" maxlength="32" placeholder="skyhong.tw">
      <label for="claimKey">${t.signupClaimKey}</label>
      <input id="claimKey" name="claimKey" type="text" maxlength="128" autocomplete="off">
      <button type="submit">${t.signupClaimSubmit}</button>
    </form></details>
    <script>(() => {
      // Live availability check so a taken handle never survives to submit.
      const input = document.getElementById('handle');
      const hint = document.getElementById('handle-hint');
      const free = ${JSON.stringify(t.handleFree)};
      const taken = ${JSON.stringify(t.handleTakenHint)};
      let timer = 0;
      const check = async () => {
        const handle = input.value.trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9.-]{1,31}$/.test(handle)) { hint.textContent = ''; return; }
        try {
          const response = await fetch('/signup/handle-check?handle=' + encodeURIComponent(handle));
          if (!response.ok) return;
          const body = await response.json();
          if (input.value.trim().toLowerCase() !== handle) return;
          hint.textContent = body.available ? free : taken;
          hint.style.color = body.available ? '#7ecf9d' : 'var(--accent-text)';
        } catch { /* advisory only */ }
      };
      input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(check, 300); });
      if (input.value) check();
    })();</script></div>`;
  return shell(t.signupCompleteTitle, body, signupNav(lang), '', lang);
}

export interface AccountPageState {
  rotated?: { captureToken: string; dashboardToken: string };
  error?: string;
  extensionVersion?: string;
}

export function accountPage(user: User, state: AccountPageState = {}, lang: Lang = 'en'): string {
  const t = messages(lang);
  const dashboardHref = `/${user.handle}`;
  const rotatedHtml = state.rotated ? `
      <div class="ob-warn">${t.accountRotated}</div>
      <p style="margin-bottom:2px">${t.accountCaptureToken}</p>
      <code class="ob-token">${html(state.rotated.captureToken)}</code>
      <p style="margin-bottom:2px">${t.accountDashboardKey}</p>
      <code class="ob-token">${html(state.rotated.dashboardToken)}</code>` : '';
  const body = `<style>${formStyles}</style><section class="ob-intro"><div class="eyebrow">${t.accountEyebrow}</div><h1>${t.accountTitle}</h1>
    <p>${t.accountSignedInAs(html(user.googleEmail ?? ''))}</p></section>
    <div class="ob-card">
      ${state.error ? `<div class="ob-error">${html(state.error)}</div>` : ''}
      <h2>${t.accountDashboard}</h2>
      <code class="ob-token"><a href="${dashboardHref}">${html(config.publicBaseUrl)}/${html(user.handle)}</a></code>
      <form method="post" action="/account/profile" class="ob-form" style="margin-top:6px">
        <label for="displayName">${t.signupName}</label>
        <input id="displayName" name="displayName" type="text" required maxlength="80" value="${html(user.displayName)}">
        <button type="submit">${t.accountNameSave}</button>
      </form>
      <h2>${t.accountExtension}</h2>
      <p>${t.accountExtensionPara(html(state.extensionVersion ?? '?'))}</p>
      <ol class="ob-steps">
        ${t.accountExtensionSteps.map((step) => `<li>${step}</li>`).join('\n        ')}
      </ol>
      <h2>${t.accountVisibility}</h2>
      <p>${t.accountVisibilityPara}</p>
      <form method="post" action="/account/visibility" class="ob-form">
        <label class="ob-check"><input type="checkbox" name="dashboardPublic" value="1"${user.dashboardPublic ? ' checked' : ''}> ${t.signupPublic}</label>
        <button type="submit">${t.accountVisibilitySave}</button>
      </form>
      ${rotatedHtml}
      <h2>${t.accountRotate}</h2>
      <p>${t.accountRotatePara}</p>
      <form method="post" action="/account/rotate" class="ob-form"><button type="submit">${t.accountRotate}</button></form>
      <form method="post" action="/logout" class="ob-form" style="margin-top:10px"><button type="submit" style="background:var(--raised);border-color:var(--line-strong);color:var(--ink)">${t.accountLogout}</button></form>
      <details style="margin-top:26px"><summary style="color:var(--accent-text);cursor:pointer;font-size:13px;font-weight:700">${t.accountDelete}</summary>
      <form method="post" action="/account/delete" class="ob-form" style="margin-top:10px">
        <p style="margin:0">${t.accountDeletePara(html(user.handle))}</p>
        <input name="confirmHandle" type="text" autocomplete="off" placeholder="${html(user.handle)}">
        <button type="submit">${t.accountDeleteButton}</button>
      </form></details>
    </div>`;
  return shell(t.accountTitle, body, [
    { label: t.navHome, href: '/' },
    { label: t.navDashboard, href: dashboardHref },
    { label: t.navAccount, href: '/account', active: true },
  ], '', lang);
}

export function welcomePage(user: CreatedUser, lang: Lang = 'en'): string {
  const t = messages(lang);
  const endpoint = `${config.publicBaseUrl}/api/ingest/youtube/capture`;
  const dashboardUrl = user.dashboardPublic
    ? `${config.publicBaseUrl}/${user.handle}`
    : `${config.publicBaseUrl}/${user.handle}?key=${user.dashboardToken}`;
  const installSteps = t.welcomeInstallSteps.map((step) => `<li>${step}</li>`).join('\n        ');
  const body = `<style>${formStyles}</style><section class="ob-intro"><div class="eyebrow">${t.welcomeEyebrow(html(user.displayName))}</div><h1>${t.welcomeTitle}</h1>
    <p>${t.welcomePara}</p></section>
    <div class="ob-card">
      <div class="ob-warn">${t.welcomeWarn}</div>
      <h2>${t.welcomeInstall}</h2>
      <ol class="ob-steps">
        ${installSteps}
      </ol>
      <h2>${t.welcomeConfigure}</h2>
      <p>${t.welcomeConfigurePara}</p>
      <details style="margin:0 0 18px"><summary style="color:var(--muted);cursor:pointer;font-size:13px">${t.welcomeManualSummary}</summary>
      <div style="margin-top:10px">
        <p>${t.welcomeManualPara}</p>
        <p style="margin-bottom:2px">${t.welcomeEndpointLabel}</p>
        <code class="ob-token">${html(endpoint)}</code>
        <p style="margin-bottom:2px">${t.welcomeTokenLabel}</p>
        <code class="ob-token">${html(user.captureToken)}</code>
        <p>${t.welcomeManualAccount}</p>
      </div></details>
      <h2>${t.welcomeDash}</h2>
      <p>${t.welcomeDashPara(user.dashboardPublic)}</p>
      <code class="ob-token"><a href="${html(dashboardUrl)}">${html(dashboardUrl)}</a></code>
      <p>${t.welcomeAfterPara}</p>
      <p style="margin-top:16px">${t.welcomeLost}</p>
    </div>`;
  return shell(t.welcomeTitle, body, signupNav(lang), '', lang);
}

// The page the extension opens right after install (and the target of the
// welcome page's step 2). Talks to the provision content script through DOM
// dataset attributes + events — the same bridge pattern dashboard.js uses.
export function extensionSetupPage(user: User, lang: Lang = 'en'): string {
  const t = messages(lang);
  const body = `<style>${formStyles}</style><section class="ob-intro"><div class="eyebrow">${t.signupEyebrow}</div><h1>${t.esTitle}</h1>
    <p>${t.esPara(html(user.googleEmail ?? user.handle))}</p></section>
    <div class="ob-card" data-urtube-provision>
      <div id="es-waiting">
        <p>${t.esWaiting}</p>
        <ol class="ob-steps">${t.welcomeInstallSteps.map((step) => `<li>${step}</li>`).join('')}</ol>
      </div>
      <div id="es-ready" hidden>
        <p>${t.esAuthorizePara}</p>
        <form class="ob-form"><button id="es-authorize" type="button">${t.esAuthorize}</button></form>
      </div>
      <div id="es-done" hidden>
        <div class="ob-warn" style="border-color:rgba(94,182,125,.4);background:rgba(94,182,125,.1);color:#7ecf9d">${t.esDone}</div>
        <p>${t.esDonePara}</p>
        <p><a href="/${html(user.handle)}">${t.landingMyDashboard}</a></p>
      </div>
      <p id="es-error" class="ob-error" hidden>${t.esError}</p>
    </div>
    <script>(() => {
      const root = document.querySelector('[data-urtube-provision]');
      const show = (id) => {
        for (const section of ['es-waiting', 'es-ready', 'es-done']) {
          document.getElementById(section).hidden = section !== id;
        }
      };
      const refresh = () => {
        if (root.dataset.provisioned === '1') show('es-done');
        else if (root.dataset.extensionReady === '1') show('es-ready');
      };
      window.addEventListener('urtube-extension-ready', refresh);
      window.addEventListener('urtube-provision-done', refresh);
      window.addEventListener('urtube-provision-error', () => {
        document.getElementById('es-error').hidden = false;
      });
      // The content script may have run before our listeners attached.
      setInterval(refresh, 800);
      refresh();
      document.getElementById('es-authorize').addEventListener('click', async () => {
        const button = document.getElementById('es-authorize');
        button.disabled = true;
        try {
          const response = await fetch('/extension-setup/token', { method: 'POST' });
          if (!response.ok) throw new Error('token request failed');
          root.dataset.provisionPayload = JSON.stringify(await response.json());
          window.dispatchEvent(new Event('urtube-provision-request'));
        } catch {
          document.getElementById('es-error').hidden = false;
          button.disabled = false;
        }
      });
    })();</script>`;
  return shell(t.esTitle, body, [
    { label: t.navHome, href: '/' },
    { label: t.navDashboard, href: `/${user.handle}` },
    { label: t.navAccount, href: '/account' },
  ], '', lang);
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
    <p id="setup-ext-status" hidden style="color:#7ecf9d;font-weight:600;margin:14px 0 0"></p>
    <script>(() => {
      // Closes the loop: when the extension's dashboard bridge reports in,
      // the static install steps gain a live "connected / syncing" line.
      const badge = document.getElementById('setup-ext-status');
      const control = document.querySelector('[data-youtube-import-control]');
      if (!badge || !control) return;
      const connected = ${JSON.stringify(t.setupConnected)};
      const syncingTemplate = ${JSON.stringify(t.setupSyncing(-1))};
      const syncing = (n) => syncingTemplate.replace('-1', String(n));
      const update = () => {
        let status;
        try { status = JSON.parse(control.dataset.extensionStatus || ''); } catch { return; }
        if (!status || !status.extensionReady) return;
        badge.hidden = false;
        badge.textContent = status.state === 'running' ? syncing(status.events ?? 0) : connected;
      };
      window.addEventListener('urtube-youtube-import-status', update);
      update();
    })();</script>
  </div>`;
}
