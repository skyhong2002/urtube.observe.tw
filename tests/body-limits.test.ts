import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { createApp } from '../src/index.js';
import { createIngestApp } from '../src/ingest.js';
import { UserRegistry } from '../src/users.js';
import { parseYoutubeArchive } from '../src/youtube/takeout.js';

const CAPTURE_TOKEN = process.env.YOUTUBE_CAPTURE_TOKEN!;
const SECRET = 'test-private-data-key-with-at-least-32-characters';

// A chunked body with no Content-Length that records how much was pulled.
function countedStream(chunks: number, chunkBytes: number) {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks) return controller.close();
      pulled++;
      controller.enqueue(new Uint8Array(chunkBytes).fill(0x20));
    },
  });
  return { body, pulled: () => pulled };
}

test('ingest rejects an oversized chunked capture before reading all of it', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const app = createIngestApp(registry);
    const stream = countedStream(32, 16 * 1024);
    const response = await app.request('/api/ingest/youtube/capture', {
      method: 'POST', body: stream.body, duplex: 'half',
      headers: { authorization: `Token ${CAPTURE_TOKEN}`, 'content-type': 'application/json' },
    } as RequestInit);
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'Capture payload exceeds 16 KiB' });
    assert.ok(stream.pulled() < 32, `stopped after ${stream.pulled()} of 32 chunks`);

    const declared = await app.request('/api/ingest/youtube/history', {
      method: 'POST', body: 'x',
      headers: { authorization: `Token ${CAPTURE_TOKEN}`, 'content-length': String(300 * 1024) },
    });
    assert.equal(declared.status, 413, 'declared oversize is refused from the header alone');
  } finally {
    registry.close();
  }
});

test('site forms and the Takeout upload stop streaming oversized bodies', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const app = createApp(registry);
    const user = registry.createUser('limits', 'Limits');
    const cookie = `urtube_session=${registry.createSession(user)}`;
    const form = countedStream(64, 64 * 1024);
    const small = await app.request('/account/visibility', {
      method: 'POST', body: form.body, duplex: 'half',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    } as RequestInit);
    assert.equal(small.status, 413);
    assert.ok(form.pulled() < 64, `stopped after ${form.pulled()} of 64 chunks`);

    const upload = await app.request('/account/takeout', {
      method: 'POST', body: 'x',
      headers: { cookie, 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(200 * 1024 * 1024) },
    });
    assert.equal(upload.status, 413);
    assert.match(await upload.text(), /<html/i, 'signed-in users get the account page with the error');
  } finally {
    registry.close();
  }
});

test('archive inflation is bounded by actual output, not only declared sizes', () => {
  const entries = [{
    header: 'YouTube', title: 'Watched Fixture', titleUrl: 'https://www.youtube.com/watch?v=AAAAAAAAAAA',
    time: '2026-07-28T00:00:00Z', products: ['YouTube'], activityControls: ['YouTube watch history'],
  }];
  const json = strToU8(JSON.stringify(entries).padEnd(4096, ' '));
  const archive = zipSync({ 'Takeout/YouTube and YouTube Music/history/watch-history.json': json });
  assert.throws(
    () => parseYoutubeArchive(archive, SECRET, 'takeout', { maxUncompressedBytes: 1024 }),
    /uncompressed size limit/,
  );
  assert.equal(parseYoutubeArchive(archive, SECRET, 'takeout').watches.length, 1);
});
