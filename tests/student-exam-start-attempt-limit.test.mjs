import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseExamAttemptLimitError, buildExamAttemptLimitModal, fetchExamStartResponse } from '../src/student-exam-start-guard.js';

test('Limit error is displayed only for explicit quota denial (including legacy 403)', () => {
  assert.deepEqual(parseExamAttemptLimitError(403, { code: 'EXAM_ATTEMPT_LIMIT_REACHED', attemptCount: '2', maxAttempts: 2 }), { attemptCount: 2, maxAttempts: 2 });
  assert.deepEqual(parseExamAttemptLimitError(403, { error: '🛑 Bạn đã đạt giới hạn số lần làm bài thi này! (Bạn đã hoàn thành 3 lần / Tối đa 3 lần làm bài quy định).' }), { attemptCount: 3, maxAttempts: 3 });
  assert.equal(parseExamAttemptLimitError(403, { error: 'Không có quyền truy cập đề thi.' }), null);
  assert.equal(parseExamAttemptLimitError(401, {code: 'EXAM_ATTEMPT_LIMIT_REACHED'}), null);
  assert.equal(parseExamAttemptLimitError(403, { code: 'EXAM_PASSWORD_INCORRECT' }), null);
});
test('Dialog shows exact counts and escapes untrusted exam name', () => {
  const html=buildExamAttemptLimitModal('<img src=x onerror=alert(1)>',{attemptCount:2,maxAttempts:2});
  assert.match(html,/Đã làm:<\/span><strong>2 lượt/);
  assert.match(html,/Tối đa:<\/span><strong>2 lượt/);
  assert.match(html,/Còn lại:<\/span><strong>0 lượt/);
  assert.match(html,/id="exam-attempt-limit-confirm"/);
  assert.doesNotMatch(html,/<img/);
  assert.match(html,/&lt;img/);
});
test('Server response: parse JSON, do not invent numbers or decode HTML as JSON', async () => {
  const denied=await fetchExamStartResponse(async()=>({ok:false,status:403,text:async()=>JSON.stringify({code:'EXAM_ATTEMPT_LIMIT_REACHED',attemptCount:1,maxAttempts:1})}),'/api/exam/generate');
  assert.deepEqual(parseExamAttemptLimitError(denied.status,denied.body),{attemptCount:1,maxAttempts:1});
  const invalid=await fetchExamStartResponse(async()=>({ok:false,status:502,text:async()=>'<html>down</html>'}),'/api/exam/generate');
  assert.equal(invalid.body,null);
});
test('Hung network releases pending request by timeout', async () => {
  let aborted=false;
  await assert.rejects(fetchExamStartResponse((url,opts)=>new Promise((resolve,reject)=>{
    opts.signal.addEventListener('abort',()=>{aborted=true; reject(new Error('aborted'));});
  }),'/api/exam/generate',{},15),/quá thời gian/);
  assert.equal(aborted,true);
});
test('Exam starts timer only after authoritative server start; fullscreen keeps direct click activation', () => {
  const s=readFileSync('src/main.js','utf8');
  const region=s.slice(s.indexOf('window.startExam = async function startExam('),s.indexOf('function generateExamQuestions()',s.indexOf('window.startExam = async function startExam(')));
  assert.match(region,/if \(examStartPending\) return/);
  assert.match(region,/parseExamAttemptLimitError\(response.status, response.body\)/);
  assert.match(region,/showModal\(buildExamAttemptLimitModal/);
  assert.match(region,/finally \{\s*examStartPending = false;/);
  assert.match(region,/exam-start-ready-confirm/);
  assert.match(region,/readyButton.addEventListener\('click', async/);

  const readyStart=region.indexOf("readyButton.addEventListener('click', async");
  const readyRegion=region.slice(readyStart);
  const fullscreenAt=readyRegion.indexOf('window.enterExamFullscreen()');
  const serverStartAt=readyRegion.indexOf("fetch('/api/exam/start'");
  const startUiAt=readyRegion.indexOf('startExamUI()');
  assert.ok(fullscreenAt >= 0 && serverStartAt > fullscreenAt,
    'Fullscreen must be requested from the direct click before awaiting the server.');
  assert.ok(startUiAt > serverStartAt,
    'The exam UI/timer must start only after the server start request succeeds.');
  assert.match(readyRegion,/currentExam\.serverStartedAt = startResult\.startedAt/);
  assert.match(readyRegion,/currentExam\.serverElapsedSeconds/);
  assert.doesNotMatch(region,/KIỂM TRA TRƯỚC SỐ LẦN LÀM BÀI TRÊN CLIENT/);

  const generate=readFileSync('functions/api/exam/generate.ts','utf8');
  assert.match(generate,/code: 'EXAM_ATTEMPT_LIMIT_REACHED'/);
  const start=readFileSync('functions/api/exam/start.ts','utf8');
  assert.match(start,/EXAM_ATTEMPT_LIMIT_REACHED/);
  assert.match(start,/EXAM_ATTEMPT_ALREADY_ACTIVE/);
});
