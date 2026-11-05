import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  createExamSessionId,
  remainingExamSeconds,
  canAutoSubmitExam
} from '../src/student-exam-session-guard.js';

test('exam countdown starts only from the real UI start time', () => {
  const start = 10_000;
  assert.equal(remainingExamSeconds(null, 600, start + 100_000), null);
  assert.equal(remainingExamSeconds(start, 600, start + 30_000), 570);
  assert.equal(remainingExamSeconds(start, 600, start + 599_000), 1);
  assert.equal(remainingExamSeconds(start, 600, start + 600_000), 0);
});

test('automatic submit is fail-closed unless its reason is independently valid', () => {
  assert.equal(canAutoSubmitExam({ reason: 'time_expired', remainingSeconds: 12 }), false);
  assert.equal(canAutoSubmitExam({ reason: 'time_expired', remainingSeconds: 0 }), true);
  assert.equal(canAutoSubmitExam({ reason: 'cheat_limit', cheatWarningCount: 4, maxCheatWarnings: 5 }), false);
  assert.equal(canAutoSubmitExam({ reason: 'cheat_limit', cheatWarningCount: 5, maxCheatWarnings: 5 }), true);
  assert.equal(canAutoSubmitExam({ reason: '', remainingSeconds: 0, cheatWarningCount: 99, maxCheatWarnings: 5 }), false);
});

test('session identifiers are unique for consecutive attempts', () => {
  assert.notEqual(createExamSessionId(1234), createExamSessionId(1234));
});

test('main exam flow binds timer and delayed anti-cheat submit to the current session', () => {
  const main = readFileSync('src/main.js', 'utf8');
  assert.match(main, /startTime:\s*null,[\s\S]{0,500}sessionId:\s*createExamSessionId\(\)/);
  assert.match(main, /currentExam\.startTime\s*=\s*Date\.now\(\);[\s\S]{0,500}startTimer\(\)/);
  assert.match(main, /window\.submitExam\(true,\s*'time_expired',\s*sessionId\)/);
  assert.match(main, /window\.submitExam\(true,\s*'cheat_limit',\s*sessionId\)/);
  assert.match(main, /canAutoSubmitExam\([\s\S]{0,500}autoReason/);
  assert.match(main, /isSameExamSession\(sessionId\)/);
});
