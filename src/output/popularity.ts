import { YOUTUBE_POPULARITY_BOUNDS } from '../youtube/popularity.js';
import { taipeiDate } from '../youtube/timeline.js';
import type { YoutubePopularity, YoutubePopularitySeries } from '../youtube/types.js';
import type { Lang } from './i18n.js';
import { html } from './pages.js';

// Labels follow YOUTUBE_POPULARITY_BOUNDS (popularity-v1); change both together.
const BUCKET_LABELS: Record<Lang, readonly string[]> = {
  zh: ['< 1 千', '1 千–1 萬', '1 萬–10 萬', '10 萬–100 萬', '≥ 100 萬'],
  en: ['< 1K', '1K–10K', '10K–100K', '100K–1M', '≥ 1M'],
};

const COPY = {
  zh: {
    title: '看過的影片：頻道規模與熱門程度',
    sample: (count: string) => `${count} 支不同影片`,
    intro: (count: string) => `所選期間看過的每支影片只計一次，不計重複播放。百分比以這 ${count} 支影片為分母，未知資料也計入。`,
    empty: '這段期間沒有可辨識的已觀看影片。',
    channels: '所屬頻道的訂閱數',
    videos: '影片觀看次數',
    coverage: (known: string, total: string, share: string) => `有效資料 ${known} / ${total} 支（${share}）`,
    unknown: (count: string) => `未知 ${count} 支`,
    reasons: { pending: '尚未取得', hidden: '訂閱數隱藏', unavailable: '影片無法取得', missing: 'YouTube 未提供' },
    noData: '尚無可用的公開統計，因此不顯示分布。',
    snapshot: (dates: string) => `公開統計快照：${dates}（台灣日期）`,
    noSnapshot: '尚未取得公開統計快照',
    videoCount: (count: string) => `${count} 支`,
    method: '數字的意思',
    note: '這裡的公開數字來自最近一次抓取的快照，每天最多更新一次，不是你當時觀看時的熱門程度。日期範圍只決定納入哪些看過的影片。頻道訂閱數代表頻道的公開規模，不是你的訂閱清單；YouTube 公開的訂閱數只保留前三位有效數字。隱藏、缺失或無法取得的數字列為未知，不當作 0。',
  },
  en: {
    title: 'Watched videos: channel size and popularity',
    sample: (count: string) => `${count} distinct videos`,
    intro: (count: string) => `Each video you watched in this period counts once, regardless of replays. Percentages use all ${count} videos, including unknown data.`,
    empty: 'No identifiable watched videos in this period.',
    channels: 'Subscribers of the video’s channel',
    videos: 'Video views',
    coverage: (known: string, total: string, share: string) => `Known for ${known} of ${total} videos (${share})`,
    unknown: (count: string) => `${count} unknown`,
    reasons: { pending: 'not fetched yet', hidden: 'subscribers hidden', unavailable: 'video unavailable', missing: 'not provided by YouTube' },
    noData: 'No public statistics are available yet, so no distribution is shown.',
    snapshot: (dates: string) => `Public statistics snapshot: ${dates} (Taiwan date)`,
    noSnapshot: 'No public statistics snapshot yet',
    videoCount: (count: string) => `${count} ${count === '1' ? 'video' : 'videos'}`,
    method: 'What these numbers mean',
    note: 'Public counts come from the latest snapshot, refreshed at most once a day. They are not how popular a video was when you watched it. The date range only selects which watched videos are included. Channel subscribers describe a channel’s public size, not your subscriptions, and YouTube rounds public subscriber counts to three significant figures. Hidden, missing or unavailable counts are unknown, never zero.',
  },
} as const;

export const popularityStyles = `
  .yt-popularity-grid{display:grid;gap:28px}
  .yt-popularity h3{font-size:15px;margin:0 0 4px}
  .yt-popularity p{font-size:13px;margin:4px 0}
  .yt-popularity-bars{display:grid;gap:10px;list-style:none;margin:14px 0 10px;padding:0}
  .yt-popularity-bars li{align-items:center;display:grid;gap:10px;grid-template-columns:96px minmax(0,1fr) 92px;font-size:12px}
  .yt-popularity-bars li>span:first-child{color:var(--ink-2)}
  .yt-popularity-bars li>span:last-child{color:var(--ink-2);font-variant-numeric:tabular-nums;text-align:right}
  .yt-popularity-bars small{color:var(--muted);margin-left:6px}
  .yt-popularity-bars .yt-mix-track i{background:var(--accent);border-radius:4px;min-width:0}
  .yt-popularity details{color:var(--ink-2);font-size:13px;margin-top:18px}
  .yt-popularity summary{cursor:pointer;width:fit-content}
  .yt-popularity summary:focus-visible{outline:2px solid var(--accent-text);outline-offset:4px}
  @media(min-width:900px){.yt-popularity-grid{column-gap:36px;grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:560px){.yt-popularity-bars li{grid-template-columns:76px minmax(0,1fr) 80px}}
`;

// Two horizontal distributions over distinct watched videos. Shares always
// use every distinct video as the denominator; a series without any known
// value shows a statement instead of bars, so no 0% preference is implied.
export function popularitySection(data: YoutubePopularity, lang: Lang): string {
  const t = COPY[lang];
  const locale = lang === 'zh' ? 'zh-TW' : 'en';
  const number = (value: number) => value.toLocaleString(locale);
  const percent = (value: number) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
    .format(data.totalVideos ? value / data.totalVideos : 0);
  const series = (kind: 'channels' | 'videos', value: YoutubePopularitySeries) => {
    const unknownTotal = Object.values(value.unknown).reduce((sum, count) => sum + count, 0);
    const reasons = (Object.keys(value.unknown) as Array<keyof typeof value.unknown>)
      .filter((reason) => value.unknown[reason] > 0)
      .map((reason) => `${t.reasons[reason]} ${number(value.unknown[reason])}`).join(' · ');
    const dates = value.oldestFetchedAt && value.newestFetchedAt
      ? [...new Set([taipeiDate(value.oldestFetchedAt), taipeiDate(value.newestFetchedAt)])].join(' – ') : null;
    const bars = value.known ? `<ul class="yt-popularity-bars">${value.buckets.map((count, index) =>
      `<li><span>${html(BUCKET_LABELS[lang][index])}</span><div class="yt-mix-track" aria-hidden="true"><i style="width:${(count / data.totalVideos * 100).toFixed(2)}%"></i></div><span>${t.videoCount(number(count))}<small>${percent(count)}</small></span></li>`
    ).join('')}</ul>` : `<p class="muted">${t.noData}</p>`;
    return `<section aria-labelledby="yt-popularity-${kind}" data-popularity-series="${kind}">
      <h3 id="yt-popularity-${kind}">${t[kind]}</h3>
      <p>${t.coverage(number(value.known), number(data.totalVideos), percent(value.known))}</p>
      ${unknownTotal ? `<p class="muted">${t.unknown(number(unknownTotal))}${reasons ? `${lang === 'zh' ? '：' : ': '}${reasons}` : ''}</p>` : ''}
      ${bars}
      <p class="muted">${dates ? t.snapshot(dates) : t.noSnapshot}</p>
    </section>`;
  };
  if (YOUTUBE_POPULARITY_BOUNDS.length !== BUCKET_LABELS[lang].length) throw new Error('Popularity labels do not match bounds');
  const body = data.totalVideos
    ? `<p>${t.intro(number(data.totalVideos))}</p><div class="yt-popularity-grid">${series('channels', data.channels)}${series('videos', data.videos)}</div>`
    : `<p class="muted">${t.empty}</p>`;
  return `<section class="section yt-popularity" data-popularity-version="${html(data.version)}">
    <div class="section-head"><h2>${t.title}</h2><span>${t.sample(number(data.totalVideos))}</span></div>
    ${body}
    <details><summary>${t.method}</summary><p>${t.note}</p></details>
  </section>`;
}
