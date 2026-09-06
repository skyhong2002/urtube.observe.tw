import assert from 'node:assert/strict';
import test from 'node:test';
import { blendKeywords } from '../src/output/blend-keywords.js';
import type { Profile, Genre } from '../src/matching-v3/model.js';

function profile(genres: Partial<Record<Genre, Array<[string, number, number?]>>>): Profile {
  return {version:'test',sourceFingerprint:'test',builtAt:'2026-09-06T00:00:00Z',complete:true,processedVideos:20,totalVideos:20,
    genres:Object.fromEntries(Object.entries(genres).map(([genre,tags])=>[genre,{status:'ready',retainedCoverage:1,totalMass:20,videoCount:20,
      clusters:[{centroid:[1],mass:20,share:1,tags:tags.map(([text,count,generatedCount=0])=>({text,count,generatedCount}))}]}]))};
}

test('Blend keywords intersect original terms in shared genres, filter category labels, and rank shared support',()=>{
  const a=profile({Music:[['Indie Rock',9],['MUSIC',100],['Only left',10],['Generated',5,5],['rare',100]],Sport:[['private sport',10]]});
  const b=profile({Music:[['  indie rock  ',4],['music',100],['Only right',10],['Generated',5],['rare',1]],Sport:[['private sport',10]]});
  assert.deepEqual(blendKeywords(a,b,['Music']),['Indie Rock','rare']);
  assert.deepEqual(blendKeywords(a,b,[]),[]);
  assert.deepEqual(blendKeywords(profile({Music:[['cross-category',2]]}),profile({Sport:[['cross-category',2]]}),['Music','Sport']),[]);
});

test('Blend keywords are deduplicated and limited to five without mutating profiles',()=>{
  const a=profile({Music:Array.from({length:8},(_,i)=>[`term ${i}`,10-i] as [string,number])});
  const before=structuredClone(a);
  assert.deepEqual(blendKeywords(a,a,['Music','Music']),['term 0','term 1','term 2','term 3','term 4']);
  assert.deepEqual(a,before);
});
