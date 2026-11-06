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


test('TF4: all-false key NONE is valid and explicit false answers score correctly', () => {
  const full = evaluateTF4('NONE', {A:false,B:false,C:false,D:false});
  assert.equal(full.validKey, true);
  assert.equal(full.correctCount, 4);
  assert.equal(full.allCorrect, true);
  const blank = evaluateTF4('NONE', {});
  assert.equal(blank.correctCount, 0);
  assert.equal(blank.answeredCount, 0);
});

test('TF4: duplicate true-option keys are rejected', () => {
  assert.equal(evaluateTF4('A&A', {A:true,B:false,C:false,D:false}).validKey, false);
});

test('TF4 exhaustive: missing answers never score and every complete truth vector is exact', () => {
  const letters = ['A','B','C','D'];
  for (let mask = 0; mask < 16; mask++) {
    const expected = {};
    const trueLetters = [];
    for (let i = 0; i < 4; i++) {
      const value = Boolean(mask & (1 << i));
      expected[letters[i]] = value;
      if (value) trueLetters.push(letters[i]);
    }
    const key = trueLetters.length ? trueLetters.join('&') : 'NONE';

    const blank = evaluateTF4(key, {});
    assert.equal(blank.correctCount, 0, key + ' blank must score 0 statements');
    assert.equal(blank.allCorrect, false, key + ' blank must not be fully correct');

    const exact = evaluateTF4(key, expected);
    assert.equal(exact.correctCount, 4, key + ' exact vector');
    assert.equal(exact.allCorrect, true, key + ' exact vector');

    for (const letter of letters) {
      const partial = {...expected};
      delete partial[letter];
      const verdict = evaluateTF4(key, partial);
      assert.equal(verdict.answeredCount, 3, key + ' partial answered count');
      assert.equal(verdict.correctCount, 3, key + ' partial correct count');
      assert.equal(verdict.allCorrect, false, key + ' partial must not be fully correct');
    }
  }
});

test('SQ: unicode math slash and strict punctuation semantics are deterministic', () => {
  assert.equal(isShortAnswerCorrect('1⁄2', '1/2', {caseSensitive:false,punctuationSensitive:false}), true);
  assert.equal(isShortAnswerCorrect('a;b', 'a;b', {caseSensitive:true,punctuationSensitive:true}), true);
  assert.equal(isShortAnswerCorrect('a', 'a;b', {caseSensitive:true,punctuationSensitive:true}), false);
});


test('exam generation cannot be tricked into exposing answers or using another teacher bank', () => {
  const generate = fs.readFileSync(new URL('../functions/api/exam/generate.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(generate, /examConfig && \(examConfig\.immediateFeedback/);
  assert.match(generate, /immediate_feedback: mappedExam\.immediate_feedback \?\? 0/);
  assert.match(generate, /examFlagEnabled\(\s*activeExamConfig\.immediateFeedback \?\? activeExamConfig\.immediate_feedback/);
  assert.doesNotMatch(generate, /SELECT \* FROM questions'\)\.all\(\)/);
  assert.match(generate, /studentUserId: tokenUser\?\.user_id \|\| tokenUser\?\.id \|\| null/);
});

test('logged-in exam access ignores spoofed client class and unit', () => {
  const generate = fs.readFileSync(new URL('../functions/api/exam/generate.ts', import.meta.url), 'utf8');
  const tokenUserBranch = generate.slice(
    generate.indexOf('} else if (tokenUser) {'),
    generate.indexOf('} else {', generate.indexOf('} else if (tokenUser) {'))
  );
  assert.doesNotMatch(tokenUserBranch, /candidateInputDonvi/);
  const classMatch = generate.slice(generate.indexOf('const isLopMatched'), generate.indexOf('if \(!isLopMatched\)'));
  assert.doesNotMatch(classMatch, /candidateClass/);
});

test('question save validates answer key before persistence', () => {
  const questions = fs.readFileSync(new URL('../functions/api/questions.ts', import.meta.url), 'utf8');
  assert.match(questions, /validateQuestionAnswer/);
  assert.match(questions, /INVALID_QUESTION_ANSWER/);
  assert.match(questions, /INVALID_QUESTION_OPTIONS/);
});

test('submission replay is atomically gated at result persistence boundary', () => {
  const grade = fs.readFileSync(new URL('../functions/api/exam/grade.ts', import.meta.url), 'utf8');
  const claimPos = grade.indexOf('ON CONFLICT (token_hash) DO NOTHING');
  const scorePos = grade.indexOf('const finalScore');
  const insertResultPos = grade.indexOf('INSERT INTO results');
  assert.ok(claimPos > scorePos, 'claim must happen after validation/scoring');
  assert.ok(claimPos < insertResultPos, 'claim must happen before result insert');
  assert.match(grade, /DELETE FROM _submitted_exam_tokens WHERE token_hash = \? AND status = \?/);
  assert.match(grade, /alreadySubmitted: true/);
});

test('browser user id cannot become authenticated result identity', () => {
  const grade = fs.readFileSync(new URL('../functions/api/exam/grade.ts', import.meta.url), 'utf8');
  assert.match(grade, /let authenticatedUserId: any = null/);
  assert.doesNotMatch(grade, /let authenticatedUserId = studentInfo\.userId/);
  assert.match(grade, /Tài khoản nộp bài không khớp tài khoản đã nhận phiên thi/);
});
