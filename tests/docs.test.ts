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
    // The taxonomy review/rollback UI was retired (its routes answer 410).
    assert.doesNotMatch(content, /確認結果與復原|復原先前(的分類|結果)/, `${path} does not promise the retired rollback UI`);
  }
});

test('README states the actual signup privacy defaults', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /儀表板預設私人/);
  assert.match(readme, /好友探索（配對）預設關閉/);
  assert.doesNotMatch(readme, /配對開關預設開啟/);
});
