import { config } from '../config.js';
import type { CreatedUser, User } from '../users.js';
import { html, shell } from './pages.js';

const formStyles = `
  .ob-card{background:var(--surface);border:1px solid var(--line);border-radius:14px;margin:0 auto;max-width:560px;padding:26px}
  .ob-card h2{margin:0 0 6px}.ob-card p{color:var(--muted);font-size:13px;margin:0 0 18px}
  .ob-form{display:grid;gap:10px}.ob-form label{color:var(--muted);font-size:12px;font-weight:700;margin-top:6px}
  .ob-form input[type=text]{background:var(--surface-raised);border:1px solid var(--line-strong);border-radius:6px;color:var(--text);font:inherit;padding:11px 12px;width:100%}
  .ob-form input:focus{border-color:var(--accent);outline:2px solid rgba(255,69,58,.2)}
  .ob-check{align-items:center;color:var(--muted);display:flex;font-size:13px;gap:8px;margin-top:6px}
  .ob-form button{background:var(--text);border:1px solid var(--text);border-radius:6px;color:#111;cursor:pointer;font:inherit;font-weight:700;margin-top:14px;padding:11px 14px}
  .ob-error{border:1px solid #7a2c24;border-radius:8px;color:#ff9c87;font-size:13px;margin-bottom:14px;padding:10px 12px}
  .ob-token{background:var(--surface-raised);border:1px solid var(--line-strong);border-radius:6px;display:block;font-family:ui-monospace,monospace;font-size:12px;margin:6px 0 14px;overflow-wrap:anywhere;padding:10px 12px;user-select:all}
  .ob-warn{border:1px solid #6b5b18;border-radius:8px;color:#f2c14e;font-size:13px;margin:14px 0;padding:10px 12px}
  .ob-steps{color:var(--muted);font-size:14px;line-height:1.7;padding-left:20px}.ob-steps code{background:var(--surface-raised);border-radius:4px;padding:1px 5px}
  .ob-steps strong{color:var(--text)}
`;

const signupNav = [
  { label: 'Home', href: '/' },
  { label: 'Create your archive', href: '/signup', active: true },
];

export function signupPage(error = ''): string {
  const body = `<section class="page-intro"><div><div class="eyebrow">Self-serve onboarding</div><h1>Create your archive</h1>
    <p>Pick a handle and you immediately get a private dashboard plus a personal capture token for the Chrome
    extension. Your history stays yours: searches are encrypted, dashboards are private by default, and every
    account lives in its own database.</p></div></section>
    <div class="ob-card">${error ? `<div class="ob-error">${html(error)}</div>` : ''}
    <form class="ob-form" method="post" action="/signup">
      <label for="handle">Handle (lowercase letters, digits, dashes)</label>
      <input id="handle" name="handle" type="text" required minlength="2" maxlength="32" pattern="[a-z0-9][a-z0-9-]{1,31}" placeholder="dad">
      <label for="displayName">Display name</label>
      <input id="displayName" name="displayName" type="text" required maxlength="80" placeholder="Sky's Dad">
      <label class="ob-check"><input type="checkbox" name="dashboardPublic" value="1"> Make my dashboard public (anyone with the link can see aggregates — never searches)</label>
      <button type="submit">Create my archive</button>
    </form></div>`;
  return shell('Create your archive', body, signupNav, formStyles);
}

export function welcomePage(user: CreatedUser): string {
  const endpoint = `${config.publicBaseUrl}/api/ingest/youtube/capture`;
  const dashboardUrl = user.dashboardPublic
    ? `${config.publicBaseUrl}/u/${user.handle}`
    : `${config.publicBaseUrl}/u/${user.handle}?key=${user.dashboardToken}`;
  const body = `<section class="page-intro"><div><div class="eyebrow">Welcome, ${html(user.displayName)}</div><h1>Your archive is ready</h1>
    <p>These credentials are shown <strong>once</strong> — we store only hashes. Save them somewhere safe now.</p></div></section>
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
  return shell('Welcome', body, signupNav, formStyles);
}

export function dashboardSetupSection(user: User, hasData: boolean): string {
  if (hasData) return '';
  const endpoint = `${config.publicBaseUrl}/api/ingest/youtube/capture`;
  return `<style>${formStyles}</style><div class="ob-card" style="margin:0 0 34px;max-width:none">
    <h2>Nothing here yet — finish your setup</h2>
    <ol class="ob-steps">
      <li>Install the <a href="/extension.zip">Chrome extension</a> (chrome://extensions → Developer mode → Load unpacked).</li>
      <li>Extension settings: endpoint <code>${html(endpoint)}</code> + the capture token you saved at signup.</li>
      <li>Watch a video, or press <strong>Sync now</strong> in the extension popup to import recent history.</li>
    </ol>
  </div>`;
}
