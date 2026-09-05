import { config } from '../config.js';
import { messages, type Lang } from './i18n.js';

import { queryNavigationScript } from './query-navigation.js';

export function html(value: unknown): string {
  return String(value ?? '').replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[char]!));
}

export function trustSignals(items: string[], label: string): string {
  return `<ul class="trust-signals" aria-label="${html(label)}">${items.map((item) =>
    `<li><span aria-hidden="true">✓</span>${html(item)}</li>`).join('')}</ul>`;
}

export function hours(seconds: number | null): string {
  if (seconds === null) return '—';
  return `${Math.round(seconds / 360) / 10}h`;
}

export function duration(seconds: number | null, lang: Lang = 'en'): string {
  const t = messages(lang);
  if (seconds === null) return t.unknownLength;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? t.minutes(minutes) : t.hoursMinutes(Math.floor(minutes / 60), minutes % 60);
}

// Tiered relative time for watch cards: minutes/hours/days/weeks ago, then a
// plain calendar date (Taipei time) once it is more than a month old.
export function timeAgo(iso: string, lang: Lang = 'en', now = Date.now()): string {
  const t = messages(lang);
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 60) return t.agoMinutes(Math.max(1, minutes));
  const hoursAgo = Math.floor(minutes / 60);
  if (hoursAgo < 24) return t.agoHours(hoursAgo);
  const days = Math.floor(hoursAgo / 24);
  if (days < 7) return t.agoDays(days);
  if (days < 31) return t.agoWeeks(Math.floor(days / 7));
  const taipei = new Date(then + 8 * 3600_000);
  const nowTaipei = new Date(now + 8 * 3600_000);
  const sameYear = taipei.getUTCFullYear() === nowTaipei.getUTCFullYear();
  return sameYear
    ? t.monthDay(taipei.getUTCMonth() + 1, taipei.getUTCDate())
    : t.fullDate(taipei.getUTCFullYear(), taipei.getUTCMonth() + 1, taipei.getUTCDate());
}

// The screening room: a dark, cinematic surface where thumbnails glow and the
// data is the only loud thing. Chart ink is validated against #141412 (marks
// ≥3:1, text tokens ≥4.5:1; see the dataviz six checks).
const styles = `
  :root{color-scheme:dark;
    --bg:#0d0d0c;--surface:#141412;--raised:#1d1d1b;--line:#262624;--line-strong:#3a3a36;
    --ink:#f4f2ee;--ink-2:#b8b5ad;--muted:#8a877f;
    --accent:#d03b3b;--accent-text:#ff8a8a;--blue:#3987e5;--blue-text:#7fb2ef;--good:#0ca30c;
    --radius:14px;--shadow:0 1px 0 rgba(255,255,255,.03) inset,0 18px 40px -30px rgba(0,0,0,.9)}
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{background:var(--bg);background-image:radial-gradient(1100px 420px at 50% -180px,rgba(208,59,59,.09),transparent 70%);background-repeat:no-repeat;color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;min-height:100vh}
  a{color:var(--accent-text)}
  a:focus-visible,button:focus-visible,input:focus-visible,[tabindex]:focus-visible{border-radius:6px;outline:2px solid var(--accent-text);outline-offset:3px}
  ::selection{background:rgba(208,59,59,.35)}
  h1,h2,h3,p{overflow-wrap:anywhere}
  .eyebrow{color:var(--muted);font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}
  .muted{color:var(--ink-2)}
  .site-main[data-loading]{cursor:progress}
  .site-main[data-loading]::before{background:var(--accent);content:'';height:3px;left:0;position:fixed;right:0;top:0;z-index:100}
  [data-navigation-status]{position:fixed;right:12px;bottom:12px;background:var(--surface);border-radius:6px;color:var(--ink);font-size:12px;z-index:100}
  [data-navigation-status]:not(:empty){padding:8px 12px}
  code{background:var(--raised);border-radius:5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;padding:1px 5px}
  .trust-signals{display:flex;flex-wrap:wrap;gap:7px;list-style:none;margin:0 0 18px;padding:0}
  .trust-signals li{align-items:center;background:rgba(78,190,130,.08);border:1px solid rgba(78,190,130,.28);border-radius:999px;color:#9be3bc;display:flex;font-size:11px;font-weight:700;gap:5px;line-height:1.25;padding:6px 10px}
  .trust-signals li span{font-size:10px}

  .site-header{align-items:center;display:flex;gap:24px;justify-content:space-between;padding:18px max(22px,calc((100% - 1180px)/2))}
  .site-brand{align-items:center;color:var(--ink);display:flex;flex:0 0 auto;gap:11px;text-decoration:none}
  .site-brand svg{display:block;height:30px;width:30px}
  .site-brand strong{font-size:15px;letter-spacing:.01em}
  .site-brand small{color:var(--muted);display:block;font-size:9px;letter-spacing:.14em;text-transform:uppercase}
  .site-nav{display:flex;gap:4px;max-width:100%;overflow-x:auto;overscroll-behavior-inline:contain;scrollbar-width:none}
  .site-nav::-webkit-scrollbar{display:none}
  .site-nav a{border-radius:999px;color:var(--ink-2);flex:0 0 auto;font-size:13px;font-weight:600;padding:7px 13px;text-decoration:none;white-space:nowrap}
  .site-nav a:hover{background:var(--raised);color:var(--ink)}
  .site-nav a[aria-current=page]{background:var(--ink);color:#111}
  .site-main{margin:0 auto;max-width:1180px;padding:26px 22px 90px}
  .site-footer{border-top:1px solid var(--line);color:var(--muted);font-size:12px;margin:0 auto;max-width:1180px;padding:24px 22px 54px}

  .card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}
  .section{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);margin-top:18px;padding:22px 24px}
  .section-head{align-items:baseline;display:flex;flex-wrap:wrap;gap:6px 14px;justify-content:space-between;margin-bottom:16px}
  .section-head h2{font-size:15px;letter-spacing:.01em;margin:0}
  .section-head span{color:var(--muted);font-size:11px}
  .section-head a{color:inherit}

  .viz-tip{background:#262623;border:1px solid var(--line-strong);border-radius:9px;box-shadow:0 10px 30px -10px rgba(0,0,0,.8);color:var(--ink-2);font-size:11px;left:0;line-height:1.5;padding:7px 10px;pointer-events:none;position:fixed;top:0;transform:translate(-50%,calc(-100% - 10px));visibility:hidden;white-space:nowrap;z-index:30}
  .viz-tip strong{color:var(--ink);display:block;font-size:13px}
  details.viz-table{color:var(--ink-2);font-size:12px;margin-top:12px}
  details.viz-table summary{color:var(--muted);cursor:pointer;font-size:11px}
  details.viz-table table{border-collapse:collapse;margin-top:8px}
  details.viz-table td,details.viz-table th{border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums;padding:4px 14px 4px 0;text-align:left}

  .yt-profile{align-items:flex-start;display:flex;gap:18px;margin:14px 0 22px}
  .yt-avatar{background:linear-gradient(140deg,#e66767,#a92f2f);border-radius:50%;display:block;flex:0 0 70px;height:70px;object-fit:cover;width:70px}
  .yt-profile-copy{min-width:0}.profile-details li{overflow-wrap:anywhere;max-width:100%}
  .profile-social-buttons{display:flex;flex-wrap:wrap;gap:10px;list-style:none;padding:0;margin:16px 0}
  .profile-icon-button,.profile-edit-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;border:1px solid var(--line-strong);background:var(--raised);color:var(--ink);text-decoration:none;transition:background .15s,border-color .15s}
  .profile-icon-button{width:44px;height:44px;border-radius:50%}.profile-edit-button{border-radius:999px;padding:10px 16px;font-size:13px;font-weight:700}
  .profile-icon-button:hover,.profile-edit-button:hover{border-color:var(--accent-text);background:var(--surface)}
  .site-nav a[href="/account/profile"]{border:1px solid var(--line-strong);background:var(--raised);color:var(--ink)}
  .site-nav a[href="/account/profile"][aria-current=page]{background:var(--ink);color:#111}

  .yt-profile-copy h1{font-size:clamp(28px,4vw,40px);letter-spacing:-.03em;line-height:1.05;margin:2px 0 4px}
  .yt-profile-meta{color:var(--muted);font-size:12px}.yt-profile-meta a{color:var(--ink-2);display:inline-flex;align-items:center;min-height:44px;padding:9px 16px;margin-top:8px;border:1px solid var(--line-strong);border-radius:999px;background:var(--raised);text-decoration:none;font-weight:600}
  h1 .h1-scope{color:var(--muted);font-size:.42em;font-style:normal;font-weight:600;letter-spacing:0;margin-left:8px;vertical-align:.22em;white-space:nowrap}
  .yt-range{display:flex;gap:6px;margin-bottom:18px;overflow-x:auto;padding:2px 0}
  .yt-range a{background:var(--surface);border:1px solid var(--line);border-radius:999px;color:var(--ink-2);font-size:12px;font-weight:600;padding:7px 14px;text-decoration:none;white-space:nowrap}
  .yt-range a:hover{border-color:var(--line-strong);color:var(--ink)}
  .yt-range a[aria-current=page]{background:var(--accent);border-color:var(--accent);color:#fff}
  .yt-stat strong{display:block;font-size:22px;font-weight:650;letter-spacing:-.02em}
  .yt-stat span{color:var(--muted);display:block;font-size:10px;font-weight:700;letter-spacing:.09em;margin-top:2px;text-transform:uppercase}

  @media(max-width:760px){.site-header{align-items:flex-start;flex-direction:column;gap:10px;padding-block:14px}.site-nav{width:100%}.site-main{padding-top:16px}.section{padding:16px}}
  @media(max-width:560px){.yt-profile{gap:14px}.yt-avatar{flex-basis:58px;font-size:24px;height:58px;width:58px}.trust-signals{gap:6px}.trust-signals li{font-size:10px;padding:5px 8px}}
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
`;

// One floating tooltip for every chart on the page: any element carrying
// data-tip (value) / data-tip-label shows it on hover and keyboard focus.
// Tooltips enhance — every value they show is also in text or a table view.
const tooltipScript = `(()=>{
  const tip=document.createElement('div');tip.className='viz-tip';tip.setAttribute('role','status');document.body.append(tip);
  let current=null;
  const show=(el)=>{current=el;
    tip.replaceChildren();
    const strong=document.createElement('strong');strong.textContent=el.dataset.tip||'';tip.append(strong);
    if(el.dataset.tipLabel)tip.append(document.createTextNode(el.dataset.tipLabel));
    const r=el.getBoundingClientRect();
    tip.style.visibility='visible';
    const w=tip.offsetWidth,x=Math.min(Math.max(r.left+r.width/2,w/2+8),innerWidth-w/2-8);
    tip.style.left=x+'px';tip.style.top=Math.max(r.top,44)+'px';};
  const hide=(el)=>{if(current===el){tip.style.visibility='hidden';current=null;}};
  for(const [enter,leave] of [['pointerover','pointerout'],['focusin','focusout']]){
    document.addEventListener(enter,event=>{const el=event.target.closest?.('[data-tip]');if(el)show(el)});
    document.addEventListener(leave,event=>{const el=event.target.closest?.('[data-tip]');if(el)hide(el)});
  }
  addEventListener('urtube:page-updated',()=>{if(current)hide(current)});
  addEventListener('scroll',()=>{if(current)hide(current)},{passive:true});
})();`;

export const brandMark = `<svg viewBox="0 0 128 128" aria-hidden="true"><rect width="128" height="128" rx="28" fill="#d03b3b"/><ellipse cx="64" cy="64" rx="46" ry="16" fill="none" stroke="#fcfcfb" stroke-width="6" transform="rotate(-24 64 64)"/><path d="M52 40 L90 64 L52 88 Z" fill="#c23535" stroke="#c23535" stroke-width="14" stroke-linejoin="round"/><path d="M52 40 L90 64 L52 88 Z" fill="#fcfcfb" stroke="#fcfcfb" stroke-width="4" stroke-linejoin="round"/></svg>`;

export interface ShellNavItem {
  label: string;
  href: string;
  active?: boolean;
}

export type PrimaryNavActive = 'signup' | 'example' | 'dashboard' | 'channels' | 'matches' | 'account';

export interface PrimaryNavOptions {
  active?: PrimaryNavActive;
  dashboardHref?: string;
  exampleHref?: string;
  languageHref?: string;
}

// One navigation contract for the whole site. Supplying dashboardHref means
// the viewer is signed in; anonymous viewers get the combined account entry
// and a safe public example instead. The brand already links home, so the
// menu does not spend scarce mobile space on a duplicate Home item.
export function primaryNav(lang: Lang, options: PrimaryNavOptions = {}): ShellNavItem[] {
  const t = messages(lang);
  const language = {
    label: t.langToggle,
    href: options.languageHref ?? `?lang=${lang === 'zh' ? 'en' : 'zh'}`,
  };
  if (options.dashboardHref) {
    return [
      { label: t.navDashboard, href: options.dashboardHref, active: options.active === 'dashboard' },
      { label: t.channelDirectory, href: '/channel/', active: options.active === 'channels' },
      { label: t.navMatches, href: '/matches', active: options.active === 'matches' },
      { label: t.navAccount, href: '/account', active: options.active === 'account' },
      language,
    ];
  }
  return [
    { label: t.navSignup, href: '/signup', active: options.active === 'signup' },
    { label: t.navExample, href: options.exampleHref ?? '/', active: options.active === 'example' },
    language,
  ];
}

export function shell(rawTitle: string, body: string, nav: ShellNavItem[] = [], extraStyles = '', lang: Lang = 'en', canonicalPath = ''): string {
  // An empty title means brand-only (the landing page).
  const title = rawTitle ? `${rawTitle} · urtube` : 'urtube';
  const t = messages(lang);
  const links = nav.map((item) =>
    `<a href="${html(item.href)}"${item.active ? ' aria-current="page"' : ''}>${html(item.label)}</a>`
  ).join('');
  // Query-free canonical (?range/?sort/?lang/?key variants all collapse onto
  // the bare path). Error pages pass nothing and get no canonical.
  const canonical = canonicalPath
    ? `<link rel="canonical" href="${html(config.publicBaseUrl + canonicalPath)}">\n  ` : '';
  const ogUrl = canonicalPath
    ? `<meta property="og:url" content="${html(config.publicBaseUrl + canonicalPath)}">` : '';
  return `<!doctype html><html lang="${t.htmlLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="description" content="${t.description}">
  ${canonical}<meta property="og:type" content="website"><meta property="og:title" content="${html(title)}"><meta property="og:description" content="${t.description}">${ogUrl}
  <meta property="og:image" content="${html(config.publicBaseUrl)}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${t.landingDocTitle}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#0d0d0c"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <title>${html(title)}</title><style>${styles}${extraStyles}</style><script>${queryNavigationScript}</script></head><body>
  <header class="site-header"><a class="site-brand" href="/">${brandMark}<span><strong>urtube</strong><small>${t.tagline}</small></span></a><nav class="site-nav" aria-label="${html(t.navLabel)}">${links}</nav></header>
  <main class="site-main">${body}</main>
  <div data-navigation-status role="status" aria-live="polite"></div>
  <footer class="site-footer">${t.footer(html(config.publicBaseUrl.replace(/^https?:\/\//, '')))} · <a href="/privacy" style="color:inherit">${t.privacyLink}</a></footer>
  <script>${tooltipScript}</script>
  </body></html>`;
}
