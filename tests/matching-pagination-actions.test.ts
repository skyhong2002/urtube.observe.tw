import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { load } from 'cheerio';
import test from 'node:test';
import { createApp } from '../src/index.js';
import { UserRegistry } from '../src/users.js';
import { settings } from '../src/matching-v3/model.js';
import type { Compute } from '../src/matching-v3/compute.js';
import { MATCHING_CANDIDATE_PAGE_SIZE } from '../src/youtube/candidates.js';

// More synthetic members than one directory page holds.
function directory() {
  const registry = new UserRegistry(':memory:');
  const viewer = registry.createUser('page-viewer', 'Viewer');
  registry.setMatchingOptIn(viewer.handle, true);
  for (let i = 0; i < MATCHING_CANDIDATE_PAGE_SIZE + 5; i++) {
    const member = registry.createUser(`page-member-${String(i).padStart(2, '0')}`, `Member ${i}`);
    registry.setMatchingOptIn(member.handle, true);
  }
  // No member has a profile yet, so the directory never compares.
  const compute: Compute = { cluster: async () => { throw new Error('unused'); }, compare: async () => { throw new Error('unused'); } };
  const app = createApp(registry, { matchingV3: { settings: settings({ MATCHING_V3_ENABLED: 'true' }), compute } });
  const headers = { cookie: `urtube_session=${registry.createSession(viewer)}`, origin: 'http://localhost:3000' };
  const form = { ...headers, 'content-type': 'application/x-www-form-urlencoded' };
  return { registry, app, headers, form };
}

test('friendship actions on directory page 2 return to page 2 with the updated card', async () => {
  const { registry, app, headers, form } = directory();
  try {
    const page = load(await (await app.request('/matches?page=2&lang=zh', { headers })).text());
    const card = page('#mv-directory .mt-card').first();
    const href = card.find('.mt-person-link').attr('href');
    assert.ok(href);
    assert.equal(card.find('[name=returnTo]').attr('value'), '/matches?page=2', 'no-JS forms keep the page too');
    const sent = await app.request('/matches/request', { method: 'POST', headers: form,
      body: new URLSearchParams({ actionToken: card.find('[name=actionToken]').attr('value')!, returnTo: '/matches?page=2' }) });
    assert.equal(sent.status, 302);
    assert.equal(sent.headers.get('location'), '/matches?page=2');
    const after = load(await (await app.request(sent.headers.get('location')!, { headers })).text());
    const updated = after(`#mv-directory .mt-card:has(.mt-person-link[href="${href}"])`);
    assert.equal(updated.length, 1);
    assert.equal(updated.find('form').attr('action'), '/matches/withdraw');
    // Only the matches directory and its numbered pages are accepted destinations.
    for (const returnTo of ['/matches?page=0', '/matches?page=2&x=1', '//evil.example/matches?page=2', '/matches?page=99999']) {
      const response = await app.request('/matches/withdraw', { method: 'POST', headers: form,
        body: new URLSearchParams({ requestToken: updated.find('[name=requestToken]').attr('value')!, actionToken: updated.find('[name=actionToken]').attr('value')!, returnTo }) });
      assert.notEqual(response.headers.get('location'), returnTo, returnTo);
    }
  } finally { registry.close(); }
});

test('the AJAX friendship handler asks for the page being viewed and updates that card in place', async () => {
  const source = readFileSync(new URL('../src/matching-v3/client.js', import.meta.url), 'utf8');
  const handlerSource = source.slice(source.indexOf('let friendshipPending'));
  const node = (attrs: Record<string, string> = {}, children: Record<string, any> = {}): any => ({
    attrs, children, replacedWith: null as any, disabled: false, focused: false, textContent: '',
    getAttribute(name: string) { return this.attrs[name] ?? null; },
    setAttribute(name: string, value: string) { this.attrs[name] = value; },
    querySelector(selector: string) { return this.children[selector] ?? null; },
    querySelectorAll(selector: string) { return this.children[selector] ?? []; },
    closest(selector: string) { return this.children[`closest:${selector}`] ?? null; },
    replaceWith(next: any) { this.replacedWith = next; },
    replaceChildren() {}, prepend() {}, focus() { this.focused = true; },
  });
  const card = (href: string, state: string) => node({ state }, { '.mt-person-link': node({ href }) });
  const current = card('/page-member-21', 'none');
  const fresh = card('/page-member-21', 'sent');
  const html = '<returned page 2>';
  let listener: ((event: any) => Promise<void>) | undefined;
  let requested: { path: string; body: URLSearchParams } | undefined;
  class HTMLFormElement {}
  const form = Object.assign(new HTMLFormElement(), {
    action: 'http://localhost:3000/matches/request',
    closest: (selector: string) => selector === '.mv-workspace' ? {} : selector === '.mt-card' ? current : null,
  });
  const nodes: Record<string, any> = {
    'mv-directory': node({}, { '.mt-card': [current] }), 'mv-invitations': node(), 'mv-invites': node(),
  };
  const context: any = {
    HTMLFormElement, URL, URLSearchParams, lang: 'zh', $: (id: string) => nodes[id],
    location: { href: 'http://localhost:3000/matches?page=2&view=all' },
    window: {},
    FormData: class { constructor(public form: unknown) {} *[Symbol.iterator]() { yield ['actionToken', 'opaque']; yield ['returnTo', '/matches']; } },
    element: () => node(),
    fetch: async (path: string, init: { body: URLSearchParams }) => {
      requested = { path, body: init.body };
      return { ok: true, url: `http://localhost:3000${init.body.get('returnTo')}`, text: async () => html };
    },
    DOMParser: class { parseFromString(text: string) {
      assert.equal(text, html);
      return { getElementById: (id: string) => id === 'mv-directory' ? node({}, { '.mt-card': [fresh] }) : id === 'mv-invitations' ? node() : null };
    } },
    document: {
      addEventListener: (_: string, fn: (event: any) => Promise<void>) => { listener = fn; },
      querySelector: (selector: string) => selector === '.mv-detail' ? node() : null,
      querySelectorAll: () => [],
      importNode: (value: any) => value,
    },
  };
  runInNewContext(handlerSource, context);
  await listener!({ target: form, submitter: null, preventDefault() {} });
  assert.equal(requested?.path, '/matches/request');
  assert.equal(requested?.body.get('returnTo'), '/matches?page=2');
  assert.equal(current.replacedWith, fresh);
});
