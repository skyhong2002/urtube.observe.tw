import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from 'cheerio';
import { createApp } from '../src/index.js';
import { config } from '../src/config.js';
import { accountPage, type AccountPageState } from '../src/output/onboarding.js';
import { UserRegistry } from '../src/users.js';

test('settings feedback reports current saved choices in both languages without changing privacy defaults', () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('settings-feedback', 'Fixture');
    assert.equal(user.dashboardPublic, false);
    assert.equal(user.matchingOptIn, false);
    for (const enabled of [false, true]) {
      registry.setDashboardPublic(user.handle, enabled);
      registry.setMatchingPreferences(user.handle, enabled, 'topics_and_channel', true);
      registry.setReferenceOptIn(user.handle, enabled);
      const current = registry.userByHandle(user.handle)!;
      for (const [updated, field, english] of [
        ['visibility', 'dashboardPublic', enabled ? 'currently public' : 'currently private'],
        ['matching', 'matchingOptIn', enabled ? 'currently on' : 'currently off'],
        ['reference', 'referenceOptIn', enabled ? 'currently contribute' : 'currently do not contribute'],
      ] as const) {
        for (const lang of ['en', 'zh'] as const) {
          const page = load(accountPage(current, { updated }, lang));
          assert.ok(page('#settings-privacy').is('[open]'));
          assert.equal(page(`#settings-privacy [name=${field}]`).is('[checked]'), enabled);
          assert.ok(page('#settings-feedback').text().includes(lang === 'en' ? english : '目前'));
          assert.equal(page('#settings-feedback').attr('role'), 'status');
          assert.equal(page('#settings-feedback').attr('tabindex'), '-1');
        }
      }
    }
    for (const updated of [undefined, '<img onerror=alert(1)>']) {
      const page = load(accountPage(user, { updated } as AccountPageState));
      assert.equal(page('#settings-feedback').length, 0);
      assert.equal(page('#settings-privacy').is('[open]'), false);
      assert.equal(page('[onerror]').length, 0);
    }
  } finally { registry.close(); }
});

test('settings writes return to the expanded section and show persisted values in both languages', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('settings-feedback', 'Fixture');
    const cookie = `urtube_session=${registry.createSession(user)}`;
    const app = createApp(registry);
    for (const [route, key, field] of [['visibility', 'visibility', 'dashboardPublic'], ['matching', 'matching', 'matchingOptIn'], ['reference-population', 'reference', 'referenceOptIn']]) {
      for (const enabled of [true, false]) {
        const response = await app.request(`/account/${route}?lang=zh`, { method: 'POST', headers: { cookie, origin: new URL(config.publicBaseUrl).origin,
          'content-type': 'application/x-www-form-urlencoded' }, body: enabled ? `${field}=1` : '' });
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), `/account?updated=${key}&lang=zh#settings-privacy`);
        const page = load(await (await app.request(response.headers.get('location')!.split('#')[0], { headers: { cookie } })).text());
        assert.ok(page('#settings-privacy').is('[open]'));
        assert.equal(page(`#settings-privacy [name=${field}]`).is('[checked]'), enabled);
        assert.ok(page('#settings-feedback').text().includes('目前'));
        assert.equal(page('#settings-feedback').attr('role'), 'status');
        const english = load(await (await app.request(`/account?updated=${key}&lang=en`, { headers: { cookie } })).text());
        assert.match(english('#settings-feedback').text(), /currently/);
      }
    }
    // The URL only selects the notice; actual settings always come from storage.
    registry.setDashboardPublic(user.handle, false);
    const current = load(await (await app.request('/account?updated=visibility&lang=en', { headers: { cookie } })).text());
    assert.match(current('#settings-feedback').text(), /currently private/);
    const ordinary = await (await app.request('/account?updated=unknown', { headers: { cookie } })).text();
    assert.doesNotMatch(ordinary, /id="settings-feedback"/);
    assert.equal((await app.request('/account?updated=visibility')).status, 302);
  } finally { registry.close(); }
});
