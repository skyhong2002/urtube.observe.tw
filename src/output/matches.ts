import type { MatchingCandidateBatch, MatchingCandidateCard } from '../youtube/candidates.js';
import type { CohortRecommendations } from '../youtube/cohort-recommendations.js';
import type { MatchingInbox } from '../users.js';
import { messages, type Lang } from './i18n.js';
import { html, primaryNav, shell } from './pages.js';

export type MatchesPageState =
  | { kind: 'opt_in_required' }
  | { kind: 'data_pending' }
  | { kind: 'empty' }
  | { kind: 'ready'; batch: ActionableMatchingCandidateBatch };

export interface ActionableMatchingCandidateCard extends MatchingCandidateCard {
  actionToken: string;
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
  .mt-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);display:flex;flex-direction:column;min-height:290px;padding:20px}
  .mt-person{align-items:center;display:flex;gap:12px}.mt-avatar{background:linear-gradient(140deg,#e66767,#9b2b2b);border-radius:50%;display:block;flex:0 0 44px;height:44px;object-fit:cover;width:44px}.mt-person h2{font-size:17px;margin:0}.mt-strength{color:var(--accent-text);font-size:11px;font-weight:750;margin-top:2px}
  .mt-clues{display:grid;gap:9px;margin:20px 0 16px}.mt-clue-label{color:var(--muted);display:block;font-size:9px;font-weight:700;letter-spacing:.08em;margin-bottom:5px;text-transform:uppercase}.mt-pills{display:flex;flex-wrap:wrap;gap:6px}.mt-pill{border:1px solid var(--line-strong);border-radius:999px;color:var(--ink-2);font-size:11px;padding:3px 9px}.mt-channel{color:var(--ink-2);font-size:12px}
  .mt-icebreaker{color:var(--ink-2);font-size:12px;line-height:1.6;margin:auto 0 16px}.mt-actions{display:flex;gap:8px}.mt-actions button{border-radius:999px;font:inherit;font-size:12px;font-weight:700;padding:8px 12px}.mt-want{background:var(--accent);border:1px solid var(--accent);color:#fff}.mt-skip{background:transparent;border:1px solid var(--line-strong);color:var(--ink-2);cursor:pointer}
  .mt-pagination{align-items:center;display:flex;gap:9px;justify-content:center;margin-top:22px}.mt-pagination a{border:1px solid var(--line-strong);border-radius:999px;color:var(--ink-2);font-size:12px;font-weight:700;padding:8px 13px;text-decoration:none}.mt-page{color:var(--muted);font-size:11px}
  .mt-empty{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);max-width:620px;padding:26px}.mt-empty h2{font-size:18px;margin:0 0 8px}.mt-empty p{color:var(--ink-2);margin:0 0 16px}.mt-empty a{background:var(--accent);border-radius:999px;color:#fff;display:inline-block;font-size:13px;font-weight:700;padding:9px 15px;text-decoration:none}
  .mt-inbox{display:grid;gap:14px;margin-bottom:20px}.mt-inbox-section{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:20px}.mt-inbox-section h2{font-size:16px;margin:0 0 12px}.mt-inbox-list{display:grid;gap:10px}.mt-inbox-row{align-items:center;background:var(--raised);border-radius:10px;display:flex;gap:12px;justify-content:space-between;padding:12px 14px}.mt-inbox-copy{min-width:0}.mt-inbox-copy strong,.mt-inbox-copy span{display:block}.mt-inbox-copy span{color:var(--muted);font-size:11px;margin-top:2px}.mt-inbox-actions{display:flex;flex-wrap:wrap;gap:7px}.mt-inbox-actions button{border-radius:999px;cursor:pointer;font:inherit;font-size:11px;font-weight:700;padding:7px 10px}.mt-accept{background:var(--accent);border:1px solid var(--accent);color:#fff}.mt-secondary{background:transparent;border:1px solid var(--line-strong);color:var(--ink-2)}
  .mt-connections{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}.mt-connection{background:var(--raised);border-radius:10px;padding:15px}.mt-connection h3{font-size:15px;margin:0 0 7px}.mt-connection p{color:var(--ink-2);font-size:12px;line-height:1.6;margin:5px 0}.mt-contact{border-top:1px solid var(--line);font-weight:700;margin-top:11px!important;padding-top:10px}
`;

function icebreaker(topics: string[], lang: Lang): string {
  const t = messages(lang);
  return topics.length
    ? t.matchesIcebreakerTopics(topics.join(lang === 'zh' ? '、' : ' and '))
    : t.matchesIcebreakerGeneric;
}

function candidateCard(card: ActionableMatchingCandidateCard, lang: Lang): string {
  const t = messages(lang);
  const topics = card.disclosure.topics;
  const prompt = topics.length
    ? icebreaker(topics, lang)
    : card.disclosure.channel
      ? t.matchesIcebreakerChannel(card.disclosure.channel)
      : t.matchesIcebreakerGeneric;
  return `<article class="mt-card">
    <div class="mt-person"><img class="mt-avatar" src="/avatar/match/${html(card.actionToken)}" alt="" width="44" height="44" loading="lazy"><div><h2>${html(card.displayName)}</h2><div class="mt-strength">${html(t.matchStrength(card.similarity))}</div></div></div>
    <div class="mt-clues">
      ${topics.length ? `<div><span class="mt-clue-label">${t.matchesSharedTopics}</span><div class="mt-pills">${topics.map((topic) => `<span class="mt-pill">${html(topic)}</span>`).join('')}</div></div>` : ''}
      ${card.disclosure.channel ? `<div><span class="mt-clue-label">${t.matchesSharedChannel}</span><span class="mt-channel">${html(card.disclosure.channel)}</span></div>` : ''}
    </div>
    <p class="mt-icebreaker">${html(prompt)}</p>
    <div class="mt-actions"><form method="post" action="/matches/request"><input type="hidden" name="actionToken" value="${html(card.actionToken)}"><button class="mt-want" type="submit">${t.matchesWant}</button></form><button class="mt-skip" type="button">${t.matchesSkip}</button></div>
  </article>`;
}

function inboxSection(inbox: MatchingInbox, lang: Lang): string {
  const t = messages(lang);
  const incoming = inbox.incoming.length ? `<section class="mt-inbox-section"><h2>${t.matchesIncoming}</h2><div class="mt-inbox-list">${inbox.incoming.map((request) => `<div class="mt-inbox-row"><img class="mt-avatar" src="/avatar/request/${html(request.requestToken)}" alt="" width="44" height="44" loading="lazy"><div class="mt-inbox-copy"><strong>${html(request.displayName)}</strong><span>${html(request.topics.join(lang === 'zh' ? '、' : ', ') || t.matchesSharedGroundPrivate)}</span></div><div class="mt-inbox-actions"><form method="post" action="/matches/respond"><input type="hidden" name="requestToken" value="${html(request.requestToken)}"><button class="mt-accept" name="response" value="accept">${t.matchesAccept}</button><button class="mt-secondary" name="response" value="decline">${t.matchesDecline}</button></form><button class="mt-secondary mt-ignore" type="button">${t.matchesSkip}</button></div></div>`).join('')}</div></section>` : '';
  const sent = inbox.sent.length ? `<section class="mt-inbox-section"><h2>${t.matchesSent}</h2><div class="mt-inbox-list">${inbox.sent.map((request) => `<div class="mt-inbox-row"><img class="mt-avatar" src="/avatar/request/${html(request.requestToken)}" alt="" width="44" height="44" loading="lazy"><div class="mt-inbox-copy"><strong>${html(request.displayName)}</strong><span>${t.matchesAwaiting}</span></div><form method="post" action="/matches/withdraw"><input type="hidden" name="requestToken" value="${html(request.requestToken)}"><button class="mt-secondary" type="submit">${t.matchesWithdraw}</button></form></div>`).join('')}</div></section>` : '';
  const connections = inbox.connections.length ? `<section class="mt-inbox-section"><h2>${t.matchesConnections}</h2><div class="mt-connections">${inbox.connections.map((connection) => `<article class="mt-connection"><div class="mt-person"><img class="mt-avatar" src="/avatar/request/${html(connection.requestToken)}" alt="" width="44" height="44" loading="lazy"><h3>${html(connection.displayName)}</h3></div>${connection.introduction ? `<p>${html(connection.introduction)}</p>` : `<p>${t.matchesNoIntroduction}</p>`}<p>${html(icebreaker(connection.topics, lang))}</p>${connection.contact ? `<p class="mt-contact">${html(connection.contact)}</p>` : `<p class="mt-contact">${t.matchesNoContact}</p>`}<form method="post" action="/matches/withdraw"><input type="hidden" name="requestToken" value="${html(connection.requestToken)}"><button class="mt-secondary" type="submit">${t.matchesDisconnect}</button></form></article>`).join('')}</div></section>` : '';
  if (!incoming && !sent && !connections) return '';
  return `<div class="mt-inbox">${incoming}${sent}${connections}</div><script>(()=>{for(const button of document.querySelectorAll('.mt-ignore'))button.addEventListener('click',()=>button.closest('.mt-inbox-row')?.remove())})();</script>`;
}

function cohortSection(recommendations: CohortRecommendations, lang: Lang): string {
  if (!recommendations.topics.length && !recommendations.channels.length) return '';
  const t = messages(lang);
  const group = (label: string, items: string[]) => items.length
    ? `<div class="mt-cohort-group"><strong>${label}</strong><div class="mt-pills">${items.map((item) => `<span class="mt-pill">${html(item)}</span>`).join('')}</div></div>`
    : '';
  return `<section class="mt-cohort"><h2>${t.matchesCohortTitle}</h2><p>${t.matchesCohortPara}</p><div class="mt-cohort-groups">${group(t.matchesCohortTopics, recommendations.topics)}${group(t.matchesCohortChannels, recommendations.channels)}</div></section>`;
}

export function matchesPage(
  displayName: string,
  dashboardHref: string,
  state: MatchesPageState,
  lang: Lang = 'en',
  inbox: MatchingInbox = { incoming: [], sent: [], connections: [] },
  provisional = false,
  recommendations: CohortRecommendations = { topics: [], channels: [] },
  languageHref = `/matches?lang=${lang === 'zh' ? 'en' : 'zh'}`,
): string {
  const t = messages(lang);
  let content: string;
  if (state.kind === 'opt_in_required') {
    content = `<section class="mt-empty"><h2>${t.matchesOptInTitle}</h2><p>${t.matchesOptInPara}</p><a href="/account">${t.matchesSettings}</a></section>`;
  } else if (state.kind === 'data_pending') {
    content = `<section class="mt-empty"><h2>${t.matchesPendingTitle}</h2><p>${t.matchesPendingPara}</p><a href="${html(dashboardHref)}">${t.navDashboard}</a></section>`;
  } else if (state.kind === 'empty') {
    content = `<section class="mt-empty"><h2>${t.matchesEmptyTitle}</h2><p>${t.matchesEmptyPara}</p><a href="/signup">${t.matchesInvite}</a></section>`;
  } else {
    const { batch } = state;
    content = `<div class="mt-grid">${batch.cards.map((card) => candidateCard(card, lang)).join('')}</div>
      <p class="mt-empty" id="mt-batch-empty" hidden>${t.matchesBatchEmpty}</p>
      <nav class="mt-pagination" aria-label="${html(t.matchesPages)}">
        ${batch.hasPrevious ? `<a href="/matches?page=${batch.page - 1}">${t.matchesPrevious}</a>` : ''}
        <span class="mt-page">${t.matchesPage(batch.page)}</span>
        ${batch.hasNext ? `<a href="/matches?page=${batch.page + 1}">${t.matchesNext}</a>` : ''}
      </nav>
      <script>(()=>{const cards=[...document.querySelectorAll('.mt-card')];for(const card of cards){card.querySelector('.mt-skip')?.addEventListener('click',()=>{card.remove();if(!document.querySelector('.mt-card'))document.getElementById('mt-batch-empty').hidden=false})}})();</script>`;
  }
  const body = `<style>${matchesStyles}</style><section class="mt-intro"><div class="eyebrow">${t.matchesEyebrow}</div><h1>${t.matchesTitle}</h1><p>${t.matchesPara(html(displayName))}</p></section><div class="mt-privacy">${t.matchesPrivacy}</div>${provisional ? `<div class="mt-provisional">${t.matchesProvisional}</div>` : ''}${inboxSection(inbox, lang)}${cohortSection(recommendations, lang)}${content}`;
  return shell(t.matchesTitle, body, primaryNav(lang, {
    active: 'matches', dashboardHref, languageHref,
  }), '', lang);
}
