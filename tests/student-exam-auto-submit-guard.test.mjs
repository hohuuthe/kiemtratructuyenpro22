import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  createExamSessionId,
  remainingExamSeconds,
  remainingExamSecondsMonotonic,
  canAutoSubmitExam,
  shouldCountExamViolation
} from '../src/student-exam-session-guard.js';

test('exam countdown starts only from the real UI start time', () => {
  const start = 10_000;
  assert.equal(remainingExamSeconds(null, 600, start + 100_000), null);
  assert.equal(remainingExamSeconds(start, 600, start + 30_000), 570);
  assert.equal(remainingExamSeconds(start, 600, start + 599_000), 1);
  assert.equal(remainingExamSeconds(start, 600, start + 600_000), 0);
});

test('monotonic countdown is immune to wall-clock jumps', () => {
  const startTick = 5_000;
  assert.equal(remainingExamSecondsMonotonic(startTick, 600, 35_000), 570);
  assert.equal(remainingExamSecondsMonotonic(startTick, 600, 604_000), 1);
  assert.equal(remainingExamSecondsMonotonic(startTick, 600, 605_000), 0);
  assert.equal(remainingExamSecondsMonotonic(startTick, 600, 4_000), null);
});

test('automatic submit is fail-closed unless its reason is independently valid', () => {
  assert.equal(canAutoSubmitExam({ reason: 'time_expired', remainingSeconds: 12 }), false);
  assert.equal(canAutoSubmitExam({ reason: 'time_expired', remainingSeconds: 0 }), true);
  assert.equal(canAutoSubmitExam({ reason: 'cheat_limit', cheatWarningCount: 4, maxCheatWarnings: 5 }), false);
  assert.equal(canAutoSubmitExam({ reason: 'cheat_limit', cheatWarningCount: 5, maxCheatWarnings: 5 }), false);
  assert.equal(canAutoSubmitExam({ reason: 'cheat_limit', cheatWarningCount: 6, maxCheatWarnings: 5 }), true);
  assert.equal(canAutoSubmitExam({ reason: '', remainingSeconds: 0, cheatWarningCount: 99, maxCheatWarnings: 5 }), false);
});

test('browser duplicate visibility/fullscreen signals count as one violation', () => {
  assert.equal(shouldCountExamViolation({ reason: 'tab_switch', now: 10_000, lastAt: 0 }), true);
  assert.equal(shouldCountExamViolation({
    reason: 'Thoát toàn màn hình trái phép',
    lastReason: 'tab_switch',
    now: 10_500,
    lastAt: 10_000,
    duplicateWindowMs: 1500
  }), false);
  assert.equal(shouldCountExamViolation({
    reason: 'tab_switch',
    lastReason: 'tab_switch',
    now: 10_800,
    lastAt: 10_000,
    duplicateWindowMs: 1500
  }), false);
  assert.equal(shouldCountExamViolation({
    reason: 'tab_switch',
    lastReason: 'tab_switch',
    now: 12_000,
    lastAt: 10_000,
    duplicateWindowMs: 1500
  }), true);
});

test('session identifiers are unique for consecutive attempts', () => {
  assert.notEqual(createExamSessionId(1234), createExamSessionId(1234));
});

test('server freezes authoritative exam duration into the generated session', () => {
  const generate = readFileSync('functions/api/exam/generate.ts', 'utf8');
  assert.match(generate, /const timeLimitSeconds = Math\.max\(1, Math\.round\(timeLimitMinutes \* 60\)\)/);
  assert.match(generate, /timeLimitSeconds,/);
  assert.match(generate, /timeLimitMinutes,/);
  assert.match(generate, /exp:[\s\S]{0,180}timeLimitSeconds \+ 3600/);
});

test('main exam flow binds timer and delayed anti-cheat submit to the current session', () => {
  const main = readFileSync('src/main.js', 'utf8');
  assert.match(main, /startTime:\s*null,[\s\S]{0,500}sessionId:\s*createExamSessionId\(\)/);
  assert.match(main, /const serverElapsedSeconds = Math\.max\(0, Number\(currentExam\.serverElapsedSeconds\) \|\| 0\)/);
  assert.match(main, /currentExam\.startTime = Date\.now\(\) - Math\.round\(serverElapsedSeconds \* 1000\)/);
  assert.match(main, /currentExam\.startTick = [\s\S]{0,220}performance\.now\(\) - \(serverElapsedSeconds \* 1000\)/);
  assert.match(main, /currentExam\.serverStartedAt = startResult\.startedAt/);
  assert.match(main, /startExamUI\(\)[\s\S]{0,2200}startTimer\(\)/);
  assert.match(main, /const frozenSeconds = Number\(currentExam\?\.timeLimitSeconds\)/);
  assert.match(main, /remainingExamSecondsMonotonic/);
  assert.match(main, /currentExam\.startTick/);
  assert.match(main, /violationEpisodeActive/);
  assert.match(main, /function resetViolationEpisodeIfRecovered/);
  assert.match(main, /shouldCountExamViolation/);
  assert.match(main, /currentCount > maxWarnings/);
  assert.match(main, /window\.submitExam\(true,\s*'time_expired',\s*sessionId\)/);
  assert.match(main, /window\.submitExam\(true,\s*'cheat_limit',\s*sessionId\)/);
  assert.match(main, /canAutoSubmitExam\([\s\S]{0,500}autoReason/);
  assert.match(main, /isSameExamSession\(sessionId\)/);
});

test('legitimate file pickers are protected from late browser violation events', () => {
  const main = readFileSync('src/main.js', 'utf8');
  const background = readFileSync('src/student-exam-background.js', 'utf8');
  assert.match(main, /studentAnswerFilePickerGraceUntil/);
  assert.match(main, /studentBackgroundPickerGraceUntil/);
  assert.match(background, /studentBackgroundPickerGraceUntil = Date\.now\(\) \+ 1500/);
  assert.match(main, /window\.studentBackgroundPickerActive \|\|[\s\S]{0,180}Date\.now\(\) < backgroundGraceUntil/);
});
