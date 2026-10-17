import assert from 'node:assert/strict';
import test from 'node:test';
import { channelImageSources } from '../src/output/channel-image.js';

test('channel CDN variants preserve the crop, query and fragment', () => {
  for (const host of ['yt3.ggpht.com', 'yt3.googleusercontent.com']) {
    const source = `https://${host}/ytc/id=s800-c-k-c0x00ffffff-no-rj?x=1&y=2#avatar`;
    const result = channelImageSources(source);
    assert.equal(result.src, source.replace('=s800-', '=s128-'));
    assert.equal(result.srcset, [128, 256, 384].map(size => `${source.replace('=s800-', `=s${size}-`)} ${size}w`).join(', '));
  }
});

test('only the final CDN size suffix changes', () => {
  assert.equal(channelImageSources('https://yt3.ggpht.com/id=s800-part/avatar=s800').src,
    'https://yt3.ggpht.com/id=s800-part/avatar=s128');
});

test('other URLs retain their original source without responsive variants', () => {
  for (const source of [
    'https://i.ytimg.com/vi/id/hqdefault.jpg',
    'https://example.com/avatar=s800-c',
    'https://yt3.ggpht.com.example.com/id=s800-c',
    'https://yt3.ggpht.com:8443/id=s800-c',
    'https://name@yt3.ggpht.com/id=s800-c',
    'http://yt3.ggpht.com/id=s800-c',
    'https://yt3.ggpht.com/id=s800-c/other',
    'https://yt3.ggpht.com/avatar.jpg',
    '/member/id/avatar', '',
  ]) assert.deepEqual(channelImageSources(source), { src: source });
});
