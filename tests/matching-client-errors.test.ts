import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

for (const [status, body, expected] of [
  [502, '', /暫時無法完成操作/],
  [503, '<html>Service unavailable</html>', /暫時無法完成操作/],
  [200, '', /暫時無法取得結果/],
  [401, '{"error":"login_required"}', /登入已過期/],
] as const) test(`matching UI handles HTTP ${status} with a readable error`, async () => {
  const source=readFileSync(new URL('../src/matching-v3/client.js',import.meta.url),'utf8').split('function error(err)')[0];
  const context={
    document: { documentElement: { lang: 'zh' }, getElementById: () => ({}), querySelector: () => ({ dataset: { genreLabels: '{}' } }) },
    fetch:async()=>new Response(body,{status}),run:null as null|(()=>Promise<unknown>)
  };
  runInNewContext(source+'\nglobalThis.run=api;',context);
  await assert.rejects(context.run!(),expected);
});
