import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from 'cheerio';
import { candidateCard, type ActionableMatchingCandidateCard } from '../src/output/matches.js';
import type { MatchRelationship } from '../src/users.js';

const base: ActionableMatchingCandidateCard = {
  candidateUserId: 2, handle: 'icon-friend', displayName: 'Friend <script>', matchPercent: 65,
  topicPercent: 65, channelPercent: null, method: 'topics', percentageVersion: 'calibrated-v2',
  viewerInterests: [], interests: [], sharedInterests: [], disclosure: { topics: [] },
  actionToken: 'opaque-action-token', relationship: { status: 'none' },
};

test('directory friendship icons keep accessible names and correct POST actions in every relationship state', () => {
  const cases: { relationship: MatchRelationship; action: string; labels: string[] }[] = [
    { relationship: { status: 'none' }, action: 'request', labels: ['加好友'] },
    { relationship: { status: 'sent', requestToken: 'sent-token' }, action: 'withdraw', labels: ['已送出好友邀請 · 取消好友邀請'] },
    { relationship: { status: 'connected', requestToken: 'friend-token' }, action: 'withdraw', labels: ['取消好友關係'] },
    { relationship: { status: 'incoming', requestToken: 'incoming-token' }, action: 'respond', labels: ['接受好友邀請', '拒絕'] },
  ];
  for (const { relationship, action, labels } of cases) {
    const $ = load(candidateCard({ ...base, relationship }, 'viewer', 'zh', true));
    const tools = $('[data-friendship-tools]');
    assert.equal(tools.find('form').attr('method'), 'post');
    assert.equal(tools.find('form').attr('action'), `/matches/${action}`);
    assert.deepEqual(tools.find('button').toArray().map(el => $(el).attr('aria-label')), labels);
    for (const el of tools.find('button').toArray()) {
      assert.equal($(el).attr('title'), $(el).attr('aria-label'));
      assert.equal($(el).find('svg[aria-hidden="true"]').length, 1);
      assert.equal($(el).text(), $(el).attr('aria-label'));
    }
    assert.equal(tools.find('[name=actionToken]').attr('value'), base.actionToken);
    assert.equal(tools.find('[name=returnTo]').attr('value'), '/matches');
    if (relationship.status !== 'none') assert.equal(tools.find('[name=requestToken]').attr('value'), relationship.requestToken);
    if (relationship.status === 'incoming') assert.deepEqual(tools.find('[name=response]').toArray().map(el => $(el).val()), ['accept', 'decline']);
    assert.equal($('.mt-actions form,.mt-actions button').length, 0);
    assert.equal($('.mt-actions a').length, relationship.status === 'connected' ? 1 : 0);
    assert.equal($('script').length, 0);
    assert.equal($('.mt-person-link').attr('href'), '/icon-friend');
    assert.match($('.mt-percent').text(), /65%/);
  }
});

test('public members keep direct Blend and eligible add-friend icon; invitation cards retain explicit decisions', () => {
  const publicCard = load(candidateCard({ ...base, targetPublic: true }, 'viewer', 'en', true));
  assert.equal(publicCard('[data-friendship-tools] button[aria-label="Add friend"]').length, 1);
  assert.equal(publicCard('.mt-actions a').attr('href'), '/viewer/compare/icon-friend');
  const noToken = load(candidateCard({ ...base, actionToken: undefined }, 'viewer', 'en', true));
  assert.equal(noToken('[data-friendship-tools]').length, 0);
  const invitation = load(candidateCard({ ...base, relationship: { status: 'incoming', requestToken: 'incoming' } }, 'viewer', 'en'));
  assert.equal(invitation('[data-friendship-tools]').length, 0);
  assert.equal(invitation('.mt-actions button[name=response]').length, 2);
  assert.ok(invitation('.mt-actions button[value=accept]').text().length > 0);
});
