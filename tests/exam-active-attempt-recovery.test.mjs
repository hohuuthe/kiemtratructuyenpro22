import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  buildActiveExamRecoveryPayload,
  unrecoverableExamSnapshotReason,
  inspectActiveExamRecoveryState,
  isAuthenticatedSchoolExamStudent
} from '../src/exam-active-attempt-recovery.js';

// Historical snapshots are still needed internally for safe grading of an
// abandoned attempt. Browser-facing school recovery has been retired.
const now=Date.parse('2026-11-17T06:00:00Z');
const old={
  session_id:'session-1',exam_id:'exam-1',teacher_id:'teacher-1',
  question_ids:JSON.stringify(['q-1']),question_snapshot:JSON.stringify([{id:'q-1',answer:'B'}]),
  exam_config:JSON.stringify({id:'exam-1',immediateFeedback:true,aiPrompt:'PRIVATE'}),
  started_at:new Date(now-60_000).toISOString(),
  deadline_at:new Date(now+300_000).toISOString(),
  expires_at:new Date(now+3_600_000).toISOString()
};
test('Internal signed grading authority preserves original session and never exposes AI rubric',()=>{
  const payload=buildActiveExamRecoveryPayload({
    session:old,examId:'exam-1',studentUserId:'learner-1',nowMs:now
  });
  assert.equal(payload.gradingSessionId,'session-1');
  assert.equal(payload.studentUserId,'learner-1');
  assert.equal(payload.immediateFeedback,true);
  assert.ok(!('aiPrompt' in payload.examConfig));
});
test('Internal grading authority refuses mismatched, expired or corrupted snapshot',()=>{
  const payload=(session,examId='exam-1')=>buildActiveExamRecoveryPayload({
    session,examId,studentUserId:'learner-1',nowMs:now
  });
  assert.equal(payload(old,'exam-2'),null);
  assert.equal(payload({...old,expires_at:new Date(now-1).toISOString()}),null);
  assert.equal(payload({...old,question_ids:'{broken'}),null);
  assert.equal(unrecoverableExamSnapshotReason({...old,question_snapshot:'{broken'},'exam-1',now),'corrupt_snapshot');
  assert.equal(inspectActiveExamRecoveryState({...old,started_at:null},'exam-1','learner-1',now).canResume,false);
});
test('Authentication helper never treats teacher or admin as school learner',()=>{
  assert.equal(isAuthenticatedSchoolExamStudent({role:'user',target_audience:'Học sinh'}),true);
  assert.equal(isAuthenticatedSchoolExamStudent({role:'teacher',target_audience:'Học sinh'}),false);
  assert.equal(isAuthenticatedSchoolExamStudent({role:'admin'}),false);
});
test('Obsolete public recovery route rejects old browser tokens',()=>{
  const source=readFileSync('functions/api/exam/recover.ts','utf8');
  assert.match(source,/EXAM_RECOVERY_RETIRED/);
  assert.match(source,/status:410/);
  assert.doesNotMatch(source,/signJWT/);
});
test('School resume is disabled but public contest resume still uses server snapshot',()=>{
  const source=readFileSync('functions/api/exam/resume.ts','utf8');
  assert.match(source,/decoded\.studentUserId && !decoded\.contestParticipantId/);
  assert.match(source,/EXAM_RESUME_RETIRED/);
  assert.match(source,/question_snapshot/);
});
