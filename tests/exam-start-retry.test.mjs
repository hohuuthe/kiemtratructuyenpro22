import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {activateExamAfterPreviousFinalization} from '../src/student-exam-start-guard.js';

const reply=(status,body)=>new Response(JSON.stringify(body),{
 status,headers:{'content-type':'application/json'}
});

test('prior attempt is graded and a new attempt begins without another click',async()=>{
 let calls=0;
 const progress=[];
 const fetcher=async()=>{
  calls++;
  return calls===1 ? reply(409,{code:'EXAM_PREVIOUS_ATTEMPT_FINALIZED'}) :
   reply(200,{token:'new-token',questions:[{id:'q1'}]});
 };
 const result=await activateExamAfterPreviousFinalization(fetcher,'/api/exam/start',{},
  {sleep:async()=>{},onRetry:state=>progress.push(state)});
 assert.equal(calls,2);
 assert.equal(result.status,200);
 assert.equal(result.body.token,'new-token');
 assert.deepEqual(progress.map(x=>x.code),['EXAM_PREVIOUS_ATTEMPT_FINALIZED']);
});

test('only a server-confirmed ACTIVE conflict retries; no infinite block',async()=>{
 let calls=0, waits=0;
 const response=await activateExamAfterPreviousFinalization(async()=>{
   calls++;return reply(409,{code:'EXAM_ATTEMPT_ALREADY_ACTIVE'});
 },'/api/exam/start',{}, {sleep:async()=>{waits++;},maxRetries:3});
 assert.equal(response.status,409);
 assert.equal(calls,4);
 assert.equal(waits,3);
});

test('the default retry policy cannot leave the READY dialog stuck for 100 seconds',async()=>{
 let calls=0,totalDelay=0;
 const response=await activateExamAfterPreviousFinalization(async()=>{
   calls++;return reply(409,{code:'EXAM_ATTEMPT_ALREADY_ACTIVE'});
 },'/api/exam/start',{}, {sleep:async ms=>{totalDelay+=ms;}});
 assert.equal(response.status,409);
 assert.equal(calls,3);
 assert.equal(totalDelay,2000);
});

test('other errors and quota exhaustion must not retry',async()=>{
 for (const [status,code] of [[403,'EXAM_ATTEMPT_LIMIT_REACHED'],[409,'EXAM_ACCESS_REVOKED'],[503,'EXAM_PREVIOUS_ATTEMPT_FINALIZE_RETRY']]) {
  let calls=0;
  const res=await activateExamAfterPreviousFinalization(async()=>{
    calls++;return reply(status,{code});
  },'/api/exam/start',{}, {sleep:async()=>{}});
  assert.equal(res.status,status);
  assert.equal(calls,1);
 }
});

test('ambiguous timeout is never retried',async()=>{
 let calls=0;
 await assert.rejects(
  activateExamAfterPreviousFinalization(async()=>{
   calls++;
   return new Promise(()=>{});
  },'/api/exam/start',{}, {requestTimeoutMs:10,sleep:async()=>{}}),
  e=>e.code==='EXAM_START_TIMEOUT'
 );
 assert.equal(calls,1);
});

test('cancelled ready state stops before next request',async()=>{
 let calls=0,cancel=false;
 await assert.rejects(
  activateExamAfterPreviousFinalization(async()=>{
   calls++;
   return reply(409,{code:'EXAM_ATTEMPT_ALREADY_ACTIVE'});
  },'/api/exam/start',{}, {sleep:async()=>{cancel=true},isCancelled:()=>cancel}),
  e=>e.code==='EXAM_START_CANCELLED'
 );
 assert.equal(calls,1);
});

test('student UI starts once with no old-session recovery or waiting',()=>{
 const main=readFileSync('src/main.js','utf8');
 assert.match(main,/fetchExamStartResponse\(fetch, '\/api\/exam\/start'/);
 assert.doesNotMatch(main,/activateExamAfterPreviousFinalization\(fetch/);
 assert.doesNotMatch(main,/Đang hoàn tất lượt thi trước/);
 assert.doesNotMatch(main,/tryResumeActiveExam\(/);
});

test('expired READY from a prior cleanup automatically requests a fresh unstarted exam',()=>{
 const backend=readFileSync('functions/api/exam/start.ts','utf8');
 const frontend=readFileSync('src/main.js','utf8');
 assert.match(backend,/code:'EXAM_READY_REGENERATE_REQUIRED'/);
 const branch=frontend.slice(frontend.indexOf("if (error?.code === 'EXAM_READY_REGENERATE_REQUIRED')"));
 assert.ok(branch.length>0);
 assert.match(branch,/window.currentExamToken = null/);
 assert.match(branch,/clearStoredActiveExamResume\(\)/);
 assert.match(branch,/closeModal\(\)/);
 assert.match(branch,/setTimeout\(\(\) => window.startExam\(\), 0\)/);
});
