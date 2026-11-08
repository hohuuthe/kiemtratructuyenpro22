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
