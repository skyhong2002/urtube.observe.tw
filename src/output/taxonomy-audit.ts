import type {
  PersonalTaxonomyDistribution,
  PersonalTaxonomyEvidenceRow,
  PersonalTaxonomyReadiness,
  PersonalTaxonomyRun,
} from '../youtube/personal-taxonomy.js';
import { PERSONAL_TOPICS } from '../youtube/personal-taxonomy.js';
import type { Lang } from './i18n.js';
import { html, primaryNav, shell } from './pages.js';

export interface PersonalTaxonomyAuditRun {
  run: PersonalTaxonomyRun;
  distribution: PersonalTaxonomyDistribution;
  evidence: PersonalTaxonomyEvidenceRow[];
}

export interface PersonalTaxonomyAuditData {
  readiness: PersonalTaxonomyReadiness;
  canPrepare: boolean;
  runs: PersonalTaxonomyAuditRun[];
  activations: Array<{
    fromVersion: number | null;
    toVersion: number;
    action: 'activate' | 'rollback';
    changedAt: string;
  }>;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function topicName(slug: string, fallback: string, lang: Lang): string {
  const topic = PERSONAL_TOPICS.find((candidate) => candidate.slug === slug);
  return topic ? lang === 'zh' ? topic.nameZh : topic.name : fallback;
}

function qualityRows(run: PersonalTaxonomyRun, lang: Lang): string {
  if (!run.quality) return `<p class="muted">${lang === 'zh' ? '尚無品質結果' : 'No quality result yet'}</p>`;
  const quality = run.quality;
  const rows = lang === 'zh' ? [
    ['處理覆蓋', percent(quality.processedCoverage)],
    ['Unknown', percent(quality.unknownShare)],
    ['低信心', percent(quality.lowConfidenceShare)],
    ['易混淆', percent(quality.ambiguityShare)],
    ['凝聚度', percent(quality.cohesionScore)],
  ] : [
    ['Processed', percent(quality.processedCoverage)],
    ['Unknown', percent(quality.unknownShare)],
    ['Low confidence', percent(quality.lowConfidenceShare)],
    ['Ambiguous', percent(quality.ambiguityShare)],
    ['Cohesion', percent(quality.cohesionScore)],
  ];
  return `<dl class="tx-metrics">${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
}

function runCard(entry: PersonalTaxonomyAuditRun, lang: Lang): string {
  const { run, distribution, evidence } = entry;
  const canActivate = run.status === 'ready'
    || (run.status === 'retired' && run.activatedAt !== null);
  const label = lang === 'zh' ? {
    contract: '合約', model: '模型', input: '輸入影片', sample: '抽樣影片', range: '資料範圍',
    distribution: '廣義分布', coverage: '有效覆蓋', unknown: 'Unknown', evidence: '抽樣證據',
    noEvidence: '尚無可顯示證據', review: '我已檢查品質、Unknown、漂移與抽樣證據',
    activate: run.activatedAt ? '切回此版本' : '啟用此版本', active: '目前使用中',
  } : {
    contract: 'Contract', model: 'Model', input: 'Input videos', sample: 'Sampled videos', range: 'Data range',
    distribution: 'Broad distribution', coverage: 'Effective coverage', unknown: 'Unknown', evidence: 'Sample evidence',
    noEvidence: 'No displayable evidence yet', review: 'I reviewed quality, Unknown, drift, and sample evidence',
    activate: run.activatedAt ? 'Roll back to this version' : 'Activate this version', active: 'Active now',
  };
  const topicRows = distribution.topics.slice(0, 14).map((topic) =>
    `<li><span>${html(topicName(topic.slug, topic.name, lang))}</span><strong>${percent(topic.share)}</strong></li>`
  ).join('');
  const evidenceRows = evidence.map((row) => {
    const reasons = row.evidence.map((item) =>
      `${item.source} ${percent(item.score)} · “${item.text}”`).join(' | ');
    return `<li><strong>${html(topicName(row.topicSlug, row.topicName, lang))}</strong><span>${html(row.title)} · ${html(row.channelTitle)} · ${percent(row.confidence)}</span>${reasons ? `<small>${html(reasons)}</small>` : ''}</li>`;
  }).join('');
  const action = run.status === 'active'
    ? `<p class="tx-active">${label.active}</p>`
    : canActivate ? `<form method="post" action="/account/taxonomy/${run.taxonomyVersion}/activate" class="tx-action">
        <label><input type="checkbox" name="reviewed" value="1" required> ${label.review}</label>
        <button type="submit">${label.activate}</button>
      </form>` : '';
  return `<article class="section tx-run">
    <div class="section-head"><h2>v${run.taxonomyVersion}</h2><span class="tx-status">${html(run.status)}</span></div>
    <dl class="tx-facts">
      <div><dt>${label.contract}</dt><dd>${html(run.definitionVersion)}</dd></div>
      <div><dt>${label.model}</dt><dd>${html(run.model)} · ${html(run.promptVersion)}</dd></div>
      <div><dt>${label.input}</dt><dd>${run.inputVideos}</dd></div>
      <div><dt>${label.sample}</dt><dd>${run.sample?.sampledVideos ?? '—'}</dd></div>
      <div><dt>${label.range}</dt><dd>${html(run.dataStartAt?.slice(0, 10) ?? '—')} → ${html(run.dataEndAt?.slice(0, 10) ?? '—')}</dd></div>
    </dl>
    ${qualityRows(run, lang)}
    <div class="tx-columns"><section><h3>${label.distribution}</h3><p class="muted">${label.coverage} ${percent(distribution.effectiveCoverage)} · ${label.unknown} ${percent(distribution.unknownShare)}</p><ol class="tx-topics">${topicRows}</ol></section>
    <section><h3>${label.evidence}</h3>${evidenceRows ? `<ul class="tx-evidence">${evidenceRows}</ul>` : `<p class="muted">${label.noEvidence}</p>`}</section></div>
    ${action}
  </article>`;
}

export function personalTaxonomyAuditPage(
  data: PersonalTaxonomyAuditData,
  lang: Lang = 'en',
  error = '',
  dashboardHref = '/',
): string {
  const copy = lang === 'zh' ? {
    eyebrow: 'OWNER ONLY', title: '個人主題審核',
    intro: '這裡只供本人檢查分類版本。公開洞察只顯示廣義主題與覆蓋率。',
    readiness: 'Metadata 準備度', available: '可分類影片', history: '啟用紀錄',
    noRuns: '尚無分類版本。Metadata 達標後可建立候選版本。',
    prepare: '建立 governed v2 候選版本',
    prepareConfirm: '我了解這會在背景對我的公開影片 metadata 執行有界 AI 分類',
    noHistory: '尚無啟用或 rollback 紀錄', back: '返回設定', account: '設定', dashboard: 'Dashboard',
  } : {
    eyebrow: 'OWNER ONLY', title: 'Personal topic review',
    intro: 'Only you can inspect versions here. Public insights show broad topics and coverage only.',
    readiness: 'Metadata readiness', available: 'Classifiable videos', history: 'Activation history',
    noRuns: 'No taxonomy run yet. A candidate can be prepared after metadata is ready.',
    prepare: 'Prepare a governed v2 candidate',
    prepareConfirm: 'I understand this starts bounded background AI classification of my public video metadata',
    noHistory: 'No activation or rollback yet', back: 'Back to settings', account: 'Settings', dashboard: 'Dashboard',
  };
  const history = data.activations.map((item) => `<li><strong>${html(item.action)}</strong><span>${item.fromVersion === null ? '—' : `v${item.fromVersion}`} → v${item.toVersion} · ${html(item.changedAt)}</span></li>`).join('');
  const prepare = data.canPrepare && data.readiness.ready
    ? `<form method="post" action="/account/taxonomy/prepare" class="tx-action tx-prepare">
        <label><input type="checkbox" name="confirmed" value="1" required> ${copy.prepareConfirm}</label>
        <button type="submit">${copy.prepare}</button>
      </form>` : '';
  const body = `<style>${styles}</style><section class="tx-intro"><div class="eyebrow">${copy.eyebrow}</div><h1>${copy.title}</h1><p>${copy.intro}</p><a href="/account">← ${copy.back}</a></section>
    ${error ? `<div class="tx-error" role="alert">${html(error)}</div>` : ''}
    <section class="section tx-readiness"><div class="section-head"><h2>${copy.readiness}</h2><span>${data.readiness.reason}</span></div><strong>${percent(data.readiness.metadataCoverage)}</strong><span>${copy.available} ${data.readiness.availableVideos} / ${data.readiness.totalVideos}</span></section>
    ${prepare}
    ${data.runs.length ? data.runs.map((entry) => runCard(entry, lang)).join('') : `<section class="section"><p class="muted">${copy.noRuns}</p></section>`}
    <section class="section"><div class="section-head"><h2>${copy.history}</h2></div>${history ? `<ul class="tx-history">${history}</ul>` : `<p class="muted">${copy.noHistory}</p>`}</section>`;
  return shell(copy.title, body, primaryNav(lang, {
    active: 'account', dashboardHref,
    languageHref: `/account/taxonomy?lang=${lang === 'zh' ? 'en' : 'zh'}`,
  }), '', lang, '/account/taxonomy');
}

const styles = `
  .tx-intro{margin:14px 0 26px}.tx-intro h1{font-size:clamp(28px,4vw,40px);letter-spacing:-.03em;line-height:1.08;margin:7px 0 8px}.tx-intro p{color:var(--ink-2);margin:0 0 8px;max-width:680px}.tx-intro a{font-size:12px}.tx-error{background:#321717;border:1px solid #713030;border-radius:10px;color:#ffb3b3;margin-bottom:18px;padding:12px 14px}.tx-readiness{align-items:center;display:grid;gap:5px;grid-template-columns:1fr auto}.tx-readiness .section-head{grid-column:1/-1;margin:0}.tx-readiness>strong{font-size:28px}.tx-readiness>span{color:var(--muted);font-size:12px}.tx-status,.tx-active{color:var(--accent-text)!important;font-weight:700;text-transform:uppercase}.tx-facts,.tx-metrics{display:grid;gap:8px;margin:0}.tx-facts{grid-template-columns:repeat(5,minmax(0,1fr))}.tx-metrics{grid-template-columns:repeat(5,1fr);margin-top:14px}.tx-facts div,.tx-metrics div{background:var(--raised);border-radius:9px;padding:10px}.tx-facts dt,.tx-metrics dt{color:var(--muted);font-size:9px;text-transform:uppercase}.tx-facts dd,.tx-metrics dd{font-size:12px;margin:3px 0 0;overflow-wrap:anywhere}.tx-metrics dd{font-size:17px;font-weight:700}.tx-columns{display:grid;gap:22px;grid-template-columns:1fr 1fr;margin-top:22px}.tx-columns h3{font-size:13px;margin:0 0 7px}.tx-topics,.tx-evidence,.tx-history{list-style:none;margin:0;padding:0}.tx-topics li,.tx-evidence li,.tx-history li{border-top:1px solid var(--line);display:flex;gap:14px;justify-content:space-between;padding:7px 0}.tx-topics span,.tx-evidence span,.tx-history span{color:var(--muted);font-size:11px}.tx-evidence li{display:grid;gap:2px}.tx-evidence small{color:var(--ink-2);font-size:10px}.tx-action{border-top:1px solid var(--line);display:flex;gap:16px;justify-content:space-between;margin-top:20px;padding-top:16px}.tx-action label{color:var(--ink-2);font-size:12px}.tx-action input{accent-color:var(--accent)}.tx-action button{background:var(--accent);border:0;border-radius:999px;color:white;cursor:pointer;font:inherit;font-size:12px;font-weight:700;padding:9px 14px}.tx-active{font-size:12px;margin:18px 0 0}
  @media(max-width:760px){.tx-facts{grid-template-columns:1fr 1fr}.tx-metrics{grid-template-columns:repeat(2,1fr)}.tx-columns{grid-template-columns:1fr}.tx-action{align-items:start;flex-direction:column}}
`;
