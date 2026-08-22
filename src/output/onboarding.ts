import { config } from '../config.js';
import type { CreatedUser, User } from '../users.js';
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

const signupNav = [
  { label: 'Home', href: '/' },
  { label: 'Create your archive', href: '/signup', active: true },
];

export function signupPage(error = ''): string {
  const body = `<style>${formStyles}</style><section class="ob-intro"><div class="eyebrow">Self-serve onboarding</div><h1>Create your archive</h1>
    <p>Pick a handle and you immediately get a private dashboard plus a personal capture token for the Chrome
    extension. Your history stays yours: searches are encrypted, dashboards are private by default, and every
    account lives in its own database.</p></section>
    <div class="ob-card">${error ? `<div class="ob-error">${html(error)}</div>` : ''}
    <form class="ob-form" method="post" action="/signup">
      <label for="handle">Handle (lowercase letters, digits, dashes)</label>
      <input id="handle" name="handle" type="text" required minlength="2" maxlength="32" pattern="[a-z0-9][a-z0-9-]{1,31}" placeholder="dad">
      <label for="displayName">Display name</label>
      <input id="displayName" name="displayName" type="text" required maxlength="80" placeholder="Sky's Dad">
      <label class="ob-check"><input type="checkbox" name="dashboardPublic" value="1"> Make my dashboard public (anyone with the link can see aggregates — never searches)</label>
      <button type="submit">Create my archive</button>
    </form></div>`;
  return shell('Create your archive', body, signupNav);
}

export function welcomePage(user: CreatedUser): string {
  const endpoint = `${config.publicBaseUrl}/api/ingest/youtube/capture`;
  const dashboardUrl = user.dashboardPublic
    ? `${config.publicBaseUrl}/u/${user.handle}`
    : `${config.publicBaseUrl}/u/${user.handle}?key=${user.dashboardToken}`;
  const body = `<style>${formStyles}</style><section class="ob-intro"><div class="eyebrow">Welcome, ${html(user.displayName)}</div><h1>Your archive is ready</h1>
    <p>These credentials are shown <strong>once</strong> — we store only hashes. Save them somewhere safe now.</p></section>
    <div class="ob-card">
      <div class="ob-warn">⚠ This page cannot be re-opened. Copy everything below before leaving.</div>
      <h2>1 · Your dashboard</h2>
      <p>Bookmark this exact link${user.dashboardPublic ? '' : ' — the key in it is your login'}:</p>
      <code class="ob-token"><a href="${html(dashboardUrl)}">${html(dashboardUrl)}</a></code>
      <h2>2 · Capture token</h2>
      <p>Paste this into the extension's settings as the capture token:</p>
      <code class="ob-token">${html(user.captureToken)}</code>
      <h2>3 · Install the Chrome extension</h2>
      <ol class="ob-steps">
        <li>Download <a href="/extension.zip">extension.zip</a> and unzip it.</li>
        <li>Open <code>chrome://extensions</code>, enable <strong>Developer mode</strong>, click <strong>Load unpacked</strong>, and pick the unzipped folder.</li>
        <li>In the extension's <strong>Settings</strong>: endpoint <code>${html(endpoint)}</code>, token from step 2 → <strong>Test connection</strong> should say “Connection ready.”</li>
        <li>Watch any YouTube video for ≥30 seconds — it appears on your dashboard as measured time.</li>
        <li>Optional: press <strong>Sync now</strong> in the extension popup to pull your recent account history and saved progress, or upload a full <a href="https://takeout.google.com">Google Takeout</a> later.</li>
      </ol>
      <p style="margin-top:16px">Lost your tokens? There is no recovery in this MVP — ask the instance owner to rotate them.</p>
    </div>`;
  return shell('Welcome', body, signupNav);
}

export function dashboardSetupSection(user: User, hasData: boolean): string {
  if (hasData) return '';
  const endpoint = `${config.publicBaseUrl}/api/ingest/youtube/capture`;
  return `<style>${formStyles}</style><div class="ob-card" style="margin:18px 0 0;max-width:none">
    <h2>Nothing here yet — finish your setup</h2>
    <ol class="ob-steps">
      <li>Install the <a href="/extension.zip">Chrome extension</a> (chrome://extensions → Developer mode → Load unpacked).</li>
      <li>Extension settings: endpoint <code>${html(endpoint)}</code> + the capture token you saved at signup.</li>
      <li>Watch a video, or press <strong>Sync now</strong> in the extension popup to import recent history.</li>
    </ol>
  </div>`;
}
