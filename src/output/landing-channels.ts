// Adapted from the production channel directory shelf, retaining its native
// controls and card layout. Data here is limited to public archives, not the
// signed-in matching pool used by the full directory.
import { html } from './pages.js';
import type { Lang } from './i18n.js';
import type { CommunityChannel } from '../youtube/community.js';
export function landingChannelShelf(channels: CommunityChannel[], mode: 'duration' | 'watches', lang: Lang): string {
 const zh = lang === 'zh';
 const title = zh ? '成員熱門頻道' : 'Popular member channels';
 const subtitle = mode === 'duration' ? (zh ? '依觀看時間' : 'By viewing time') : (zh ? '依觀看次數' : 'By watch count');
 const fmt = new Intl.NumberFormat(zh ? 'zh-TW' : 'en-US');
 const rows = channels.map((channel, index) => {
   const href = `/channel/${encodeURIComponent(channel.id)}?range=90d&sort=${mode}&lang=${lang}`;
   const avatar = channel.thumbnailUrl && /^https:\/\//.test(channel.thumbnailUrl)
     ? `<img src="${html(channel.thumbnailUrl)}" alt="" loading="lazy" width="128" height="128" referrerpolicy="no-referrer">`
     : `<span class="ch-initial" aria-hidden="true">${html([...channel.name][0] ?? '?')}</span>`;
   const hours = `${Math.round((channel.estimatedWatchSeconds ?? 0) / 360) / 10}h`;
   const watches = `${fmt.format(channel.watches)} ${zh ? '次' : 'views'}`;
   return `<article class="ch-row ch-channel"><span class="ch-rank">#${index + 1}</span><div class="ch-main"><a href="${html(href)}" tabindex="-1" aria-hidden="true">${avatar}</a><div><strong><a href="${html(href)}">${html(channel.name)}</a></strong><small>${fmt.format(channel.members)} ${zh ? '位成員看過' : 'members watched'}</small></div></div><div class="ch-nums"><strong>${mode === 'duration' ? hours : watches}</strong><span>${mode === 'duration' ? watches : hours}</span></div></article>`;
 }).join('');
 const expand = zh ? '展開全部頻道' : 'Show all channels';
 const collapse = zh ? '收起為橫向列表' : 'Collapse to a row';
 return `<section class="lp-native-shelf"><div class="lp-shelf-heading"><h3>${title}</h3><span>${subtitle}</span></div>${rows ? `<div class="ch-shelf"><div class="ch-controls"><button type="button" data-ch-grid aria-pressed="false" aria-label="${expand}" title="${expand}" data-expand-label="${expand}" data-collapse-label="${collapse}"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="2" width="14" height="14" rx="1"/><path d="M2 7h14M2 11h14M7 2v14M11 2v14"/></svg></button><button type="button" data-ch-scroll="-1" aria-label="${zh ? '上一排' : 'Previous'}">←</button><button type="button" data-ch-scroll="1" aria-label="${zh ? '下一排' : 'Next'}">→</button></div><div class="ch-rows" role="region" aria-label="${title} · ${subtitle}" tabindex="0">${rows}</div></div>` : `<p class="lp-empty">${zh ? '目前沒有可顯示的公開頻道資料。' : 'No public channel data to display yet.'}</p>`}</section>`;
}

export const landingShelfStyles = `
  .site-main{padding-top:14px}
  .ch-page .section{background:none;border:0;border-radius:0;box-shadow:none;margin-top:24px;padding:0}
  .ch-page .section-head{align-items:baseline;gap:6px 14px;justify-content:flex-start;margin-bottom:10px;min-height:28px;padding-right:120px}.ch-page .section-head h2{font-size:19px;letter-spacing:-.025em}.ch-page .section-head span{font-size:12px}
  .ch-head{align-items:center;display:flex;gap:18px;margin:8px 0 14px}.ch-avatar{background:var(--raised);border-radius:50%;color:var(--ink-2);display:grid;flex:0 0 88px;font-size:30px;font-weight:700;height:88px;object-fit:cover;place-items:center;width:88px}.ch-head>div{min-width:0}.ch-head h1{font-size:clamp(26px,3vw,36px);letter-spacing:-.035em;line-height:1.15;margin:0 0 5px}.ch-meta{align-items:center;color:var(--muted);display:flex;flex-wrap:wrap;font-size:12px;gap:5px 16px}.ch-meta a{color:var(--ink-2)}.ch-subscribers{color:var(--ink-2);font-size:14px}.ch-subscribers strong{color:var(--ink);font-weight:700}
  .ch-public{align-items:baseline;color:var(--muted);display:flex;flex-wrap:wrap;font-size:12px;gap:4px 16px;margin-top:6px}.ch-public strong{color:var(--ink-2);font-weight:600}.ch-tags{align-items:center;display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}.ch-tags span{color:var(--muted);font-size:11px;margin-right:2px}.ch-tags a{background:var(--raised);border-radius:5px;color:var(--ink-2);font-size:11px;padding:2px 7px;text-decoration:none}
  .ch-toolbar{align-items:center;display:flex;flex-wrap:wrap;gap:8px 20px;margin:14px 0}.ch-toolbar .yt-range{margin:0}.ch-toolbar .yt-range a{font-size:11px;padding:5px 11px}.ch-toolbar .ch-sort{margin-left:auto}
  .ch-stats{display:flex;gap:24px;overflow-x:auto;padding:2px 0 8px;scroll-snap-type:x proximity}.ch-stats .yt-stat{flex:0 0 auto;min-width:110px;scroll-snap-align:start}.ch-stats .yt-stat strong{font-size:24px;line-height:1.3}.ch-stats .yt-stat span{font-size:11px;font-weight:500;letter-spacing:0;margin-top:2px;text-transform:none}.ch-stats .ch-date strong{font-size:14px;padding-top:7px;white-space:nowrap}
  .ch-shelf{position:relative}.ch-controls{display:flex;gap:6px;position:absolute;right:0;top:-40px}.ch-controls button{background:var(--raised);border:0;border-radius:50%;color:var(--ink);cursor:pointer;font-size:17px;height:30px;width:30px}.ch-controls button svg{display:block;height:16px;margin:auto;width:16px}.ch-controls button[aria-pressed=true]{background:var(--ink);color:var(--bg)}.ch-controls button:disabled{cursor:default;opacity:.3}
  .ch-rows{display:flex;gap:16px;overflow-x:auto;overscroll-behavior-x:contain;padding:2px 0 10px;scroll-snap-type:x proximity;scrollbar-color:var(--line-strong) transparent;scrollbar-width:thin}
  .ch-shelf.is-grid .ch-rows{display:grid;grid-template-columns:repeat(auto-fill,minmax(136px,1fr));overflow:visible;row-gap:22px;scroll-snap-type:none}.ch-shelf.is-grid .ch-row{min-width:0}
  .ch-row{border-radius:6px;display:flex;flex:0 0 calc((100% - 96px)/7);flex-direction:column;gap:5px;min-width:136px;padding:0;position:relative;scroll-snap-align:start}.ch-row.me .ch-main strong{color:var(--accent-text)}.ch-row:hover .ch-main strong a{color:var(--accent-text)}
  .ch-rank{background:rgba(13,13,12,.88);border-radius:5px;color:var(--ink-2);font-size:11px;font-variant-numeric:tabular-nums;line-height:1.6;padding:1px 5px;position:absolute;right:5px;top:5px;z-index:1}.ch-row:nth-child(-n+3) .ch-rank{color:#ecc15b}
  .ch-main{display:flex;flex:1;flex-direction:column;gap:7px;min-width:0}.ch-main strong{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:13px;font-weight:650;line-height:1.4;overflow:hidden;overflow-wrap:anywhere}.ch-main a{color:var(--ink);text-decoration:none}.ch-main small{color:var(--muted);display:block;font-size:11px;line-height:1.4;margin-top:2px}.ch-main>div{min-width:0}.ch-main strong small{display:inline}
  .ch-main img,.ch-initial{aspect-ratio:1;background:var(--raised);border-radius:50%;color:var(--ink-2);display:grid;font-size:32px;font-weight:700;height:auto;object-fit:cover;place-items:center;width:100%}.ch-main img.ch-thumb,.ch-thumb{aspect-ratio:16/9;border-radius:5px;display:block;height:auto;margin:0;object-fit:cover;width:100%;background:var(--raised)}
  .ch-nums{display:flex;flex-wrap:wrap;gap:2px 8px;align-items:baseline;margin-top:auto}.ch-nums strong{font-size:12px;font-variant-numeric:tabular-nums;font-weight:650}.ch-nums span{color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}.ch-main img:not(.ch-thumb),.ch-initial{height:104px;margin-inline:auto;width:104px}.ch-person .ch-rank,.ch-channel .ch-rank{right:calc(50% - 52px);top:80px}.ch-person .ch-main>div,.ch-channel .ch-main>div{text-align:center}.ch-person .ch-nums,.ch-channel .ch-nums{justify-content:center}.ch-person .ch-main small{font-size:10px}
  .ch-search{display:flex;gap:8px;max-width:450px;margin:10px 0}.ch-search input[type=search]{background:var(--surface);border:1px solid var(--line-strong);border-radius:7px;color:var(--ink);flex:1;font:inherit;font-size:12px;min-width:0;padding:8px 10px}.ch-search button{background:var(--accent);border:0;border-radius:7px;color:white;font:inherit;font-size:12px;padding:8px 14px}.ch-back{display:inline-block;font-size:11px;margin-bottom:8px}.ch-intro{color:var(--muted);font-size:12px;margin:3px 0 8px}.ch-directory h1{font-size:28px;line-height:1.2;margin:4px 0}.ch-directory-head{align-items:center;display:flex;flex-wrap:wrap;gap:8px 30px;justify-content:space-between}.ch-directory-head .ch-search{flex:1;min-width:240px}
  .ch-months{align-items:flex-end;display:flex;gap:4px;height:100px;margin-top:6px;overflow-x:auto}.ch-month{background:var(--accent);border-radius:3px 3px 1px 1px;flex:1;min-width:6px;outline:none}.ch-month:hover,.ch-month:focus{background:#e66767}.ch-month-labels{color:var(--muted);display:flex;font-size:10px;justify-content:space-between;margin-top:4px}.ch-empty{color:var(--muted);font-size:12px;margin:0}
  .ch-personal{border-top:1px solid var(--line);margin-top:24px;padding-top:2px}
  @media(max-width:1000px){.ch-row{flex-basis:152px;min-width:0}.ch-rows{gap:12px}}
  @media(max-width:560px){.ch-main img:not(.ch-thumb),.ch-initial{height:80px;width:80px}.ch-person .ch-rank,.ch-channel .ch-rank{right:calc(50% - 40px);top:56px}.ch-avatar{flex-basis:64px;height:64px;width:64px}.ch-head{align-items:flex-start;gap:12px}.ch-head h1{font-size:24px}.ch-row{flex-basis:140px}.ch-toolbar{gap:8px}.ch-toolbar .ch-sort{margin-left:0}.ch-page .section-head h2{font-size:17px}.ch-page .section-head{align-items:flex-start;flex-direction:column;gap:1px}.ch-controls{top:-39px}.ch-stats{gap:18px}.ch-stats .yt-stat strong{font-size:21px}.ch-stats .yt-stat{min-width:95px}.ch-stats .ch-date strong{font-size:13px}.ch-public{gap:4px 10px}.ch-directory-head .ch-search{max-width:none}}

.lp-native-shelf{margin:30px 0 14px}.lp-shelf-heading{display:flex;gap:16px;align-items:baseline;margin-bottom:20px;padding-right:115px}.lp-shelf-heading h3{font-size:23px}.lp-shelf-heading>span{font-size:12px;color:var(--accent-text)}.lp-native-shelf .ch-controls{top:-48px}.lp-native-shelf .ch-main{min-height:176px}.lp-native-shelf .ch-main strong{font-size:13px}.lp-native-shelf .ch-nums{margin-top:10px}.lp-native-shelf .ch-controls button[hidden]{display:none}@media(max-width:600px){.lp-shelf-heading{display:block}.lp-shelf-heading h3{font-size:20px}.lp-shelf-heading>span{display:block;margin-top:6px}.lp-native-shelf .ch-main{min-height:150px}.lp-native-shelf .ch-controls{top:-58px}}`;
export const landingShelfScript = `<script>(()=>{
  for(const [index,shelf] of [...document.querySelectorAll('.ch-shelf')].entries()){
    const rail=shelf.querySelector('.ch-rows');
    const buttons=[...shelf.querySelectorAll('[data-ch-scroll]')];
    const toggle=shelf.querySelector('[data-ch-grid]');
    let scrollPosition=0;
    rail.id='ch-rail-'+index;
    toggle.setAttribute('aria-controls',rail.id);
    const update=()=>{
      buttons[0].disabled=rail.scrollLeft<=3;
      buttons[1].disabled=rail.scrollLeft+rail.clientWidth>=rail.scrollWidth-3;
    };
    toggle.addEventListener('click',()=>{
      const expanded=!shelf.classList.contains('is-grid');
      if(expanded)scrollPosition=rail.scrollLeft;
      shelf.classList.toggle('is-grid',expanded);
      toggle.setAttribute('aria-pressed',String(expanded));
      const label=expanded?toggle.dataset.collapseLabel:toggle.dataset.expandLabel;
      toggle.setAttribute('aria-label',label);
      toggle.title=label;
      for(const button of buttons)button.hidden=expanded;
      if(!expanded)rail.scrollLeft=scrollPosition;
      update();
    });
    for(const button of buttons)button.addEventListener('click',()=>rail.scrollBy({left:Number(button.dataset.chScroll)*rail.clientWidth*.85,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'}));
    rail.addEventListener('scroll',update,{passive:true});
    const observer=new ResizeObserver(update);
    observer.observe(rail);
    window.urtubePageController?.signal?.addEventListener('abort',()=>observer.disconnect(),{once:true});
    update();
  }
})();</script>`;
