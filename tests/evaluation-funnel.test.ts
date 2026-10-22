import assert from 'node:assert/strict';
import test from 'node:test';
import { FUNNEL_STEPS, formatFunnelReport, runSyntheticFunnel } from '../scripts/eval/funnel.js';

test('synthetic funnel completes signup through accepted invitation over the real app', async () => {
  const originalFetch = globalThis.fetch;
  const report = await runSyntheticFunnel({ users: 6, seed: 11 });
  assert.equal(globalThis.fetch, originalFetch, 'outbound fetch guard is restored');
  assert.deepEqual(report.users.filter((u) => u.failedAt).map((u) => `${u.handle}:${u.failedAt}:${u.failure}`), []);
  assert.deepEqual(report.steps.map((s) => s.step), [...FUNNEL_STEPS]);
  for (const step of report.steps) {
    assert.equal(step.succeeded, step.eligible, step.step);
    assert.ok(step.eligible > 0, `${step.step} was exercised`);
  }
  // Only even-indexed synthetic people invite; three communities x two people each.
  assert.equal(report.steps.find((s) => s.step === 'invite')!.eligible, 3);
  assert.equal(report.invitationAcceptanceRate, 1);
  assert.equal(report.topCandidateSameCommunityRate, 1);
  assert.equal(report.actionsToFirstValue.median, 7);
  assert.ok(report.timeToFirstValueMs.median !== null && report.timeToFirstValueMs.median >= 0);
  const text = formatFunnelReport(report);
  assert.match(text, /NOT measurements of real demand/);
  assert.match(text, /Long-term effects .* unverified/);
});

test('decline path keeps people unconnected and lowers the planted acceptance rate', async () => {
  const report = await runSyntheticFunnel({ users: 6, seed: 11, acceptPolicy: 'decline-all' });
  assert.deepEqual(report.users.filter((u) => u.failedAt).map((u) => u.failure), []);
  const accept = report.steps.find((s) => s.step === 'accept')!;
  assert.equal(accept.eligible, 3);
  assert.equal(accept.succeeded, 0);
  assert.equal(report.invitationAcceptanceRate, 0);
  assert.ok(report.users.filter((u) => u.invited).every((u) => u.invitationOutcome === 'declined'));
});
