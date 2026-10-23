import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeWordImportAnswer} from '../src/word-import-verification.js';
test('Word MC answers are exactly A-D',()=>{
  assert.deepEqual(normalizeWordImportAnswer('4-1','b'),{ok:true,value:'B'});
  for(const bad of ['AB','Đ','A&C','', 'E'])assert.equal(normalizeWordImportAnswer('4-1',bad).ok,false,bad);
});
test('Word TF4 answers are canonical student grading keys',()=>{
  assert.deepEqual(normalizeWordImportAnswer('TF4','Đ S Đ S'),{ok:true,value:'A&C'});
  assert.deepEqual(normalizeWordImportAnswer('TF4','D&A'),{ok:true,value:'A&D'});
  for(const bad of ['A&A','A B C','Đ S', 'Đ Đ Đ', 'invalid'])assert.equal(normalizeWordImportAnswer('TF4',bad).ok,false,bad);
});
test('Short and essay answers retain exact mathematical text',()=>{
  const math=String.raw`\\frac{x+1}{2}`;
  assert.deepEqual(normalizeWordImportAnswer('SQ',math),{ok:true,value:math});
});
