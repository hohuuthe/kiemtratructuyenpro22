import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {planRecentQuestionView,resolveWordImportedQuestionIds} from '../src/question-bank-recent-view.js';
const src=readFileSync('src/main.js','utf8');
const html=readFileSync('public/components/tab-questions.html','utf8');
test('Single lesson and mixed type focus',()=>{
 const q=[{id:'a',lesson:'BÀI 1',type:'SQ'},{id:'b',lesson:'BÀI 1',type:'TF4'}];
 assert.deepEqual(planRecentQuestionView(q),{ids:['a','b'],total:2,primaryLesson:'BÀI 1',lessonCount:1,typeFilter:'ALL'});
 assert.equal(planRecentQuestionView([{id:'a',lesson:'BÀI 2',type:'4-1'}]).typeFilter,'4-1');
});
test('Multi-lesson imports focus all newly saved IDs',()=>{
 const p=planRecentQuestionView([{id:'1',lesson:'BÀI 1',type:'SQ'},{id:'2',lesson:'BÀI 2',type:'TL'},{id:'3',lesson:'BÀI 1',type:'SQ'}]);
 assert.equal(p.lessonCount,2);assert.equal(p.primaryLesson,'BÀI 1');assert.equal(p.typeFilter,'ALL');
 assert.deepEqual(p.ids,['1','2','3']);
});
test('Word receipt IDs are used instead of temporary preview IDs',()=>{
 const key='a'.repeat(40),rows=resolveWordImportedQuestionIds([{id:'preview',lesson:'BÀI 1'}],key);
 assert.equal(rows[0].id,'wi-'+key+'-0001');assert.equal(resolveWordImportedQuestionIds(rows,'invalid').length,0);
});
test('Three pathways await acknowledged save or readback before focusing',()=>{
 assert.match(src,/await saveQuestionsToDB\(\[question\]\)/);
 assert.match(src,/await saveQuestionsToDB\(sanitizedQuestions\)/);
 assert.match(src,/receipt\.importKey/);
 assert.match(src,/await revealSavedQuestions\(imported\)/);
 assert.match(src,/const refreshed = await loadQuestions\(true\)/);
 assert.match(src,/receipt\.success !== true/);
 assert.match(src,/recentlySavedIds\.has\(String\(a\.id\)\)/);
 assert.match(html,/id="questions-recent-notice"/);
 assert.match(html,/showAllQuestionBank\(\)/);
});
