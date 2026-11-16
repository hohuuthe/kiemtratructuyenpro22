import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync('src/main.js','utf8');
const recover = readFileSync('functions/api/exam/recover.ts','utf8');

test('registered or school learner gets active session preflight before READY generation', () => {
  const start = main.slice(main.indexOf('window.startExam = async function startExam('),
    main.indexOf('function generateExamQuestions()', main.indexOf('window.startExam = async function startExam(')));
  const beforeReady = start.indexOf('await offerActiveExamBeforeReady(selectedExamId');
  const generate = start.indexOf("fetchExamStartResponse(fetch, '/api/exam/generate'");
  assert.ok(beforeReady > 0 && generate > beforeReady, 'ACTIVE recovery must precede new READY generation');
  assert.match(main,/async function offerActiveExamBeforeReady\(examId, details\)/);
  assert.match(main,/if \(response\.status === 409 && recovered\.code === 'EXAM_RECOVER_NOT_FOUND'\) return false/);
  assert.match(main,/await tryResumeActiveExam\(\{\s*token: recovered\.token, meta: resumeMeta, allowOtherTab: true/);
});

test('recovery no-lock result does not show misleading READY cancellation and is safe in a fresh tenant', () => {
  assert.match(recover,/CREATE TABLE IF NOT EXISTS _exam_active_attempts/);
  assert.match(recover,/if \(!activeLock\) return json\(\{/);
  assert.match(recover,/code:'EXAM_RECOVER_NOT_FOUND'/);
  assert.match(recover,/verifyAuthSession/);
  assert.match(recover,/verifyContestTicket/);
});

test('real tab exit dialog is singular, has visible stay and explicit destructive action', () => {
  assert.match(main,/let examLeaveDialogOpen = false/);
  assert.match(main,/if \(examLeaveDialogOpen\) return/);
  assert.match(main,/id="exam-leave-stay"/);
  assert.match(main,/id="exam-leave-confirm"/);
  assert.match(main,/showActiveExamLeaveDialog\(tabName, activeExamOwnerTab\)/);
  assert.match(main,/examLeaveDialogOpen = false;\s*if \(window\.__mathTypeExamExportController\)/);
  const confirm = main.slice(main.indexOf('function showActiveExamLeaveDialog('),main.indexOf('function switchTab(',main.indexOf('function showActiveExamLeaveDialog(')));
  assert.doesNotMatch(confirm,/resetExam\(\);\s*requestedTab = ownerTab/);
  assert.match(confirm,/leave\.addEventListener\('click', \(\) => \{\s*closeModal\(\);\s*resetExam\(\)/);
});

test('question navigation cannot trigger cancel-exam guard', () => {
  const render = main.slice(main.indexOf('function renderCurrentQuestion('),
    main.indexOf('function renderMultipleChoice(',main.indexOf('function renderCurrentQuestion(')));
  const matches = render.match(/type="button" onclick="openExamQuestionNavigator\(\)"/g) || [];
  assert.equal(matches.length,3);
  assert.doesNotMatch(render,/onclick="switchTab\('exam'\)"/);
  assert.match(main,/window\.openExamQuestionNavigator = \(\) => scrollExamQuestionNavigator\(document\)/);
});
