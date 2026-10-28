import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {splitGeminiKeys,localGeminiStorageKey,readBrowserGeminiKeys,saveBrowserGeminiKeys,prioritizeGradingKeys} from '../src/essay-browser-ai-keys.js';
const storage=()=>{const m=new Map();return {getItem:key=>m.get(key)||null,setItem:(key,val)=>m.set(key,val),removeItem:key=>m.delete(key)};};
test('browser personal keys precede exam and system pools without duplicates',()=>{
 const s=storage(),user={username:'teacher_one'};
 saveBrowserGeminiKeys(s,user,'personal-key-123 personal-key-456');
 assert.deepEqual(prioritizeGradingKeys(s,user,'exam-key-123 personal-key-456','system-key-123 exam-key-123'),[
 'personal-key-123','personal-key-456','exam-key-123','system-key-123']);
});
test('keys stay isolated per signed-in account and can be deleted',()=>{
 const s=storage(),a={username:'teacher_A'},b={username:'teacher_B'};
 saveBrowserGeminiKeys(s,a,'teacher-A-key');
 assert.deepEqual(readBrowserGeminiKeys(s,b),[]);
 assert.notEqual(localGeminiStorageKey(a),localGeminiStorageKey(b));
 saveBrowserGeminiKeys(s,a,'');
 assert.deepEqual(readBrowserGeminiKeys(s,a),[]);
 assert.throws(()=>saveBrowserGeminiKeys(s,null,'secret-key-123'));
 assert.deepEqual(prioritizeGradingKeys(s,null,'exam-key-123','system-key-123'),['exam-key-123','system-key-123']);
});
test('invalid placeholders and repeated keys are filtered',()=>{
 assert.deepEqual(splitGeminiKeys('valid-key-123 valid-key-123 YOUR_KEY_PLACEHOLDER ••••••••••• invalid-key-123'),['valid-key-123','invalid-key-123']);
});
test('essay detail uses saved personal key priority and offers separate editor',()=>{
 const main=readFileSync('src/main.js','utf8');
 assert.match(main,/prioritizeGradingKeys\(localStorage,currentUser,targetConfig\?\.aiGradingKey,appSettings\?\.aiGradingKey\)/);
 assert.match(main,/onclick="openEssayAIConfig\(\)"/);
 assert.match(main,/window\.openEssayAIConfig/);
 assert.match(main,/data-essay-ai-action="test"/);
 assert.match(main,/data-essay-ai-action="save"/);
 assert.match(main,/data-essay-ai-action="clear"/);
 assert.match(main,/testSingleGeminiKey\(k\)/);
 assert.doesNotMatch(main,/localStorage\.setItem\('exam_configs?'/);
});
