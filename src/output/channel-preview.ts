import { channelHeader, type ChannelPageData } from './channel.js';
import { messages, type Lang } from './i18n.js';
import { hours, html } from './pages.js';

// Uses the same authenticated channel data and public header as the full page.
// This fragment contains no scripts or global page styles.
export function channelPreview(data: ChannelPageData, lang: Lang): string {
  const t = messages(lang);
  const count = (n: number) => new Intl.NumberFormat('en').format(n);
  const stat = (value: string, label: string) => `<div><strong>${html(value)}</strong><span>${html(label)}</span></div>`;
  const stats = (watches: number, seconds: number, videos: number) => `${stat(count(watches), t.channelStatWatches)}${stat(hours(seconds), t.channelStatHours)}${stat(count(videos), t.channelStatVideos)}`;
  const order = <T extends { watches: number; estimatedWatchSeconds: number }>(items: T[]) => [...items].sort((a, b) => data.sort === 'watches' ? b.watches - a.watches : b.estimatedWatchSeconds - a.estimatedWatchSeconds);
  const videos = (items: Array<{ videoId: string; title: string; thumbnailUrl: string; watches: number; estimatedWatchSeconds: number }>) => order(items).slice(0, 5).map(video => `<li><a href="https://www.youtube.com/watch?v=${html(video.videoId)}" target="_blank" rel="noopener">${video.thumbnailUrl ? `<img src="${html(video.thumbnailUrl)}" alt="" loading="lazy" width="96" height="54">` : ''}<span><strong>${html(video.title)}</strong><small>${html(t.matchesTimes(video.watches))} · ${hours(video.estimatedWatchSeconds)}</small></span></a></li>`).join('');
  const section = (title: string, body: string) => `<section><h3>${html(title)}</h3>${body}</section>`;
  let community = `<p class="cp-note">${html(t.channelJoinForCommunity)}</p>`;
  if (data.community) {
    const total = data.community.members.reduce((sum, member) => ({ watches: sum.watches + member.watches, seconds: sum.seconds + member.estimatedWatchSeconds }), { watches: 0, seconds: 0 });
    community = section(t.channelCommunityStats, `<div class="cp-stats">${stat(count(data.community.memberCount), t.channelStatMembers)}${stats(total.watches, total.seconds, data.community.videos.length)}</div>`);
    if (data.community.videos.length) community += section(t.channelCommunityVideos, `<ol class="cp-videos">${videos(data.community.videos)}</ol>`);
    if (data.community.members.length) community += section(t.channelTopViewers, `<ol class="cp-members">${order(data.community.members).slice(0, 5).map((member, i) => `<li><span>#${i + 1}</span><a class="cp-member-profile" href="/${html(member.handle)}"><img src="/avatar/member/${html(member.handle)}" alt="" width="32" height="32" loading="lazy"><strong>${html(member.displayName)}</strong></a><small>${hours(member.estimatedWatchSeconds)} · ${html(t.matchesTimes(member.watches))}</small></li>`).join('')}</ol>`);
  }
  const dates = [
    [data.mine.stats.firstWatchedAt, t.channelFirstWatch],
    [data.mine.stats.lastWatchedAt, t.channelLastWatch],
  ].filter(([date]) => date).map(([date, label]) => `<div><dt>${html(label!)}</dt><dd>${html(new Intl.DateTimeFormat(lang === 'zh' ? 'zh-TW' : 'en', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(date!)))}</dd></div>`).join('');
  return `<div class="cp-content" data-channel-preview-fragment>${channelHeader(data.channel, t, 'h2')}<p class="cp-note">${html(t.ranges[data.range])} · ${html(data.sort === 'watches' ? t.rhythmWatches : t.rhythmTime)}</p>${community}<div class="cp-personal">${section(t.channelYourStats, `<div class="cp-stats">${stats(data.mine.stats.watches, data.mine.stats.estimatedWatchSeconds, data.mine.stats.uniqueVideos)}</div>${dates ? `<dl class="cp-dates">${dates}</dl>` : ''}`)}${data.mine.videos.length ? section(t.channelYourVideos, `<ol class="cp-videos">${videos(data.mine.videos)}</ol>`) : ''}</div></div>`;
}

export function channelPreviewDrawer(lang: Lang, range: string): string {
  const t = messages(lang);
  return `<style>${previewStyles}</style><dialog class="cp-drawer" aria-labelledby="cp-title" data-range="${html(range)}" data-lang="${lang}"><div class="cp-bar"><h2 id="cp-title">${html(t.channelPreviewTitle)}</h2><a data-cp-full target="_blank" rel="noopener">${html(t.channelPreviewFull)} ↗</a><button type="button" data-cp-close aria-label="${html(t.channelPreviewClose)}" autofocus>×</button></div><div class="cp-scroll"><p data-cp-loading role="status">${html(t.channelPreviewLoading)}</p><div data-cp-error hidden role="alert"><p>${html(t.channelPreviewError)}</p><button type="button" data-cp-retry>${html(t.channelPreviewRetry)}</button></div><div data-cp-body></div></div></dialog><script>${previewScript}</script>`;
}

const previewStyles = `
  html:has(.cp-drawer[open]){overflow:hidden}@media(min-width:561px){html:has(.cp-drawer[open]){scrollbar-gutter:stable}}
  .cp-drawer{background:var(--bg);border:0;border-left:1px solid var(--line);box-shadow:-20px 0 60px #0006;color:var(--ink);height:100dvh;margin:0 0 0 auto;max-height:none;max-width:100%;padding:0;width:520px}
  .cp-drawer[open]{display:flex;flex-direction:column;animation:cp-enter .18s ease-out}.cp-drawer::backdrop{background:#0007}
  .cp-bar{align-items:center;border-bottom:1px solid var(--line);display:flex;flex:none;gap:12px;padding:14px 20px}.cp-bar h2{font-size:14px;margin:0}.cp-bar a{color:var(--muted);font-size:11px;margin-left:auto;text-decoration:none}.cp-bar button{background:var(--raised);border:0;border-radius:50%;color:var(--ink);cursor:pointer;font-size:24px;height:34px;width:34px}
  .cp-scroll{overflow-y:auto;overscroll-behavior:contain;padding:20px 24px 36px;min-height:0}.cp-scroll [hidden]{display:none}.cp-scroll>[role=status],.cp-scroll [role=alert]{color:var(--muted);font-size:13px}.cp-scroll [data-cp-retry]{background:var(--raised);border:1px solid var(--line);border-radius:6px;color:var(--ink);cursor:pointer;padding:7px 12px}
  .cp-content .ch-head{align-items:flex-start;display:flex;gap:14px}.cp-content .ch-head>div{min-width:0}.cp-content .ch-avatar{background:var(--raised);border-radius:50%;display:grid;flex:0 0 60px;font-size:24px;height:60px;object-fit:cover;place-items:center;width:60px}.cp-content .ch-head h2{font-size:24px;line-height:1.2;margin:0 0 6px}
  .cp-content .ch-meta,.cp-content .ch-public,.cp-content .ch-tags{align-items:baseline;color:var(--muted);display:flex;flex-wrap:wrap;font-size:11px;gap:4px 10px;margin-top:6px}.cp-content .ch-subscribers{font-size:13px}.cp-content .ch-subscribers strong,.cp-content .ch-public strong{color:var(--ink-2)}.cp-content .ch-tags a{background:var(--raised);border-radius:4px;color:var(--ink-2);padding:2px 5px;text-decoration:none}
  .cp-content section{margin-top:24px}.cp-content h3{font-size:15px;margin:0 0 12px}.cp-note{color:var(--muted);font-size:11px;margin:12px 0}.cp-stats{display:grid;gap:12px;grid-template-columns:repeat(2,minmax(0,1fr))}.cp-stats strong{display:block;font-size:21px;line-height:1.3}.cp-stats span{color:var(--muted);font-size:11px}.cp-personal{border-top:1px solid var(--line);margin-top:24px}
  .cp-videos,.cp-members{display:grid;gap:12px;list-style:none;margin:0;padding:0}.cp-videos a{align-items:center;color:var(--ink);display:flex;gap:12px;text-decoration:none}.cp-videos img{border-radius:5px;flex:0 0 96px;height:54px;object-fit:cover;width:96px}.cp-videos strong{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:12px;line-height:1.4;overflow:hidden}.cp-videos small,.cp-members small{color:var(--muted);font-size:11px}.cp-videos small{display:block;margin-top:3px}
  .cp-members li{align-items:center;display:flex;gap:9px;font-size:12px}.cp-members li>span{color:var(--muted);font-size:10px;min-width:18px}.cp-members img{border-radius:50%;height:32px;width:32px}.cp-member-profile{align-items:center;color:var(--ink);display:flex;flex:1;gap:9px;min-width:0;text-decoration:none}.cp-member-profile:hover{color:var(--accent-text)}.cp-members strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cp-members small{flex:none}.cp-dates{color:var(--muted);display:flex;flex-wrap:wrap;font-size:11px;gap:12px 24px}.cp-dates dd{color:var(--ink-2);margin:3px 0}
  @keyframes cp-enter{from{transform:translateX(100%)}to{transform:translateX(0)}}@media(prefers-reduced-motion:reduce){.cp-drawer[open]{animation:none}}@media(max-width:560px){.cp-drawer{border-left:0;width:100%}.cp-scroll{padding-inline:20px}.cp-bar{padding-inline:16px}}
`;

const previewScript = `(()=>{
  const dialog=document.querySelector('.cp-drawer');
  if(!dialog||typeof dialog.showModal!=='function')return;
  const body=dialog.querySelector('[data-cp-body]'),loading=dialog.querySelector('[data-cp-loading]'),error=dialog.querySelector('[data-cp-error]'),full=dialog.querySelector('[data-cp-full]'),scroll=dialog.querySelector('.cp-scroll');
  const signal=window.urtubePageController?.signal;
  let controller=null,opener=null,url=null;
  const clear=()=>{controller?.abort();controller=null;body.replaceChildren();body.removeAttribute('aria-busy');};
  const load=async()=>{
    clear();const request=new AbortController();controller=request;loading.hidden=false;error.hidden=true;body.setAttribute('aria-busy','true');
    const timeout=setTimeout(()=>request.abort(),12000);
    try{
      const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:request.signal});
      if(!response.ok||response.headers.get('X-Urtube-Fragment')!=='channel-preview')throw new Error('preview unavailable');
      const content=await response.text();
      if(controller!==request||!dialog.open)return;
      body.innerHTML=content;
    }catch{
      if(controller===request&&dialog.open)error.hidden=false;
    }finally{
      clearTimeout(timeout);
      if(controller===request){loading.hidden=true;body.removeAttribute('aria-busy');}
    }
  };
  document.addEventListener('click',event=>{
    const link=event.target.closest('a[data-channel-preview]');
    if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();opener=link;
    const target=new URL(link.href);target.searchParams.set('range',dialog.dataset.range);target.searchParams.set('lang',dialog.dataset.lang);
    target.searchParams.set('sort',document.querySelector('[data-metric][aria-pressed=true]')?.dataset.metric==='watches'?'watches':'duration');
    full.href=target.pathname+target.search;target.searchParams.set('preview','1');url=target.pathname+target.search;
    if(!dialog.open)dialog.showModal();scroll.scrollTop=0;load();
  },{signal});
  dialog.querySelector('[data-cp-close]').addEventListener('click',()=>dialog.close());
  dialog.querySelector('[data-cp-retry]').addEventListener('click',load);
  let backdrop=false;
  dialog.addEventListener('pointerdown',event=>{backdrop=event.target===dialog;});
  dialog.addEventListener('click',event=>{if(backdrop&&event.target===dialog)dialog.close();backdrop=false;});
  dialog.addEventListener('close',()=>{clear();opener?.focus({preventScroll:true});});
  const dispose=()=>{clear();if(dialog.open)dialog.close();};
  signal?.addEventListener('abort',dispose,{once:true});
  addEventListener('pagehide',dispose,{signal});
})();`;
