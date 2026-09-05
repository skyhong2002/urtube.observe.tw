import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/matching-v3/client.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
test('topic switches serialize requests, coalesce pending selections and discard stale results', async () => {
  const requests: { genres: string[]; resolve: (data: unknown) => void }[] = [];
  const rendered: unknown[] = [];
  const context: any = {
    t: (zh: string, _en: string) => zh,
    api: (_: string, __: string, body: { genres: string[] }) => new Promise(resolve => requests.push({ ...body, resolve })),
    renderMatches: (data: unknown) => rendered.push(data),
  };
  runInNewContext('let requestNumber = 0;\n' + source.slice(source.indexOf('let pendingMatch'), source.indexOf('function renderMatches')) + '\nglobalThis.queue = queueMatch; globalThis.leave = () => requestNumber++;', context);
  context.queue({ genres: ['Music'] }, {});
  context.queue({ genres: ['Sport'] }, {});
  context.queue({ genres: ['News'] }, {});
  assert.equal(requests.length, 1);
  requests[0].resolve({ old: true }); await tick();
  assert.equal(rendered.length, 0);
  assert.equal(requests.length, 2);
  assert.deepEqual(Array.from(requests[1].genres), ['News']);
  requests[1].resolve({ latest: true }); await tick();
  assert.deepEqual(rendered, [{ latest: true }]);
  context.queue({ genres: ['Sport'] }, {});
  context.queue({ genres: ['Music'] }, {});
  context.leave(); requests[2].resolve({ stale: true }); await tick();
  assert.equal(requests.length, 3);
  assert.equal(rendered.length, 1);
});

test('ranked cards label only the top three scored people and preserve Blend without debug percentages', () => {
  const cards = new Map<string, any>();
  for (const id of ['a', 'b', 'c', 'd', 'missing']) cards.set(id, {
    id, blend: true, badges: [] as unknown[],
    querySelector() { return { append: (badge: unknown) => this.badges.push(badge) }; },
  });
  const result: any = { children: [], replaceChildren() { this.children = []; }, append(child: unknown) { this.children.push(child); } };
  const context: any = {
    t: (zh: string, _en: string) => zh,
    lang: 'zh',
    element: (tag: string, text?: string, cls?: string) => ({ tag, text, cls, children: [] as unknown[], append(child: unknown) { this.children.push(child); } }),
    document: { createElement: () => ({ innerHTML: '', get content(): any { const id = this.innerHTML; return { querySelector: () => cards.get(id) }; } }) },
  };
  runInNewContext(source.slice(source.indexOf('function renderMatches'), source.indexOf('async function save')) + '\nglobalThis.render = renderMatches;', context);
  context.render({ candidates: [
    { memberHtml: 'a', score: .2 }, { memberHtml: 'missing', score: null },
    { memberHtml: 'b', score: .4 }, { memberHtml: 'c', score: .3 }, { memberHtml: 'd', score: .1 },
  ] }, result);
  assert.deepEqual(Array.from(result.children[0].children, (card: any) => card.id), ['b', 'c', 'a', 'd', 'missing']);
  for (const id of ['a', 'b', 'c']) assert.equal(cards.get(id).badges[0].text, '最佳拍檔');
  for (const id of ['d', 'missing']) assert.equal(cards.get(id).badges.length, 0);
  assert.ok([...cards.values()].every(card => card.blend));
  assert.ok(!JSON.stringify(result).includes('%'));
});
