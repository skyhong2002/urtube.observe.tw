import type { Lang } from './i18n.js';
export { landingShelfScript as popularShelfScript } from './landing-channels.js';

export function popularShelfControls(lang: Lang): string {
  const zh = lang === 'zh';
  const expand = zh ? '網格展開' : 'Expand grid';
  const collapse = zh ? '收合為橫向排列' : 'Collapse to carousel';
  return `<div class="yt-shelf-controls"><button type="button" data-ch-grid aria-pressed="false" aria-label="${expand}" title="${expand}" data-expand-label="${expand}" data-collapse-label="${collapse}"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" aria-hidden="true"><rect x="2" y="2" width="14" height="14" rx="1"/><path d="M2 7h14M2 11h14M7 2v14M11 2v14"/></svg></button><button type="button" data-ch-scroll="-1" aria-label="${zh ? '向左滑動' : 'Scroll left'}">←</button><button type="button" data-ch-scroll="1" aria-label="${zh ? '向右滑動' : 'Scroll right'}">→</button></div>`;
}

export const popularShelfStyles = `
.yt-popular-shelf .section-head{align-items:center;gap:8px 16px}.yt-shelf-controls{display:flex;gap:6px;margin-left:auto}.yt-shelf-controls button{display:grid;place-items:center;border:0;border-radius:50%;background:var(--raised);color:var(--ink);width:36px;height:36px;cursor:pointer}.yt-shelf-controls button[hidden]{display:none}.yt-shelf-controls button:disabled{opacity:.3;cursor:default}.yt-shelf-controls button[aria-pressed=true]{background:var(--ink);color:var(--bg)}
.yt-popular-shelf .ch-rows{display:flex;gap:16px;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x proximity;scrollbar-width:thin;padding:4px 0 12px}
.yt-popular-shelf .yt-channel-row,.yt-popular-shelf .yt-top-video{display:flex;flex-direction:column;align-items:stretch;position:relative;flex:0 0 176px;min-width:0;padding:0;gap:8px;scroll-snap-align:start;border-radius:6px}
.yt-popular-shelf .yt-channel-rank{position:absolute;top:4px;right:4px;background:rgba(13,13,12,.88);padding:2px 5px;border-radius:4px;z-index:1}
.yt-popular-shelf .yt-channel-row>img,.yt-popular-shelf .yt-channel-avatar{height:104px;width:104px;flex:none;margin:0 auto;font-size:28px}.yt-popular-shelf .yt-channel-main{text-align:center;width:100%}.yt-popular-shelf .yt-channel-track{display:none}.yt-popular-shelf .yt-channel-name{white-space:normal;overflow-wrap:anywhere}.yt-popular-shelf .yt-channel-nums{text-align:center;margin-top:auto}
.yt-popular-shelf .yt-top-video-media{width:100%;flex:none}.yt-popular-shelf .yt-top-video-main strong{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal;min-height:2.7em;overflow-wrap:anywhere}.yt-popular-shelf .yt-top-video-nums{text-align:left;margin-top:auto}.yt-popular-shelf .yt-top-video-nums strong,.yt-popular-shelf .yt-channel-nums strong{display:inline;margin-right:8px}
.yt-popular-shelf.is-grid .ch-rows{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));overflow:visible;row-gap:22px;scroll-snap-type:none}
@media(max-width:560px){.yt-popular-shelf .ch-rows{gap:12px}.yt-popular-shelf .yt-channel-row,.yt-popular-shelf .yt-top-video{flex-basis:148px}.yt-popular-shelf.is-grid .ch-rows{grid-template-columns:repeat(2,minmax(0,1fr))}.yt-shelf-controls button{width:40px;height:40px}}
`;
