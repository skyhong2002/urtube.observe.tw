import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { MATCHING_PERCENTAGE_VERSION } from '../src/youtube/candidates.js';

const documents = ['README.md', 'hackathon.md', 'docs/pitch.md'];

test('documents describe AI data use and technical documents name the matching formula', () => {
  for (const path of documents) {
    const content = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    if (path !== 'README.md') {
      assert.match(content, new RegExp(MATCHING_PERCENTAGE_VERSION), `${path} names the deployed formula`);
    }
    assert.doesNotMatch(content, /cosine-equal-v1/, `${path} does not carry the retired formula`);
    assert.match(content, /public video metadata|公開影片中繼資料|公開影片資訊/, `${path} states the model input`);
    assert.match(content, /search|搜尋/, `${path} states a private-data boundary`);
    assert.match(content, /Unknown|無法判斷/, `${path} explains abstention`);
    assert.match(content, /rollback|roll back|復原先前/, `${path} explains owner rollback`);
  }
});
