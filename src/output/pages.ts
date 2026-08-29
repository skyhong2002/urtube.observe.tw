import { config } from '../config.js';
import { messages, type Lang } from './i18n.js';

export function html(value: unknown): string {
  return String(value ?? '').replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[char]!));
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
  code{background:var(--raised);border-radius:5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;padding:1px 5px}

  .site-header{align-items:center;display:flex;gap:24px;justify-content:space-between;padding:18px max(22px,calc((100% - 1180px)/2))}
  .site-brand{align-items:center;color:var(--ink);display:flex;gap:11px;text-decoration:none}
  .site-brand svg{display:block;height:30px;width:30px}
  .site-brand strong{font-size:15px;letter-spacing:.01em}
  .site-brand small{color:var(--muted);display:block;font-size:9px;letter-spacing:.14em;text-transform:uppercase}
  .site-nav{display:flex;gap:4px}
  .site-nav a{border-radius:999px;color:var(--ink-2);font-size:13px;font-weight:600;padding:7px 13px;text-decoration:none}
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

  .yt-profile{align-items:center;display:flex;gap:18px;margin:14px 0 22px}
  .yt-avatar{align-items:center;background:linear-gradient(140deg,#e66767,#a92f2f);border-radius:50%;color:#fff;display:flex;flex:0 0 70px;font-size:30px;font-weight:800;height:70px;justify-content:center;width:70px}
  .yt-profile-copy h1{font-size:clamp(28px,4vw,40px);letter-spacing:-.03em;line-height:1.05;margin:2px 0 4px}
  .yt-profile-meta{color:var(--muted);font-size:12px}.yt-profile-meta a{color:var(--ink-2)}
  h1 .h1-scope{color:var(--muted);font-size:.42em;font-style:normal;font-weight:600;letter-spacing:0;margin-left:8px;vertical-align:.22em;white-space:nowrap}
  .yt-range{display:flex;gap:6px;margin-bottom:18px;overflow-x:auto;padding:2px 0}
  .yt-range a{background:var(--surface);border:1px solid var(--line);border-radius:999px;color:var(--ink-2);font-size:12px;font-weight:600;padding:7px 14px;text-decoration:none;white-space:nowrap}
  .yt-range a:hover{border-color:var(--line-strong);color:var(--ink)}
  .yt-range a[aria-current=page]{background:var(--accent);border-color:var(--accent);color:#fff}
  .yt-stat strong{display:block;font-size:22px;font-weight:650;letter-spacing:-.02em}
  .yt-stat span{color:var(--muted);display:block;font-size:10px;font-weight:700;letter-spacing:.09em;margin-top:2px;text-transform:uppercase}

  @media(max-width:760px){.site-header{padding-block:14px}.site-main{padding-top:16px}.section{padding:16px}}
  @media(max-width:560px){.yt-profile{gap:14px}.yt-avatar{flex-basis:58px;font-size:24px;height:58px;width:58px}}
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
  for(const el of document.querySelectorAll('[data-tip]')){
    el.addEventListener('pointerenter',()=>show(el));
    el.addEventListener('pointerleave',()=>hide(el));
    el.addEventListener('focus',()=>show(el));
    el.addEventListener('blur',()=>hide(el));
  }
  addEventListener('scroll',()=>{if(current)hide(current)},{passive:true});
})();`;

export const brandMark = `<svg viewBox="0 0 128 128" aria-hidden="true"><rect width="128" height="128" rx="28" fill="#d03b3b"/><ellipse cx="64" cy="64" rx="46" ry="16" fill="none" stroke="#fcfcfb" stroke-width="6" transform="rotate(-24 64 64)"/><path d="M52 40 L90 64 L52 88 Z" fill="#c23535" stroke="#c23535" stroke-width="14" stroke-linejoin="round"/><path d="M52 40 L90 64 L52 88 Z" fill="#fcfcfb" stroke="#fcfcfb" stroke-width="4" stroke-linejoin="round"/></svg>`;

export interface ShellNavItem {
  label: string;
  href: string;
  active?: boolean;
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
  return `<!doctype html><html lang="${t.htmlLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="description" content="${t.description}">
  ${canonical}<meta property="og:type" content="website"><meta property="og:title" content="${html(title)}"><meta property="og:description" content="${t.description}">
  <meta name="theme-color" content="#0d0d0c"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <title>${html(title)}</title><style>${styles}${extraStyles}</style></head><body>
  <header class="site-header"><a class="site-brand" href="/">${brandMark}<span><strong>urtube</strong><small>${t.tagline}</small></span></a><nav class="site-nav" aria-label="Primary">${links}</nav></header>
  <main class="site-main">${body}</main>
  <footer class="site-footer">${t.footer(html(config.publicBaseUrl.replace(/^https?:\/\//, '')))} · <a href="/privacy" style="color:inherit">${t.privacyLink}</a></footer>
  <script>${tooltipScript}</script>
  </body></html>`;
}
