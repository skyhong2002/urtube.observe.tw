import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('matching UI reports an empty 502 response without a JSON parsing error', async () => {
  const source=readFileSync(new URL('../src/matching-v3/client.js',import.meta.url),'utf8').split('function error(err)')[0];
  const context={fetch:async()=>new Response('',{status:502}),run:null as null|(()=>Promise<unknown>)};
  runInNewContext(source+'\nglobalThis.run=api;',context);
  await assert.rejects(context.run!(),/HTTP 502/);
});
