import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  evaluateTF4,
  isShortAnswerCorrect,
  normalizeShortAnswer,
  examFlagEnabled,
  clampScore,
  roundScore
} from '../src/exam-grading-core.js';

test('TF4: unanswered statements never receive credit', () => {
  assert.deepEqual(evaluateTF4('A&C', {}), {
    validKey: true,
    answeredCount: 0,
    correctCount: 0,
    allCorrect: false
  });
  assert.deepEqual(evaluateTF4('A', {}), {
    validKey: true,
    answeredCount: 0,
    correctCount: 0,
    allCorrect: false
  });
});

test('TF4: false is creditable only when student explicitly answered false', () => {
  const partial = evaluateTF4('A&C', { B: false, D: false });
  assert.equal(partial.answeredCount, 2);
  assert.equal(partial.correctCount, 2);
  assert.equal(partial.allCorrect, false);

  const full = evaluateTF4('A&C', { A: true, B: false, C: true, D: false });
  assert.equal(full.answeredCount, 4);
  assert.equal(full.correctCount, 4);
  assert.equal(full.allCorrect, true);
});

test('TF4: legacy explicit and ordered formats remain supported', () => {
  assert.equal(evaluateTF4('A:Đ&B:S&C:Đ&D:S', {A:true,B:false,C:true,D:false}).allCorrect, true);
  assert.equal(evaluateTF4('Đ,S,Đ,S', {A:true,B:false,C:true,D:false}).allCorrect, true);
});

test('SQ: mathematical meaning is preserved', () => {
  const opts = {caseSensitive:false, punctuationSensitive:false};
  assert.equal(isShortAnswerCorrect('2', '-2', opts), false);
  assert.equal(isShortAnswerCorrect('12', '1/2', opts), false);
  assert.equal(isShortAnswerCorrect('15', '1.5', opts), false);
  assert.equal(isShortAnswerCorrect('1,5', '1.5', opts), true);
  assert.equal(isShortAnswerCorrect(' - 2 ', '-2', opts), true);
  assert.equal(isShortAnswerCorrect('1 / 2', '1/2', opts), true);
});

test('SQ: alternatives and normal text remain supported', () => {
  const opts = {caseSensitive:false, punctuationSensitive:false};
  assert.equal(isShortAnswerCorrect('Hà Nội', 'hà nội|HN', opts), true);
  assert.equal(isShortAnswerCorrect('hn', 'Hà Nội|HN', opts), true);
  assert.equal(normalizeShortAnswer('Đúng!', opts), 'đúng');
});

test('boolean flags treat persisted 0 and "0" as false', () => {
  assert.equal(examFlagEnabled(0, true), false);
  assert.equal(examFlagEnabled('0', true), false);
  assert.equal(examFlagEnabled(false, true), false);
  assert.equal(examFlagEnabled(1, false), true);
  assert.equal(examFlagEnabled('1', false), true);
});

test('essay score is clamped and score precision keeps quarter points', () => {
  assert.equal(clampScore(1.5, 1), 1);
  assert.equal(clampScore(-0.25, 1), 0);
  assert.equal(roundScore(0.25, 2), 0.25);
  assert.equal(roundScore(7.25, 2), 7.25);
  assert.equal(roundScore(0.1 + 0.2, 2), 0.3);
});

test('server grading uses immutable snapshots and fail-closed persistence', () => {
  const generate = fs.readFileSync(new URL('../functions/api/exam/generate.ts', import.meta.url), 'utf8');
  const grade = fs.readFileSync(new URL('../functions/api/exam/grade.ts', import.meta.url), 'utf8');
  assert.match(generate, /_exam_grade_sessions/);
  assert.match(generate, /question_snapshot/);
  assert.match(grade, /gradingSessionId/);
  assert.match(grade, /Snapshot chấm điểm/);
  assert.match(grade, /Phiên thi chưa bị đánh dấu đã nộp/);
});

test('manual grading API preserves objective details and recomputes canonical total', () => {
  const results = fs.readFileSync(new URL('../functions/api/results.ts', import.meta.url), 'utf8');
  assert.match(results, /if \(type !== 'TL'\) return storedDetail/);
  assert.match(results, /canonicalScore/);
  assert.match(results, /clampScore/);
});

test('browser uses shared grading core and no one-decimal manual score rounding', () => {
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /from '.\/exam-grading-core\.js'/);
  assert.match(main, /roundScore\(newTotalScore, 2\)/);
  assert.doesNotMatch(main, /newTotalScore\) \|\| 0\)\.toFixed\(1\)/);
});
