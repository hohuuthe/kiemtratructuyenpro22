import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fetchExamStartResponse} from '../src/student-exam-start-guard.js';

test('new exam enters immediately with one server request',async()=>{
 let calls=0;
 const response=await fetchExamStartResponse(async()=>{
  calls++;
  return new Response(JSON.stringify({token:'fresh',questions:[{id:'q1'}]}),
    {status:200,headers:{'content-type':'application/json'}});
 },'/api/exam/start',{},2000);
 assert.equal(calls,1);
 assert.equal(response.status,200);
 assert.equal(response.body.token,'fresh');
});

test('an unexpected server 409 is reported without retrying previous session',async()=>{
 let calls=0;
 const response=await fetchExamStartResponse(async()=>{
  calls++;
  return new Response(JSON.stringify({code:'EXAM_START_CONCURRENT_SUBMISSION'}),
    {status:409,headers:{'content-type':'application/json'}});
 },'/api/exam/start',{},2000);
 assert.equal(calls,1);
 assert.equal(response.body.code,'EXAM_START_CONCURRENT_SUBMISSION');
});

test('ambiguous start timeout never triggers duplicate submissions',async()=>{
 let calls=0;
 await assert.rejects(fetchExamStartResponse(async()=>{
  calls++;
  return new Promise(()=>{});
 },'/api/exam/start',{},10),e=>e.code==='EXAM_START_TIMEOUT');
 assert.equal(calls,1);
});

test('student UI contains no previous-attempt spinner or recovery path',()=>{
 const main=readFileSync('src/main.js','utf8');
 const guard=readFileSync('src/student-exam-start-guard.js','utf8');
 assert.match(main,/fetchExamStartResponse\(fetch, '\/api\/exam\/start'/);
 assert.doesNotMatch(main,/activateExamAfterPreviousFinalization\(fetch/);
 assert.doesNotMatch(main,/Đang hoàn tất lượt thi trước/);
 assert.doesNotMatch(main,/tryResumeActiveExam\(/);
 assert.doesNotMatch(guard,/activateExamAfterPreviousFinalization/);
});

test('expired READY token prepares a new unstarted exam, no old resume',()=>{
 const backend=readFileSync('functions/api/exam/start.ts','utf8');
 const frontend=readFileSync('src/main.js','utf8');
 assert.match(backend,/EXAM_READY_REGENERATE_REQUIRED/);
 assert.match(backend,/if \(snapshot.started_at\)/);
 assert.match(backend,/PRESTART token must never reopen a session/);
 const branch=frontend.slice(frontend.indexOf("if (error?.code === 'EXAM_READY_REGENERATE_REQUIRED')"));
 assert.ok(branch.length>0);
 assert.match(branch,/window.currentExamToken = null/);
 assert.match(branch,/clearStoredActiveExamResume\(\)/);
 assert.match(branch,/closeModal\(\)/);
 assert.match(branch,/setTimeout\(\(\) => window.startExam\(\), 0\)/);
});
