import { YOUTUBE_RANGES } from '../youtube/types.js';
import type { YoutubeHistoryEntry, YoutubeHistoryFilters, YoutubeHistoryPage } from '../youtube/history.js';
import { messages, type Lang } from './i18n.js';
import { html, shell, type ShellNavItem } from './pages.js';
import { youtubeImportControl } from './youtube.js';

const copy = {
  zh: {
    description: '找回看過的影片，從一句片名或一個頻道開始。',
    private: '私人觀看紀錄', search: '影片名稱或頻道', placeholder: '搜尋已匯入的觀看紀錄',
    from: '開始日期', to: '結束日期', apply: '搜尋紀錄', reset: '清除篩選',
    hint: '在選定期間搜尋已匯入的影片與頻道名稱；指定日期會取代上方期間。日期與時間皆為台北時間。',
    older: '較早的紀錄', newer: '較新的紀錄', first: '回到最新結果', pagination: '觀看紀錄翻頁',
    dateOnly: '僅有日期', empty: '找不到符合條件的觀看紀錄',
    emptyHelp: '試試其他關鍵字或放寬日期範圍。尚未匯入的紀錄不會出現在這裡。',
    custom: '自訂日期', start: '最早紀錄', end: '至今', unavailable: '影片連結無法使用',
    pageCount: (count: number) => `本頁 ${count} 筆紀錄 · 由新到舊`,
    precision: '「僅有日期」表示來源沒有精確觀看時間；同一天內的排列不代表觀看先後。',
    errors: {
      q: '搜尋文字請勿超過 120 個字。',
      dates: '請輸入有效的日期，並確認開始日期不晚於結束日期。',
      cursor: '這個翻頁連結已無法使用。請重新搜尋，從最新結果開始。',
    },
  },
  en: {
    description: 'Find a video again, starting with a title or a channel.',
    private: 'Private watch history', search: 'Video title or channel', placeholder: 'Search imported watch history',
    from: 'Start date', to: 'End date', apply: 'Search history', reset: 'Clear filters',
    hint: 'Searches imported video and channel names within the selected period. Custom dates replace the period above. Dates and times use Taipei time.',
    older: 'Older watches', newer: 'Newer watches', first: 'Back to latest results', pagination: 'Watch history pages',
    dateOnly: 'Date only', empty: 'No watches match these filters',
    emptyHelp: 'Try another keyword or a wider date range. Watches that have not been imported will not appear here.',
    custom: 'Custom dates', start: 'Earliest watch', end: 'Present', unavailable: 'Video link unavailable',
    pageCount: (count: number) => `${count} watches on this page · Newest first`,
    precision: '“Date only” means the source has no exact watch time. The order within that day does not indicate viewing order.',
    errors: {
      q: 'Keep your search to 120 characters or fewer.',
      dates: 'Enter valid dates, with the start date on or before the end date.',
      cursor: 'This page link is no longer valid. Search again to start from the latest results.',
    },
  },
};

// Only explicit History controls go into links; credentials and unrelated
// request parameters never become hidden form values or pagination URLs.
function historyHref(path: string, filters: YoutubeHistoryFilters, lang: Lang, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ range: filters.range, lang });
  for (const name of ['q', 'from', 'to'] as const) if (filters[name]) params.set(name, filters[name]);
  for (const [name, value] of Object.entries(extra)) params.set(name, value);
  return `${path}?${params}`;
}

function safeWebUrl(value: string): string {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? value : '';
  } catch { return ''; }
}

const styles = `
  .hs-profile{display:flex;align-items:flex-start;gap:20px;margin:28px 0}.hs-avatar{border-radius:50%;height:64px;width:64px;flex:none}.hs-profile-copy{min-width:0;flex:1}.hs-title{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:center}.hs-title h1{margin:2px 0;font-size:28px}.hs-profile p{margin:5px 0}.hs-profile .eyebrow{color:var(--ink-2)}
  .yt-page-nav,.yt-range{display:flex;flex-wrap:wrap;gap:8px}.yt-page-nav{border-bottom:1px solid var(--line);margin-bottom:20px}.yt-page-nav a,.yt-range a{color:var(--ink-2);text-decoration:none;min-height:44px;display:inline-flex;align-items:center;padding:10px 16px;font-size:14px}.yt-page-nav a[aria-current]{color:var(--ink);border-bottom:2px solid var(--accent)}.yt-range a{border:1px solid var(--line);border-radius:24px}.yt-range a[aria-current]{color:var(--ink);border-color:var(--ink-2);background:var(--raised)}
  .hs-intro{margin:28px 0 18px}.hs-intro h2{margin:0;font-size:24px}.hs-intro p{color:var(--ink-2);margin:8px 0}.hs-form{display:grid;grid-template-columns:minmax(180px,2fr) minmax(145px,1fr) minmax(145px,1fr) auto;gap:14px;align-items:end;background:var(--surface);padding:20px;border:1px solid var(--line);border-radius:var(--radius)}.hs-form label{display:grid;gap:7px;color:var(--ink-2);font-size:13px;min-width:0}.hs-form input{width:100%;min-width:0;min-height:44px;background:var(--bg);border:1px solid var(--line-strong);border-radius:7px;color:var(--ink);font:inherit;font-size:16px;padding:10px}.hs-form button,.yt-import-control button{min-height:44px;padding:10px 18px;border:1px solid var(--line-strong);border-radius:7px;background:var(--raised);color:var(--ink);font:inherit;cursor:pointer}.hs-form button{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:650}.hs-hint,.hs-alert{grid-column:1/-1;margin:0;color:var(--ink-2);font-size:13px}.hs-alert{border-left:3px solid var(--accent-text);padding:8px 12px;color:var(--ink)}.hs-reset{display:inline-flex;align-items:center;min-height:44px;font-size:13px;width:fit-content}.hs-summary{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin:24px 0;color:var(--ink-2);font-size:13px}.hs-summary p{margin:0}.hs-day{margin:22px 0}.hs-day h3{font-size:14px;margin:0 0 4px;color:var(--ink-2)}.hs-rows{list-style:none;padding:0;margin:0}.hs-rows li{border-bottom:1px solid var(--line)}.hs-row{display:grid;grid-template-columns:112px minmax(0,1fr) auto;gap:16px;align-items:center;padding:14px 0;color:var(--ink);text-decoration:none}.hs-row:hover strong{text-decoration:underline}.hs-thumb{width:112px;aspect-ratio:16/9;object-fit:cover;border-radius:7px;background:var(--raised)}.hs-copy{min-width:0}.hs-copy strong{display:block;font-size:15px;font-weight:600;overflow-wrap:anywhere}.hs-copy>span{display:block;color:var(--ink-2);font-size:13px;margin-top:4px;overflow-wrap:anywhere}.hs-when{color:var(--ink-2);font-size:13px;white-space:nowrap;font-variant-numeric:tabular-nums}.hs-empty{padding:36px 0}.hs-empty h3{font-size:18px}.hs-empty p{color:var(--ink-2)}.hs-pages{display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;margin:28px 0}.hs-pages a{min-height:44px;display:inline-flex;align-items:center;border:1px solid var(--line-strong);border-radius:8px;padding:10px 16px;text-decoration:none;color:var(--ink)}.hs-precision{color:var(--ink-2);font-size:13px;margin:24px 0}.yt-import-control{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;color:var(--ink-2)}.yt-import-control[hidden]{display:none}
  @media(max-width:850px){.hs-form{grid-template-columns:1fr 1fr}.hs-search{grid-column:1/-1}.hs-form button{grid-column:1/-1}}@media(max-width:480px){.hs-form{padding:14px;gap:12px}.hs-profile{gap:12px}.hs-avatar{height:48px;width:48px}.hs-title h1{font-size:23px}.hs-row{grid-template-columns:80px minmax(0,1fr);gap:8px 12px}.hs-thumb{width:80px;grid-row:1/3}.hs-when{grid-column:2}.hs-copy strong{font-size:14px}.yt-page-nav a{padding:10px 12px}}
`;

export interface HistoryPageOptions {
  ownerName: string;
  profilePath: string;
  profileHtml: string;
  viewerOwns: boolean;
  nav: ShellNavItem[];
  lang: Lang;
  result: YoutubeHistoryPage;
  hasCursor?: boolean;
  error?: 'q' | 'dates' | 'cursor';
}

export function historyPage(options: HistoryPageOptions): string {
  const { ownerName, profilePath, profileHtml, viewerOwns, lang, result, error } = options;
  const t = messages(lang);
  const h = copy[lang];
  const path = `${profilePath}/history`;
  const { filters } = result;
  const href = (extra: Record<string, string> = {}) => html(historyHref(path, filters, lang, extra));
  const reset = html(historyHref(path, { range: 'all', q: '', from: '', to: '' }, lang));
  const dates = Boolean(filters.from || filters.to);
  const scope = dates ? `${filters.from || h.start} — ${filters.to || h.end}` : t.ranges[filters.range];
  const invalid = (field: string) => error === field ? ' aria-invalid="true" aria-describedby="history-error history-hint"' : ' aria-describedby="history-hint"';
  const date = new Intl.DateTimeFormat(lang === 'zh' ? 'zh-TW' : 'en', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  const time = new Intl.DateTimeFormat(lang === 'zh' ? 'zh-TW' : 'en', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const groups = new Map<string, YoutubeHistoryEntry[]>();
  for (const entry of result.entries) {
    const day = new Date(Date.parse(entry.watchedAt) + 8 * 3600_000).toISOString().slice(0, 10);
    groups.set(day, [...(groups.get(day) ?? []), entry]);
  }
  const rows = [...groups].map(([day, entries]) => `<section class="hs-day"><h3><time datetime="${day}">${html(date.format(new Date(`${day}T12:00:00+08:00`)))}</time></h3><ul class="hs-rows">${entries.map(entry => {
    const url = safeWebUrl(entry.url);
    const thumbnail = safeWebUrl(entry.thumbnailUrl);
    const content = `${thumbnail ? `<img class="hs-thumb" src="${html(thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" width="112" height="63">` : '<span class="hs-thumb" aria-hidden="true"></span>'}
      <span class="hs-copy"><strong>${html(entry.title)}</strong><span>${html(entry.channelTitle)}</span>${url ? '' : `<span>${h.unavailable}</span>`}</span>
      <time class="hs-when" datetime="${html(entry.precision === 'day' ? day : entry.watchedAt)}">${entry.precision === 'day' ? h.dateOnly : html(time.format(new Date(entry.watchedAt)))}</time>`;
    return `<li>${url ? `<a class="hs-row" href="${html(url)}" rel="noreferrer">${content}</a>` : `<div class="hs-row">${content}</div>`}</li>`;
  }).join('')}</ul></section>`).join('');
  const pageNav = `<nav class="yt-page-nav" aria-label="${html(lang === 'zh' ? '個人頁面' : 'YouTube profile')}">${[
    ['', t.navOverview], ['/insights', t.navInsights], ['/history', t.navHistory], ['/recap', t.navRecap],
  ].map(([suffix, label]) => `<a href="${html(profilePath + suffix)}?range=${filters.range}&amp;lang=${lang}"${suffix === '/history' ? ' aria-current="page"' : ''}>${html(label)}</a>`).join('')}</nav>`;
  const rangeNav = `<nav class="yt-range" aria-label="${lang === 'zh' ? '觀看期間' : 'Time range'}">${YOUTUBE_RANGES.map(range =>
    `<a href="${html(historyHref(path, { ...filters, range, from: '', to: '' }, lang))}"${!dates && range === filters.range ? ' aria-current="page"' : ''}>${t.ranges[range]}</a>`
  ).join('')}</nav>`;
  const body = `<style>${styles}</style><section class="yt-profile hs-profile"><img class="hs-avatar" src="${html(`/avatar${profilePath}`)}" width="64" height="64" alt=""><div class="hs-profile-copy"><div class="eyebrow">${h.private}</div><div class="yt-profile-title-row hs-title"><h1>${html(ownerName)}</h1>${viewerOwns ? youtubeImportControl(lang) : ''}</div>${profileHtml}</div></section>
    ${pageNav}${rangeNav}<section class="hs-intro"><h2>${t.historyTitle}</h2><p>${h.description}</p></section>
    <form class="hs-form" action="${html(path)}" method="get" role="search" aria-label="${h.apply}">
      <input type="hidden" name="range" value="${filters.range}"><input type="hidden" name="lang" value="${lang}">
      ${error ? `<p class="hs-alert" id="history-error" role="alert">${h.errors[error]}</p>` : ''}
      <label class="hs-search" for="history-q">${h.search}<input type="search" id="history-q" name="q" value="${html(filters.q)}" placeholder="${h.placeholder}"${invalid('q')}></label>
      <label for="history-from">${h.from}<input type="date" id="history-from" name="from" value="${html(filters.from)}"${invalid('dates')}></label>
      <label for="history-to">${h.to}<input type="date" id="history-to" name="to" value="${html(filters.to)}"${invalid('dates')}></label>
      <button type="submit">${h.apply}</button><p class="hs-hint" id="history-hint">${h.hint}</p>
    </form><div class="hs-summary"><p>${html(scope)} · ${h.pageCount(result.entries.length)}</p><a class="hs-reset" href="${reset}">${h.reset}</a></div>
    ${error ? '' : rows || `<section class="hs-empty"><h3>${h.empty}</h3><p>${h.emptyHelp}</p></section>`}
    <nav class="hs-pages" aria-label="${h.pagination}">${result.newerCursor ? `<a rel="prev" href="${href({ cursor: result.newerCursor, direction: 'newer' })}">← ${h.newer}</a>` : ''}${result.olderCursor ? `<a rel="next" href="${href({ cursor: result.olderCursor, direction: 'older' })}">${h.older} →</a>` : ''}${options.hasCursor || error === 'cursor' ? `<a href="${href()}">${h.first}</a>` : ''}</nav>
    ${result.entries.some(entry => entry.precision === 'day') ? `<p class="hs-precision">${h.precision}</p>` : ''}`;
  return shell(`${ownerName} · ${t.historyTitle}`, body, options.nav, '', lang, path);
}
