import { GENRES, type Genre, type Profile } from '../matching-v3/model.js';
import { html } from './pages.js';
import type { Lang } from './i18n.js';

const names: Record<Genre, string> = {
  Politic: '政治', Music: '音樂', Sport: '運動', Education: '教育',
  'Video gaming': '遊戲', Streaming: '直播', News: '新聞', Podcast: 'Podcast', 'channel type': '頻道類型',
};

export function v3DashboardSection(profile: Profile | null, options: {
  enabled: boolean; currentVersion: string; backfillVideoLimit: number; genres: Genre[]; lang: Lang; provisional?: boolean;
}): string {
  const zh = options.lang === 'zh';
  const current = profile?.version === options.currentVersion ? profile : null;
  const visible = GENRES.filter(genre => options.genres.includes(genre));
  if (!visible.length) return '';
  const empty = !options.enabled
    ? (zh ? '興趣分析目前尚未啟用。' : 'Interest analysis is not enabled yet.')
    : (zh ? '正在等待 v3 興趣分析，完成後會在這裡顯示。' : 'Waiting for v3 interest analysis. Results will appear here when available.');
  const provisional = current && (options.provisional || !current.complete || visible.some(genre => !current.genres[genre] || current.genres[genre]?.status === 'insufficient'));
  const state = (genre: Genre) => {
    const item = current?.genres[genre];
    return item?.status === 'ready' ? (zh ? '已建立' : 'Ready')
      : item?.status === 'empty' ? (zh ? '沒有相關影片' : 'No related videos')
        : item?.status === 'insufficient' ? (zh ? '資料不足' : 'Limited data')
          : (zh ? '尚未建立' : 'Pending');
  };
  const scope = zh
    ? `以最近最多 ${options.backfillVideoLimit.toLocaleString('en')} 部影片建立，不隨上方日期範圍切換。影片可以屬於多個類別。`
    : `Based on up to ${options.backfillVideoLimit.toLocaleString('en')} recent videos, independently of the date filter above. Videos may belong to multiple categories.`;
  return `<section class="section yt-v3-interests" data-v3-interests${!current ? ' data-processing-status' : ''}>
    <style>.yt-v3-grid{display:flex;flex-wrap:wrap;justify-content:center;gap:10px}.yt-v3-genre{flex:0 1 calc((100% - 80px)/9);background:var(--raised);border:1px solid var(--line);border-radius:12px;padding:14px;text-align:center;min-width:0}.yt-v3-genre strong,.yt-v3-genre span{display:block}.yt-v3-genre strong{font-size:14px}.yt-v3-genre span{font-size:12px;color:var(--muted);margin-top:6px}.yt-v3-scope{font-size:12px;line-height:1.6;color:var(--muted)}@media(max-width:1000px){.yt-v3-genre{flex-basis:calc((100% - 20px)/3)}}</style>
    <div class="section-head"><h2>${zh ? 'v3 興趣分析' : 'v3 interests'}</h2>${current ? `<span${provisional ? ' data-processing-status' : ''}>${provisional ? (zh ? '暫定結果' : 'Provisional') : (zh ? '已建立' : 'Ready')}</span>` : ''}</div>
    <p class="yt-v3-scope">${html(scope)}</p>
    ${current ? `<div class="yt-v3-grid">${visible.map(genre => {
      const item = current.genres[genre];
      return `<div class="yt-v3-genre"><strong>${html(zh ? names[genre] : genre)}</strong><span>${html(state(genre))}</span>${item ? `<span>${Number(item.videoCount).toLocaleString('en')} ${zh ? '部影片' : 'videos'}</span>` : ''}</div>`;
    }).join('')}</div>` : `<p class="muted">${empty}</p>`}
  </section>`;
}
