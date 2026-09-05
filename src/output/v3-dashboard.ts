import { GENRES, type Genre, type Profile } from '../matching-v3/model.js';
import { html } from './pages.js';
import type { Lang } from './i18n.js';

const names: Record<Genre, string> = {
  Politic: '政治', Music: '音樂', Sport: '運動', Education: '教育',
  'Video gaming': '遊戲', Streaming: '直播', News: '新聞', Podcast: 'Podcast', 'channel type': '其他類別',
};

export function v3DashboardSection(profile: Profile | null, options: {
  enabled: boolean; currentVersion: string; backfillVideoLimit: number; genres: Genre[]; lang: Lang; provisional?: boolean; ownerDetails?: boolean;
}): string {
  const zh = options.lang === 'zh';
  const current = profile?.version === options.currentVersion ? profile : null;
  const visible = GENRES.filter(genre => options.genres.includes(genre));
  if (!visible.length) return '';
  const empty = !options.enabled
    ? (zh ? '興趣分析目前尚未啟用。' : 'Interest analysis is not enabled yet.')
    : (zh ? '正在等待 興趣分析，完成後會在這裡顯示。' : 'Waiting for interest analysis. Results will appear here when available.');
  const provisional = current && (options.provisional || !current.complete || visible.some(genre => !current.genres[genre] || current.genres[genre]?.status === 'insufficient'));
  const state = (genre: Genre) => {
    const item = current?.genres[genre];
    if (item?.clusters.length) return zh ? `已建立 ${item.clusters.length} 個興趣群` : `${item.clusters.length} interest clusters`;
    return item?.status === 'ready' ? (zh ? '已建立' : 'Ready')
      : item?.status === 'empty' ? (zh ? '沒有相關影片' : 'No related videos')
        : item?.status === 'insufficient' ? (zh ? '資料不足' : 'Limited data')
          : (zh ? '尚未建立' : 'Pending');
  };
  const scope = zh
    ? `以最近最多 ${options.backfillVideoLimit.toLocaleString('en')} 部影片建立，不隨上方日期範圍切換。影片可以屬於多個類別。`
    : `Based on up to ${options.backfillVideoLimit.toLocaleString('en')} recent videos, independently of the date filter above. Videos may belong to multiple categories.`;
  const cloud = (genre: Genre) => {
    if (!options.ownerDetails) return '';
    const counts = new Map<string, number>();
    for (const cluster of current?.genres[genre]?.clusters ?? []) for (const tag of cluster.tags) {
      const count = tag.count - tag.generatedCount;
      if (count > 0) counts.set(tag.text, Math.max(counts.get(tag.text) ?? 0, count));
    }
    const tags = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 18);
    if (!tags.length) return '';
    const max = tags[0][1];
    return `<div class="yt-v3-cloud" aria-label="${zh ? '代表標籤' : 'Representative tags'}">${tags.map(([text, count]) => `<span style="font-size:${(13 + 15 * Math.sqrt(count / max)).toFixed(1)}px" title="${html(zh ? `${count} 部不同影片` : `${count} distinct videos`)}">${html(text)}</span>`).join('')}</div>`;
  };
  return `<section class="section yt-v3-interests" data-v3-interests${options.ownerDetails ? ' data-tag-clouds' : ''}${!current ? ' data-processing-status' : ''}>
    <style>.yt-v3-grid{display:flex;flex-wrap:wrap;justify-content:center;gap:10px}.yt-v3-genre{flex:0 1 calc((100% - 80px)/9);background:var(--raised);border:1px solid var(--line);border-radius:12px;padding:14px;text-align:center;min-width:0}.yt-v3-genre strong,.yt-v3-genre span{display:block}.yt-v3-genre strong{font-size:14px}.yt-v3-genre span{font-size:12px;color:var(--muted);margin-top:6px}.yt-v3-scope{font-size:12px;line-height:1.6;color:var(--muted)}@media(max-width:1000px){.yt-v3-genre{flex-basis:calc((100% - 20px)/3)}}.yt-v3-interests[data-tag-clouds] .yt-v3-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.yt-v3-interests[data-tag-clouds] .yt-v3-genre{padding:20px;text-align:left}.yt-v3-cloud{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px 14px;min-height:150px;margin:16px 0;overflow-wrap:anywhere}.yt-v3-genre .yt-v3-cloud span{display:inline;color:var(--accent-text);line-height:1.4;margin:0;max-width:100%}.yt-v3-genre .yt-v3-cloud span:nth-child(3n){color:var(--ink)}@media(max-width:700px){.yt-v3-interests[data-tag-clouds] .yt-v3-grid{grid-template-columns:1fr}}</style>
    <div class="section-head"><h2>${zh ? '興趣分析' : 'Interests'}</h2>${current ? `<span${provisional ? ' data-processing-status' : ''}>${provisional ? (zh ? '暫定結果' : 'Provisional') : (zh ? '已建立' : 'Ready')}</span>` : ''}</div>
    <p class="yt-v3-scope">${html(scope)}</p>${options.ownerDetails ? `<p class="yt-v3-scope">${zh ? '文字大小依不同影片中的標籤次數呈現。此標籤雲僅自己可見。' : 'Word sizes reflect distinct-video tag counts. Tag clouds are visible only to you.'}</p>` : ''}
    ${current ? `<div class="yt-v3-grid">${visible.map(genre => {
      return `<div class="yt-v3-genre"><strong>${html(zh ? names[genre] : genre)}</strong><span>${html(state(genre))}</span>${cloud(genre)}</div>`;
    }).join('')}</div>` : `<p class="muted">${empty}</p>`}
  </section>`;
}
