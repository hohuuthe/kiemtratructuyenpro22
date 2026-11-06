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
import {
  examDeadlineAtMs,
  remainingExamSecondsFromDeadline,
  evaluateExamAccessWindow,
  resolveAuthoritativeExamTiming
} from '../src/exam-time-authority.js';

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
  assert.match(main, /currentExam\.startTime\s*=\s*Number\(currentExam\.serverStartedAtMs\)/);
  assert.match(main, /currentExam\.deadlineAtMs/);
  assert.match(main, /serverNowAtActivationMs/);
  assert.match(main, /\/api\/exam\/start/);
  assert.match(main, /\/api\/exam\/save/);
  assert.match(main, /window\.flushExamAutosave/);
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


test('server deadline helpers use an immutable start and reject wall-clock extension', () => {
  assert.equal(examDeadlineAtMs(1_000_000, 600), 1_600_000);
  assert.equal(remainingExamSecondsFromDeadline(1_600_000, 1_000_000), 600);
  assert.equal(remainingExamSecondsFromDeadline(1_600_000, 1_599_001), 1);
  assert.equal(remainingExamSecondsFromDeadline(1_600_000, 1_600_000), 0);

  const active = resolveAuthoritativeExamTiming(
    { timeLimitSeconds: 600, startedAtMs: 1_000_000, deadlineAtMs: 1_600_000 },
    {},
    1_300_000
  );
  assert.equal(active.valid, true);
  assert.equal(active.expired, false);
  assert.equal(active.elapsedSeconds, 300);

  const expired = resolveAuthoritativeExamTiming(
    { timeLimitSeconds: 600, startedAtMs: 1_000_000, deadlineAtMs: 1_600_000 },
    {},
    1_600_001
  );
  assert.equal(expired.expired, true);
  assert.equal(expired.elapsedSeconds, 600);
});

test('server access window is authoritative and deterministic', () => {
  const config = { accessControl: { enabled: true, startTime: '2026-11-07T08:00:00.000Z', endTime: '2026-11-07T09:00:00.000Z' } };
  assert.equal(evaluateExamAccessWindow(config, Date.parse('2026-11-07T07:59:59.000Z')).code, 'EXAM_NOT_STARTED');
  assert.equal(evaluateExamAccessWindow(config, Date.parse('2026-11-07T08:30:00.000Z')).allowed, true);
  assert.equal(evaluateExamAccessWindow(config, Date.parse('2026-11-07T09:00:00.001Z')).code, 'EXAM_WINDOW_CLOSED');
});

test('new sessions cannot be graded before activation and late grading uses server draft', () => {
  const generate = readFileSync('functions/api/exam/generate.ts', 'utf8');
  const start = readFileSync('functions/api/exam/start.ts', 'utf8');
  const save = readFileSync('functions/api/exam/save.ts', 'utf8');
  const grade = readFileSync('functions/api/exam/grade.ts', 'utf8');
  const route = readFileSync('functions/[slug]/api/[[path]].ts', 'utf8');

  assert.match(generate, /EXAM_SESSION_PURPOSE_PRESTART/);
  assert.match(generate, /evaluateExamAccessWindow/);
  assert.match(start, /EXAM_SESSION_PURPOSE_ACTIVE/);
  assert.match(start, /SET started_at = \?, deadline_at = \?/);
  assert.match(start, /WHERE session_id = \? AND started_at IS NULL/);
  assert.match(start, /deadline_at IS NULL/);
  assert.match(save, /EXAM_DEADLINE_REACHED/);
  assert.match(save, /_exam_answer_drafts/);
  assert.match(grade, /EXAM_NOT_ACTIVATED/);
  assert.match(grade, /authoritativeTiming\.expired/);
  assert.match(grade, /_exam_answer_drafts/);
  assert.match(grade, /studentAnswers\.splice/);
  assert.match(route, /'exam\/start': examStart/);
  assert.match(route, /'exam\/save': examSave/);
});

test('submit failure restores the live timer when time remains and locks answers after deadline', () => {
  const main = readFileSync('src/main.js', 'utf8');
  assert.match(main, /remainingAfterFailure/);
  assert.match(main, /startTimer\(\)/);
  assert.match(main, /currentExam\.deadlineLocked = true/);
  assert.match(main, /Gửi lại bài đã khóa/);
});


test('violation count for active sessions is persisted and read from server', () => {
  const violation = readFileSync('functions/api/exam/violation.ts', 'utf8');
  const grade = readFileSync('functions/api/exam/grade.ts', 'utf8');
  const main = readFileSync('src/main.js', 'utf8');
  const route = readFileSync('functions/[slug]/api/[[path]].ts', 'utf8');

  assert.match(violation, /_exam_violation_events/);
  assert.match(violation, /ON CONFLICT \(event_key\) DO NOTHING/);
  assert.match(grade, /SELECT COUNT\(\*\) AS count FROM _exam_violation_events/);
  assert.match(grade, /decoded\.purpose === EXAM_SESSION_PURPOSE_ACTIVE/);
  assert.match(main, /queueExamViolation\(reason\)/);
  assert.match(main, /flushExamViolationEvents/);
  assert.match(route, /'exam\/violation': examViolation/);
});


test('Vietnam datetime-local access windows are interpreted as UTC+07:00 on every runtime', () => {
  const config = {
    accessControl: {
      enabled: true,
      startTime: '2026-11-07T08:00',
      endTime: '2026-11-07T09:00'
    }
  };
  assert.equal(evaluateExamAccessWindow(config, Date.parse('2026-11-07T00:59:59.999Z')).code, 'EXAM_NOT_STARTED');
  assert.equal(evaluateExamAccessWindow(config, Date.parse('2026-11-07T01:00:00.000Z')).allowed, true);
  assert.equal(evaluateExamAccessWindow(config, Date.parse('2026-11-07T01:30:00.000Z')).allowed, true);
  assert.equal(evaluateExamAccessWindow(config, Date.parse('2026-11-07T02:00:00.001Z')).code, 'EXAM_WINDOW_CLOSED');

  const explicitUtc = {
    accessControl: {
      enabled: true,
      startTime: '2026-11-07T08:00:00.000Z',
      endTime: '2026-11-07T09:00:00.000Z'
    }
  };
  assert.equal(evaluateExamAccessWindow(explicitUtc, Date.parse('2026-11-07T08:30:00.000Z')).allowed, true);
});

test('Node/local server delegates grading to the same hardened Cloudflare handler', () => {
  const server = readFileSync('server.ts', 'utf8');
  assert.match(server, /hardenedExamGradeHandler/);
  assert.match(server, /onRequestPost as hardenedExamGradeHandler/);
  const routeStart = server.indexOf('app.post("\/api\/exam\/grade"');
  const routeEnd = server.indexOf('// Vite middleware for development', routeStart);
  const route = server.slice(routeStart, routeEnd);
  assert.match(route, /hardenedExamGradeHandler/);
  assert.doesNotMatch(route, /scale10Score/);
  assert.doesNotMatch(route, /studentInfo\.userId \|\| null/);
});
