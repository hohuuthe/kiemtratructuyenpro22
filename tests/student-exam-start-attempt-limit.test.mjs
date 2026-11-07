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


test('start revalidates max attempts and atomically allows only one active session per student and exam', () => {
  const start=readFileSync('functions/api/exam/start.ts','utf8');
  assert.match(start,/SELECT COUNT\(\*\) AS count FROM results WHERE exam_id = \? AND user_id = \?/);
  assert.match(start,/_exam_active_attempts/);
  assert.match(start,/attemptKey = examId \+ ':' \+ signedStudentUserId/);
  assert.match(start,/ON CONFLICT \(attempt_key\) DO UPDATE SET/);
  assert.match(start,/EXAM_ATTEMPT_ALREADY_ACTIVE/);
  assert.match(start,/EXAM_ATTEMPT_COUNT_UNAVAILABLE/);
  assert.match(start,/EXAM_REVOKED_BEFORE_START/);
});

test('legacy attempt counting is only used for one canonical profile and normalized unit aliases', () => {
  const generate=readFileSync('functions/api/exam/generate.ts','utf8');
  const start=readFileSync('functions/api/exam/start.ts','utf8');
  for (const source of [generate,start]) {
    assert.match(source,/normalizeLegacyUnit/);
    assert.match(source,/normalize\('NFD'\)/);
    assert.match(source,/replace\(\/\[\\u0300-\\u036f\]\/g, ''\)/);
    assert.match(source,/replace\(\/\^truong\\s\+\/u, ''\)/);
    assert.match(source,/replace\(\/\^thpt\\s\+\/u, ''\)/);
    assert.match(source,/SELECT id, donvi FROM users/);
    assert.match(source,/matchingProfiles\.length === 1/);
    assert.match(source,/\(user_id IS NULL OR TRIM\(user_id\) = ''\)/);
    assert.match(source,/LOWER\(TRIM\(student_name\)\) = LOWER\(TRIM\(\?\)\)/);
    assert.match(source,/LOWER\(TRIM\(COALESCE\(lop,''\)\)\) = LOWER\(TRIM\(\?\)\)/);
    assert.match(source,/normalizeLegacyUnit\(row\?\.don_vi\) === canonicalProfileUnit/);
  }
});

test('unit scope includes configured target unit and does not rely on substring matching', () => {
  const generate=readFileSync('functions/api/exam/generate.ts','utf8');
  const region=generate.slice(
    generate.indexOf('// KIỂM TRA QUYỀN TRUY CẬP ĐỐI VỚI ĐỀ CHO ĐƠN VỊ'),
    generate.indexOf('// KIỂM TRA GIỚI HẠN SỐ LẦN LÀM BÀI')
  );
  assert.match(region,/activeExamConfig\.target_donvi/);
  assert.match(region,/activeExamConfig\.donvi/);
  assert.match(region,/allowedUnitSet\.has\(verifiedUserDonvi\)/);
  assert.doesNotMatch(region,/userDonvi\.includes|teacherDonvi\.includes|candidateInputDonvi/);
});


test('start fails closed if the authoritative started_at claim was not persisted', () => {
  const start=readFileSync('functions/api/exam/start.ts','utf8');
  assert.match(start,/EXAM_START_CLAIM_NOT_PERSISTED/);
  assert.match(start,/if \(!authoritative\?\.started_at\)/);
  assert.doesNotMatch(start,/authoritative\?\.started_at \|\| proposedStartedAt/);
  assert.doesNotMatch(start,/authoritative\?\.deadline_at \|\| proposedDeadlineAt/);
});
