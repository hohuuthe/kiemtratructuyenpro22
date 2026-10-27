import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync('public/components/tab-exam-editor.html','utf8');
const edge=readFileSync('functions/api/exam/grade.ts','utf8');
const express=readFileSync('server.ts','utf8');
const ui=readFileSync('src/main.js','utf8');

test('exam editor has a separate key pool and explicit per-key test button',()=>{
  assert.match(page,/id="exam-config-ai-grading-key"/);
  assert.match(page,/id="btn-test-exam-grading-keys"/);
  assert.match(page,/onclick="validateAIGradingKey\(document.getElementById\('exam-config-ai-grading-key'\).value\)"/);
  assert.match(ui,/window.validateAIGradingKey = async function/);
  assert.match(ui,/Promise.all\(rawKeys.map\(k => testSingleGeminiKey\(k\)\)\)/);
});
test('both backends choose key by signed exam ID plus owner, never student-supplied ID or name',()=>{
  for(const code of [edge,express]){
    const grading=code.slice(code.indexOf('const { questionIds, examConfig'));
    assert.match(grading,/String\(examConfig(?:\?)?\.id \|\| ''\)/);
    assert.match(grading,/SELECT ai_grading_key FROM exam_configs WHERE id = \? AND creator_id = \?/);
    assert.match(grading,/SELECT ai_grading_key FROM app_settings WHERE id = 1/);
    assert.doesNotMatch(grading.slice(0,grading.indexOf('const normalizeTypeForGrading')>0?grading.indexOf('const normalizeTypeForGrading'):grading.indexOf('2. Truy xuất câu hỏi gốc')),/studentInfo\.examId|studentInfo\.examName/);
  }
});
test('key failover maintains unique list and valid opt-in flag',()=>{
 for(const code of [edge,express]){
  assert.match(code,/new Set\(\(aiKey \|\| ''\)\.trim\(\)\.split\(\/\\s\+\/\)/);
  assert.match(code,/currentKeyIdx\+\+/);
  assert.match(code,/gradeFlag\(examConfig.autoGradeEssay \?\? examConfig.auto_grade_essay\)/);
  assert.match(code,/const responseJson: any = await res.json\(\)/);
  assert.match(code,/Number\.isFinite\(value\)/);
 }
});
