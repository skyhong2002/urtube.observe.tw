// Adapted from the production channel directory shelf, retaining its native
// controls and card layout. Data here is limited to public archives, not the
// signed-in matching pool used by the full directory.
import { html } from './pages.js';
import { channelImageSources } from './channel-image.js';
import type { Lang } from './i18n.js';
import type { CommunityChannel } from '../youtube/community.js';

// Display-only rounding: rows seen by fewer members than this show rounded
// hours and views so small groups are not described to the exact minute. The
// ranking data and MIN_RANKED_MEMBERS are unchanged.
export const PRECISE_FIGURES_MIN_MEMBERS = 5;

// Channel pages require sign-in, so anonymous visitors get plain cards
// instead of links that would bounce them to Google sign-in.
export function landingChannelShelf(channels: CommunityChannel[], mode: 'duration' | 'watches', lang: Lang, signedIn = false): string {
 const zh = lang === 'zh';
 const title = zh ? '成員熱門頻道' : 'Popular member channels';
 const subtitle = mode === 'duration' ? (zh ? '依觀看時間' : 'By viewing time') : (zh ? '依觀看次數' : 'By watch count');
 const fmt = new Intl.NumberFormat(zh ? 'zh-TW' : 'en-US');
 const memberLine = (members: number) => zh ? `${fmt.format(members)} 位成員看過` : `Watched by ${fmt.format(members)} ${members === 1 ? 'member' : 'members'}`;
 const rows = channels.map((channel, index) => {
   const href = `/channel/${encodeURIComponent(channel.id)}?range=90d&sort=${mode}&lang=${lang}`;
   const image = channelImageSources(channel.thumbnailUrl ?? '');
   const avatar = channel.thumbnailUrl && /^https:\/\//.test(channel.thumbnailUrl)
     ? `<img src="${html(image.src)}"${image.srcset ? ` srcset="${html(image.srcset)}" sizes="(max-width: 560px) 80px, 104px"` : ''} alt="" loading="lazy" decoding="async" width="128" height="128" referrerpolicy="no-referrer">`
     : `<span class="ch-initial" aria-hidden="true">${html([...channel.name][0] ?? '?')}</span>`;
   const seconds = channel.estimatedWatchSeconds ?? 0;
   const approximate = channel.members < PRECISE_FIGURES_MIN_MEMBERS;
   const hours = approximate ? roundedHours(seconds, zh) : `${Math.round(seconds / 360) / 10}h`;
   const watches = approximate ? roundedViews(channel.watches, zh, fmt)
     : zh ? `${fmt.format(channel.watches)} 次` : `${fmt.format(channel.watches)} ${channel.watches === 1 ? 'view' : 'views'}`;
   const name = signedIn
     ? `<strong><a href="${html(href)}">${html(channel.name)}</a></strong>`
     : `<strong><span class="ch-name">${html(channel.name)}</span></strong>`;
   const picture = signedIn ? `<a href="${html(href)}" tabindex="-1" aria-hidden="true">${avatar}</a>` : `<span class="ch-picture">${avatar}</span>`;
   return `<article class="ch-row ch-channel"><span class="ch-rank">#${index + 1}</span><div class="ch-main">${picture}<div>${name}<small>${memberLine(channel.members)}</small></div></div><div class="ch-nums${approximate ? ' ch-approx' : ''}"><strong>${mode === 'duration' ? hours : watches}</strong><span>${mode === 'duration' ? watches : hours}</span></div></article>`;
 }).join('');
 const expand = zh ? '展開全部頻道' : 'Show all channels';
 const collapse = zh ? '收起為橫向列表' : 'Collapse to a row';
 const hint = zh ? '左右滑動或使用箭頭查看更多 →' : 'Scroll sideways or use the arrows to see more →';
 // The heading, hint and controls live inside .ch-shelf so the shared shelf
 // script can mark the rail as scrollable (hint and edge fade) or not.
 return `<section class="lp-native-shelf${rows ? ' ch-shelf' : ''}"><div class="lp-shelf-heading"><div><h3>${title}</h3><span>${subtitle}</span></div>${rows ? `<div class="ch-controls"><button type="button" data-ch-grid aria-pressed="false" aria-label="${expand}" title="${expand}" data-expand-label="${expand}" data-collapse-label="${collapse}"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="2" width="14" height="14" rx="1"/><path d="M2 7h14M2 11h14M7 2v14M11 2v14"/></svg></button><button type="button" data-ch-scroll="-1" aria-label="${zh ? '上一排' : 'Previous'}">←</button><button type="button" data-ch-scroll="1" aria-label="${zh ? '下一排' : 'Next'}">→</button></div>` : ''}</div>${rows ? `<p class="lp-shelf-hint">${hint}</p><div class="lp-rail"><div class="ch-rows" role="region" aria-label="${title} · ${subtitle}" tabindex="0">${rows}</div></div>` : `<p class="lp-empty">${zh ? '目前沒有可顯示的公開頻道資料。' : 'No public channel data to display yet.'}</p>`}</section>`;
}

function roundedHours(seconds: number, zh: boolean): string {
  const value = Math.round(seconds / 3600);
  if (value < 1) return zh ? '不到 1h' : 'under 1h';
  return zh ? `約 ${value}h` : `about ${value}h`;
}

function roundedViews(watches: number, zh: boolean, fmt: Intl.NumberFormat): string {
  const value = Math.round(watches / 10) * 10;
  if (value < 10) return zh ? '不到 10 次' : 'under 10 views';
  return zh ? `約 ${fmt.format(value)} 次` : `about ${fmt.format(value)} views`;
}

// Only the channel-card rules the landing shelves use; directory and channel
// page rules live with those pages (src/output/channel.ts).
export const landingShelfStyles = `
  .ch-controls{display:flex;gap:8px}.ch-controls button{align-items:center;background:var(--raised);border:1px solid var(--line-strong);border-radius:50%;color:var(--ink);cursor:pointer;display:inline-flex;font-size:18px;height:44px;justify-content:center;width:44px}.ch-controls button:hover:not(:disabled){border-color:var(--ink-2)}.ch-controls button svg{display:block;height:18px;width:18px}.ch-controls button[aria-pressed=true]{background:var(--ink);color:var(--bg)}.ch-controls button:disabled{cursor:default;opacity:.35}.ch-controls button[hidden]{display:none}
  .ch-rows{display:flex;gap:16px;overflow-x:auto;overscroll-behavior-x:contain;padding:4px 2px 12px;scroll-snap-type:x proximity;scrollbar-color:var(--line-strong) transparent;scrollbar-width:thin}
  .ch-shelf.is-grid .ch-rows{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));overflow:visible;row-gap:22px;scroll-snap-type:none}.ch-shelf.is-grid .ch-row{min-width:0}
  .ch-row{display:flex;flex:0 0 calc((100% - 5 * 16px) / 5.5);flex-direction:column;gap:6px;min-width:140px;position:relative;scroll-snap-align:start}.ch-row:hover .ch-main strong a{color:var(--accent-text)}
  .ch-rank{background:rgba(13,13,12,.88);border-radius:5px;color:var(--ink-2);font-size:12px;font-variant-numeric:tabular-nums;line-height:1.6;padding:1px 6px;position:absolute;right:calc(50% - 52px);top:80px;z-index:1}.ch-row:nth-child(-n+3) .ch-rank{color:#ecc15b}
  .ch-main{display:flex;flex:1;flex-direction:column;gap:8px;min-width:0}.ch-main>div{min-width:0;text-align:center}.ch-main a{color:var(--ink);text-decoration:none}
  .ch-main strong{display:block;font-size:14px;font-weight:650;line-height:1.4}.ch-main strong a,.ch-main strong .ch-name{-webkit-box-orient:vertical;-webkit-line-clamp:2;display:-webkit-box;min-height:calc(2.8em + 8px);overflow:hidden;overflow-wrap:anywhere;padding:4px 0}.ch-picture{display:block}
  .ch-main small{color:var(--muted);display:block;font-size:12px;line-height:1.4}
  .ch-main img,.ch-initial{aspect-ratio:1;background:var(--raised);border-radius:50%;color:var(--ink-2);display:grid;font-size:32px;font-weight:700;height:104px;margin-inline:auto;object-fit:cover;place-items:center;width:104px}
  .ch-nums{align-items:baseline;display:flex;flex-wrap:wrap;gap:2px 8px;justify-content:center;margin-top:auto}.ch-nums strong{font-size:13px;font-variant-numeric:tabular-nums;font-weight:650}.ch-nums span{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
  .lp-native-shelf{margin:32px 0 8px}.lp-shelf-heading{align-items:center;display:flex;gap:16px;justify-content:space-between}.lp-shelf-heading>div:first-child{align-items:baseline;display:flex;flex-wrap:wrap;gap:4px 14px}.lp-shelf-heading h3{font-size:21px}.lp-shelf-heading>div>span{color:var(--accent-text);font-size:13px}
  .lp p.lp-shelf-hint{color:var(--muted);font-size:13px;margin:4px 0 12px}.ch-shelf[data-fits] .lp-shelf-hint,.ch-shelf.is-grid .lp-shelf-hint{visibility:hidden}
  .lp-rail{position:relative}.lp-rail::before,.lp-rail::after{bottom:12px;content:"";opacity:0;pointer-events:none;position:absolute;top:0;transition:opacity .2s;width:56px;z-index:2}.lp-rail::before{background:linear-gradient(to left,transparent,var(--bg));left:0}.lp-rail::after{background:linear-gradient(to right,transparent,var(--bg));right:0}.ch-shelf[data-more-start] .lp-rail::before,.ch-shelf[data-more-end] .lp-rail::after{opacity:1}.ch-shelf.is-grid .lp-rail::before,.ch-shelf.is-grid .lp-rail::after{display:none}
  @media(max-width:1000px){.ch-row{flex-basis:152px;min-width:0}.ch-rows{gap:12px}}
  @media(max-width:560px){.ch-main img,.ch-initial{height:80px;width:80px}.ch-rank{right:calc(50% - 40px);top:56px}.ch-row{flex-basis:138px}.lp-shelf-heading{align-items:flex-start}.lp-shelf-heading>div:first-child{display:block}.lp-shelf-heading h3{font-size:19px}.lp-shelf-heading>div>span{display:block;margin-top:2px}.lp-rail::after{width:40px}}
  @media(prefers-reduced-motion:reduce){.lp-rail::before,.lp-rail::after{transition:none}}`;
export const landingShelfScript = `<script>(()=>{
  for(const [index,shelf] of [...document.querySelectorAll('.ch-shelf')].entries()){
    const rail=shelf.querySelector('.ch-rows');
    const buttons=[...shelf.querySelectorAll('[data-ch-scroll]')];
    const toggle=shelf.querySelector('[data-ch-grid]');
    let scrollPosition=0;
    rail.id='ch-rail-'+index;
    toggle.setAttribute('aria-controls',rail.id);
    const update=()=>{
      const before=rail.scrollLeft>3,after=rail.scrollLeft+rail.clientWidth<rail.scrollWidth-3;
      buttons[0].disabled=!before;
      buttons[1].disabled=!after;
      // Styling hooks for scroll hints and edge fades.
      shelf.toggleAttribute('data-more-start',before);
      shelf.toggleAttribute('data-more-end',after);
      shelf.toggleAttribute('data-fits',!before&&!after);
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
