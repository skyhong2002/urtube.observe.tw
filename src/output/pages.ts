import { config } from '../config.js';

export function html(value: unknown): string {
  return String(value ?? '').replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[char]!));
}

export function hours(seconds: number | null): string {
  if (seconds === null) return '—';
  return `${Math.round(seconds / 360) / 10}h`;
}

export function duration(seconds: number | null): string {
  if (seconds === null) return 'Unknown length';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const styles = `
  :root{color-scheme:dark;--bg:#111112;--surface:#18181c;--surface-raised:#202024;--line:#29292e;--line-strong:#3a3a40;--text:#fff;--muted:#a3a3a3;--quiet:#727272;--accent:#ff453a}
  *{box-sizing:border-box}html{scroll-behavior:smooth}body{background:var(--bg);color:var(--text);font:15px/1.55 Inter,system-ui,sans-serif;margin:0;min-height:100vh}a{color:var(--accent)}a:focus-visible{border-radius:5px;outline:2px solid var(--accent);outline-offset:4px}
  .site-header{align-items:center;border-bottom:1px solid var(--line);display:flex;gap:28px;justify-content:space-between;margin:0 auto;max-width:1280px;padding:18px 20px}.site-brand{align-items:center;color:var(--text);display:flex;gap:11px;text-decoration:none}.brand-mark{align-items:center;background:var(--accent);border-radius:7px;color:#111112;display:flex;font-size:18px;font-weight:800;height:36px;justify-content:center;width:36px}.site-brand strong,.site-brand small{display:block}.site-brand strong{font-size:16px;letter-spacing:.02em}.site-brand small{color:var(--quiet);font-size:10px;letter-spacing:.08em;text-transform:uppercase}.site-nav{display:flex;gap:5px}.site-nav a{border-radius:999px;color:#8f8f94;font-size:13px;padding:7px 11px;text-decoration:none}.site-nav a:hover,.site-nav a[aria-current=page]{background:var(--surface);color:var(--text)}
  .site-main{margin:0 auto;max-width:1280px;padding:42px 20px 82px}.site-footer{border-top:1px solid var(--line);color:var(--quiet);font-size:12px;margin:0 auto;max-width:1280px;padding:26px 20px 48px}
  h1,h2,h3,p{overflow-wrap:anywhere}.eyebrow{color:var(--accent);font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase}.muted{color:var(--muted)}
  .page-intro{align-items:end;display:flex;gap:30px;justify-content:space-between;margin-bottom:34px}.page-intro h1{font-size:clamp(32px,5vw,54px);letter-spacing:-.045em;line-height:1.02;margin:7px 0 12px}.page-intro p{color:var(--muted);margin:0;max-width:670px}.page-intro-aside{color:var(--quiet);font-size:12px;max-width:220px;text-align:right}.context-line{align-items:center;color:var(--quiet);display:flex;flex-wrap:wrap;font-size:12px;gap:8px;margin:-14px 0 32px}.context-line a{color:#9ca6b3;text-decoration:none}.context-line strong{color:var(--text);font-weight:600}
  @media(max-width:760px){.site-header{align-items:flex-start;flex-direction:column}.site-nav{max-width:100%;overflow-x:auto;padding-bottom:3px;width:100%}.site-main{padding-top:38px}}
  @media(max-width:560px){.page-intro{align-items:flex-start;flex-direction:column}.page-intro-aside{text-align:left}}
`;

export interface ShellNavItem {
  label: string;
  href: string;
  active?: boolean;
}

export function shell(title: string, body: string, nav: ShellNavItem[] = [], extraStyles = ''): string {
  const description = 'A private YouTube attention archive: watch history, measured viewing time, channels, and topics.';
  const links = nav.map((item) =>
    `<a href="${html(item.href)}"${item.active ? ' aria-current="page"' : ''}>${html(item.label)}</a>`
  ).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="description" content="${description}">
  <meta property="og:type" content="website"><meta property="og:title" content="${html(title)} · urtube"><meta property="og:description" content="${description}">
  <title>${html(title)} · urtube</title><style>${styles}${extraStyles}</style></head><body>
  <header class="site-header"><a class="site-brand" href="/"><span class="brand-mark">u</span><span><strong>urtube</strong><small>YouTube attention archive</small></span></a><nav class="site-nav" aria-label="Primary">${links}</nav></header>
  <main class="site-main">${body}</main>
  <footer class="site-footer">urtube · self-hosted at ${html(config.publicBaseUrl.replace(/^https?:\/\//, ''))} · watch history stays private</footer>
  </body></html>`;
}
