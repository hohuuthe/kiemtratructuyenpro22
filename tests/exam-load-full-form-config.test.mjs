import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync('src/main.js','utf8');

function section(start,end){
  const a=app.indexOf(start); assert.ok(a>=0,'missing '+start);
  const b=app.indexOf(end,a+start.length); assert.ok(b>a,'missing '+end);
  return app.slice(a,b);
}

test('loaded exam is always present by id and real name in the exam select',()=>{
  const helper=section('function ensureLoadedExamOption(cData, draft)','function verifyLoadedExamForm(draft)');
  assert.match(helper,/option\.value = id/);
  assert.match(helper,/option\.dataset\.name = name/);
  assert.match(helper,/option\.textContent = name/);
  assert.match(helper,/select\.value = id/);
});

test('applyExamConfig does not depend on editor already being active',()=>{
  const apply=section('function applyExamConfig(cData)','function updateExamTeacherFilter()');
  assert.ok(!apply.includes("activeTab === 'tab-exam-editor'"));
  assert.match(apply,/ensureLoadedExamOption\(cData, examConfig\)/);
});

test('stored exam values are restored to all editable form groups',()=>{
  const apply=section('function applyExamConfig(cData)','function updateExamTeacherFilter()');
  for (const id of [
    'exam-config-time','exam-config-max-cheat-warnings','exam-config-max-attempts',
    'exam-config-mode','exam-config-password','exam-config-donvi','exam-config-lop',
    'exam-count-41-nb','exam-count-41-th','exam-count-41-vd',
    'exam-count-tf4-nb','exam-count-tf4-th','exam-count-tf4-vd',
    'exam-count-sq-nb','exam-count-sq-th','exam-count-sq-vd',
    'exam-count-tl-nb','exam-count-tl-th','exam-count-tl-vd',
    'exam-points-41','exam-points-tf4','exam-points-sq','exam-points-tl',
    'exam-config-ai-prompt','exam-config-ai-grading-key',
    'exam-access-enabled','exam-access-start','exam-access-end',
    'exam-config-sq-case-sensitive','exam-config-sq-punctuation-sensitive',
    'exam-config-immediate-feedback','exam-config-auto-grade-essay',
    'exam-config-show-score','exam-config-show-details',
    'exam-config-shared-results','exam-shared-code'
  ]) assert.ok(apply.includes(id),id);
  assert.match(apply,/tf4-points-/);
  assert.match(apply,/formatScoreInput4\(value\)/);
});

test('selected lessons are restored by normalized lesson keys',()=>{
  assert.match(app,/selectedLessonKeys\.has\(normalizeExamPoolLesson\(lesson\)\)/);
});

test('Nạp đề verifies the fully restored form before showing success',()=>{
  const load=section('window.loadExamConfigById = async function loadExamConfigById','window.openExportDocxModal');
  const applyAt=load.indexOf('applyExamConfig(payload.resJson.data)');
  const checkAt=load.indexOf('verifyLoadedExamForm(examConfig)');
  const switchAt=load.indexOf("switchTab('exam-editor')");
  assert.ok(applyAt>=0 && checkAt>applyAt && switchAt>checkAt);
  assert.match(load,/Form sửa đề chưa khôi phục đầy đủ cấu hình/);
});

test('stored unit is preferred over current teacher unit on load',()=>{
  const apply=section('function applyExamConfig(cData)','function updateExamTeacherFilter()');
  assert.match(apply,/const storedDonvi = String\(examConfig\.target_donvi/);
  assert.match(apply,/examConfig\.target_donvi = storedDonvi \|\| teacherDonvi/);
});
