import assert from 'node:assert/strict';
import test from 'node:test';
import { compatibilityPercentage } from '../src/output/compatibility-score.js';
test('compatibility display follows square-root calibration and preserves endpoints and ordering', () => {
  assert.deepEqual([0,.25,.36,.49,1].map(compatibilityPercentage),[0,50,60,70,100]);
  let last = -1;
  for(let i=0;i<=100;i++) { const next=compatibilityPercentage(i/100); assert.ok(next>=last); last=next; }
});
