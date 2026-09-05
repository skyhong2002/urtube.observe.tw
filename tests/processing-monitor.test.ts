import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { processingMonitorScript } from '../src/output/processing-monitor.js';

class Element {
  children: Element[] = [];
  ownText = '';
  hidden = false;
  disabled = false;
  open = false;
  max = 0;
  value = 0;
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  events: Record<string, () => unknown> = {};
  constructor(public tag = 'div') {}
  set textContent(value: string) { this.ownText = value; this.children = []; }
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join('\n'); }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.ownText = ''; this.children = children; }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  addEventListener(name: string, callback: () => unknown) { this.events[name] = callback; }
}

function fixture(initial: unknown) {
  const content = new Element(), connection = new Element(), button = new Element('button');
  const snapshot = new Element(), label = new Element();
  const page = new AbortController();
  const panel = { dataset: {}, querySelector: (selector: string) => selector === '[data-v3-snapshot]' ? snapshot : label };
  const root = { dataset: { lang: 'zh' }, closest: () => panel,
    querySelector: (selector: string) => selector === '[data-monitor-content]' ? content : selector === 'button' ? button : connection };
  const document = { hidden: false, currentScript: { previousElementSibling: root },
    createElement: (tag: string) => new Element(tag), createDocumentFragment: () => new Element('fragment'),
    events: {} as Record<string, () => void>, addEventListener(name: string, fn: () => void) { this.events[name] = fn; } };
  const requests: Array<{ url: string; options: { cache: string; signal: AbortSignal } }> = [];
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let id = 0, data = initial, status = 200;
  runInNewContext(processingMonitorScript, { document, window: { urtubePageController: page }, AbortController, Date,
    setTimeout(callback: () => void, delay: number) { timers.set(++id, { callback, delay }); return id; },
    clearTimeout(key: number) { timers.delete(key); },
    fetch: async (url: string, options: { cache: string; signal: AbortSignal }) => {
      requests.push({ url, options }); return { status, ok: status === 200, json: async () => data };
    },
  });
  return { content, connection, button, snapshot, label, panel, document, page, requests, timers,
    update(value: unknown, code = 200) { data = value; status = code; },
    async tick() { await new Promise(resolve => setImmediate(resolve)); },
  };
}
const data = {
  genres: ['Politic', 'Music', 'Sport', 'Education', 'Video gaming', 'Streaming', 'News', 'Podcast', 'channel type'],
  job: { state: 'failed', attempts: 3, retry_at: 0, error: '<img src=x onerror=bad()>',
    progress: { phase: 'embedding', processed: 15, total: 30, genre: 'Music' } },
  profile: { currentVersion: true, complete: false, processedVideos: 2000, totalVideos: 2000,
    builtAt: '2026-09-05T10:38:52Z', genres: { Music: { status: 'insufficient', videoCount: 42 } } },
};
function descendants(element: Element): Element[] { return [element, ...element.children.flatMap(descendants)]; }

test('personal monitor displays failed job details and category gaps without claiming active processing', async () => {
  const f = fixture(data); await f.tick();
  assert.match(f.label.textContent, /處理失敗，目前未在執行/);
  assert.match(f.content.textContent, /失敗次數：3/);
  assert.match(f.content.textContent, /最後回報階段：標籤向量/);
  assert.match(f.content.textContent, /15 \/ 30 tags/);
  assert.match(f.content.textContent, /2,000 \/ 2,000/);
  assert.match(f.content.textContent, /資料不足 · 42 部影片/);
  assert.match(f.content.textContent, /18:38:52/);
  assert.equal(descendants(f.content).filter(el => el.tag === 'dt').length, 9);
  assert.equal(descendants(f.content).filter(el => el.tag === 'img').length, 0, 'errors stay literal text');
  assert.match(f.content.textContent, /<img src=x onerror=bad\(\)>/);
  assert.equal(f.snapshot.hidden, true);
  assert.equal(f.requests[0].url, '/api/matching-v3');
  assert.equal(f.requests[0].options.cache, 'no-store');
  assert.equal([...f.timers.values()][0].delay, 30000);
  f.page.abort(); assert.equal(f.timers.size, 0);
});

test('monitor refreshes phases, stops in hidden tabs and after navigation, and preserves stale results on server failure', async () => {
  const f = fixture(data); await f.tick();
  f.update({ ...data, job: { ...data.job, state: 'running', error: null,
    progress: { phase: 'channels', processed: 0, total: 2000 } } });
  await f.button.events.click();
  assert.equal(f.label.textContent, '處理中');
  assert.match(f.content.textContent, /來源影片 2,000/);
  assert.equal(descendants(f.content).filter(el => el.tag === 'progress').length, 0);
  f.update(null, 503); await f.button.events.click();
  assert.match(f.connection.textContent, /上次資料/);
  assert.match(f.content.textContent, /來源影片 2,000/);
  assert.equal([...f.timers.values()][0].delay, 60000);
  f.document.hidden = true; f.document.events.visibilitychange();
  assert.equal(f.timers.size, 0);
  const requests = f.requests.length; await f.button.events.click(); assert.equal(f.requests.length, requests);
  f.page.abort(); f.document.hidden = false; await f.button.events.click(); assert.equal(f.requests.length, requests);
});

test('monitor clears live details and stops polling after session expiry', async () => {
  const f = fixture(data); await f.tick();
  f.update(null, 401); await f.button.events.click();
  assert.equal(f.content.textContent, '');
  assert.equal(f.button.disabled, true);
  assert.equal(f.timers.size, 0);
  assert.match(f.connection.textContent, /重新登入/);
});
