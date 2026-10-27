import test from 'node:test';
import assert from 'node:assert/strict';
import {
  essayFlag,parseEssayKeyPool,prepareEssayDetails,summarizeEssayDetails,
  gradeEssayWithKeyPool,publicEssayGradingResult
} from '../src/essay-grading-pipeline.js';
import {readFileSync} from 'node:fs';

const question={type:'TL',content:'Giải thích mô hình OSI',image:''};
const base={question,correctAnswer:'7 tầng',userAnswer:{text:'Gồm 7 tầng'},score:0};
const response=(status,body)=>({ok:status>=200&&status<300,status,
  json:async()=>body});
const success=(score=1,feedback='Đạt')=>response(200,
  {candidates:[{content:{parts:[{text:JSON.stringify({score,feedback})}]}}]});

test('key pool splits spaces, strips repeated/placeholder keys',()=>{
  assert.deepEqual(parseEssayKeyPool('AIza-111111 AIza-222222\nAIza-111111'),['AIza-111111','AIza-222222']);
  assert.deepEqual(parseEssayKeyPool('YOUR_KEY ••••••••'),[]);
});
test('unanswered essay scores zero, answered essay remains pending not final zero',()=>{
  const rows=prepareEssayDetails([base,{...base,userAnswer:''}],true,2);
  assert.equal(rows[0].score,null);
  assert.equal(rows[0].gradingStatus,'pending');
  assert.equal(rows[1].score,0);
  assert.equal(rows[1].gradingStatus,'completed');
  assert.deepEqual(summarizeEssayDetails(rows),{score:null,provisionalScore:0,pendingCount:1,manualCount:0,completed:false});
  rows[0].score=1.5;rows[0].gradingStatus='completed';rows[0].needsGrading=false;
  assert.equal(summarizeEssayDetails(rows).score,1.5);
});
test('disabled automatic grading must await teacher rather than publish zero',()=>{
  const rows=prepareEssayDetails([base],false,2);
  assert.equal(rows[0].gradingStatus,'manual_required');
  assert.equal(summarizeEssayDetails(rows).score,null);
  assert.equal(essayFlag(0),false);
  assert.equal(essayFlag('0'),false);
  assert.equal(essayFlag(1),true);
});
test('quota on first key causes rotation to second key',async()=>{
  const attempted=[];
  const outcome=await gradeEssayWithKeyPool({
    detail:{...base,maxScore:2},
    keys:['AIza-111111','AIza-222222'],
    models:['gemini-2.5-flash'],
    fetchImpl:async(_url,opts)=>{
      attempted.push(opts.headers['x-goog-api-key']);
      return attempted.length===1?response(429,{error:{message:'RESOURCE_EXHAUSTED'}}):success(1.5);
    }
  });
  assert.equal(outcome.ok,true);
  assert.equal(outcome.score,1.5);
  assert.equal(outcome.keyIndex,1);
  assert.deepEqual(attempted,['AIza-111111','AIza-222222']);
});
test('bad provider response must never be recorded as zero or final score',async()=>{
  const result=await gradeEssayWithKeyPool({
    detail:{...base,maxScore:2},
    keys:['AIza-111111'],models:['gemini-2.5-flash'],
    fetchImpl:async()=>success('not-a-number')
  });
  assert.equal(result.ok,false);
  assert.equal(result.code,'INVALID_AI_SCORE');
});
test('pending result is never disclosed with provisional score',()=>{
  assert.equal(publicEssayGradingResult({id:'x',score:8,grading_status:'retry_pending'}).score,null);
  assert.equal(publicEssayGradingResult({id:'x',score:8,grading_status:'completed'}).score,8);
});
test('backend integrates durable submit and lease-safe final updates',()=>{
  const edge=readFileSync('functions/api/exam/grade.ts','utf8');
  const retry=readFileSync('functions/api/exam/retry-essay.ts','utf8');
  const manual=readFileSync('functions/api/results.ts','utf8');
  const ui=readFileSync('src/main.js','utf8');
  assert.match(edge,/ON CONFLICT \(submission_token_hash\) DO NOTHING/);
  assert.match(edge,/processStoredEssayGrading/);
  assert.match(retry,/verifyAuthSession/);
  assert.match(retry,/creator=teacher/);
  assert.match(manual,/grading_lease_token = NULL/);
  assert.match(ui,/gradingInProgress/);
});

test('remote or invalid image attachments must not be graded using partial answers', async () => {
  for (const image of ['https://example.org/student.png', 'data:image/png;base64,not valid']) {
    let requests = 0;
    const response = await gradeEssayWithKeyPool({
      detail:{...base, userAnswer:{text:'My response',image},maxScore:2},
      keys:['AIza-111111'], models:['gemini-2.5-flash'],
      fetchImpl: async()=>{ requests++; return success(2); }
    });
    assert.equal(response.ok,false);
    assert.equal(response.code,'UNSUPPORTED_ESSAY_IMAGE');
    assert.equal(requests,0);
  }
});
test('image_url alias is considered a submitted answer',()=>{
  const details=prepareEssayDetails([{...base,userAnswer:{image_url:'https://example.org/submitted.png'}}],true,2);
  assert.equal(details[0].gradingStatus,'pending');
  assert.equal(details[0].score,null);
});
