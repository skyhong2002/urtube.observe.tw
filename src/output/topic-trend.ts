import type { YoutubeDashboardData, YoutubeTopicTrendMonth } from '../youtube/types.js';
import { PERSONAL_TOPICS } from '../youtube/personal-taxonomy.js';
import type { Messages } from './i18n.js';
import { hours, html } from './pages.js';

const TOPIC_COLORS = [
  '#c84d4d', '#3478b8', '#39805b', '#a8661f', '#7656ad', '#18817d',
  '#b64f78', '#6f7928', '#596b82', '#a65334', '#367187', '#866247',
];

export interface TopicTrendValue {
  slug: string;
  name: string;
  share: number | null;
  rawShare: number | null;
  smoothedShare: number | null;
  estimatedWatchSeconds: number;
}

export interface TopicTrendFrame {
  month: string;
  label: string;
  coverage: number | null;
  provisional: boolean;
  empty: string;
  values: TopicTrendValue[];
}

export interface TopicTrendModel {
  frames: TopicTrendFrame[];
  topics: Array<{ slug: string; name: string; color: string }>;
}

function topicColor(slug: string): string {
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return TOPIC_COLORS[hash % TOPIC_COLORS.length];
}

function monthLabel(month: string, t: Messages): string {
  const [year, number, day] = month.split('-').map(Number);
  return day ? t.fullDate(year, number, day) : t.monthYear(year, number);
}

export function buildTopicTrendModel(months: YoutubeTopicTrendMonth[], t: Messages): TopicTrendModel {
  const names = new Map<string, string>();
  const totals = new Map<string, number>();
  for (const month of months) {
    for (const topic of month.topics) {
      const definition = PERSONAL_TOPICS.find((candidate) => candidate.slug === topic.slug);
      names.set(topic.slug, definition
        ? t.topicTrendOther === '其他' ? definition.nameZh : definition.name
        : topic.name);
      totals.set(topic.slug, (totals.get(topic.slug) ?? 0) + topic.estimatedWatchSeconds);
    }
  }
  const topics = [...names].filter(([slug]) => (totals.get(slug) ?? 0) > 0)
    .map(([slug, name]) => ({ slug, name, color: topicColor(slug) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const frames = months.map((month) => ({
    month: month.month,
    label: (month.periodStart && month.periodEnd && month.periodStart !== month.periodEnd
      ? `${month.periodStart} – ${month.periodEnd}` : monthLabel(month.periodStart ?? month.month, t)) + (month.partialPeriod ? ` · ${t.topicTrendPartial}` : ''),
    empty: !month.watchEvents ? t.topicTrendNoWatches : !month.classifiedWatchEvents ? t.topicTrendUnavailable : t.topicTrendNoTime,
    coverage: month.classifiableWatchEvents ? month.classificationCoverage : null,
    provisional: month.classifiableWatchEvents > 0 && month.classificationCoverage < 0.999,
    values: topics.map((topic) => {
      const value = month.topics.find((candidate) => candidate.slug === topic.slug);
      return {
        slug: topic.slug,
        name: topic.name,
        share: month.classifiedWatchSeconds > 0 && value ? value.movingAverageShare : null,
        rawShare: month.classifiedWatchSeconds > 0 && value ? value.share : null,
        smoothedShare: month.classifiedWatchSeconds > 0 && value ? value.movingAverageShare : null,
        estimatedWatchSeconds: value?.estimatedWatchSeconds ?? 0,
      };
    }),
  }));
  return { frames, topics };
}

function percentage(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function signedPoints(value: number): string {
  const points = value * 100;
  return `${points > 0 ? '+' : ''}${points.toFixed(1)} pp`;
}

function sortedValues(frame: TopicTrendFrame): TopicTrendValue[] {
  return frame.values.filter((value) => value.share !== null)
    .sort((a, b) => b.share! - a.share! || a.name.localeCompare(b.name));
}

function raceRows(model: TopicTrendModel, index: number, t: Messages): string {
  const current = model.frames[index];
  const previous = model.frames[index - 1];
  const values = sortedValues(current);
  const visible = values.slice(0, 8);
  const hidden = values.slice(8);
  if (hidden.length) {
    visible.push({
      slug: '__other',
      name: t.topicTrendOther,
      share: hidden.reduce((sum, value) => sum + value.share!, 0),
      rawShare: hidden.reduce((sum, value) => sum + (value.rawShare ?? 0), 0),
      smoothedShare: hidden.reduce((sum, value) => sum + (value.smoothedShare ?? 0), 0),
      estimatedWatchSeconds: hidden.reduce((sum, value) => sum + value.estimatedWatchSeconds, 0),
    });
  }
  const max = Math.max(...visible.map((value) => value.share ?? 0), 0.01);
  return visible.map((value, rank) => {
    const previousShare = value.slug === '__other'
      ? null
      : previous?.values.find((candidate) => candidate.slug === value.slug)?.share ?? null;
    const change = previousShare === null || value.share === null ? null : value.share - previousShare;
    const movement = change === null ? t.topicTrendNoChange : change > 0.0005
      ? t.topicTrendRose(signedPoints(change)) : change < -0.0005
        ? t.topicTrendFell(signedPoints(change)) : t.topicTrendFlat;
    return `<li class="yt-trend-race-row" data-race-slug="${html(value.slug)}" style="transform:translateY(${rank * 49}px)">
      <span class="yt-trend-rank">${rank + 1}</span><span class="yt-trend-race-main"><strong>${html(value.name)}</strong>
      <span class="yt-trend-track"><i style="--bar:${((value.share ?? 0) / max * 100).toFixed(2)}%;--topic-color:${value.slug === '__other' ? '#77736d' : topicColor(value.slug)}"></i></span></span>
      <span class="yt-trend-race-value"><strong>${percentage(value.share)}</strong><small>${html(movement)}</small></span></li>`;
  }).join('');
}

function topicStats(model: TopicTrendModel, slug: string): { latest: number; growth: number; average: number } {
  const shares = model.frames.map((frame) => frame.values.find((value) => value.slug === slug)?.share ?? null);
  const known = shares.filter((share): share is number => share !== null);
  const first = known[0] ?? 0;
  const latest = known.at(-1) ?? 0;
  return { latest, growth: latest - first, average: known.reduce((sum, share) => sum + share, 0) / Math.max(1, known.length) };
}

function heatmapRows(model: TopicTrendModel, t: Messages): string {
  return model.topics.map((topic) => {
    const stats = topicStats(model, topic.slug);
    const cells = model.frames.map((frame, frameIndex) => {
      const value = frame.values.find((candidate) => candidate.slug === topic.slug)!;
      const details = value.share === null
        ? `${topic.name} · ${frame.label} · ${frame.empty}`
        : `${topic.name} · ${frame.label} · ${percentage(value.share)} · ${hours(value.estimatedWatchSeconds)} · ${frame.coverage === null ? t.topicTrendNoCoverage : t.topicTrendCoverage(Math.round(frame.coverage * 100))}${frame.provisional ? ` · ${t.provisional}` : ''}`;
      const opacity = value.share === null ? 0 : Math.max(0.08, Math.min(1, value.share / 0.25));
      return `<button type="button" class="yt-trend-heat-cell${frame.provisional ? ' is-provisional' : ''}" data-trend-frame="${frameIndex}" style="--heat:${opacity.toFixed(3)}" aria-label="${html(details)}" title="${html(details)}">${percentage(value.share)}</button>`;
    }).join('');
    return `<div class="yt-trend-heat-row" data-topic-row data-topic-slug="${html(topic.slug)}" data-latest="${stats.latest}" data-growth="${stats.growth}" data-average="${stats.average}" data-name="${html(topic.name)}">
      <label class="yt-trend-topic-label"><input type="checkbox" value="${html(topic.slug)}" data-topic-select><i style="--topic-color:${topic.color}"></i><span>${html(topic.name)}</span></label>
      <div class="yt-trend-heat-cells">${cells}</div><strong>${percentage(stats.latest)}</strong><span>${signedPoints(stats.growth)}</span></div>`;
  }).join('');
}

function comparisonSvg(model: TopicTrendModel, selected: string[], t: Messages): string {
  const width = 760;
  const height = 220;
  const left = 20;
  const right = 120;
  const top = 18;
  const bottom = 30;
  const max = Math.max(0.05, ...model.frames.flatMap((frame) => frame.values
    .filter((value) => selected.includes(value.slug) && value.share !== null)
    .map((value) => value.share!)));
  const x = (index: number) => left + index / Math.max(1, model.frames.length - 1) * (width - left - right);
  const y = (share: number) => top + (1 - share / max) * (height - top - bottom);
  const paths = selected.map((slug, selectedIndex) => {
    const topic = model.topics.find((candidate) => candidate.slug === slug);
    if (!topic) return '';
    let path = '';
    let open = false;
    for (let index = 0; index < model.frames.length; index += 1) {
      const share = model.frames[index].values.find((value) => value.slug === slug)?.share ?? null;
      if (share === null) {
        open = false;
        continue;
      }
      path += `${open ? 'L' : 'M'}${x(index).toFixed(1)},${y(share).toFixed(1)}`;
      open = true;
    }
    const latest = [...model.frames].reverse().map((frame) => frame.values.find((value) => value.slug === slug)?.share ?? null).find((share) => share !== null) ?? 0;
    const labelY = Math.max(top + 8, Math.min(height - bottom, y(latest) + (selectedIndex - (selected.length - 1) / 2) * 14));
    return `<g style="--topic-color:${topic.color}"><path d="${path}"></path><text x="${width - right + 10}" y="${labelY.toFixed(1)}">${html(topic.name)} ${percentage(latest)}</text></g>`;
  }).join('');
  const labels = model.frames.map((frame, index) => index % 2 === 0 || index === model.frames.length - 1
    ? `<text x="${x(index).toFixed(1)}" y="${height - 8}">${html(frame.label)}</text>` : '').join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${html(t.topicTrendCompareAria)}"><g class="yt-trend-focus-lines">${paths}</g><g class="yt-trend-focus-labels">${labels}</g></svg>`;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

export function topicTrendSection(data: YoutubeDashboardData, t: Messages): string {
  const model = buildTopicTrendModel(data.topicTrend, t);
  // View labels describe what changes visually, without classification-version terminology.
  const rawLabel = t.topicTrendOther === '其他' ? '每日／每週' : 'Daily / weekly';
  const smoothedLabel = t.topicTrendOther === '其他' ? '趨勢' : 'Trend';
  if (!model.frames.length) {
    return `<section class="section"><div class="section-head"><div><h2>${t.topicTrendTitle}</h2><span>${t.topicTrendSub}</span></div></div><p class="muted">${t.topicTrendEmpty}</p><p class="yt-topic-trend-method">${t.topicTrendMethod}</p></section>`;
  }
  const latestIndex = model.frames.length - 1;
  const latest = model.frames[latestIndex];
  const latestValues = sortedValues(latest);
  const previous = model.frames[latestIndex - 1];
  const biggestRiser = latestValues.map((value) => ({ value, delta: value.share! - (previous?.values.find((candidate) => candidate.slug === value.slug)?.share ?? value.share!) }))
    .sort((a, b) => b.delta - a.delta)[0];
  const summary = latestValues.length ? t.topicTrendSummary(
    latest.label,
    latestValues.slice(0, 3).map((value) => `${value.name} ${percentage(value.share)}`).join(', '),
    biggestRiser?.delta > 0.0005 ? `${biggestRiser.value.name} ${signedPoints(biggestRiser.delta)}` : t.topicTrendNoRiser,
  ) : latest.empty;
  const selected = latestValues.slice(0, 3).map((value) => value.slug);
  const tableRows = model.frames.map((frame) => {
    const values = sortedValues(frame).filter((value) => value.estimatedWatchSeconds > 0)
      .map((value) => `${html(value.name)} · ${hours(value.estimatedWatchSeconds)} (${percentage(value.share)})`).join('<br>') || html(frame.empty);
    const coverage = frame.coverage === null ? '—' : `${t.topicTrendCoverage(Math.round(frame.coverage * 100))}${frame.provisional ? ` · ${t.provisional}` : ''}`;
    return `<tr><td>${html(frame.label)}</td><td>${coverage}</td><td>${values}</td></tr>`;
  }).join('');
  return `<section class="section yt-topic-trend" data-topic-trend><div class="section-head"><div><h2>${t.topicTrendTitle}</h2><span>${t.topicTrendSub}</span></div>
    <div class="yt-trend-controls"><div class="yt-trend-toggle" role="group" aria-label="${html(t.topicTrendView)}"><button type="button" data-trend-view="race" aria-pressed="true">${t.topicTrendRace}</button><button type="button" data-trend-view="heatmap" aria-pressed="false">${t.topicTrendHeatmap}</button></div>
    <div class="yt-trend-toggle" role="group" aria-label="${html(smoothedLabel)}"><button type="button" data-trend-smoothing="raw" aria-pressed="false">${rawLabel}</button><button type="button" data-trend-smoothing="smoothed" aria-pressed="true">${smoothedLabel}</button></div></div></div>
    <p class="yt-trend-range" role="note">${t.topicTrendRangeNote}</p><p class="yt-trend-summary" data-trend-summary>${html(summary)}</p>
    <div data-trend-panel="race"><div class="yt-trend-race-controls"><button type="button" data-race-previous>${t.topicTrendPrevious}</button><button type="button" data-race-play data-play="${html(t.topicTrendPlay)}" data-pause="${html(t.topicTrendPause)}">${t.topicTrendPlay}</button><button type="button" data-race-next>${t.topicTrendNext}</button>
      <label>${t.topicTrendMonth}<input type="range" min="0" max="${latestIndex}" value="${latestIndex}" data-race-range></label><label>${t.topicTrendSpeed}<select data-race-speed><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option></select></label></div>
      <div class="yt-trend-frame-head"><strong data-race-month>${html(latest.label)}</strong><span data-race-coverage class="${latest.provisional ? 'is-provisional' : ''}">${latest.coverage === null ? t.topicTrendNoCoverage : t.topicTrendCoverage(Math.round(latest.coverage * 100))}${latest.provisional ? ` · ${t.provisional}` : ''}</span></div>
      <p class="muted" data-race-empty${latestValues.length ? ' hidden' : ''}>${html(latest.empty)}</p><ol class="yt-trend-race" data-race-list style="height:${Math.min(9, model.topics.length) * 49}px">${raceRows(model, latestIndex, t)}</ol></div>
    <div data-trend-panel="heatmap" hidden><div class="yt-trend-heat-controls"><label>${t.topicTrendSort}<select data-topic-sort><option value="latest">${t.topicTrendSortLatest}</option><option value="growth">${t.topicTrendSortGrowth}</option><option value="average">${t.topicTrendSortAverage}</option></select></label><span>${t.topicTrendSelectHelp}</span></div>
      <div class="yt-trend-heat-wrap" style="--trend-periods:${model.frames.length};--trend-width:${Math.max(600, model.frames.length * 50)}px"><div class="yt-trend-heat-head"><span>${t.topics}</span><div>${model.frames.map((frame) => `<span>${html(frame.label)}</span>`).join('')}</div><span>${t.topicTrendLatest}</span><span>${t.topicTrendChange}</span></div><div data-heat-rows>${heatmapRows(model, t)}</div></div>
      <div class="yt-trend-focus" data-topic-focus>${comparisonSvg(model, selected, t)}</div></div>
    <p class="yt-topic-trend-method">${t.topicTrendMethod}</p>
    <details class="viz-table"><summary>${t.tableView}</summary><table><thead><tr><th>${t.colMonth}</th><th>${t.colCoverage}</th><th>${t.colTopicShares}</th></tr></thead><tbody data-trend-table-body>${tableRows}</tbody></table></details>
    <script type="application/json" data-topic-trend-data>${safeJson(model)}</script>
    <script>(()=>{const root=document.currentScript?.closest('[data-topic-trend]');if(!root)return;const model=JSON.parse(root.querySelector('[data-topic-trend-data]').textContent);const text=${safeJson({
      other: t.topicTrendOther, noChange: t.topicTrendNoChange, flat: t.topicTrendFlat,
      provisional: t.provisional, noCoverage: t.topicTrendNoCoverage,
      play: t.topicTrendPlay, pause: t.topicTrendPause,
      coverage: t.topicTrendCoverage(42).replace('42', '{n}'), compareAria: t.topicTrendCompareAria,
      unavailable: t.topicTrendUnavailable, noRiser: t.topicTrendNoRiser,
      summary: t.topicTrendSummary('{period}', '{leaders}', '{riser}'),
    })};const pct=(value)=>value===null?'—':(value*100).toFixed(1)+'%';const pp=(value)=>(value>0?'+':'')+(value*100).toFixed(1)+' pp';let smoothing='smoothed';const useShares=()=>{for(const frame of model.frames)for(const value of frame.values)value.share=smoothing==='raw'?value.rawShare:value.smoothedShare};
      const panels=[...root.querySelectorAll('[data-trend-panel]')];for(const button of root.querySelectorAll('[data-trend-view]'))button.addEventListener('click',()=>{for(const peer of root.querySelectorAll('[data-trend-view]'))peer.setAttribute('aria-pressed',String(peer===button));for(const panel of panels)panel.hidden=panel.dataset.trendPanel!==button.dataset.trendView});
      const range=root.querySelector('[data-race-range]');
      const list=root.querySelector('[data-race-list]');
      const month=root.querySelector('[data-race-month]');
      const coverage=root.querySelector('[data-race-coverage]');
      const play=root.querySelector('[data-race-play]');
      const speed=root.querySelector('[data-race-speed]');
      const previousButton=root.querySelector('[data-race-previous]');
      const nextButton=root.querySelector('[data-race-next]');
      const pitch=49;
      const hiddenY=(Math.min(9,model.topics.length)+1)*pitch;
      const baseStep=Math.max(120,Math.min(650,Math.round(15000/model.frames.length)));
      const stepMs=()=>baseStep/Number(speed.value);
      const rowCache=new Map([...list.querySelectorAll('[data-race-slug]')].map(row=>[row.dataset.raceSlug,row]));
      let timer;
      const stop=()=>{
        if(timer!==undefined)clearInterval(timer);
        timer=undefined;
        play.textContent='▶';
        play.setAttribute('aria-label',text.play);
        play.title=text.play;
        play.setAttribute('aria-pressed','false');
      };
      const makeRow=(value)=>{
        const row=document.createElement('li');
        row.className='yt-trend-race-row';
        row.dataset.raceSlug=value.slug;
        row.innerHTML='<span class="yt-trend-rank"></span><span class="yt-trend-race-main"><strong></strong><span class="yt-trend-track"><i></i></span></span><span class="yt-trend-race-value"><strong></strong><small></small></span>';
        row.querySelector('.yt-trend-race-main strong').textContent=value.name;
        const bar=row.querySelector('.yt-trend-track i');
        bar.style.setProperty('--topic-color',model.topics.find(topic=>topic.slug===value.slug)?.color||'#77736d');
        bar.style.setProperty('--bar','0%');
        row.style.transform='translateY('+hiddenY+'px)';
        row.style.opacity='0';
        list.append(row);
        void row.offsetHeight;
        rowCache.set(value.slug,row);
        return row;
      };
      const render=(index,manual=true)=>{
        if(manual)stop();
        range.value=String(index);
        const frame=model.frames[index];
        const prev=model.frames[index-1];
        month.textContent=frame.label;
        coverage.textContent=frame.coverage===null?text.noCoverage:text.coverage.replace('{n}',String(Math.round(frame.coverage*100)))+(frame.provisional?' · '+text.provisional:'');
        coverage.classList.toggle('is-provisional',frame.provisional);
        const values=frame.values.filter(value=>value.share!==null).sort((a,b)=>b.share-a.share||a.name.localeCompare(b.name));
        const shown=values.slice(0,8);
        const rest=values.slice(8);
        if(rest.length)shown.push({slug:'__other',name:text.other,share:rest.reduce((sum,value)=>sum+value.share,0)});
        const max=Math.max(.01,...shown.map(value=>value.share));
        const seen=new Set();
        list.style.setProperty('--race-duration',(manual?450:Math.min(450,stepMs()*.85))+'ms');
        shown.forEach((value,rank)=>{
          const row=rowCache.get(value.slug)||makeRow(value);
          seen.add(value.slug);
          const old=value.slug==='__other'?null:prev?.values.find(candidate=>candidate.slug===value.slug)?.share??null;
          const delta=old===null?null:value.share-old;
          row.querySelector('.yt-trend-rank').textContent=String(rank+1);
          row.querySelector('.yt-trend-track i').style.setProperty('--bar',value.share/max*100+'%');
          row.querySelector('.yt-trend-race-value strong').textContent=pct(value.share);
          row.querySelector('small').textContent=delta===null?text.noChange:Math.abs(delta)<.0005?text.flat:pp(delta);
          row.style.transform='translateY('+(rank*pitch)+'px)';
          row.style.opacity='1';
          row.removeAttribute('aria-hidden');
          row.setAttribute('aria-posinset',String(rank+1));
          row.setAttribute('aria-setsize',String(shown.length));
        });
        for(const [slug,row] of rowCache){
          if(seen.has(slug))continue;
          row.style.opacity='0';
          row.style.transform='translateY('+hiddenY+'px)';
          row.setAttribute('aria-hidden','true');
        }
        root.querySelector('[data-race-empty]').hidden=shown.length>0;
        root.querySelector('[data-race-empty]').textContent=frame.empty;
        previousButton.disabled=index===0;
        nextButton.disabled=index===model.frames.length-1;
        refreshSummary();
      };
      const start=()=>{
        if(model.frames.length<2)return;
        if(Number(range.value)>=model.frames.length-1)render(0);
        play.textContent='❚❚';
        play.setAttribute('aria-label',text.pause);
        play.title=text.pause;
        play.setAttribute('aria-pressed','true');
        timer=setInterval(()=>{
          const next=Number(range.value)+1;
          if(next>=model.frames.length)return stop();
          render(next,false);
          if(next===model.frames.length-1)stop();
        },stepMs());
      };
      window.urtubePageController.signal.addEventListener('abort',stop,{once:true});
      document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()},{signal:window.urtubePageController.signal});
      root.querySelector('[data-trend-view="heatmap"]').addEventListener('click',stop);
      previousButton.addEventListener('click',()=>render(Math.max(0,Number(range.value)-1)));
      nextButton.addEventListener('click',()=>render(Math.min(model.frames.length-1,Number(range.value)+1)));
      range.addEventListener('input',()=>render(Number(range.value)));
      play.addEventListener('click',()=>timer!==undefined?stop():start());
      speed.addEventListener('change',()=>{if(timer!==undefined){stop();start()}});
      if(model.frames.length<2){play.disabled=true;speed.disabled=true;range.disabled=true}
      const rows=[...root.querySelectorAll('[data-topic-row]')];const sort=root.querySelector('[data-topic-sort]');const sortRows=()=>{const key=sort.value;rows.sort((a,b)=>Number(b.dataset[key])-Number(a.dataset[key])||a.dataset.name.localeCompare(b.dataset.name));rows.forEach((row,index)=>row.style.order=String(index))};sort.addEventListener('change',sortRows);sortRows();const checks=[...root.querySelectorAll('[data-topic-select]')];checks.forEach((check)=>check.checked=${safeJson(selected)}.includes(check.value));const focus=root.querySelector('[data-topic-focus]');const svg=focus.querySelector('svg');const lines=svg.querySelector('.yt-trend-focus-lines');const ns='http://www.w3.org/2000/svg';const draw=()=>{const chosen=checks.filter((check)=>check.checked).map((check)=>check.value);checks.forEach((check)=>check.disabled=!check.checked&&chosen.length>=3);lines.replaceChildren();const max=Math.max(.05,...model.frames.flatMap((frame)=>frame.values.filter((value)=>chosen.includes(value.slug)&&value.share!==null).map((value)=>value.share)));const x=(index)=>20+index/Math.max(1,model.frames.length-1)*620;const y=(share)=>18+(1-share/max)*172;for(const [chosenIndex,slug] of chosen.entries()){const topic=model.topics.find((candidate)=>candidate.slug===slug);let path='';let open=false;for(let index=0;index<model.frames.length;index+=1){const share=model.frames[index].values.find((value)=>value.slug===slug)?.share??null;if(share===null){open=false;continue}path+=(open?'L':'M')+x(index).toFixed(1)+','+y(share).toFixed(1);open=true}const latest=[...model.frames].reverse().map((frame)=>frame.values.find((value)=>value.slug===slug)?.share??null).find((share)=>share!==null)??0;const labelY=Math.max(26,Math.min(190,y(latest)+(chosenIndex-(chosen.length-1)/2)*14));const group=document.createElementNS(ns,'g');group.style.setProperty('--topic-color',topic.color);const line=document.createElementNS(ns,'path');line.setAttribute('d',path);const label=document.createElementNS(ns,'text');label.setAttribute('x','650');label.setAttribute('y',String(labelY));label.textContent=topic.name+' '+pct(latest);group.append(line,label);lines.append(group)}svg.setAttribute('aria-label',text.compareAria)};const coverageText=(frame)=>frame.coverage===null?text.noCoverage:text.coverage.replace('{n}',String(Math.round(frame.coverage*100)))+(frame.provisional?' · '+text.provisional:'');const refreshHeatmap=()=>{for(const row of rows){const slug=row.dataset.topicSlug;const values=model.frames.map((frame)=>frame.values.find((value)=>value.slug===slug));const shares=values.map((value)=>value?.share??null);const known=shares.filter((share)=>share!==null);const first=known[0]??0;const latest=known.at(-1)??0;row.dataset.latest=String(latest);row.dataset.growth=String(latest-first);row.dataset.average=String(known.reduce((sum,share)=>sum+share,0)/Math.max(1,known.length));const cells=[...row.querySelectorAll('[data-trend-frame]')];cells.forEach((cell,index)=>{const frame=model.frames[index];const value=values[index];const share=shares[index];const detail=share===null?row.dataset.name+' · '+frame.label+' · '+frame.empty:row.dataset.name+' · '+frame.label+' · '+pct(share)+' · '+(Math.round((value?.estimatedWatchSeconds??0)/360)/10)+'h · '+coverageText(frame);cell.textContent=pct(share);cell.style.setProperty('--heat',String(share===null?0:Math.max(.08,Math.min(1,share/.25))));cell.setAttribute('aria-label',detail);cell.title=detail});row.children[2].textContent=pct(latest);row.children[3].textContent=pp(latest-first)}sortRows()};const refreshSummary=()=>{const current=model.frames[Number(range.value)];const previous=model.frames[Number(range.value)-1];const values=current.values.filter((value)=>value.share!==null).sort((a,b)=>b.share-a.share||a.name.localeCompare(b.name));const riser=values.map((value)=>({value,delta:value.share-(previous?.values.find((candidate)=>candidate.slug===value.slug)?.share??value.share)})).sort((a,b)=>b.delta-a.delta)[0];const leaders=values.slice(0,3).map((value)=>value.name+' '+pct(value.share)).join(', ');const rise=riser?.delta>.0005?riser.value.name+' '+pp(riser.delta):text.noRiser;root.querySelector('[data-trend-summary]').textContent=values.length?text.summary.replace('{period}',current.label).replace('{leaders}',leaders).replace('{riser}',rise):current.empty};const tableBody=root.querySelector('[data-trend-table-body]');const refreshTable=()=>{tableBody.replaceChildren(...model.frames.map((frame)=>{const tr=document.createElement('tr');const period=document.createElement('td');period.textContent=frame.label;const coverageCell=document.createElement('td');coverageCell.textContent=coverageText(frame);const topics=document.createElement('td');for(const value of frame.values.filter((item)=>item.share!==null&&item.estimatedWatchSeconds>0).sort((a,b)=>b.share-a.share)){const line=document.createElement('div');line.textContent=value.name+' · '+(Math.round(value.estimatedWatchSeconds/360)/10)+'h ('+pct(value.share)+')';topics.append(line)}if(!topics.childNodes.length)topics.textContent=frame.empty;tr.append(period,coverageCell,topics);return tr}))};checks.forEach((check)=>check.addEventListener('change',draw));draw();for(const button of root.querySelectorAll('[data-trend-smoothing]'))button.addEventListener('click',()=>{smoothing=button.dataset.trendSmoothing;useShares();for(const peer of root.querySelectorAll('[data-trend-smoothing]'))peer.setAttribute('aria-pressed',String(peer===button));render(Number(range.value));refreshHeatmap();refreshSummary();refreshTable();draw()});
      render(Number(range.value));
      if(matchMedia('(prefers-reduced-motion:reduce)').matches){root.classList.add('reduce-motion');stop();play.hidden=true;play.disabled=true}})();</script>
  </section>`;
}

export const topicTrendStyles = `
  .yt-topic-trend{overflow:hidden}.yt-trend-controls{display:flex;flex-wrap:wrap;gap:6px}.yt-trend-toggle{background:var(--raised);border:1px solid var(--line);border-radius:999px;display:flex;padding:2px}.yt-trend-toggle button{background:transparent;border:0;border-radius:999px;color:var(--muted);cursor:pointer;font:inherit;font-size:11px;font-weight:700;padding:6px 11px}.yt-trend-toggle button[aria-pressed=true]{background:var(--ink);color:#111}
  .yt-trend-range{color:var(--ink-2);font-size:11px;line-height:1.5;margin:0 0 10px}.yt-trend-summary{color:var(--ink-2);font-size:12px;margin:0 0 18px}
  .yt-trend-race-controls{align-items:end;border-bottom:1px solid var(--line);display:grid;gap:8px;grid-template-columns:auto auto auto minmax(140px,1fr) auto;padding-bottom:14px}.yt-trend-race-controls button,.yt-trend-race-controls select,.yt-trend-heat-controls select{background:var(--raised);border:1px solid var(--line-strong);border-radius:8px;color:var(--ink);font:inherit;font-size:11px;height:34px;padding:0 10px}.yt-trend-race-controls button{cursor:pointer}.yt-trend-race-controls [data-race-play]{border-radius:50%;padding:0;width:34px}.yt-trend-race-controls :disabled{cursor:default;opacity:.45}.yt-trend-race-controls label,.yt-trend-heat-controls label{color:var(--muted);display:grid;font-size:9px;gap:3px}.yt-trend-race-controls input{accent-color:var(--accent);width:100%}
  .yt-trend-frame-head{align-items:center;display:flex;justify-content:space-between;margin:16px 0 10px}.yt-trend-frame-head strong{font-size:18px}.yt-trend-frame-head span{color:var(--muted);font-size:10px}.yt-trend-frame-head .is-provisional{color:var(--accent-text);font-weight:700}
  .yt-trend-race{list-style:none;margin:0;overflow:hidden;padding:0;position:relative}.yt-trend-race-row{align-items:center;display:grid;gap:10px;grid-template-columns:22px minmax(0,1fr) 94px;height:40px;left:0;position:absolute;right:0;top:0;transition:transform var(--race-duration,450ms) ease,opacity var(--race-duration,450ms) ease}.yt-trend-rank{color:var(--muted);font-size:11px;text-align:right}.yt-trend-race-main{min-width:0}.yt-trend-race-main strong{display:block;font-size:12px;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.yt-trend-track{background:var(--raised);border-radius:3px;display:block;height:12px;overflow:hidden}.yt-trend-track i{background:var(--topic-color);display:block;height:100%;transition:width var(--race-duration,400ms) ease;width:var(--bar)}.yt-trend-race-value{text-align:right}.yt-trend-race-value strong,.yt-trend-race-value small{display:block;font-variant-numeric:tabular-nums}.yt-trend-race-value strong{font-size:12px}.yt-trend-race-value small{color:var(--muted);font-size:9px}
  .yt-trend-heat-controls{align-items:end;display:flex;justify-content:space-between;margin-bottom:12px}.yt-trend-heat-controls>span{color:var(--muted);font-size:10px}.yt-trend-heat-wrap{max-width:100%;overflow-x:auto;padding-bottom:6px}.yt-trend-heat-wrap [data-heat-rows]{display:flex;flex-direction:column}.yt-trend-heat-head,.yt-trend-heat-row{align-items:center;display:grid;gap:8px;grid-template-columns:150px minmax(var(--trend-width),1fr) 52px 62px;min-width:calc(var(--trend-width) + 288px)}.yt-trend-heat-head{color:var(--muted);font-size:9px;padding:0 0 6px}.yt-trend-heat-head>div,.yt-trend-heat-cells{display:grid;gap:3px;grid-template-columns:repeat(var(--trend-periods),minmax(47px,1fr));text-align:center}.yt-trend-heat-row{border-top:1px solid var(--line);padding:5px 0}.yt-trend-topic-label{align-items:center;display:flex;font-size:11px;gap:6px;min-width:0}.yt-trend-topic-label input{accent-color:var(--accent)}.yt-trend-topic-label i{background:var(--topic-color);border-radius:50%;height:7px;width:7px}.yt-trend-topic-label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.yt-trend-heat-row>strong,.yt-trend-heat-row>span{font-size:10px;font-variant-numeric:tabular-nums;text-align:right}.yt-trend-heat-row>span{color:var(--muted)}.yt-trend-heat-cell{background:rgba(200,77,77,var(--heat));border:0;border-radius:4px;color:var(--ink);cursor:help;font:inherit;font-size:8px;height:28px;padding:0}.yt-trend-heat-cell.is-provisional{background-image:repeating-linear-gradient(135deg,transparent 0,transparent 4px,rgba(255,255,255,.2) 4px,rgba(255,255,255,.2) 6px)}.yt-trend-heat-cell:focus-visible{outline:2px solid var(--ink);outline-offset:1px}
  .yt-trend-focus{border-top:1px solid var(--line);margin-top:16px;padding-top:12px}.yt-trend-focus svg{display:block;width:100%}.yt-trend-focus-lines path{fill:none;stroke:var(--topic-color);stroke-linecap:round;stroke-width:2.5}.yt-trend-focus-lines text{fill:var(--topic-color);font-size:10px;font-weight:700}.yt-trend-focus-labels text{fill:var(--muted);font-size:8px;text-anchor:middle}
  .yt-topic-trend-method{color:var(--muted);font-size:10px;line-height:1.5;margin:14px 0 0}.reduce-motion .yt-trend-track i,.reduce-motion .yt-trend-race-row{transition:none}
  @media(max-width:640px){.yt-topic-trend .section-head{align-items:flex-start;gap:12px}.yt-trend-race-controls{grid-template-columns:repeat(3,1fr)}.yt-trend-race-controls label{grid-column:span 2}.yt-trend-race-controls label:last-child{grid-column:span 1}.yt-trend-race-controls button{padding:0 5px}.yt-trend-race-row{grid-template-columns:18px minmax(0,1fr) 78px}.yt-trend-heat-controls{align-items:start;gap:10px}.yt-trend-heat-controls>span{max-width:170px;text-align:right}.yt-trend-focus{overflow-x:auto}.yt-trend-focus svg{min-width:620px}}
  @media(prefers-reduced-motion:reduce){.yt-trend-track i,.yt-trend-race-row{transition:none}}
`;
