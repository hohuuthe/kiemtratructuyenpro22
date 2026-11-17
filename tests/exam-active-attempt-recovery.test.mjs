import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {shouldFinalizeExamLiveness} from '../src/exam-exit-policy.js';

const source=path=>readFileSync(path,'utf8');

test('the recovery endpoints are permanently closed to all previous JWT tokens',()=>{
  const resume=source('functions/api/exam/resume.ts');
  const recover=source('functions/api/exam/recover.ts');
  assert.match(resume,/EXAM_RESUME_DISABLED/);
  assert.match(recover,/EXAM_RESUME_DISABLED/);
  assert.match(resume,/status:410/);
  assert.match(recover,/status:410/);
  assert.doesNotMatch(resume,/signJWT|question_snapshot/);
});

test('old browser tokens are deleted and never re-adopted on application boot',()=>{
  const main=source('src/main.js');
  assert.match(main,/clearStoredActiveExamResume\(\)/);
  assert.doesNotMatch(main,/tryResumeActiveExam|offerExistingExamAttemptChoice|\/api\/exam\/recover|\/api\/exam\/resume/);
  assert.doesNotMatch(main,/localStorage\.setItem\(window\.tenantStorageKey\('currentExamToken'/);
  assert.doesNotMatch(main,/bootExamResumeToken|bootExamResumeMeta/);
});

test('same-exam reentry atomically replaces only a nonprocessing old attempt',()=>{
  const start=source('functions/api/exam/start.ts');
  const fresh=source('functions/api/exam/fresh-attempt.ts');
  assert.match(start,/claimFreshExamAttempt\(db,/);
  assert.match(start,/EXAM_ATTEMPT_LIMIT_REACHED/);
  assert.match(fresh,/ON CONFLICT \(attempt_key\) DO UPDATE SET/);
  assert.match(fresh,/status='processing'/);
  assert.match(fresh,/fresh_draft/);
  assert.doesNotMatch(start,/EXAM_PREVIOUS_ATTEMPT_FINALIZED/);
});

test('timeout closes a server attempt but temporary disconnect never counts as completion',()=>{
  const t=Date.parse('2026-11-16T06:00:00Z');
  const row={last_seen_at:new Date(t).toISOString(),deadline_at:new Date(t+600_000).toISOString()};
  assert.equal(shouldFinalizeExamLiveness(row,t+89_000),false);
  assert.equal(shouldFinalizeExamLiveness(row,t+90_000),true);
});

test('student leaving explicitly finalizes the saved draft without revoking the scoring evidence',()=>{
  const heartbeat=source('functions/api/exam/heartbeat.ts');
  const finalizer=source('functions/api/exam/finalize-service.ts');
  assert.match(heartbeat,/leave_requested_at/);
  assert.match(heartbeat,/sanitizeDraftAnswers/);
  assert.match(finalizer,/question_snapshot/);
  assert.match(finalizer,/_exam_answer_drafts/);
  assert.match(finalizer,/finalizing_at/);
  assert.match(finalizer,/INTERNAL_EXAM_FINALIZER/);
  assert.doesNotMatch(finalizer,/DELETE FROM _exam_answer_drafts/);
});

test('the unique result and signed identity are controlled on the server',()=>{
  const grade=source('functions/api/exam/grade.ts');
  assert.match(grade,/hashToken\(gradingSessionId && decoded\.purpose === EXAM_SESSION_PURPOSE_ACTIVE/);
  assert.match(grade,/ON CONFLICT \(token_hash\) DO NOTHING/);
  assert.match(grade,/submission_token_hash/);
  assert.match(grade,/trustedFinalizer/);
  assert.match(grade,/signedStudentUserId/);
});

test('tenant backend uses exact database slug rather than browser session storage',()=>{
  const adapter=source('functions/api/neon-adapter.ts');
  const worker=source('workers/exam-finalizer-worker.ts');
  assert.match(adapter,/exactOnly: route\.source === 'path'/);
  assert.match(worker,/EXAM_FINALIZER_TENANTS/);
  assert.match(worker,/finalizeDueExamLiveness/);
});
