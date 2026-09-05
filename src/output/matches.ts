import { matchingWorkspace } from '../matching-v3/page.js';
import type { MatchingCandidateBatch, MatchingCandidateCard } from '../youtube/candidates.js';
import type { CohortRecommendations } from '../youtube/cohort-recommendations.js';
import type { MatchRelationship } from '../users.js';
import {
  COMPARISON_LOCKED_TOPIC_LIMIT,
  COMPARISON_RANGES,
  type CommonChannel,
  type CommonItemMeasures,
  type CommonMeasure,
  type CommonTopic,
  type CommonVideo,
  type ComparisonList,
  type ComparisonPair,
  type ComparisonWatchEdge,
  type WatchComparison,
} from '../youtube/comparison.js';
import { messages, type Lang, type Messages } from './i18n.js';
import { hours, html, primaryNav, shell } from './pages.js';
import { radialClock, rhythmClockStyles } from './youtube.js';
import { YOUTUBE_CHANNEL_ID_PATTERN } from './channel.js';
import { channelPreviewDrawer } from './channel-preview.js';

export type MatchesPageState =
  | { kind: 'opt_in_required' }
  | { kind: 'data_pending' }
  | { kind: 'empty' }
  | { kind: 'ready'; batch: ActionableMatchingCandidateBatch };

export interface ActionableMatchingCandidateCard extends MatchingCandidateCard {
  // Scoped to the viewer and candidate for friendship forms.
  actionToken?: string;
  relationship: MatchRelationship;
  targetPublic?: boolean;
  comparisonReady?: boolean;
  topicMatch?: { score: number | null; provisional: boolean; reasons: string[]; detailsVisible: boolean };
}

export interface ActionableMatchingCandidateBatch extends Omit<MatchingCandidateBatch, 'cards'> {
  cards: ActionableMatchingCandidateCard[];
}

const matchesStyles = `
  .mt-intro{margin:14px 0 26px;max-width:700px}.mt-intro h1{font-size:clamp(30px,4.5vw,46px);letter-spacing:-.04em;line-height:1.05;margin:7px 0 10px}.mt-intro p{color:var(--ink-2);margin:0}
  .mt-privacy{background:var(--raised);border:1px solid var(--line);border-radius:10px;color:var(--muted);font-size:12px;margin:0 0 20px;padding:11px 13px}
  .mt-provisional{background:rgba(250,178,25,.1);border:1px solid rgba(250,178,25,.35);border-radius:10px;color:#f5c95e;font-size:12px;margin:0 0 20px;padding:11px 13px}
  .mt-cohort{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);margin:0 0 20px;padding:20px}.mt-cohort h2{font-size:17px;margin:0 0 7px}.mt-cohort>p{color:var(--ink-2);font-size:12px;margin:0 0 14px;max-width:680px}.mt-cohort-groups{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}.mt-cohort-group strong{color:var(--muted);display:block;font-size:9px;letter-spacing:.08em;margin-bottom:7px;text-transform:uppercase}
  .mt-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
  .mt-card[data-compact-friendship]{position:relative}.mt-card[data-compact-friendship] .mt-person{padding-right:32px}.mt-card[data-compact-friendship="incoming"] .mt-person{padding-right:68px}.mt-friend-tools{position:absolute;right:12px;top:12px}.mt-friend-tools svg{flex:none}.mt-friend-tools form{display:flex;gap:2px;margin:0}.mt-card .mt-friend-tools button{align-items:center;justify-content:center;display:inline-flex;width:34px;height:34px;min-height:34px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--muted);cursor:pointer}.mt-card .mt-friend-tools button:hover{background:var(--raised);color:var(--ink)}.mt-card .mt-friend-tools button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}@media(pointer:coarse){.mt-card .mt-friend-tools button{width:40px;height:40px;min-height:40px}.mt-card[data-compact-friendship] .mt-person{padding-right:40px}.mt-card[data-compact-friendship="incoming"] .mt-person{padding-right:80px}}
  .mt-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);display:flex;flex-direction:column;min-height:230px;padding:20px}
  .mt-person{align-items:center;display:flex;gap:12px}.mt-person-link{align-items:center;color:inherit;display:flex;gap:12px;text-decoration:none}.mt-avatar{background:linear-gradient(140deg,#e66767,#9b2b2b);border:2px solid transparent;border-radius:50%;display:block;flex:0 0 54px;height:54px;object-fit:cover;transition:border-color .15s,transform .15s;width:54px}.mt-person-link:hover .mt-avatar,.mt-person-link:focus-visible .mt-avatar{border-color:var(--accent);transform:scale(1.04)}.mt-person h2{font-size:17px;margin:0}
  .mt-partner{display:inline-block;margin-top:8px;border:1px solid var(--accent);border-radius:999px;padding:4px 10px;color:var(--accent-text);font-size:12px;font-weight:700}
  .mt-percent{color:var(--accent-text);font-size:22px;font-variant-numeric:tabular-nums;font-weight:850;letter-spacing:-.03em}.mt-percent small{color:var(--muted);font-size:10px;font-weight:650;letter-spacing:.02em;margin-left:5px}
  .mt-clues{display:grid;gap:9px;margin:20px 0 16px}.mt-clue-label{color:var(--muted);display:block;font-size:9px;font-weight:700;letter-spacing:.08em;margin-bottom:5px;text-transform:uppercase}.mt-pills{display:flex;flex-wrap:wrap;gap:6px}.mt-pill{border:1px solid var(--line-strong);border-radius:999px;color:var(--ink-2);font-size:11px;padding:3px 9px}.mt-channel{color:var(--ink-2);font-size:12px}
  .mt-icebreaker{color:var(--ink-2);font-size:12px;line-height:1.6;margin:auto 0 16px}.mt-actions{align-items:center;display:flex;flex-wrap:wrap;gap:8px}.mt-actions form{display:flex;flex-wrap:wrap;gap:10px;margin:0}.mt-actions a,.mt-actions button,.mt-profile-actions button{align-items:center;border-radius:999px;display:inline-flex;font:inherit;font-size:14px;font-weight:700;justify-content:center;min-height:44px;padding:10px 20px;text-decoration:none}.mt-want{background:var(--accent);border:1px solid var(--accent);color:#fff;cursor:pointer}.mt-secondary-link,.mt-secondary{background:transparent;border:1px solid var(--line-strong);color:var(--ink-2);cursor:pointer}.mt-state{background:var(--raised);border-radius:999px;color:var(--muted);font-size:10px;font-weight:750;padding:5px 9px}.mt-state.connected{background:rgba(78,190,130,.12);color:#71d9a1}.mt-state.incoming{background:rgba(250,178,25,.12);color:#f5c95e}
  .mt-pagination{align-items:center;display:flex;gap:9px;justify-content:center;margin-top:22px}.mt-pagination a{border:1px solid var(--line-strong);border-radius:999px;color:var(--ink-2);font-size:12px;font-weight:700;padding:8px 13px;text-decoration:none}.mt-page{color:var(--muted);font-size:11px}
  .mt-empty{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);max-width:620px;padding:26px}.mt-empty h2{font-size:18px;margin:0 0 8px}.mt-empty p{color:var(--ink-2);margin:0 0 16px}.mt-empty a{background:var(--accent);border-radius:999px;color:#fff;display:inline-block;font-size:13px;font-weight:700;padding:9px 15px;text-decoration:none}
  .mt-profile{margin:10px auto 40px;max-width:900px}.mt-profile-back{color:var(--ink-2);font-size:12px}.mt-panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);margin-top:16px;padding:22px}.mt-panel h2{font-size:15px;margin:0 0 13px}.mt-panel>p{color:var(--ink-2);font-size:12px;line-height:1.6}.mt-metrics{display:grid;gap:10px}.mt-metric{align-items:center;display:flex;gap:12px}.mt-metric span{color:var(--ink-2);font-size:12px;min-width:108px}.mt-meter{background:var(--raised);border-radius:999px;flex:1;height:8px;overflow:hidden}.mt-meter i{background:var(--accent);display:block;height:100%}.mt-metric strong{font-size:13px;font-variant-numeric:tabular-nums;min-width:38px;text-align:right}.mt-profile-actions{align-items:center;display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:20px}.mt-profile-actions form{display:flex;flex-wrap:wrap;gap:10px;margin:0}.mt-unlock{border-color:rgba(78,190,130,.35);background:rgba(78,190,130,.06)}.mt-locked{background:var(--raised)}
  .mt-vs{align-items:stretch;display:grid;grid-template-columns:minmax(0,1fr) 116px minmax(0,1fr);margin:20px 0}.mt-side{background:var(--surface);border:1px solid var(--line);min-height:360px;padding:clamp(20px,5vw,48px);text-align:center}.mt-side:first-child{border-radius:var(--radius) 0 0 var(--radius)}.mt-side:last-child{border-radius:0 var(--radius) var(--radius) 0}.mt-side img{border-radius:50%;height:clamp(72px,12vw,116px);object-fit:cover;width:clamp(72px,12vw,116px)}.mt-side h2{font-size:clamp(20px,3vw,32px);margin:13px 0 14px}.mt-side-label{color:var(--muted);font-size:10px;letter-spacing:.09em;text-transform:uppercase}.mt-side .mt-pills{justify-content:center}.mt-vs-center{align-items:center;display:flex;flex-direction:column;justify-content:center;position:relative;z-index:1}.mt-vs-center::before{background:var(--line);content:'';height:100%;left:50%;position:absolute;width:1px;z-index:-1}.mt-vs-score{align-items:center;background:var(--accent);border:7px solid var(--bg);border-radius:50%;color:#fff;display:flex;flex-direction:column;height:104px;justify-content:center;width:104px}.mt-vs-score strong{font-size:25px;font-variant-numeric:tabular-nums}.mt-vs-score span{font-size:9px;font-weight:700;text-transform:uppercase}.mt-version{color:var(--muted);font-size:10px;margin-top:9px;text-align:center}
  @media(max-width:620px){.mt-vs{grid-template-columns:minmax(0,1fr) 66px minmax(0,1fr)}.mt-vs-score{border-width:4px;height:62px;width:62px}.mt-vs-score strong{font-size:16px}.mt-vs-score span{font-size:7px}.mt-side{min-height:300px;padding:20px 8px}.mt-side h2{overflow-wrap:anywhere}.mt-side .mt-pill{font-size:9px;padding:3px 6px}}
`;

function icebreaker(topics: string[], lang: Lang): string {
  const t = messages(lang);
  return topics.length
    ? t.matchesIcebreakerTopics(topics.join(lang === 'zh' ? '、' : ' and '))
    : t.matchesIcebreakerGeneric;
}

export function friendshipActions(card: ActionableMatchingCandidateCard, viewerHandle: string, t: Messages, returnTo: string, includeBlend = true): string {
  const canBlend = card.targetPublic || card.relationship.status === 'connected';
  const blend = includeBlend && canBlend ? `<a class="mt-want" href="/${html(viewerHandle)}/compare/${html(card.handle)}">${html(t.memberProfileBlend)}</a>` : '';
  if (card.targetPublic && card.relationship.status === 'none') return blend;
  const token = `<input type="hidden" name="actionToken" value="${html(card.actionToken ?? '')}"><input type="hidden" name="returnTo" value="${html(returnTo)}">`;
  switch (card.relationship.status) {
    case 'none': return `${blend}<form method="post" action="/matches/request">${token}<button class="mt-want" type="submit">${html(t.matchesAddFriend)}</button></form>`;
    case 'incoming': return `${blend}<form method="post" action="/matches/respond">${token}<input type="hidden" name="requestToken" value="${html(card.relationship.requestToken)}"><button class="mt-want" name="response" value="accept">${html(t.matchesAcceptFriend)}</button><button class="mt-secondary" name="response" value="decline">${html(t.matchesDecline)}</button></form>`;
    case 'sent': return `${blend}<span class="mt-state sent">${html(t.matchesFriendSent)}</span><form method="post" action="/matches/withdraw">${token}<input type="hidden" name="requestToken" value="${html(card.relationship.requestToken)}"><button class="mt-secondary" type="submit">${html(t.matchesWithdraw)}</button></form>`;
    case 'connected': return `${blend}<form method="post" action="/matches/withdraw">${token}<input type="hidden" name="requestToken" value="${html(card.relationship.requestToken)}"><button class="mt-secondary" type="submit">${html(t.matchesDisconnect)}</button></form>`;
  }
}

function friendshipIcons(card: ActionableMatchingCandidateCard, t: Messages): string {
  const relationship = card.relationship;
  if (relationship.status === 'none' && !card.actionToken) return '';
  const common = `<input type="hidden" name="actionToken" value="${html(card.actionToken ?? '')}"><input type="hidden" name="returnTo" value="/matches">`;
  const request = relationship.status === 'none' ? '' : `<input type="hidden" name="requestToken" value="${html(relationship.requestToken)}">`;
  const icon = (kind: 'add' | 'remove' | 'accept' | 'decline') => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${kind === 'accept' ? '<path d="m5 12 4 4L19 6"/>' : kind === 'decline' ? '<path d="m6 6 12 12M6 18 18 6"/>' : `<circle cx="9" cy="7" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 9h6"/>${kind === 'add' ? '<path d="M20 6v6"/>' : ''}`}</svg>`;
  const button = (label: string, kind: 'add' | 'remove' | 'accept' | 'decline', value?: string) => `<button type="submit" aria-label="${html(label)}" title="${html(label)}"${value ? ` name="response" value="${value}"` : ''}>${icon(kind)}</button>`;
  const action = relationship.status === 'none' ? 'request' : relationship.status === 'incoming' ? 'respond' : 'withdraw';
  const controls = relationship.status === 'none' ? button(t.matchesAddFriend, 'add')
    : relationship.status === 'incoming' ? button(t.matchesAcceptFriend, 'accept', 'accept') + button(t.matchesDecline, 'decline', 'decline')
      : relationship.status === 'sent' ? button(`${t.matchesFriendSent} · ${t.matchesWithdraw}`, 'remove')
        : button(t.matchesDisconnect, 'remove');
  return `<div class="mt-friend-tools" data-friendship-tools><form method="post" action="/matches/${action}">${common}${request}${controls}</form></div>`;
}

export function candidateCard(card: ActionableMatchingCandidateCard, viewerHandle: string, lang: Lang, compactFriendship = false): string {
  const t = messages(lang);
  const topics = card.disclosure.topics;
  const prompt = topics.length
    ? icebreaker(topics, lang)
    : card.disclosure.channel
      ? t.matchesIcebreakerChannel(card.disclosure.channel)
      : t.matchesIcebreakerGeneric;
  const icons = compactFriendship && !card.topicMatch ? friendshipIcons(card, t) : '';
  return `<article class="mt-card"${icons ? ` data-compact-friendship="${card.relationship.status}"` : ''}${card.topicMatch ? ` data-compatibility="${card.comparisonReady === false || !Number.isFinite(card.matchPercent) ? -1 : card.matchPercent}"` : ''}>
    ${icons}
    <div class="mt-person"><a class="mt-person-link" href="/${html(card.handle)}"><img class="mt-avatar" src="/avatar/member/${html(card.handle)}" alt="" width="54" height="54" loading="lazy"><div><h2>${html(card.displayName)}</h2>${card.topicMatch ? '' : `<div class="mt-percent">${card.comparisonReady === false ? '—' : `${card.matchPercent}%`}<small>${t.matchesFit}</small></div>`}</div></a></div>
    <div class="mt-clues">
      ${topics.length ? `<div><span class="mt-clue-label">${t.matchesSharedTopics}</span><div class="mt-pills">${topics.map((topic) => `<span class="mt-pill">${html(topic)}</span>`).join('')}</div></div>` : ''}
      ${card.disclosure.channel ? `<div><span class="mt-clue-label">${t.matchesSharedChannel}</span><span class="mt-channel">${html(card.disclosure.channel)}</span></div>` : ''}
    </div>
    ${card.topicMatch ? (card.targetPublic || card.relationship.status === 'connected' ? `<div class="mt-actions"><a class="mt-want" href="/${html(viewerHandle)}/compare/${html(card.handle)}">${html(t.memberProfileBlend)}</a></div>` : '') : `<p class="mt-icebreaker">${html(prompt)}</p>
    <div class="mt-actions">${compactFriendship ? (card.targetPublic || card.relationship.status === 'connected' ? `<a class="mt-want" href="/${html(viewerHandle)}/compare/${html(card.handle)}">${html(t.memberProfileBlend)}</a>` : '') : friendshipActions(card, viewerHandle, t, '/matches')}</div>`}
  </article>`;
}

function interestPills(items: string[]): string {
  return `<div class="mt-pills">${items.map((item) => `<span class="mt-pill">${html(item)}</span>`).join('')}</div>`;
}

function metric(label: string, percentage: number | null): string {
  if (percentage === null) return '';
  return `<div class="mt-metric"><span>${html(label)}</span><div class="mt-meter" aria-hidden="true"><i style="width:${percentage}%"></i></div><strong>${percentage}%</strong></div>`;
}

const COMPARISON_PREVIEW_ROWS = 6;

export type ComparisonMetric = 'seconds' | 'watches';
export const COMPARISON_METRICS: readonly ComparisonMetric[] = ['seconds', 'watches'];

function count(value: number): string {
  return new Intl.NumberFormat('en').format(value);
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function taipeiDate(iso: string, t: Messages): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const local = new Date(time + 8 * 3600_000);
  return t.fullDate(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate());
}

function metricValue(metric: ComparisonMetric, value: number, t: Messages): string {
  return metric === 'seconds' ? hours(value) : t.matchesTimes(value);
}

function rankCell(
  measure: CommonMeasure,
  side: 'a' | 'b',
  metric: ComparisonMetric,
  showValue: boolean,
  name: string,
  t: Messages,
): string {
  return `<span class="mt-rank" aria-label="${html(t.matchesRankFor(name))}"><b>#${measure.rank[side]}</b>${showValue ? `<small>${html(metricValue(metric, measure.value[side], t))}</small>` : ''}</span>`;
}

// One panel per metric; the page-level toggle shows one at a time. Rows are
// re-sorted by that metric's blend so both people always see the same order.
function metricPanels(render: (metric: ComparisonMetric) => string): string {
  return COMPARISON_METRICS.map((metric) =>
    `<div data-metric-panel="${metric}"${metric === 'seconds' ? '' : ' hidden'}>${render(metric)}</div>`).join('');
}

function sortedBy<T extends CommonItemMeasures>(items: T[], metric: ComparisonMetric): T[] {
  return [...items].sort((x, y) => y[metric].blend - x[metric].blend
    || (x[metric].rank.a + x[metric].rank.b) - (y[metric].rank.a + y[metric].rank.b));
}

// Six rows stay visible; the rest fold into a native disclosure so the page
// needs no script to behave like stats.fm's "show more".
function foldedRows(rows: string[], t: Messages): string {
  const visible = rows.slice(0, COMPARISON_PREVIEW_ROWS).join('');
  const rest = rows.slice(COMPARISON_PREVIEW_ROWS);
  if (!rest.length) return `<div class="mt-rows">${visible}</div>`;
  return `<div class="mt-rows">${visible}</div><details class="mt-more"><summary><span class="mt-show-more">${html(t.matchesShowMore(rest.length))}</span><span class="mt-show-less">${html(t.matchesShowLess)}</span></summary><div class="mt-rows">${rest.join('')}</div></details>`;
}

function listSection<T extends CommonItemMeasures>(
  title: string,
  subtitle: string,
  list: ComparisonList<T>,
  row: (item: T, metric: ComparisonMetric) => string,
  t: Messages,
  // Topics stay visible (bounded, ranks only) while locked; channels and
  // videos do not.
  previewWhileLocked = false,
): string {
  let body: string;
  if (list.state === 'locked' && !previewWhileLocked) {
    body = `<p class="mt-gate mt-gate-locked">${t.matchesUnlockNote}</p>`;
  } else if (!list.items.length) {
    body = `<p class="mt-gate">${t.matchesNothingInCommon}</p>`;
  } else {
    body = metricPanels((metric) => foldedRows(sortedBy(list.items, metric).map((item) => row(item, metric)), t));
  }
  return `<section class="mt-panel"><div class="mt-panel-head"><h2>${html(title)}</h2><span>${html(subtitle)}</span></div>${body}</section>`;
}

function topicRow(names: ComparisonPair<string>, t: Messages) {
  return (topic: CommonTopic, metric: ComparisonMetric) =>
    `<div class="mt-row">${rankCell(topic[metric], 'a', metric, topic.valuesVisible, names.a, t)}<div class="mt-row-main"><strong>${html(topic.name)}</strong></div>${rankCell(topic[metric], 'b', metric, topic.valuesVisible, names.b, t)}</div>`;
}

// Channels keyed by a YouTube channel id open the urtube channel page;
// name-only keys (older capture rows) fall back to a YouTube search.
export function channelHref(channel: { key: string; name: string }): string {
  return YOUTUBE_CHANNEL_ID_PATTERN.test(channel.key)
    ? `/channel/${channel.key}`
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(channel.name)}`;
}

function channelRow(names: ComparisonPair<string>, t: Messages) {
  return (channel: CommonChannel, metric: ComparisonMetric) => {
    const avatar = channel.thumbnailUrl
      ? `<img src="${html(channel.thumbnailUrl)}" alt="" loading="lazy" width="36" height="36">`
      : `<span class="mt-row-avatar" aria-hidden="true">${html([...channel.name][0] ?? '?')}</span>`;
    const href = channelHref(channel);
    const linkedAvatar = href.startsWith('/')
      ? `<a class="mt-channel-avatar-link" href="${html(href)}" data-channel-preview tabindex="-1" aria-hidden="true">${avatar}</a>`
      : avatar;
    return `<div class="mt-row">${rankCell(channel[metric], 'a', metric, true, names.a, t)}<div class="mt-row-main">${linkedAvatar}<strong><a href="${html(href)}"${href.startsWith('/') ? ' data-channel-preview aria-haspopup="dialog"' : ' rel="noopener" target="_blank"'}>${html(channel.name)}</a></strong></div>${rankCell(channel[metric], 'b', metric, true, names.b, t)}</div>`;
  };
}

function videoRow(names: ComparisonPair<string>, t: Messages) {
  return (video: CommonVideo, metric: ComparisonMetric) => {
    const thumb = video.thumbnailUrl
      ? `<img class="mt-thumb" src="${html(video.thumbnailUrl)}" alt="" loading="lazy" width="64" height="36">`
      : `<span class="mt-thumb" aria-hidden="true"></span>`;
    return `<div class="mt-row">${rankCell(video[metric], 'a', metric, true, names.a, t)}<div class="mt-row-main">${thumb}<div><strong><a href="https://www.youtube.com/watch?v=${html(video.videoId)}" rel="noopener" target="_blank">${html(video.title)}</a></strong>${video.channelTitle ? `<small>${html(video.channelTitle)}</small>` : ''}</div></div>${rankCell(video[metric], 'b', metric, true, names.b, t)}</div>`;
  };
}

function statsSection(comparison: WatchComparison, t: Messages): string {
  if (!comparison.stats) {
    return `<section class="mt-panel mt-locked"><div class="mt-panel-head"><h2>${t.matchesWatchStats}</h2></div><p class="mt-gate mt-gate-locked">${t.matchesUnlockNote}</p></section>`;
  }
  const rows = comparison.stats.map((row) => `<div class="mt-stat-row"><strong>${count(row.a)}</strong><span>${html(t.matchesStat[row.key] ?? row.key)}</span><strong>${count(row.b)}</strong></div>`).join('');
  return `<section class="mt-panel"><div class="mt-panel-head"><h2>${t.matchesWatchStats}</h2></div><div class="mt-stats">${rows}</div></section>`;
}

function clockSection(comparison: WatchComparison, names: ComparisonPair<string>, t: Messages, lang: Lang): string {
  const share = comparison.clock.mode === 'share';
  const figure = (side: 'a' | 'b', metric: ComparisonMetric) => {
    const data = comparison.clock[side];
    if (!data.reliable) return `<div class="mt-clock-empty"><span>${html(names[side])}</span><p>${side === 'a' ? t.matchesClockUnreliable : t.matchesClockOtherUnreliable}</p>${side === 'a' ? `<div class="mt-actions"><a class="mt-secondary-link" href="/account?lang=${lang}#account-takeout">${t.matchesClockImport}</a></div>` : ''}</div>`;
    const values = metric === 'watches' ? data.watches : data.seconds;
    const tip = (_hour: number, value: number) => {
      if (share) return metric === 'watches' ? t.matchesClockShare(percent(value)) : t.matchesClockShareTime(percent(value));
      return metric === 'watches' ? t.tipVideos(value) : hours(value);
    };
    return radialClock(values, names[side], t.rhythmAria(names[side]), tip);
  };
  return `<section class="mt-panel"><div class="mt-panel-head"><div class="mt-panel-title"><h2>${t.matchesClock}</h2><span>${t.matchesClockSub}</span></div></div>
    ${metricPanels((metric) => `<div class="mt-clocks">${figure('a', metric)}${figure('b', metric)}</div>`)}
    ${share ? `<p class="mt-gate">${t.matchesShareMode}</p>` : ''}
  </section>`;
}

function weekdaySection(comparison: WatchComparison, t: Messages): string {
  const share = comparison.weekdays.mode === 'share';
  const rowsFor = (metric: ComparisonMetric) => {
    const pick = (row: WatchComparison['weekdays']['rows'][number], side: 'a' | 'b') =>
      metric === 'watches' ? row.watches[side] : row.seconds[side];
    const max = Math.max(1e-9, ...comparison.weekdays.rows.flatMap((row) => [pick(row, 'a'), pick(row, 'b')]));
    const label = (value: number) => (share ? percent(value) : metricValue(metric, Math.round(value * 10) / 10, t));
    const bar = (side: 'a' | 'b', row: WatchComparison['weekdays']['rows'][number]) => {
      const value = pick(row, side);
      return `<div class="mt-bar mt-bar-${side}" data-tip="${html(label(value))}" tabindex="0"><i style="width:${Math.round(value / max * 100)}%"></i><b>${html(label(value))}</b></div>`;
    };
    const subtitle = share
      ? metric === 'seconds' ? t.matchesWeekdaysShareTime : t.matchesWeekdaysShareWatches
      : metric === 'seconds' ? t.matchesWeekdaysTime : t.matchesWeekdaysWatches;
    return `<p class="mt-week-sub">${html(subtitle)}</p><div class="mt-week">${comparison.weekdays.rows.map((row) => `<div class="mt-week-row">${bar('a', row)}<span>${html(t.matchesWeekdayNames[row.weekday] ?? '')}</span>${bar('b', row)}</div>`).join('')}</div>`;
  };
  return `<section class="mt-panel"><div class="mt-panel-head"><div class="mt-panel-title"><h2>${t.matchesWeekdays}</h2></div></div>${metricPanels(rowsFor)}<p class="mt-gate mt-week-note">${html(share ? t.matchesShareMode : t.matchesWeekdaysAverageNote)}</p></section>`;
}

function edgeSection(
  title: string,
  edges: ComparisonPair<ComparisonWatchEdge | null>,
  names: ComparisonPair<string>,
  t: Messages,
): string {
  const row = (side: 'a' | 'b') => {
    const edge = edges[side];
    return `<div class="mt-edge"><span class="mt-side-label">${html(names[side])}</span>${edge ? `<strong>${html(edge.title)}</strong><small>${html(taipeiDate(edge.watchedAt, t))}</small>` : `<small>${t.matchesNoHistory}</small>`}</div>`;
  };
  return `<section class="mt-panel"><div class="mt-panel-head"><h2>${html(title)}</h2></div><div class="mt-edges">${row('a')}${row('b')}</div></section>`;
}

// The single page-level metric switch. Panels for both metrics are in the
// HTML, so switching is instant and needs no request; the choice persists
// in the query string of the range links and in localStorage.
export const metricScript = `(()=>{const buttons=[...document.querySelectorAll('[data-metric]')];const panels=[...document.querySelectorAll('[data-metric-panel]')];const links=[...document.querySelectorAll('.mt-range a, .mt-profile-link, .mp-blend')];const valid=['seconds','watches'];const fromQuery=new URLSearchParams(location.search).get('metric');let stored=null;try{stored=localStorage.getItem('urtube-compare-metric')}catch{}const apply=(metric)=>{if(!valid.includes(metric))metric='seconds';for(const b of buttons)b.setAttribute('aria-pressed',String(b.dataset.metric===metric));for(const p of panels)p.hidden=p.dataset.metricPanel!==metric;for(const a of links){const u=new URL(a.getAttribute('href'),location.href);u.searchParams.set('metric',metric);a.setAttribute('href',u.pathname+u.search)}try{localStorage.setItem('urtube-compare-metric',metric)}catch{}};for(const b of buttons)b.addEventListener('click',()=>apply(b.dataset.metric));apply(fromQuery||stored||'seconds');})();`;

export function matchingCandidatePage(
  viewer: { handle: string; displayName: string },
  dashboardHref: string,
  card: ActionableMatchingCandidateCard,
  comparison: WatchComparison,
  lang: Lang = 'en',
  languageHref = `/${viewer.handle}/compare/${card.handle}?lang=${lang === 'zh' ? 'en' : 'zh'}`,
): string {
  const viewerName = viewer.displayName;
  const t = messages(lang);
  const connected = comparison.connected;
  const names: ComparisonPair<string> = { a: viewerName, b: card.displayName };
  const viewerInterests = card.viewerInterests.length
    ? interestPills(card.viewerInterests.slice(0, connected ? 5 : 3))
    : `<p>${t.matchesNoProfileTopics}</p>`;
  const candidateInterests = card.interests.length
    ? interestPills(card.interests.slice(0, connected ? 5 : 3))
    : `<p>${t.matchesNoProfileTopics}</p>`;
  const metrics = `${metric(t.matchesTopicFit, card.topicPercent)}${metric(t.matchesChannelFit, card.channelPercent)}`;
  const actions = friendshipActions(card, viewer.handle, t, `/${card.handle}`, false);
  const consentNote = card.targetPublic ? t.matchesPublicBlendNote : connected ? t.matchesConsentConnectedNote : t.matchesConsentPendingNote;
  const basePath = `/${html(viewer.handle)}/compare/${html(card.handle)}`;
  const ranges = `<nav class="yt-range mt-range" aria-label="${html(t.matchesRange)}">${COMPARISON_RANGES.map((range) =>
    `<a href="${basePath}?range=${range}"${range === comparison.range ? ' aria-current="page"' : ''}>${html(t.ranges[range] ?? range)}</a>`).join('')}</nav>`;
  const header = `<div class="mt-vs"><section class="mt-side"><span class="mt-side-label">${t.matchesYou}</span><a class="mt-profile-link" href="/${html(viewer.handle)}?range=${comparison.range}&lang=${lang}"><img src="/avatar/member/${html(viewer.handle)}" alt="" width="116" height="116"><h2>${html(viewerName)}</h2></a>${viewerInterests}</section><div class="mt-vs-center"><div class="mt-vs-score"><strong>${card.comparisonReady === false ? '—' : `${card.matchPercent}%`}</strong><span>${t.matchesFit}</span></div></div><section class="mt-side"><span class="mt-side-label">${t.matchesCandidate}</span><a class="mt-profile-link" href="/${html(card.handle)}?range=${comparison.range}&lang=${lang}"><img src="/avatar/member/${html(card.handle)}" alt="" width="116" height="116"><h2>${html(card.displayName)}</h2></a>${candidateInterests}</section></div>`;
  const gate = card.targetPublic ? '' : connected
    ? `<section class="mt-panel mt-unlock"><h2>${t.matchesUnlockedTitle}</h2><p>${t.matchesUnlockedPara}</p></section>`
    : `<section class="mt-panel mt-locked"><h2>${t.matchesLockedTitle}</h2><p>${t.matchesLockedPara}</p></section>`;
  const topicsSubtitle = comparison.topics.state === 'locked'
    ? t.matchesLockedTopics(COMPARISON_LOCKED_TOPIC_LIMIT)
    : t.matchesInCommon(comparison.topics.total, card.displayName);
  const sections = [
    statsSection(comparison, t),
    listSection(t.matchesCommonTopics, topicsSubtitle, comparison.topics, topicRow(names, t), t, true),
    listSection(t.matchesCommonChannels, comparison.channels.state === 'unlocked' ? t.matchesInCommon(comparison.channels.total, card.displayName) : '', comparison.channels, channelRow(names, t), t),
    listSection(t.matchesCommonShorts, comparison.shortsChannels.state === 'unlocked' ? t.matchesInCommon(comparison.shortsChannels.total, card.displayName) : '', comparison.shortsChannels, channelRow(names, t), t),
    listSection(t.matchesCommonVideos, comparison.videos.state === 'unlocked' ? t.matchesInCommon(comparison.videos.total, card.displayName) : '', comparison.videos, videoRow(names, t), t),
    clockSection(comparison, names, t, lang),
    weekdaySection(comparison, t),
    comparison.firstWatch ? edgeSection(t.matchesFirstWatch, comparison.firstWatch, names, t) : '',
    comparison.lastWatch ? edgeSection(t.matchesLastWatch, comparison.lastWatch, names, t) : '',
    `<section class="mt-panel"><h2>${t.matchesPercentBreakdown}</h2><div class="mt-metrics">${metrics}</div><p>${t.matchesFormulaNote}</p><p class="mt-version">${t.matchesFormulaVersion(card.percentageVersion)}</p></section>`,
  ].join('');
  const metricToggle = `<div class="mt-metric-bar"><div class="yt-metric-toggle" role="group" aria-label="${html(t.matchesMetric)}"><button type="button" data-metric="seconds" aria-pressed="true">${t.rhythmTime}</button><button type="button" data-metric="watches" aria-pressed="false">${t.rhythmWatches}</button></div><p class="mt-gate">${t.matchesBlendNote}</p></div>`;
  const body = `<style>${matchesStyles}${rhythmClockStyles}${comparisonStyles}</style><div class="mt-profile"><a class="mt-profile-back" href="/matches">← ${t.navMatches}</a>${header}<div class="mt-profile-actions">${actions}</div><p class="mt-consent-note">${html(consentNote)}</p>${ranges}${metricToggle}${gate}${sections}<div class="mt-privacy" style="margin-top:20px">${t.matchesProfilePrivacy}</div></div><script>${metricScript}</script>${channelPreviewDrawer(lang, comparison.range)}`;
  return shell(`${card.displayName} · ${t.navMatches}`, body, primaryNav(lang, {
    active: 'matches', dashboardHref, languageHref,
  }), '', lang);
}

const comparisonStyles = `
  .mt-profile-link{color:inherit;text-decoration:none}.mt-profile-link:hover h2{color:var(--accent-text)}
  .mt-profile{max-width:960px}.mt-profile .mt-profile-back{display:block;margin-inline:auto;text-align:center;width:fit-content}.mt-profile .mt-panel-head{justify-content:center;text-align:center}.mt-profile .mt-panel>h2,.mt-profile .mt-panel>p,.mt-profile .mt-privacy,.mt-profile .mt-more summary,.mt-profile .mt-edge{text-align:center}.mt-profile .mt-row-main{justify-content:center;text-align:center}.mt-profile .mt-metrics{margin-inline:auto;max-width:560px}.mt-range{flex-wrap:wrap;justify-content:center;margin:18px 0 6px}
  .mt-metric-bar{align-items:center;display:flex;flex-direction:column;gap:8px;margin:6px 0 16px;text-align:center}.mt-metric-bar .mt-gate{max-width:560px}[data-metric-panel][hidden]{display:none}
  .mt-consent-note{color:var(--muted);font-size:11px;margin:9px auto 14px;max-width:620px;text-align:center}
  .mt-panel-head{align-items:center;display:flex;flex-wrap:wrap;gap:6px 14px;justify-content:space-between;margin-bottom:14px}.mt-panel-head h2{margin:0}.mt-panel-head span{color:var(--muted);font-size:11px}.mt-panel-title{display:flex;flex-direction:column;gap:2px}
  .mt-gate{color:var(--muted);font-size:12px;line-height:1.6;margin:0}.mt-gate-locked{background:var(--raised);border-radius:10px;padding:12px 14px}
  .mt-stats{display:grid;gap:2px}.mt-stat-row{align-items:center;border-bottom:1px solid var(--line);display:grid;grid-template-columns:1fr auto 1fr;gap:12px;padding:9px 0}.mt-stat-row:last-child{border-bottom:0}.mt-stat-row strong{font-size:17px;font-variant-numeric:tabular-nums;font-weight:750;letter-spacing:-.02em}.mt-stat-row strong:last-child{text-align:right}.mt-stat-row span{color:var(--muted);font-size:11px;text-align:center}
  .mt-rows{display:grid;gap:2px}.mt-row{align-items:center;border-radius:10px;display:grid;gap:12px;grid-template-columns:64px minmax(0,1fr) 64px;padding:7px 6px}.mt-row:hover{background:var(--raised)}
  .mt-rank{display:flex;flex-direction:column;font-variant-numeric:tabular-nums;line-height:1.2}.mt-rank b{color:var(--accent-text);font-size:14px}.mt-rank small{color:var(--muted);font-size:10px}.mt-row>.mt-rank:last-child{align-items:flex-end;text-align:right}
  .mt-row-main{align-items:center;display:flex;gap:12px;min-width:0}.mt-row-main strong{display:block;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mt-row-main strong a{color:var(--ink);text-decoration:none}.mt-row-main strong a:hover{color:var(--accent-text)}.mt-row-main small{color:var(--muted);display:block;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mt-row-main>div{min-width:0}
  .mt-row-main img,.mt-row-avatar{background:var(--raised);border-radius:50%;color:var(--ink-2);display:grid;flex:0 0 36px;font-size:13px;font-weight:700;height:36px;object-fit:cover;place-items:center;width:36px}
  .mt-channel-avatar-link{flex:0 0 36px;text-decoration:none}
  .mt-thumb,.mt-row-main img.mt-thumb{border-radius:6px;flex:0 0 64px;height:36px;width:64px}
  .mt-more summary{color:var(--muted);cursor:pointer;font-size:12px;margin:8px 6px 4px}
  .mt-more{position:relative}.mt-more .mt-show-less,.mt-more[open] .mt-show-more{display:none}.mt-more[open] .mt-show-less{display:inline}.mt-more[open]{padding-bottom:44px}.mt-more[open]>summary{position:absolute;bottom:0;left:0;right:0}.mt-more summary{min-height:32px;align-content:center}.mt-more summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .mt-clocks{display:grid;gap:14px;grid-template-columns:repeat(2,minmax(0,1fr))}.mt-clocks .yt-rhythm-clock svg{max-width:300px}.mt-clock-empty{align-items:center;color:var(--muted);display:flex;flex-direction:column;font-size:12px;justify-content:center;min-height:200px;text-align:center}.mt-clock-empty span{color:var(--ink-2);font-weight:700}.mt-clock-empty[hidden]{display:none}
  .mt-week-sub{color:var(--muted);font-size:11px;margin:-8px 0 14px;text-align:center}.mt-week-note{margin:14px auto 0;max-width:620px}
  .mt-week{display:grid;gap:4px}.mt-week-row{align-items:center;display:grid;gap:10px;grid-template-columns:minmax(0,1fr) 80px minmax(0,1fr)}.mt-week-row>span{color:var(--muted);font-size:11px;text-align:center}
  .mt-bar{align-items:center;display:flex;gap:8px;min-width:0;outline:none}.mt-bar i{background:var(--accent);border-radius:999px;display:block;height:10px;min-width:2px;transition:width .2s}.mt-bar b{color:var(--ink-2);flex:0 0 auto;font-size:11px;font-variant-numeric:tabular-nums;font-weight:650}.mt-bar-a{flex-direction:row-reverse}.mt-bar-b i{background:var(--blue)}
  .mt-edges{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}.mt-edge{background:var(--raised);border-radius:10px;padding:12px 14px}.mt-edge strong{display:block;font-size:13px;margin:4px 0 2px}.mt-edge small{color:var(--muted);font-size:11px}
  @media(max-width:620px){.mt-row{grid-template-columns:48px minmax(0,1fr) 48px;gap:8px}.mt-week-row{grid-template-columns:minmax(0,1fr) 64px minmax(0,1fr)}.mt-stat-row strong{font-size:14px}.mt-clocks{gap:6px}}
`;

function cohortSection(recommendations: CohortRecommendations, lang: Lang): string {
  if (!recommendations.topics.length && !recommendations.channels.length) return '';
  const t = messages(lang);
  const group = (label: string, items: string[]) => items.length
    ? `<div class="mt-cohort-group"><strong>${label}</strong><div class="mt-pills">${items.map((item) => `<span class="mt-pill">${html(item)}</span>`).join('')}</div></div>`
    : '';
  return `<section class="mt-cohort"><h2>${t.matchesCohortTitle}</h2><p>${t.matchesCohortPara}</p><div class="mt-cohort-groups">${group(t.matchesCohortTopics, recommendations.topics)}${group(t.matchesCohortChannels, recommendations.channels)}</div></section>`;
}

export function matchesPage(
  viewer: { handle: string; displayName: string },
  dashboardHref: string,
  state: MatchesPageState,
  lang: Lang = 'en',
  provisional = false,
  recommendations: CohortRecommendations = { topics: [], channels: [] },
  languageHref = `/matches?lang=${lang === 'zh' ? 'en' : 'zh'}`,
  workspace?: { admin: boolean; invitations: string },
): string {
  const t = messages(lang);
  let content: string;
  if (state.kind === 'opt_in_required') {
    content = `<section class="mt-empty"><h2>${t.matchesOptInTitle}</h2><p>${t.matchesOptInPara}</p><a href="/account">${t.matchesSettings}</a></section>`;
  } else if (state.kind === 'data_pending') {
    content = `<section class="mt-empty" data-processing-status><h2>${t.matchesPendingTitle}</h2><p>${t.matchesPendingPara}</p><a href="${html(dashboardHref)}">${t.navDashboard}</a></section>`;
  } else if (state.kind === 'empty') {
    content = `<section class="mt-empty"><h2>${t.matchesEmptyTitle}</h2><p>${t.matchesEmptyPara}</p><a href="/signup">${t.matchesInvite}</a></section>`;
  } else {
    const { batch } = state;
    content = `<div class="mt-grid">${batch.cards.map((card) => candidateCard(card, viewer.handle, lang, true)).join('')}</div>
      <nav class="mt-pagination" aria-label="${html(t.matchesPages)}">
        ${batch.hasPrevious ? `<a href="/matches?page=${batch.page - 1}">${t.matchesPrevious}</a>` : ''}
        <span class="mt-page">${t.matchesPage(batch.page)}</span>
        ${batch.hasNext ? `<a href="/matches?page=${batch.page + 1}">${t.matchesNext}</a>` : ''}
      </nav>`;
  }
  content += cohortSection(recommendations, lang);
  if (workspace) content = matchingWorkspace(content, workspace.invitations, workspace.admin, lang);
  const body = `<style>${matchesStyles}</style><section class="mt-intro"><div class="eyebrow">${t.matchesEyebrow}</div><h1>${t.matchesTitle}</h1><p>${t.matchesPara(html(viewer.displayName))}</p></section><div class="mt-privacy">${t.matchesPrivacy}</div>${provisional ? `<div class="mt-provisional">${t.matchesProvisional}</div>` : ''}${content}`;
  return shell(t.matchesTitle, body, primaryNav(lang, {
    active: 'matches', dashboardHref, languageHref,
  }), '', lang);
}
