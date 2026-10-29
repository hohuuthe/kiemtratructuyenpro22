import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scrollExamSubmitIntoView} from '../src/exam-scroll-to-submit.js';

test('scroll action focuses submit position without calling submit',()=>{
 let scroll=null,submitted=0;
 const root={classList:{contains:()=>false},querySelector:()=>({scrollIntoView:options=>{scroll=options;}})};
 assert.equal(scrollExamSubmitIntoView(root),true);
 assert.deepEqual(scroll,{behavior:'smooth',block:'center',inline:'nearest'});
 assert.equal(submitted,0);
 assert.equal(scrollExamSubmitIntoView({classList:{contains:()=>true}}),false);
 assert.equal(scrollExamSubmitIntoView(null),false);
});
test('desktop fullscreen control stays between previous and next',()=>{
 const html=readFileSync('public/components/tab-exam.html','utf8');
 const css=readFileSync('src/style.css','utf8');
 const main=readFileSync('src/main.js','utf8');
 const prev=html.indexOf('onclick="prevQuestion()"');
 const up=html.indexOf('id="exam-scroll-to-submit"');
 const next=html.indexOf('onclick="nextQuestion()"');
 assert.ok(prev>=0 && prev<up && up<next);
 assert.match(html,/id="exam-submit-button" onclick="submitExam\(\)"/);
 assert.match(html,/id="exam-scroll-to-submit"[^>]*onclick="window.scrollToExamSubmitButton\(\)"/);
 assert.match(css,/@media \(min-width: 1024px\)/);
 assert.match(css,/#exam-interface:fullscreen #exam-scroll-to-submit/);
 assert.match(css,/flex: 3 1 0%/);
 assert.match(css,/flex: 1 1 0%/);
 assert.match(main,/document\.fullscreenElement !== document\.getElementById\('exam-interface'\)/);
 assert.match(main,/scrollExamSubmitIntoView\(document\.getElementById\('exam-interface'\)\)/);
});
