import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync('src/main.js','utf8');

function section(start,end){
  const a=app.indexOf(start); assert.ok(a>=0,'missing '+start);
  const b=app.indexOf(end,a+start.length); assert.ok(b>a,'missing '+end);
  return app.slice(a,b);
}

test('exam loading reuses already-loaded full bank for same teacher',()=>{
  const load=section('window.loadExamConfigById = async function loadExamConfigById','window.openExportDocxModal');
  assert.match(load,/if \(isQuestionBankLoadedFor\(ownerTeacherId\)\)/);
  assert.match(load,/verification = verifyExamConfigQuestionPool\(draft, questions\)/);
  assert.match(load,/reusedQuestionBank = Boolean\(verification\?\.ok\)/);
  assert.match(load,/if \(!reusedQuestionBank\)/);
});

test('question bank API is only called inside cache-miss branch',()=>{
  const load=section('window.loadExamConfigById = async function loadExamConfigById','window.openExportDocxModal');
  const miss=load.indexOf('if (!reusedQuestionBank)');
  const fullLoad=load.indexOf('await loadQuestions(true',miss);
  assert.ok(miss>=0 && fullLoad>miss);
  const cacheHitElse=load.indexOf('} else {',fullLoad);
  assert.ok(cacheHitElse>fullLoad);
  const hitPart=load.slice(cacheHitElse,load.indexOf('if (generation !== authDataGeneration',cacheHitElse));
  assert.ok(!hitPart.includes('loadQuestions('));
  assert.ok(!hitPart.includes('/api/questions'));
});

test('same-teacher cache hit skips question progress modal',()=>{
  const load=section('window.loadExamConfigById = async function loadExamConfigById','window.openExportDocxModal');
  const miss=load.indexOf('if (!reusedQuestionBank)');
  const progress=load.indexOf("showLoadingProgress('Đang tải Ngân hàng Câu hỏi'",miss);
  assert.ok(progress>miss);
  const cacheHit=load.indexOf('} else {',progress);
  const hit=load.slice(cacheHit,load.indexOf('if (generation !== authDataGeneration',cacheHit));
  assert.ok(!hit.includes('showLoadingProgress('));
});

test('question mutation invalidates loaded scope and pending scope',()=>{
  const save=section('async function saveQuestionsToDB','async function saveResultsToDB');
  assert.match(save,/questionsLoaded = false/);
  assert.match(save,/questionBankLoadedScope = ''/);
  assert.match(save,/questionBankRevision\+\+/);
  assert.match(save,/questionsLoadPromise = null/);
  assert.match(save,/questionsLoadPromiseScope = ''/);
});

test('different teacher scope is never treated as same cache',()=>{
  assert.match(app,/function isQuestionBankLoadedFor\(teacherId = null\)/);
  assert.match(app,/questionBankLoadedScope === questionBankScopeKey\(teacherId\)/);
  assert.match(app,/return targetId \? \('teacher:' \+ targetId\) : 'admin:all'/);
});

test('exam configuration is still fetched fresh for every Nạp đề',()=>{
  const load=section('window.loadExamConfigById = async function loadExamConfigById','window.openExportDocxModal');
  assert.match(load,/fetch\(\`\/api\/exams\?id=\$\{encodeURIComponent\(selectedId\)\}\`/);
  assert.match(load,/cache: 'no-store'/);
});
