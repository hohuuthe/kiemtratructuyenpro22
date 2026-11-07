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
test('Front end never enters fullscreen before server accepts exam start', () => {
  const s=readFileSync('src/main.js','utf8');
  const region=s.slice(s.indexOf('window.startExam = async function startExam('),s.indexOf('function generateExamQuestions()',s.indexOf('window.startExam = async function startExam(')));
  assert.match(region,/if \(examStartPending\) return/);
  assert.match(region,/parseExamAttemptLimitError\(response.status, response.body\)/);
  assert.match(region,/showModal\(buildExamAttemptLimitModal/);
  assert.match(region,/finally \{\s*examStartPending = false;/);
  assert.doesNotMatch(region,/enterExamFullscreen\(/);
  assert.match(region,/exam-start-ready-confirm/);
  assert.match(region,/readyButton.addEventListener\('click'/);
  assert.match(region,/startExamUI\(\)/);
  assert.doesNotMatch(region,/KIỂM TRA TRƯỚC SỐ LẦN LÀM BÀI TRÊN CLIENT/);
  for(const path of ['functions/api/exam/generate.ts','server.ts']) {
    const backend=readFileSync(path,'utf8');
    assert.match(backend,/code: 'EXAM_ATTEMPT_LIMIT_REACHED', attemptCount, maxAttempts: maxAttemptsVal/);
  }
});


test('attempt limits are bound only to authenticated user_id and exact exam_id', () => {
  const backend=readFileSync('functions/api/exam/generate.ts','utf8');
  assert.match(backend,/EXAM_ATTEMPT_LOGIN_REQUIRED/);
  assert.match(backend,/WHERE exam_id = \? AND user_id = \?/);
  assert.doesNotMatch(
    backend.slice(
      backend.indexOf('// KIỂM TRA GIỚI HẠN SỐ LẦN LÀM BÀI'),
      backend.indexOf('// Chuẩn hóa và đối sánh bài học')
    ),
    /student_name|exam_name/
  );
  assert.match(backend,/EXAM_ATTEMPT_COUNT_UNAVAILABLE/);
});

test('unit-scoped exams require authenticated exact unit and exact class membership', () => {
  const backend=readFileSync('functions/api/exam/generate.ts','utf8');
  const region=backend.slice(
    backend.indexOf('// KIỂM TRA QUYỀN TRUY CẬP ĐỐI VỚI ĐỀ CHO ĐƠN VỊ'),
    backend.indexOf('// KIỂM TRA GIỚI HẠN SỐ LẦN LÀM BÀI')
  );
  assert.match(region,/EXAM_UNIT_LOGIN_REQUIRED/);
  assert.match(region,/EXAM_UNIT_SCOPE_INVALID/);
  assert.match(region,/EXAM_UNIT_MISMATCH/);
  assert.match(region,/allowedUnitSet\.has\(verifiedUserDonvi\)/);
  assert.match(region,/allowedLops\.includes\(userLop\)/);
  assert.doesNotMatch(region,/candidateInputDonvi/);
  assert.doesNotMatch(region,/\.includes\(teacherDonvi\)/);
  assert.doesNotMatch(region,/teacherDonvi\.includes/);
  assert.doesNotMatch(region,/\.endsWith\(userLop\)|userLop\.endsWith/);
});
