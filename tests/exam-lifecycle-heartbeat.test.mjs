import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EXAM_HEARTBEAT_MS, EXAM_DISCONNECT_MS} from '../src/exam-lifecycle-policy.js';

const main = readFileSync('src/main.js','utf8');
const start = readFileSync('functions/api/exam/start.ts','utf8');
const lifecycle = readFileSync('functions/api/exam/lifecycle.ts','utf8');
const grade = readFileSync('functions/api/exam/grade.ts','utf8');

test('Policy is 30-second heartbeat and 90-second disconnect',()=>{
  assert.equal(EXAM_HEARTBEAT_MS,30_000);
  assert.equal(EXAM_DISCONNECT_MS,90_000);
  assert.match(main,/startSchoolExamHeartbeat\(startResult\.token\)/);
  assert.match(main,/\},30000\)/);
});
test('Old session cannot be resumed after browser reload',()=>{
  const loader = main.slice(main.indexOf('async function tryResumeActiveExam()'),main.indexOf('let token =',main.indexOf('async function tryResumeActiveExam()')));
  assert.match(loader,/savedEntryTab !== 'contest'/);
  assert.match(loader,/clearStoredActiveExamResume\(\)/);
  assert.match(loader,/return false/);
  const choice = main.slice(main.indexOf('async function offerExistingExamAttemptChoice('),main.indexOf('let examStartPending = false;'));
  assert.doesNotMatch(choice,/exam-choice-resume|api\/exam\/recover|__pendingExamReplacement = \{/);
  assert.match(choice,/api\/exam\/lifecycle/);
  assert.match(choice,/mode:'settle'/);
});
test('A new start settles the existing attempt before evaluating quota',()=>{
  const settle=start.indexOf('await settleInactiveSchoolExam(context,examId,signedStudentUserId)');
  const quota=start.indexOf('let completedAttemptsForQuota = 0;');
  assert.ok(settle>=0 && quota>settle);
  assert.match(start,/EXAM_FINALIZATION_UNAVAILABLE/);
  assert.match(start,/EXAM_ATTEMPT_STILL_LIVE/);
});
test('Server binds heartbeat to authenticated student, exact session and fresh heartbeat',()=>{
  assert.match(lifecycle,/verifyAuthSession/);
  assert.match(lifecycle,/decoded\?\.studentUserId/);
  assert.match(lifecycle,/COALESCE\(heartbeat_at, created_at\) > \?/);
  assert.match(lifecycle,/finalizing_at IS NULL/);
  assert.match(lifecycle,/status IN \('processing','completed'\)/);
  assert.match(lifecycle,/EXAM_SESSION_TERMINATED/);
});
test('A timeout grades only server-acknowledged answer draft using authoritative grade route',()=>{
  assert.match(lifecycle,/SELECT answers_json FROM _exam_answer_drafts WHERE session_id = \?/);
  assert.match(lifecycle,/gradeSchoolExam/);
  assert.match(lifecycle,/SELECT id FROM results WHERE submission_token_hash = \? LIMIT 1/);
  assert.match(grade,/ON CONFLICT \(token_hash\) DO NOTHING/);
  assert.match(lifecycle,/UPDATE _exam_active_attempts\s+SET finalizing_at = \?/);
});
test('Tenant identity is derived from request context and not an arbitrary body user ID',()=>{
  assert.match(lifecycle,/getDatabase\(context\)/);
  assert.match(lifecycle,/const userId = String\(actor\?\.user_id \|\| actor\?\.id \|\| ''\)/);
  assert.doesNotMatch(lifecycle,/body\?\.userId/);
});
