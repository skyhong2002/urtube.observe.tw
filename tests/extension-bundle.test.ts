import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { unzipSync, strFromU8 } from 'fflate';
import { buildExtensionZip } from '../src/extension-bundle.js';

test('local extension targets the local proxy and provisions on localhost', () => {
  const files = unzipSync(buildExtensionZip('http://localhost:19080'));
  const source = (name: string) => strFromU8(files[`urtube-extension-local/${name}`]);
  const manifest = JSON.parse(source('manifest.json'));
  assert.match(manifest.name, /Local Development/);
  assert.ok(manifest.host_permissions.includes('http://localhost/*'));
  assert.ok(!manifest.host_permissions.includes('https://urtube.observe.tw/*'));
  assert.deepEqual(manifest.content_scripts[1].matches, ['http://localhost/extension-setup*']);
  assert.match(source('queue.js'), /http:\/\/localhost:19080\/api\/ingest\/youtube\/capture/);
  // Exercise the downloaded options code, including rejection of other ports
  // and production endpoints, rather than merely checking replaced strings.
  const endpoint = { value: 'http://localhost:19080/api/ingest/youtube/capture' };
  const context = vm.createContext({
    URL,
    document: { querySelector: (selector: string) => selector === '#endpoint' ? endpoint : {} },
  });
  const options = source('options.js');
  const start = options.indexOf('function values()');
  const end = options.indexOf('  const tokenValue', start);
  vm.runInContext(options.slice(start, end) + '\nreturn url.toString();\n}', context);
  context.endpoint = endpoint;
  assert.equal(vm.runInContext('values()', context), endpoint.value);
  for (const url of ['http://localhost:19081/api/ingest/youtube/capture',
    'https://urtube.observe.tw/api/ingest/youtube/capture', 'http://localhost:19080/wrong']) {
    endpoint.value = url;
    assert.throws(() => vm.runInContext('values()', context), /connection-settings/);
  }
});

test('production bundle retains the original extension after building a local bundle', () => {
  buildExtensionZip('http://localhost:19080');
  const files = unzipSync(buildExtensionZip('https://urtube.observe.tw'));
  for (const name of ['manifest.json', 'queue.js', 'options.js', 'popup.js']) {
    assert.equal(strFromU8(files[`urtube-extension/${name}`]),
      readFileSync(new URL(`../chrome-extension/${name}`, import.meta.url), 'utf8'));
  }
});
