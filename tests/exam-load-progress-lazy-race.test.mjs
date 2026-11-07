import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app = readFileSync('src/main.js','utf8');

function section(start,end){
  const a=app.indexOf(start);
  assert.ok(a>=0,'missing: '+start);
  const b=app.indexOf(end,a+start.length);
  assert.ok(b>a,'missing end: '+end);
  return app.slice(a,b);
}

test('openExamEditorTab awaits lazy component before init',()=>{
  const src=section('async function openExamEditorTab({newExam = false} = {})','window.startNewExamConfig');
  const component=src.indexOf("await ensureTabComponent('exam-editor')");
  const switchIndex=src.indexOf("switchTab('exam-editor')");
  const init=src.indexOf('await initExamPanel()');
  assert.ok(component>=0,'must await component');
  assert.ok(switchIndex>component,'switch only after component is ready');
  assert.ok(init>component,'init only after component is ready');
  assert.match(src,/questionBankLastLoadError\?\.message/);
});

test('load exam shows dedicated progress and verifies bank before opening editor',()=>{
  const src=section('window.loadExamConfigById = async function loadExamConfigById','window.openExportDocxModal');
  assert.match(src,/showExamConfigLoadProgress\(\)/);
  const verify=src.indexOf('await ensureExamConfigQuestionPoolLoaded(draftToLoad');
  const open=src.indexOf('await openExamEditorTab({newExam:false})');
  const apply=src.indexOf('applyExamConfig(resJson.data)');
  assert.ok(verify>=0);
  assert.ok(open>verify,'editor must open after verification');
  assert.ok(apply>open,'config applies after editor opens');
  for(const step of ['Bước 1/5','Bước 2/5','Bước 3/5','Bước 4/5','Bước 5/5','Hoàn tất']){
    assert.ok(src.includes(step),step);
  }
});

test('question loading reports real totals and preserves detailed error',()=>{
  const fetch=section('async function fetchAllQuestionsChunked(onProgress)','window.fetchAllQuestionsChunked');
  assert.match(fetch,/expectedTotal/);
  assert.match(fetch,/onProgress\(allQuestions\.length, pageNum, false, expectedTotal\)/);
  assert.match(fetch,/onProgress\(allQuestions\.length, pageNum, true, finalTotal\)/);

  const load=section('async function loadQuestions(force = false, onProgress = null)','async function ensureExamConfigQuestionPoolLoaded');
  assert.match(load,/questionBankLastLoadError = null/);
  assert.match(load,/questionBankLastLoadError = err instanceof Error/);
});

test('exam progress failure remains visible until user closes it',()=>{
  const src=section('function showExamConfigLoadProgress(examLabel = '')','window.showExamConfigLoadProgress = showExamConfigLoadProgress');
  assert.match(src,/Nạp đề chưa hoàn tất/);
  assert.match(src,/onclick="closeModal\(\)"/);
  assert.ok(!src.includes('setTimeout(() => {\n                        closeModal();'));
});
