import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { selectQuestionsStrictByDifficulty, ExamQuestionSelectionError } from '../src/exam-question-selector.ts';
import { validateExamQuestionPool } from '../src/exam-question-pool-validity.ts';
import { projectStudentResultRow } from '../src/student-result-visibility.ts';
import { examConfigGuardedDeleteStatement } from '../src/exam-config-deletion-policy.ts';

const identityShuffle = <T>(items: T[]) => [...items];

test('invalid question level is never coerced to NB in pool validation', () => {
  const config = {
    name: 'Ma tran',
    selected_lessons: ['Bai 1'],
    count_41: 1,
    count_tf4: 0,
    count_sq: 0,
    count_tl: 0,
    counts_detail: { count41NB: 1, count41TH: 0, count41VD: 0 }
  };
  const verdict = validateExamQuestionPool(config, [{
    id: 'q-invalid',
    type: '4-1',
    level: '',
    lesson: 'Bai 1',
    content: 'Cau hoi',
    options: { A: 'A', B: 'B', C: 'C', D: 'D' },
    answer: 'A'
  }]);
  assert.equal(verdict.valid, false);
  assert.equal(verdict.availableByType['4-1'], 0);
});

test('strict selector never substitutes another or invalid difficulty', () => {
  assert.throws(() => selectQuestionsStrictByDifficulty(
    [{ id: 'q1', type: '4-1', level: '' }],
    '4-1', 'Trac nghiem', 1, 1, 0, 0, identityShuffle
  ), ExamQuestionSelectionError);
});


test('legacy stored total cannot create a false shortage when exact difficulty matrix is satisfied', () => {
  const config = {
    name: 'De lich su',
    selected_lessons: ['Bai 1'],
    // Historical aggregate is stale. The editor would rewrite this to 3 on a no-op save.
    count_41: 4,
    count_tf4: 0,
    count_sq: 0,
    count_tl: 0,
    counts_detail: { count41NB: 1, count41TH: 1, count41VD: 1 }
  };
  const questions = [
    { id:'q1', type:'4-1', level:'NB', lesson:'Bai 1', content:'Q1', options:{A:'A',B:'B',C:'C',D:'D'}, answer:'A' },
    { id:'q2', type:'4-1', level:'TH', lesson:'Bai 1', content:'Q2', options:{A:'A',B:'B',C:'C',D:'D'}, answer:'B' },
    { id:'q3', type:'4-1', level:'VD', lesson:'Bai 1', content:'Q3', options:{A:'A',B:'B',C:'C',D:'D'}, answer:'C' }
  ];
  const verdict = validateExamQuestionPool(config, questions);
  assert.equal(verdict.valid, true);
  assert.equal(verdict.requiredTotal, 3);
  assert.equal(verdict.shortages.length, 0);
});

test('student exam readiness is server-authoritative and does not await metadata precheck', () => {
  const main = fs.readFileSync('src/main.js', 'utf8');
  const studentChangeStart = main.indexOf('window.onStudentExamNameChange');
  const verifyFunctionStart = main.indexOf('window.verifyExamQuestionsOnServer', studentChangeStart);
  assert.ok(studentChangeStart >= 0 && verifyFunctionStart > studentChangeStart);
  const studentChange = main.slice(studentChangeStart, verifyFunctionStart);
  assert.doesNotMatch(studentChange, /await\s+verifyExamQuestionsOnServer\s*\(/);

  const currentInfoStart = main.indexOf('window.updateCurrentExamInfo = function updateCurrentExamInfo');
  const currentInfoEnd = main.indexOf('// ==================== EXAM TAB', currentInfoStart);
  const currentInfo = main.slice(currentInfoStart, currentInfoEnd);
  assert.match(currentInfo, /hasStudentSelectedExam && !isAdminLoggedIn && !isTeacherLoggedIn[\s\S]*?isEnough = true/);
  assert.match(currentInfo, /Máy chủ sẽ xác minh chính xác khi bắt đầu/);

  const startExamStart = main.indexOf('window.startExam = async function startExam');
  const startExamEnd = main.indexOf('function generateExamQuestions()', startExamStart);
  const startExam = main.slice(startExamStart, startExamEnd);
  assert.match(startExam, /\/api\/exam\/generate/);
});

test('exam generation derives effective totals from NB TH VD matrix when present', () => {
  const generate = fs.readFileSync('functions/api/exam/generate.ts', 'utf8');
  assert.match(generate, /detailedTotals/);
  assert.match(generate, /if \(detailedTotals\.count41 > 0\) targetCount41 = detailedTotals\.count41/);
});

test('metadata ownership scope matches linked account identities', () => {
  const questionsApi = fs.readFileSync('functions/api/questions.ts', 'utf8');
  const server = fs.readFileSync('server.ts', 'utf8');
  for (const source of [questionsApi, server]) {
    assert.match(source, /creator_id IN \(SELECT user_id FROM accounts WHERE id = \?\)/);
    assert.match(source, /creator_id IN \(SELECT id FROM accounts WHERE user_id = \?\)/);
  }
});

test('exam hard delete is guarded against results and live READY/ACTIVE sessions', () => {
  const statement = examConfigGuardedDeleteStatement('exam-1', 'teacher-1', '2099-01-01T00:00:00.000Z');
  assert.match(statement.sql, /NOT EXISTS \(SELECT 1 FROM results WHERE exam_id = \?\)/);
  assert.match(statement.sql, /_exam_grade_sessions/);
  assert.equal(statement.params[2], 'exam-1');
  assert.equal(statement.params[3], 'exam-1');
});

test('pending essay grading cannot be exposed as a final student score', () => {
  const projected = projectStudentResultRow({
    id: 'r1',
    exam_id: 'e1',
    exam_name: 'De 1',
    score: 6,
    correct_count: 6,
    total_questions: 10,
    time_taken: 100,
    created_at: '2026-11-08T00:00:00.000Z',
    exam_show_score: 1,
    exam_show_details: 1,
    grading_status: 'PENDING'
  });
  assert.equal(projected.score, null);
  assert.equal(projected.correct_count, null);
  assert.equal(projected.score_finalized, false);
  assert.equal(projected.grading_status, 'PENDING');
});

test('READY session is bound to stored exam revision before START', () => {
  const generate = fs.readFileSync('functions/api/exam/generate.ts', 'utf8');
  const start = fs.readFileSync('functions/api/exam/start.ts', 'utf8');
  assert.match(generate, /examRevision/);
  assert.match(start, /EXAM_CHANGED_BEFORE_START/);
  assert.match(start, /frozenExamRevision/);
});

test('submission persistence has durable idempotency and ambiguous commit verification', () => {
  const grade = fs.readFileSync('functions/api/exam/grade.ts', 'utf8');
  assert.match(grade, /submission_token_hash/);
  assert.match(grade, /uq_results_submission_token_hash/);
  assert.match(grade, /ambiguous result commit/i);
  assert.match(grade, /resultId = String\(committed\.id\)/);
  assert.match(grade, /Keeping submission claim because commit state could not be proven/);
});

test('local metadata compatibility guard exists only in question route', () => {
  const server = fs.readFileSync('server.ts', 'utf8');
  const accountsStart = server.indexOf('app.post("/api/accounts"');
  const questionsStart = server.indexOf('app.get("/api/questions"');
  const questionPost = server.indexOf('app.post("/api/questions"', questionsStart);
  assert.ok(accountsStart >= 0 && questionsStart > accountsStart && questionPost > questionsStart);
  assert.doesNotMatch(server.slice(accountsStart, questionsStart), /metaOnly/);
  assert.match(server.slice(questionsStart, questionPost), /metaOnly/);
});

test('blocked native confirm fails closed', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const start = html.indexOf('window.confirm = function');
  assert.notEqual(start, -1);
  const block = html.slice(start, start + 220);
  assert.match(block, /return false;/);
  assert.doesNotMatch(block, /return true;/);
});


test('student selection renders loading, error and retry without blocking on external clocks', () => {
  const main = fs.readFileSync('src/main.js', 'utf8');
  const start = main.indexOf('window.onStudentExamNameChange = async function');
  const end = main.indexOf('window._verifyQuestionsSeq = 0;', start);
  assert.ok(start >= 0 && end > start);
  const selection = main.slice(start, end);
  assert.match(selection, /status: 'loading'/);
  assert.match(selection, /status: 'ready'/);
  assert.match(selection, /status: 'error'/);
  assert.match(selection, /fetchExamStartResponse\(fetch, detailUrl/);
  assert.doesNotMatch(selection, /await getInternetTime\(/);
  assert.match(selection, /studentExamReferenceTime\(\)/);
  assert.match(selection, /currentExamSeq !== window\._studentExamChangeSeq/);

  const statusStart = main.indexOf('window.updateCurrentExamInfo = function');
  const statusEnd = main.indexOf('// ==================== EXAM TAB', statusStart);
  const info = main.slice(statusStart, statusEnd);
  assert.match(info, /Đang tải đề thi\.\.\./);
  assert.match(info, /Thử tải lại đề thi/);
  assert.match(info, /loadMatches/);
  assert.match(info, /startBtn\.disabled = true;/);

  const begin = main.indexOf('window.startExam = async function');
  const finish = main.indexOf('function generateExamQuestions()', begin);
  const submit = main.slice(begin, finish);
  assert.match(submit, /loadingState\.status === 'error'/);
  assert.match(submit, /await window\.onStudentExamNameChange\(\)/);
  assert.doesNotMatch(submit, /await getInternetTime\(/);
  assert.match(submit, /studentExamReferenceTime\(\)/);
  assert.match(submit, /\/api\/exam\/generate/);
});

test('student exam detail bypasses teacher editor and returns server time', () => {
  const main = fs.readFileSync('src/main.js', 'utf8');
  const beginning = main.indexOf('function applyExamConfig(cData)');
  const editor = main.indexOf('examEditorRevision += 1;', beginning);
  assert.ok(beginning >= 0 && editor > beginning);
  assert.match(main.slice(beginning, editor), /if \(!isAdminLoggedIn && !isTeacherLoggedIn\)/);
  assert.match(main.slice(beginning, editor), /updateCurrentExamInfo\(\);[\s\S]*?return;/);

  const api = fs.readFileSync('functions/api/exams.ts', 'utf8');
  const local = fs.readFileSync('server.ts', 'utf8');
  assert.match(api, /server_now_ms: Date\.now\(\)/);
  assert.match(local, /server_now_ms: Date\.now\(\)/);
  assert.match(api, /isStudentTeacherPicker/);
  assert.match(api, /SELECT target_lop, lop, max_attempts, keep_raw_score, tieu_de_bai_thi FROM exam_configs LIMIT 0/);
});


test('teacher exam selector has bounded request and visible progress', () => {
  const main = fs.readFileSync('src/main.js', 'utf8');
  const begin = main.indexOf('window.onStudentTeacherFilterChange = async function');
  const finish = main.indexOf('window._studentExamChangeSeq = 0;', begin);
  const teacher = main.slice(begin, finish);
  assert.match(teacher, /_studentTeacherListLoading = true/);
  assert.match(teacher, /fetchExamStartResponse\(fetch,/);
  assert.match(teacher, /\/api\/exams\?teacherId=/);
  assert.match(teacher, /finally \{/);
  assert.match(teacher, /_studentTeacherListLoading = false/);
  assert.match(main, /Đang tải danh sách đề thi\.\.\./);
});
