import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {essayFlag,parseEssayKeyPool,gradeEssayWithKeyPool} from '../src/essay-grading-pipeline.js';

const page=readFileSync('public/components/tab-exam-editor.html','utf8');
const edge=readFileSync('functions/api/exam/grade.ts','utf8');
const express=readFileSync('server.ts','utf8');
const ui=readFileSync('src/main.js','utf8');
const pipeline=readFileSync('src/essay-grading-pipeline.js','utf8');

test('exam editor exposes per-exam key list and test button',()=>{
  assert.match(page,/id="exam-config-ai-grading-key"/);
  assert.match(page,/id="btn-test-exam-grading-keys"/);
  assert.match(page,/validateAIGradingKey\(document.getElementById\('exam-config-ai-grading-key'\).value\)/);
  assert.match(ui,/window.validateAIGradingKey = async function/);
  assert.match(ui,/Promise.all\(rawKeys.map\(k => testSingleGeminiKey\(k\)\)\)/);
});
test('signed exam ID and creator control key selection in both handlers',()=>{
  for(const code of [edge,express]){
    const start=code.indexOf('const { questionIds, examConfig');
    assert.ok(start>=0,'cannot locate signed exam claims');
    const grading=code.slice(start);
    assert.match(grading,/String\(examConfig(?:\?)?\.id \|\| ''\)/);
    assert.match(grading,/SELECT ai_grading_key FROM exam_configs WHERE id = \? AND creator_id = \?/);
    assert.match(grading,/SELECT ai_grading_key FROM app_settings WHERE id = 1/);
    const end=grading.indexOf('const normalizeTypeForGrading')>=0
      ? grading.indexOf('const normalizeTypeForGrading') : grading.indexOf('2. Truy xuất câu hỏi gốc');
    assert.ok(end>0,'cannot isolate key lookup');
    assert.doesNotMatch(grading.slice(0,end),/studentInfo\.examId|studentInfo\.examName/);
    assert.match(code,/processStoredEssayGrading/);
  }
});
test('all grading routes share the durable, unique key pool',()=>{
  assert.deepEqual(parseEssayKeyPool('AIza-111111 AIza-222222 AIza-111111'),['AIza-111111','AIza-222222']);
  assert.equal(essayFlag('1'),true);
  assert.equal(essayFlag('0'),false);
  assert.match(pipeline,/loadEssayGradingKeys/);
  assert.match(pipeline,/gradeEssayWithKeyPool/);
  assert.match(edge,/prepareEssayDetails/);
  assert.match(express,/prepareEssayDetails/);
});
test('invalid AI score cannot be accepted by shared grader',async()=>{
  const result=await gradeEssayWithKeyPool({
    detail:{question:{type:'TL',content:'Test'},correctAnswer:'Test',userAnswer:'Test',maxScore:2},
    keys:['AIza-111111'],models:['gemini-2.5-flash'],
    fetchImpl:async()=>({ok:true,status:200,json:async()=>({
      candidates:[{content:{parts:[{text:JSON.stringify({score:100,feedback:'Invalid'})}]}}]
    })})
  });
  assert.equal(result.ok,false);
  assert.equal(result.code,'INVALID_AI_SCORE');
});
