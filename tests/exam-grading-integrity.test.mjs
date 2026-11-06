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


test('hidden-detail responses strip nested question.answer and correctness hints', () => {
  const grade = fs.readFileSync(new URL('../functions/api/exam/grade.ts', import.meta.url), 'utf8');
  assert.match(grade, /sanitizeGradingDetailForClient/);
  assert.match(grade, /const \{ answer, \.\.\.safeQuestion \} = question/);
  assert.match(grade, /const \{ correctAnswer, aiFeedback, isCorrect, correctStatements, \.\.\.safeD \}/);
});

test('public shared result API is summary-only', () => {
  const results = fs.readFileSync(new URL('../functions/api/results.ts', import.meta.url), 'utf8');
  assert.match(results, /if \(idParam && !user\)/);
  assert.match(results, /if \(examIdParam && !user && includeDetails\)/);
});


test('second audit: authoritative exam identity, time and AI key cannot come from browser', () => {
  const grade = fs.readFileSync(new URL('../functions/api/exam/grade.ts', import.meta.url), 'utf8');
  assert.match(grade, /authoritativeExamId/);
  assert.doesNotMatch(grade, /studentInfo\.examId\).*ai_grading_key/);
  assert.match(grade, /authoritativeTimeTaken/);
  assert.match(grade, /serverStartedAtMs/);
  assert.doesNotMatch(grade, /const issuedAtMs = Number\(decoded\.timestamp\)/);
  assert.match(grade, /String\(examConfig\.name \|\| studentInfo\.examName \|\| ''\)/);
});

test('second audit: config and UI use one two-decimal score precision contract', () => {
  const contract = fs.readFileSync(new URL('../src/exam-config-contract.ts', import.meta.url), 'utf8');
  const editor = fs.readFileSync(new URL('../public/components/tab-exam-editor.html', import.meta.url), 'utf8');
  const generate = fs.readFileSync(new URL('../functions/api/exam/generate.ts', import.meta.url), 'utf8');
  assert.match(contract, /tối đa 2 chữ số thập phân/);
  assert.doesNotMatch(editor, /step="0\.001"/);
  assert.match(editor, /id="tf4-points-2" value="0\.50"/);
  assert.match(editor, /id="tf4-points-3" value="0\.75"/);
  assert.match(editor, /id="tf4-points-4" value="1\.00"/);
  assert.match(generate, /hasTwoDecimalPrecision/);
});

test('second audit: image-only MC options remain valid through save and generation filters', () => {
  const questions = fs.readFileSync(new URL('../functions/api/questions.ts', import.meta.url), 'utf8');
  const generate = fs.readFileSync(new URL('../functions/api/exam/generate.ts', import.meta.url), 'utf8');
  assert.match(questions, /!text && !image/);
  assert.match(generate, /Boolean\(text \|\| image\)/);
});


test('third audit: client question order must exactly match signed issued order', () => {
  const grade = fs.readFileSync(new URL('../functions/api/exam/grade.ts', import.meta.url), 'utf8');
  assert.match(grade, /const issuedQuestionIds = questionIds\.map/);
  assert.match(grade, /new Set\(issuedQuestionIds\)\.size !== issuedQuestionIds\.length/);
  assert.match(grade, /clientQuestions\[i\]\?\.id \?\? clientQuestions\[i\]\?\.questionId/);
  assert.match(grade, /Thứ tự câu hỏi nộp bài không khớp phiên đã phát/);
});

test('third audit: snapshot order and answer-key integrity fail closed', () => {
  const grade = fs.readFileSync(new URL('../functions/api/exam/grade.ts', import.meta.url), 'utf8');
  assert.match(grade, /Snapshot chấm điểm không khớp chính xác thứ tự câu hỏi đã phát/);
  assert.match(grade, /validateQuestionAnswer\(trueQ\.type, trueQ\.answer, trueQ\.options\)/);
  assert.match(grade, /Không tìm thấy dữ liệu chấm điểm của câu/);
  assert.match(grade, /Khóa đáp án câu .* không hợp lệ/);
});

test('third audit: grading validates signed point precision and custom TF4 map', () => {
  const grade = fs.readFileSync(new URL('../functions/api/exam/grade.ts', import.meta.url), 'utf8');
  assert.match(grade, /const readPoint = \(value: any, fallback: number, label: string\): number \| null/);
  assert.match(grade, /Math\.abs\(n \* 100 - Math\.round\(n \* 100\)\) > 1e-9/);
  assert.match(grade, /const customTf4Mode = examFlagEnabled/);
  assert.match(grade, /Bảng điểm Đúng\/Sai tùy chỉnh không hợp lệ; hệ thống chưa lưu kết quả/);
});


test('final hardening: SQ recognizes only safe numeric equivalence', () => {
  const opts = {caseSensitive:false, punctuationSensitive:false};
  assert.equal(isShortAnswerCorrect('1.50', '1.5', opts), true);
  assert.equal(isShortAnswerCorrect('+2', '2', opts), true);
  assert.equal(isShortAnswerCorrect('1/2', '0.5', opts), true);
  assert.equal(isShortAnswerCorrect('1e-3', '0.001', opts), true);
  assert.equal(isShortAnswerCorrect('2/0', '0', opts), false);
  assert.equal(isShortAnswerCorrect('1+1', '2', opts), false);
  assert.equal(isShortAnswerCorrect('Math.random()', '0.5', opts), false);
  assert.equal(isShortAnswerCorrect('1,5', '1.5', {caseSensitive:false,punctuationSensitive:true}), false);
});

test('final hardening: custom essay prompt is frozen and AI invalid scores never become completed zero', () => {
  const security = fs.readFileSync(new URL('../functions/api/exam/security.ts', import.meta.url), 'utf8');
  const grade = fs.readFileSync(new URL('../functions/api/exam/grade.ts', import.meta.url), 'utf8');
  const generate = fs.readFileSync(new URL('../functions/api/exam/generate.ts', import.meta.url), 'utf8');
  assert.match(security, /'aiPrompt','ai_prompt'/);
  assert.match(generate, /tokenGradeSessionConfig/);
  assert.match(generate, /aiPrompt: _aiPrompt, ai_prompt: _aiPromptSnake/);
  assert.match(grade, /const teacherPrompt = String/);
  assert.match(grade, /examConfig\.aiPrompt \?\? examConfig\.ai_prompt/);
  assert.match(grade, /Number\.isFinite\(numericEssayScore\)/);
  assert.match(grade, /numericEssayScore < 0 \|\| numericEssayScore > pTL/);
  assert.match(grade, /gradingStatus = 'pending_manual'/);
  assert.match(grade, /scoreFinalized: !hasPendingEssayGrades/);
  assert.doesNotMatch(grade, /const essayScore = clampScore\(parsed\.score, pTL\)/);
});

test('final hardening: manual essay updates bind exact question IDs and reject invalid scores', () => {
  const results = fs.readFileSync(new URL('../functions/api/results.ts', import.meta.url), 'utf8');
  assert.match(results, /storedQuestionId/);
  assert.match(results, /incomingQuestionId/);
  assert.match(results, /storedQuestionId !== incomingQuestionId/);
  assert.match(results, /!Number\.isFinite\(requestedScore\)/);
  assert.match(results, /requestedScore < 0 \|\| requestedScore > maxScore/);
  assert.match(results, /gradingStatus: 'completed_manual'/);
});


test('fourth audit: submission shape, immutable snapshot and replay response fail closed', () => {
  const grade = fs.readFileSync(new URL('../functions/api/exam/grade.ts', import.meta.url), 'utf8');
  assert.match(grade, /Array\.isArray\(studentAnswers\)/);
  assert.match(grade, /studentAnswers\.length !== questionIds\.length/);
  assert.match(grade, /Phiên thi không có snapshot chấm điểm bất biến/);
  assert.doesNotMatch(grade, /SELECT \* FROM questions WHERE id IN/);
  assert.match(grade, /gradingPending: hasPendingEssayGrading\(details\)/);
  assert.match(grade, /scoreFinalized: !hasPendingEssayGrading\(details\)/);
});

test('fourth audit: server start timestamp is mandatory and bounds result time', () => {
  const generate = fs.readFileSync(new URL('../functions/api/exam/generate.ts', import.meta.url), 'utf8');
  const start = fs.readFileSync(new URL('../functions/api/exam/start.ts', import.meta.url), 'utf8');
  const grade = fs.readFileSync(new URL('../functions/api/exam/grade.ts', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(generate, /started_at TEXT/);
  assert.match(start, /UPDATE _exam_grade_sessions SET started_at/);
  assert.match(start, /Tài khoản bắt đầu bài thi không khớp phiên đã phát/);
  assert.match(grade, /serverStartedAtMs/);
  assert.doesNotMatch(grade, /submissionTransportGraceSeconds/);
  assert.match(grade, /elapsedByServer > signedLimitSeconds/);
  assert.match(main, /fetch\('\/api\/exam\/start'/);
  assert.match(main, /currentExam\.serverStartedAt = startResult\.startedAt/);
});

test('fourth audit: forced submission freezes answers and failed early submit resumes same timer', () => {
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /lockedSubmissionAnswers/);
  assert.match(main, /submitContext\?\.autoReason === 'time_expired'/);
  assert.match(main, /submitContext\?\.autoReason === 'cheat_limit'/);
  assert.match(main, /startTimer\(\);[\s\S]{0,500}Đồng hồ vẫn tiếp tục từ thời gian thực của phiên thi/);
  assert.match(main, /setTimeout\(\(\) => \{ window\.intentionalFullscreenExit = false; \}, 800\)/);
});

test('fourth audit: candidate identity is frozen at issue time', () => {
  const generate = fs.readFileSync(new URL('../functions/api/exam/generate.ts', import.meta.url), 'utf8');
  const grade = fs.readFileSync(new URL('../functions/api/exam/grade.ts', import.meta.url), 'utf8');
  assert.match(generate, /studentName: issuedStudentName/);
  assert.match(generate, /studentLop: issuedStudentLop/);
  assert.match(generate, /studentDonvi: issuedStudentDonvi/);
  assert.match(grade, /sessionStudentName/);
  assert.match(grade, /sessionStudentLop/);
  assert.match(grade, /sessionStudentDonvi/);
});


test('fifth audit: attempt slots are atomically reserved only at actual server start', () => {
  const generate = fs.readFileSync(new URL('../functions/api/exam/generate.ts', import.meta.url), 'utf8');
  const start = fs.readFileSync(new URL('../functions/api/exam/start.ts', import.meta.url), 'utf8');
  const grade = fs.readFileSync(new URL('../functions/api/exam/grade.ts', import.meta.url), 'utf8');
  assert.match(generate, /maxAttempts:/);
  assert.match(start, /CREATE TABLE IF NOT EXISTS _exam_attempt_slots/);
  assert.match(start, /PRIMARY KEY \(exam_id, candidate_key, attempt_no\)/);
  assert.match(start, /session_id TEXT NOT NULL UNIQUE/);
  assert.match(start, /ON CONFLICT DO NOTHING/);
  assert.match(start, /EXAM_ATTEMPT_LIMIT_REACHED/);
  assert.match(grade, /UPDATE _exam_attempt_slots SET completed_at = \?, result_id = \?/);
});

test('fifth audit: submission deadline uses request arrival, not AI processing completion', () => {
  const grade = fs.readFileSync(new URL('../functions/api/exam/grade.ts', import.meta.url), 'utf8');
  assert.match(grade, /const requestReceivedAtMs = Date\.now\(\)/);
  assert.match(grade, /requestReceivedAtMs - serverStartedAtMs/);
  assert.doesNotMatch(grade, /Math\.floor\(\(Date\.now\(\) - serverStartedAtMs\)/);
});

test('fifth audit: client timer is synchronized to server elapsed time', () => {
  const start = fs.readFileSync(new URL('../functions/api/exam/start.ts', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(start, /elapsedSeconds/);
  assert.match(main, /currentExam\.serverElapsedSeconds = Math\.max/);
  assert.match(main, /performance\.now\(\) - \(serverElapsedSeconds \* 1000\)/);
});

test('fifth audit: AI essay score is advisory until teacher confirmation', () => {
  const grade = fs.readFileSync(new URL('../functions/api/exam/grade.ts', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(grade, /d\.aiSuggestedScore = essayScore/);
  assert.match(grade, /d\.gradingStatus = 'pending_manual_ai_suggested'/);
  assert.match(grade, /d\.needsGrading = true/);
  assert.doesNotMatch(grade, /d\.gradingStatus = 'completed';\s*d\.needsGrading = false;\s*rawEarnedScore \+= essayScore/);
  assert.match(main, /d\.aiSuggestedScore \?\? d\.score \?\? 0/);
  assert.match(main, /AI đề xuất:/);
});

test('fifth audit: concurrent manual essay grading uses compare-and-swap', () => {
  const results = fs.readFileSync(new URL('../functions/api/results.ts', import.meta.url), 'utf8');
  assert.match(results, /originalDetailsRaw/);
  assert.match(results, /WHERE id = \? AND details = \?/);
  assert.match(results, /RESULT_GRADING_CONFLICT/);
});

test('fifth audit: stale crashed persistence claim is recoverable but fresh claim is not', () => {
  const grade = fs.readFileSync(new URL('../functions/api/exam/grade.ts', import.meta.url), 'utf8');
  assert.match(grade, /Date\.now\(\) - claimedAtMs > 120000/);
  assert.match(grade, /claimed_at = \? AND NOT EXISTS \(SELECT 1 FROM results WHERE id = \?\)/);
});


test('sixth audit: on-time answer checkpoints protect deadline recovery without accepting late edits', () => {
  const checkpoint = fs.readFileSync(new URL('../functions/api/exam/checkpoint.ts', import.meta.url), 'utf8');
  const grade = fs.readFileSync(new URL('../functions/api/exam/grade.ts', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(checkpoint, /requestReceivedAtMs > startedAtMs \+ limitSeconds \* 1000/);
  assert.match(checkpoint, /ON CONFLICT \(session_id\) DO UPDATE SET/);
  assert.match(checkpoint, /WHERE _exam_answer_checkpoints\.sequence < EXCLUDED\.sequence/);
  assert.match(grade, /SELECT question_ids, answers, saved_at FROM _exam_answer_checkpoints/);
  assert.match(grade, /checkpointSavedAtMs > deadlineMs/);
  assert.match(grade, /gradingAnswers = checkpointAnswers/);
  assert.match(grade, /recoveredFromCheckpoint = true/);
  assert.match(main, /fetch\('\/api\/exam\/checkpoint'/);
  assert.match(main, /window\.backupExamState = function backupExamState/);
  assert.match(main, /checkpointInterval = setInterval/);
});

test('sixth audit: no client answers are trusted after exact deadline', () => {
  const grade = fs.readFileSync(new URL('../functions/api/exam/grade.ts', import.meta.url), 'utf8');
  assert.match(grade, /if \(elapsedByServer > signedLimitSeconds\)/);
  assert.doesNotMatch(grade, /elapsedByServer > signedLimitSeconds \+/);
  assert.match(grade, /SUBMISSION_AFTER_DEADLINE_NO_CHECKPOINT/);
});

test('sixth audit: one candidate cannot run multiple attempts concurrently', () => {
  const start = fs.readFileSync(new URL('../functions/api/exam/start.ts', import.meta.url), 'utf8');
  assert.match(start, /idx_exam_attempt_slots_one_active/);
  assert.match(start, /WHERE completed_at IS NULL/);
  assert.match(start, /EXAM_ATTEMPT_ALREADY_ACTIVE/);
  assert.match(start, /attemptExpiresAt/);
});


test('seventh audit: immediate feedback never exposes answer keys to the browser', () => {
  const generate = fs.readFileSync(new URL('../functions/api/exam/generate.ts', import.meta.url), 'utf8');
  const feedback = fs.readFileSync(new URL('../functions/api/exam/feedback.ts', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

  assert.doesNotMatch(generate, /if \(isImmediateFeedback\)[\s\S]{0,200}return \{ \.\.\.q \}/);
  assert.match(generate, /answer,[\s\S]{0,220}correctAnswer: questionCorrectAnswer[\s\S]{0,220}\.\.\.qWithoutAnswer/);
  assert.match(generate, /correctAnswer: optionCorrectAnswer/);
  assert.match(generate, /answerKey: optionAnswerKey/);
  assert.match(feedback, /SELECT question_ids, question_snapshot, exam_config, started_at FROM _exam_grade_sessions/);
  assert.match(feedback, /allCorrect:/);
  assert.doesNotMatch(feedback, /correctAnswer\s*:/);
  assert.match(main, /fetch\('\/api\/exam\/feedback'/);

  const examUiStart = main.indexOf('function renderQuestionNav()');
  const examUiEnd = main.indexOf('// ==================== EXAM ANTI-CHEAT & MONITORING', examUiStart);
  assert.ok(examUiStart >= 0 && examUiEnd > examUiStart);
  const studentFeedbackUi = main.slice(examUiStart, examUiEnd);
  assert.doesNotMatch(studentFeedbackUi, /q\.answer/);
  assert.doesNotMatch(studentFeedbackUi, /Đáp án đúng:/);
  assert.match(studentFeedbackUi, /currentExam\.feedback/);
});

test('seventh audit: changing an answer invalidates stale immediate feedback', () => {
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /delete currentExam\.feedback\[index\]/);
  assert.match(main, /requestImmediateExamFeedback\(index, option\)/);
  assert.match(main, /selectedCorrect === true/);
});


test('eighth audit: exact identity prevents false attempt-limit collisions', () => {
  const generate = fs.readFileSync(new URL('../functions/api/exam/generate.ts', import.meta.url), 'utf8');
  const start = fs.readFileSync(new URL('../functions/api/exam/start.ts', import.meta.url), 'utf8');
  assert.match(generate, /COUNT\(\*\) AS count FROM results WHERE exam_id = \? AND user_id = \?/);
  assert.match(generate, /COALESCE\(lop, ''\)/);
  assert.match(generate, /COALESCE\(don_vi, ''\)/);
  assert.doesNotMatch(generate, /user_id[^\n]+OR[^\n]+student_name/);
  assert.match(start, /Even an unlimited-attempt exam permits only ONE active session/);
  assert.match(start, /MAX\(attempt_no\) AS max_attempt_no/);
  assert.match(start, /nextAttempt > maxAttempts/);
  assert.match(start, /COALESCE\(don_vi, ''\)/);
});
