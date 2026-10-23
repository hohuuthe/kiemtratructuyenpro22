import test from 'node:test';
import assert from 'node:assert/strict';
import {wordImportImageObjectKey} from '../src/word-import-image-key.js';
test('Same Word image bytes and teacher get the exact same R2 object key for safe retries',async()=>{
  const a=new Uint8Array([137,80,78,71,0,4,55]);
  const k1=await wordImportImageObjectKey(a,'teacher-1','image/png');
  const k2=await wordImportImageObjectKey(new Uint8Array(a),'teacher-1','image/png');
  assert.equal(k1,k2);
  assert.match(k1,/^luuhinhnh\/word-import\/[a-f0-9]{24}\/[a-f0-9]{64}\.png$/);
});
test('Different teacher, bytes or mime yield different keys',async()=>{
  const a=new Uint8Array([10,11,12]),b=new Uint8Array([10,11,13]);
  const source=await wordImportImageObjectKey(a,'teacher-1','image/png');
  assert.notEqual(source,await wordImportImageObjectKey(a,'teacher-2','image/png'));
  assert.notEqual(source,await wordImportImageObjectKey(b,'teacher-1','image/png'));
  assert.notEqual(source,await wordImportImageObjectKey(a,'teacher-1','image/jpeg'));
});
test('Reject ambiguous image format, empty bytes and invalid teacher',async()=>{
  await assert.rejects(wordImportImageObjectKey(new Uint8Array([1]),'teacher-1','image/svg+xml'));
  await assert.rejects(wordImportImageObjectKey(new Uint8Array(0),'teacher-1','image/png'));
  await assert.rejects(wordImportImageObjectKey(new Uint8Array([1]),'','image/png'));
});
