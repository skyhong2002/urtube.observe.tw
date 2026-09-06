import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTopicDecay } from '../src/youtube/topic-decay.js';
import type { YoutubeTopicTrendMonth } from '../src/youtube/types.js';
const frame = (end: string) => ({month:end,periodEnd:end,topics:['a','b'].map(slug=>({slug,movingAverageShare:0}))}) as YoutubeTopicTrendMonth;
test('topic decay halves old mass after 90 days, preserves quiet periods, and warms up selected ranges',()=>{
  const days=[{day:'2026-01-01',slug:'a',seconds:100},{day:'2026-04-01',slug:'b',seconds:100},{day:'2027-01-01',slug:'b',seconds:100000}];
  const frames=[frame('2026-01-01'),frame('2026-04-01'),frame('2026-07-01')];
  applyTopicDecay(frames,days);
  assert.equal(frames[0].topics[0].movingAverageShare,1);
  assert.equal(frames[1].topics[0].movingAverageShare,1/3);
  assert.ok(Math.abs(frames[2].topics[0].movingAverageShare-1/3)<1e-12);
  const selected=[frame('2026-07-01')];applyTopicDecay(selected,days);
  assert.ok(Math.abs(selected[0].topics[0].movingAverageShare-frames[2].topics[0].movingAverageShare)<1e-12);
  const empty=[frame('2026-07-01')];applyTopicDecay(empty,[]);
  assert.equal(empty[0].topics[0].movingAverageShare,0);
});
