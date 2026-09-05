import { YOUTUBE_POPULARITY_BUCKETS_V1, type YoutubePopularity } from '../youtube/types.js';
import type { Lang } from './i18n.js';
import { html } from './pages.js';

export function popularitySection(data: YoutubePopularity, lang: Lang): string {
  const t = lang === 'zh' ? {
    title: '看過的影片分布', channels: '頻道訂閱數', videos: '影片公開觀看數',
    sample: `所選期間共 ${data.totalVideos.toLocaleString('zh-TW')} 支不同影片，每支只計一次。`,
    denominator: '百分比以全部不同影片為分母，包含未知資料。',
    empty: '這段期間還沒有可辨識的已觀看影片。', unavailable: '尚無可用的公開統計。',
    coverage: '有效覆蓋', unknown: '未知', fetched: '統計抓取時間', notFetched: '尚未抓取統計',
    unit: '支', method: '資料如何計算',
    note: '使用最近一次公開統計快照，每 24 小時最多成功刷新一次；不是觀看當時的歷史熱門度。頻道訂閱數是公開規模，不代表你的訂閱清單；YouTube 將訂閱數向下取至三位有效數字。缺失、隱藏或不可用的資料列為未知，不當作 0。',
    unidentified: `${data.unidentifiedEvents.toLocaleString('zh-TW')} 筆紀錄沒有影片 ID，無法去重，另列且不計入影片分母。`,
  } : {
    title: 'Watched video distribution', channels: 'Channel subscribers', videos: 'Public video views',
    sample: `${data.totalVideos.toLocaleString('en')} distinct watched ${data.totalVideos === 1 ? 'video' : 'videos'} in the selected period, each counted once.`,
    denominator: 'Percentages use all distinct videos, including unknown data.',
    empty: 'No identifiable watched videos in this period.', unavailable: 'Public statistics are not available yet.',
    coverage: 'Known coverage', unknown: 'unknown', fetched: 'Statistics fetched', notFetched: 'Statistics not fetched yet',
    unit: 'videos', method: 'How this is counted',
    note: 'The latest public snapshot is refreshed successfully at most once per 24 hours; it is not popularity at the time of watching. Channel subscribers describe public size, not your subscriptions. YouTube rounds subscriber counts down to three significant figures. Missing, hidden or unavailable counts stay unknown, never zero.',
    unidentified: `${data.unidentifiedEvents.toLocaleString('en')} events have no video ID and cannot be deduplicated; they are listed separately and excluded from the video denominator.`,
  };
  const locale = lang === 'zh' ? 'zh-TW' : 'en';
  const number = (value: number) => value.toLocaleString(locale);
  const percent = (value: number) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value / data.totalVideos);
  const date = (value: string) => html(new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value)));
  const charts = (['channels', 'videos'] as const).map(kind => {
    const series = data[kind];
    const snapshot = series.oldestFetchedAt && series.newestFetchedAt
      ? `${t.fetched}: ${date(series.oldestFetchedAt)}${series.oldestFetchedAt === series.newestFetchedAt ? '' : ` – ${date(series.newestFetchedAt)}`} (UTC+8)` : t.notFetched;
    return `<section aria-labelledby="popularity-${kind}"><h3 id="popularity-${kind}">${t[kind]}</h3>
      <p class="muted">${t.coverage}: ${number(series.known)} / ${number(data.totalVideos)} (${percent(series.known)}) · ${number(series.unknown)} ${t.unknown}</p>
      ${series.known ? `<ul class="yt-popularity-bars">${series.buckets.map((count, index) => {
        const lower = YOUTUBE_POPULARITY_BUCKETS_V1[index];
        const upper = YOUTUBE_POPULARITY_BUCKETS_V1[index + 1];
        const label = index === 0 ? `&lt; ${number(upper)}` : upper ? `${number(lower)}–${number(upper - 1)}` : `≥ ${number(lower)}`;
        return `<li><span>${label}</span><div class="yt-mix-track" aria-hidden="true"><i style="width:${(count / data.totalVideos * 100).toFixed(3)}%"></i></div><span>${number(count)} ${lang === 'en' && count === 1 ? 'video' : t.unit}<small>${percent(count)}</small></span></li>`;
      }).join('')}</ul>` : `<p>${t.unavailable}</p>`}
      <p class="muted yt-popularity-date">${snapshot}</p></section>`;
  }).join('');
  return `<style>
    .yt-popularity-grid{display:grid;gap:32px}.yt-popularity h3{font-size:19px;margin:0}
    .yt-popularity p{font-size:13px}.yt-popularity-bars{display:grid;gap:14px;list-style:none;padding:0}
    .yt-popularity-bars li{display:grid;grid-template-columns:108px minmax(0,1fr) 72px;align-items:center;gap:10px;font-size:12px;font-variant-numeric:tabular-nums}
    .yt-popularity-bars li>span:last-child{text-align:right}.yt-popularity-bars small{display:block;color:var(--ink-2)}
    .yt-popularity-bars .yt-mix-track i{background:var(--accent);min-width:0}.yt-popularity-date{margin-bottom:0}
    .yt-popularity details{margin-top:24px;color:var(--ink-2);font-size:13px}.yt-popularity summary{cursor:pointer;width:fit-content}
    .yt-popularity summary:focus-visible{outline:2px solid var(--accent-text);outline-offset:4px}
    @media(min-width:1000px){.yt-popularity-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
  </style><section class="section yt-popularity"><div class="section-head"><h2>${t.title}</h2></div>
    <p>${data.totalVideos ? t.sample + ' ' + t.denominator : t.empty}</p>
    ${data.unidentifiedEvents ? `<p class="muted">${t.unidentified}</p>` : ''}
    ${data.totalVideos ? `<div class="yt-popularity-grid">${charts}</div>` : ''}
    <details><summary>${t.method}</summary><p>${t.note}</p></details></section>`;
}
