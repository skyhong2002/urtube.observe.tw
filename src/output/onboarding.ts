import { config } from '../config.js';
import type { GuidedOnboardingState, GuidedScanStatus } from '../onboarding-flow.js';
import { DEFAULT_HANDLE, type User } from '../users.js';
import type { YoutubeImportResult } from '../youtube/types.js';
import type { YoutubeProcessingStatus } from '../youtube/processing.js';
import { MATCHING_TAXONOMY } from '../youtube/matching.js';
import { messages, type Lang } from './i18n.js';
import { html, primaryNav, shell } from './pages.js';
import { v3ProcessingNotice, v3ProcessingStyles } from './v3-processing.js';
import type { V3ProcessingStatus } from '../youtube/v3-processing.js';

const formStyles = `
  .ob-intro{margin:14px 0 26px}
  .ob-profile{align-items:center;display:flex;gap:16px}.ob-profile .ob-avatar{border-radius:50%;flex:0 0 64px;height:64px;object-fit:cover;width:64px}.ob-profile h1{margin-top:3px}
  .ob-intro h1{font-size:clamp(28px,4vw,40px);letter-spacing:-.03em;line-height:1.08;margin:7px 0 10px}
  .ob-intro p{color:var(--ink-2);margin:0;max-width:640px}
  .ob-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);margin:0 auto;max-width:560px;padding:28px}
  .ob-card h2{font-size:16px;margin:0 0 6px}
  .ob-card h2:not(:first-child){margin-top:34px}
  .ob-card details:not(:first-child){margin-top:26px}
  .ob-card p{color:var(--ink-2);font-size:13px;margin:0 0 16px}
  .ob-form{display:grid;gap:10px}
  .ob-form label{color:var(--ink-2);font-size:12px;font-weight:700;margin-top:6px}
  .ob-form input[type=text],.ob-form select,.ob-form textarea{background:var(--raised);border:1px solid var(--line-strong);border-radius:8px;color:var(--ink);font:inherit;padding:11px 12px;width:100%}
  .ob-form textarea{min-height:82px;resize:vertical}
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
  .ob-advanced{border-top:1px solid var(--line);padding-top:22px}
  .ob-success{background:rgba(94,182,125,.1);border:1px solid rgba(94,182,125,.35);border-radius:10px;color:#7ecf9d;font-size:13px;margin-bottom:14px;padding:10px 12px}.ob-help{color:var(--muted)!important;font-size:11px!important;margin:0!important}
  .ob-switches{display:grid;gap:8px;margin:4px 0 10px}.ob-switch{align-items:flex-start;background:var(--raised);border:1px solid var(--line);border-radius:10px;cursor:pointer;display:flex;gap:12px;padding:11px 12px}.ob-switch input{flex:0 0 auto;height:18px;margin:2px 0 0;width:18px}.ob-switch strong{color:var(--ink);display:block;font-size:13px}.ob-switch small{color:var(--ink-2);display:block;font-size:11px;line-height:1.5;margin-top:2px}
`;

function signupNav(lang: Lang) {
  return primaryNav(lang, {
    active: 'signup',
    exampleHref: `/${DEFAULT_HANDLE}`,
    languageHref: `/signup?lang=${lang === 'zh' ? 'en' : 'zh'}`,
  });
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
  return shell(t.signupTitle, body, signupNav(lang), '', lang, '/signup');
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
  return shell(t.signupCompleteTitle, body, signupNav(lang), '', lang, '/signup');
}

export interface AccountPageState {
  rotated?: { captureToken: string; dashboardToken: string };
  error?: string;
  extensionVersion?: string;
  takeoutResult?: YoutubeImportResult;
  takeoutError?: string;
  // Background work still owed to this archive; shown right after an import
  // and on every later visit until the worker catches up.
  processing?: YoutubeProcessingStatus;
  v3Processing?: V3ProcessingStatus;
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
  const processing = v3ProcessingNotice(state.v3Processing, lang, { dashboardHref, ownerDetails: true, alwaysShow: true });
  const takeoutFeedback = state.takeoutResult
    ? `<div class="ob-success" role="status">${t.accountTakeoutSuccess(
      state.takeoutResult.watchesSeen, state.takeoutResult.watchesInserted,
      state.takeoutResult.searchesSeen, state.takeoutResult.searchesInserted,
    )}</div>${processing ? `<p>${t.accountTakeoutNext}</p>${processing}` : ''}`
    : state.takeoutError
      ? `<div class="ob-error" role="alert">${t.accountTakeoutFailed(html(state.takeoutError))}</div>`
      : '';
  const takeout = `<section class="ob-advanced" id="account-takeout">
      <h2>${t.accountTakeoutSummary}</h2>
      <h3>${t.accountTakeoutTitle}</h3>
      <p>${t.accountTakeoutPara}</p>
      <ol class="ob-steps">${t.accountTakeoutSteps.map((step) => `<li>${step}</li>`).join('')}</ol>
      ${takeoutFeedback}
      <form method="post" action="/account/takeout" enctype="multipart/form-data" class="ob-form">
        <label for="takeout">${t.accountTakeoutFile}</label>
        <input id="takeout" name="takeout" type="file" accept=".zip,application/zip,application/x-zip-compressed" required>
        <p class="ob-help">${t.accountTakeoutLimit}</p>
        <button type="submit">${t.accountTakeoutSubmit}</button>
      </form>
    </section>`;
  const matchingSettings = `
      <h2>${t.accountMatching}</h2>
      <p>${t.accountMatchingPara}</p>
      <form method="post" action="/account/matching" class="ob-form">
        <div class="ob-switches">
          <label class="ob-switch"><input type="checkbox" name="matchingOptIn" value="1"${user.matchingOptIn ? ' checked' : ''}><span><strong>${t.accountMatchingOptIn}</strong></span></label>
        </div>
        <details><summary>${t.settingsSharingDetails}</summary><p>${t.accountMatchingOptInHelp}</p><p>${t.accountMatchingFriends}</p></details>
        <button type="submit">${t.accountMatchingSave}</button>
      </form>`;
  const group = (id: string, title: string, content: string, open = false) =>
    `<details class="st-group" id="${id}"${open ? ' open' : ''}><summary>${title}</summary><div class="st-content">${content}</div></details>`;
  const body = `<style>${formStyles}${v3ProcessingStyles}
    .st-page{max-width:680px;margin:0 auto}.st-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:24px}.st-heading .ob-intro{margin:0}.st-heading a{font-size:13px}
    .st-group{background:var(--surface);border:1px solid var(--line);border-radius:12px;margin-bottom:12px;overflow:hidden}.st-group>summary{cursor:pointer;font-size:15px;font-weight:700;padding:20px 24px}.st-group>summary:hover{background:var(--raised)}.st-group>summary:focus-visible{outline:2px solid var(--accent);outline-offset:-4px}.st-content{border-top:1px solid var(--line);padding:24px}.st-content h2{font-size:15px;margin:26px 0 8px}.st-content h2:first-child{margin-top:0}.st-content h3{color:var(--ink-2);font-size:13px;margin:0 0 6px}.st-content p{color:var(--ink-2);font-size:13px}.st-content .ob-advanced{margin-top:20px}.st-content .ob-form button{justify-self:start}.st-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:24px}.st-footer .ob-form button{margin:0;background:var(--raised);border-color:var(--line-strong);color:var(--ink)}
    @media(max-width:480px){.st-content{padding:18px}.st-group>summary{padding:18px}}
    </style><div class="st-page"><header class="st-heading"><section class="ob-intro"><h1>${t.accountTitle}</h1><p>${t.settingsIntro}</p></section><a href="${dashboardHref}">${html(user.displayName)} ↗</a></header>
      ${state.error ? `<div class="ob-error" role="alert">${html(state.error)}</div>` : ''}
      <div id="processing">${state.takeoutResult ? '' : processing}</div>
      ${group('settings-profile', t.settingsProfile, `
      <p>${t.accountSignedInAs(html(user.googleEmail ?? ''))}</p>
      <form method="post" action="/account/profile" class="ob-form" style="margin-top:6px">
        <label for="displayName">${t.signupName}</label>
        <input id="displayName" name="displayName" type="text" required maxlength="80" value="${html(user.displayName)}">
        <button type="submit">${t.accountNameSave}</button>
      </form>
      `)}
      ${group('settings-privacy', t.settingsPrivacy, `
      ${matchingSettings}
      <h2>${t.accountVisibility}</h2>
      <p>${t.accountVisibilityPara}</p>
      <form method="post" action="/account/visibility" class="ob-form">
        <label class="ob-check"><input type="checkbox" name="dashboardPublic" value="1"${user.dashboardPublic ? ' checked' : ''}> ${t.accountVisibilityToggle}</label>
        <button type="submit">${t.accountVisibilitySave}</button>
      </form>
      <h2>${t.accountReferenceTitle}</h2>
      <p>${t.accountReferencePara}</p>
      <form method="post" action="/account/reference-population" class="ob-form">
        <label class="ob-check"><input type="checkbox" name="referenceOptIn" value="1"${user.referenceOptIn ? ' checked' : ''}> ${t.accountReferenceOptIn}</label>
        <button type="submit">${t.accountReferenceSave}</button>
      </form>
      `)}
      ${group('settings-sync', t.settingsSync, `
      <h2>${t.accountExtension}</h2>
      <p>${t.accountExtensionPara(html(state.extensionVersion ?? '?'))}</p>
      <ol class="ob-steps">
        ${t.accountExtensionSteps.map((step) => `<li>${step}</li>`).join('\n        ')}
      </ol>
      `)}
      ${group('settings-data', t.settingsData, `
      ${takeout}
      <section id="account-export">
        <h2>${t.accountExportTitle}</h2>
        <p>${t.accountExportPara}</p>
        <form method="post" action="/account/export" class="ob-form">
          <label class="ob-check"><input type="checkbox" name="confirmExport" value="1" required> ${t.accountExportConfirm}</label>
          <button type="submit">${t.accountExportButton}</button>
        </form>
      </section>
      `, !!takeoutFeedback)}
      ${group('settings-advanced', t.settingsAdvanced, `
      ${rotatedHtml}
      <h2>${t.accountRotate}</h2>
      <p>${t.accountRotatePara}</p>
      <form method="post" action="/account/rotate" class="ob-form"><button type="submit">${t.accountRotate}</button></form>
      <details style="margin-top:26px"><summary style="color:var(--accent-text);cursor:pointer;font-size:13px;font-weight:700">${t.accountDelete}</summary>
      <div class="ob-form" style="margin-top:10px">
        <p style="margin:0">${t.accountDeletePara}</p>
        <a href="mailto:me@skyhong.tw?subject=urtube%20account%20and%20data%20deletion">${t.accountDeleteButton}</a>
      </div></details>
      `, !!state.rotated || !!state.error)}
      <div class="st-footer"><a href="/privacy">${t.privacyLink}</a><form method="post" action="/logout" class="ob-form"><button type="submit">${t.accountLogout}</button></form></div>
    </div>
    <script>(() => {
      const revealTarget = () => {
        const target = document.getElementById(location.hash.slice(1));
        if (!target) return;
        for (let element = target; element; element = element.parentElement) {
          if (element instanceof HTMLDetailsElement) element.open = true;
        }
        target.scrollIntoView();
      };
      addEventListener('hashchange', revealTarget);
      revealTarget();
    })();</script>`;
  return shell(t.accountTitle, body, primaryNav(lang, {
    active: 'account', dashboardHref,
    languageHref: `/account?lang=${lang === 'zh' ? 'en' : 'zh'}`,
  }), '', lang, '/account');
}

const guidedStyles = `
  .go-progress{display:grid;gap:7px;grid-template-columns:repeat(6,minmax(0,1fr));margin:0 0 24px;padding:0}.go-progress li{border-top:3px solid var(--line);color:var(--muted);font-size:10px;list-style:none;padding-top:8px}.go-progress li.done{border-color:#5eb67d;color:var(--ink-2)}.go-progress li.current{border-color:var(--accent);color:var(--ink);font-weight:750}
  .go-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);max-width:680px;padding:28px}.go-card h2{font-size:20px;margin:0 0 9px}.go-card p{color:var(--ink-2);font-size:14px;line-height:1.65}.go-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:20px}.go-actions a,.go-actions button{border-radius:999px;font:inherit;font-size:13px;font-weight:750;padding:10px 16px;text-decoration:none}.go-primary{background:var(--accent);border:1px solid var(--accent);color:#fff}.go-secondary{background:transparent;border:1px solid var(--line-strong);color:var(--ink)}
  .go-note{background:var(--raised);border:1px solid var(--line);border-radius:10px;color:var(--ink-2);font-size:13px;margin:16px 0;padding:12px 14px}.go-note.warn{border-color:rgba(250,178,25,.35);color:#f5c95e}.go-topics{display:grid;gap:8px;margin:18px 0}.go-topic{align-items:center;background:var(--raised);border:1px solid var(--line);border-radius:9px;display:flex;font-size:13px;font-weight:700;gap:9px;padding:11px 12px}.go-topic input{accent-color:var(--accent)}.go-choice{align-items:flex-start;background:var(--raised);border:1px solid var(--line);border-radius:10px;display:flex;gap:9px;padding:12px}.go-choice input{accent-color:var(--accent);margin-top:3px}
  @media(max-width:640px){.go-progress{grid-template-columns:repeat(3,minmax(0,1fr))}.go-card{padding:21px}}
`;

function guidedScanMessage(status: GuidedScanStatus, lang: Lang): string {
  const t = messages(lang);
  if (status === 'running') return t.onboardingScanRunning;
  if (status === 'history-paused') return t.onboardingScanPaused;
  if (status === 'signed-out') return t.onboardingScanSignedOut;
  if (status === 'empty') return t.onboardingScanEmpty;
  if (status === 'retry') return t.onboardingScanRetry;
  return '';
}

export function guidedOnboardingPage(
  user: User,
  state: GuidedOnboardingState,
  lang: Lang = 'en',
  processingStatus?: V3ProcessingStatus,
): string {
  const t = messages(lang);
  const dashboardHref = `/${user.handle}`;
  const progress = `<ol class="go-progress">${t.onboardingSteps.map((label, index) => {
    const step = index + 1;
    const status = state.activeStep > step ? 'done' : state.activeStep === step ? 'current' : '';
    return `<li class="${status}"${status === 'current' ? ' aria-current="step"' : ''}>${html(label)}</li>`;
  }).join('')}</ol>`;
  const provisional = state.provisional
    ? `<div class="go-note warn">${t.onboardingProvisional}</div>` : '';
  let content: string;
  if (state.step === 'setup') {
    const scan = guidedScanMessage(state.scanStatus, lang);
    content = `<h2>${t.onboardingSetupTitle}</h2><p>${t.onboardingSetupPara}</p>
      <div class="go-note">${t.onboardingDesktopOnly}</div>
      ${scan ? `<div class="go-note${state.scanStatus === 'running' ? '' : ' warn'}">${scan}</div>` : ''}
      <ol class="ob-steps">${t.onboardingInstallSteps.map((step) => `<li>${step}</li>`).join('')}</ol>
      <div class="go-actions"><a class="go-primary" href="/extension-setup">${t.onboardingSetupCta}</a><a class="go-secondary" href="/onboarding">${t.onboardingRefresh}</a></div>`;
  } else if (state.step === 'processing') {
    const notice = v3ProcessingNotice(processingStatus, lang, { dashboardHref, ownerDetails: true, alwaysShow: true });
    content = `<h2>${t.onboardingProcessingTitle}</h2><p>${t.onboardingProcessingPara}</p>
      ${notice || `<div class="go-note warn">${t.onboardingMoreData}</div>`}
      <div class="go-actions"><a class="go-primary" href="/onboarding">${t.onboardingRefresh}</a><a class="go-secondary" href="/extension-setup">${t.onboardingSetupCta}</a><a class="go-secondary" href="${dashboardHref}">${t.onboardingOpenDashboard}</a></div>`;
  } else if (state.step === 'consent') {
    content = `<h2>${t.onboardingConsentTitle}</h2><p>${t.onboardingConsentPara}</p>${provisional}
      <form method="post" action="/onboarding/finish" class="ob-form">
        <label class="go-choice"><input type="radio" name="choice" value="join" required> <span>${t.onboardingJoin}</span></label>
        <label class="go-choice"><input type="radio" name="choice" value="private" required> <span>${t.onboardingPrivate}</span></label>
        <button type="submit">${t.onboardingFinish}</button>
      </form>`;
  } else {
    content = `<h2>${t.onboardingCompleteTitle}</h2><p>${t.onboardingCompletePara}</p>
      <div class="go-actions">${user.matchingOptIn ? `<a class="go-primary" href="/matches">${t.onboardingOpenMatches}</a>` : ''}<a class="go-secondary" href="${dashboardHref}">${t.onboardingOpenDashboard}</a></div>`;
  }
  const refresh = state.step === 'processing' || state.scanStatus === 'running'
    ? '<script>setTimeout(()=>location.reload(),15000)</script>' : '';
  const body = `<style>${formStyles}${v3ProcessingStyles}${guidedStyles}</style><section class="ob-intro"><div class="eyebrow">${t.onboardingEyebrow}</div><h1>${t.onboardingTitle}</h1><p>${t.onboardingPara}</p></section>${progress}<section class="go-card">${content}</section>${refresh}`;
  return shell(t.onboardingTitle, body, primaryNav(lang, {
    dashboardHref,
    languageHref: `/onboarding?lang=${lang === 'zh' ? 'en' : 'zh'}`,
  }), '', lang, '/onboarding');
}

// The page the extension opens right after install (and the target of the
// guided setup). Talks to the provision content script through DOM
// dataset attributes + events — the same bridge pattern dashboard.js uses.
export function extensionSetupPage(user: User, lang: Lang = 'en'): string {
  const t = messages(lang);
  const body = `<style>${formStyles}</style><section class="ob-intro"><div class="eyebrow">${t.signupEyebrow}</div><h1>${t.esTitle}</h1>
    <p>${t.esPara(html(user.googleEmail ?? user.handle))}</p></section>
    <div class="ob-card" data-urtube-provision>
      <div id="es-waiting">
        <p>${t.esWaiting}</p>
        <ol class="ob-steps">${t.onboardingInstallSteps.map((step) => `<li>${step}</li>`).join('')}</ol>
      </div>
      <div id="es-ready" hidden>
        <p>${t.esAuthorizePara}</p>
        <form class="ob-form"><button id="es-authorize" type="button">${t.esAuthorize}</button></form>
      </div>
      <div id="es-done" hidden>
        <div class="ob-warn" style="border-color:rgba(94,182,125,.4);background:rgba(94,182,125,.1);color:#7ecf9d">${t.esDone}</div>
        <p>${t.esDonePara}</p>
        <p><a href="/onboarding">${t.esContinue}</a></p>
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
  return shell(t.esTitle, body, primaryNav(lang, {
    active: 'account', dashboardHref: `/${user.handle}`,
    languageHref: `/extension-setup?lang=${lang === 'zh' ? 'en' : 'zh'}`,
  }), '', lang, '/extension-setup');
}

export function dashboardSetupSection(user: User, hasData: boolean, lang: Lang = 'en'): string {
  if (hasData) return '';
  const t = messages(lang);
  const steps = t.setupSteps().map((step) => `<li>${step}</li>`).join('\n      ');
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
      window.addEventListener('urtube-youtube-import-status', update, { signal: window.urtubePageController.signal });
      update();
    })();</script>
  </div>`;
}
