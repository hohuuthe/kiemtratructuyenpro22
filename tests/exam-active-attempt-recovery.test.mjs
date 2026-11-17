import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildActiveExamRecoveryPayload, examAllowsFreshAttempt, unrecoverableExamSnapshotReason, inspectActiveExamRecoveryState, isAuthenticatedSchoolExamStudent } from '../src/exam-active-attempt-recovery.js';

const now = Date.parse('2026-11-16T03:00:00Z');
const session = {
  session_id: 'original-grading-session',
  exam_id: 'exam-1',
  teacher_id: 'teacher-1',
  started_at: new Date(now - 10_000).toISOString(),
  deadline_at: new Date(now + 350_000).toISOString(),
  expires_at: new Date(now + 360_000).toISOString(),
  question_ids: JSON.stringify(['q-1', 'q-2']),
  question_snapshot: JSON.stringify([{id:'q-1'},{id:'q-2'}]),
  exam_config: JSON.stringify({
    id: 'exam-1', immediateFeedback: true, maxCheatWarnings: 4,
    aiPrompt: 'server-only', ai_prompt: 'server-only-legacy'
  })
};

test('Recovery preserves exact original session ID, server clock, frozen policy and question order', () => {
  const payload = buildActiveExamRecoveryPayload({ session, examId: 'exam-1', studentUserId: 'user-1', nowMs: now });
  assert.equal(payload.gradingSessionId, 'original-grading-session');
  assert.equal(payload.purpose, 'exam_active');
  assert.equal(payload.studentUserId, 'user-1');
  assert.equal(payload.startedAtMs, now - 10_000);
  assert.equal(payload.deadlineAtMs, now + 350_000);
  assert.equal(payload.timeLimitSeconds, 360);
  assert.deepEqual(payload.questionIds, ['q-1', 'q-2']);
  assert.equal(payload.immediateFeedback, true);
  assert.equal(payload.maxCheatWarnings, 4);
  assert.ok(!('aiPrompt' in payload.examConfig));
  assert.ok(!('ai_prompt' in payload.examConfig));
});

test('Recovery rejects mismatched exams, expired/orphaned snapshots and missing actor', () => {
  const recover = (data, overrides = {}) => buildActiveExamRecoveryPayload({
    session: data, examId: 'exam-1', studentUserId: 'user-1', nowMs: now, ...overrides
  });
  assert.equal(recover(session,{examId:'exam-2'}),null);
  assert.equal(recover({...session, session_id:''}),null);
  assert.equal(recover({...session, expires_at:new Date(now-1).toISOString()}),null);
  assert.equal(recover({...session, started_at:null}),null);
  assert.equal(recover({...session, question_ids:'[]'}),null);
  assert.equal(recover({...session, exam_config:'{bad'}),null);
  assert.equal(recover(session,{studentUserId:''}),null);
  assert.equal(recover(session,{contestParticipantId:'contest-1'}),null);
});

test('Legacy recovery does not turn on Immediate Feedback based on changed live config', () => {
  const payload = buildActiveExamRecoveryPayload({
    session: {...session, exam_config:JSON.stringify({id:'exam-1'})},
    examId:'exam-1', studentUserId:'user-1', nowMs:now
  });
  assert.equal(payload.immediateFeedback,false);
});

test('Recovered and original ACTIVE tokens share same submission deduplication key', () => {
  const grade = readFileSync('functions/api/exam/grade.ts','utf8');
  const resume = readFileSync('functions/api/exam/resume.ts','utf8');
  assert.match(grade, /hashToken\(gradingSessionId && decoded.purpose === EXAM_SESSION_PURPOSE_ACTIVE \? 'exam-session:' \+ String\(gradingSessionId\) : token\)/);
  assert.match(resume, /hashToken\(decoded.gradingSessionId && decoded.purpose === EXAM_SESSION_PURPOSE_ACTIVE \? 'exam-session:' \+ String\(decoded.gradingSessionId\) : token\)/);
  assert.match(grade, /ON CONFLICT \(token_hash\) DO NOTHING/);
});

test('Conflicting start never recursively re-enters Start and cannot trap the READY dialog', () => {
  const main=readFileSync('src/main.js','utf8');
  const fragment=main.slice(main.indexOf("startResult.code === 'EXAM_ATTEMPT_ALREADY_ACTIVE'"),main.indexOf('if (!response.ok || !startResult.token'));
  assert.match(fragment,/EXAM_REPLACEMENT_CONFLICT/);
  assert.doesNotMatch(fragment,/window\.startExam\(\)/);
  assert.match(fragment,/closeModal\(\)/);
});
test('Only proven invalid snapshots qualify for confirmed abandonment',()=>{
  assert.equal(unrecoverableExamSnapshotReason(session,'exam-1',now),null);
  assert.equal(unrecoverableExamSnapshotReason(null,'exam-1',now),'missing_snapshot');
  assert.equal(unrecoverableExamSnapshotReason({...session, expires_at:new Date(now-1).toISOString()},'exam-1',now),'expired_snapshot');
  assert.equal(unrecoverableExamSnapshotReason({...session, question_snapshot:'{broken'},'exam-1',now),'corrupt_snapshot');
  assert.equal(unrecoverableExamSnapshotReason({...session, question_snapshot:JSON.stringify([{id:'q-2'},{id:'q-1'}])},'exam-1',now),'corrupt_snapshot');
  assert.equal(unrecoverableExamSnapshotReason({...session, exam_id:'another-exam'},'exam-1',now),null);
  assert.equal(unrecoverableExamSnapshotReason({...session, exam_config:JSON.stringify({id:'another-exam'})},'exam-1',now),null);
  assert.equal(unrecoverableExamSnapshotReason({...session, started_at:null},'exam-1',now),null);
});

test('A new attempt requires actual multiple-attempt availability',()=>{
  assert.equal(examAllowsFreshAttempt(1,0),false);
  assert.equal(examAllowsFreshAttempt(1,1),false);
  assert.equal(examAllowsFreshAttempt(2,0),true);
  assert.equal(examAllowsFreshAttempt(2,1),true);
  assert.equal(examAllowsFreshAttempt(2,2),false);
  assert.equal(examAllowsFreshAttempt(0,5),true);
  assert.equal(examAllowsFreshAttempt(-1,0),false);
  assert.equal(examAllowsFreshAttempt(null,0),true); // 0 means unlimited under the existing exam configuration
});

test('Replacement is atomic, counted and protected against submission races',()=>{
  const start=readFileSync('functions/api/exam/start.ts','utf8');
  const grade=readFileSync('functions/api/exam/grade.ts','utf8');
  assert.match(start,/replaceSessionId/);
  assert.match(start,/usedCanceled/);
  assert.match(start,/completed \+ usedCanceled \+ \(replacement \? 1 : 0\)/);
  assert.match(start,/WITH old AS \(/);
  assert.match(start,/FOR UPDATE/);
  assert.match(start,/switched AS \(/);
  assert.match(start,/activated AS \(/);
  assert.match(start,/revoked AS \(/);
  assert.match(start,/INSERT INTO _exam_abandoned_attempts/);
  assert.match(start,/FROM activated WHERE TRUE/);
  assert.match(start,/EXAM_REPLACEMENT_CONFLICT/);
  assert.match(grade,/schoolAttempt/);
  assert.match(grade,/FROM _exam_active_attempts/);
  assert.match(grade,/FOR UPDATE/);
  const retired=readFileSync('functions/api/exam/abandon.ts','utf8');
  assert.match(retired,/EXAM_DIRECT_ABANDON_DISABLED/);
  assert.doesNotMatch(retired,/DELETE FROM _exam_active_attempts/);
});

test('School exams skip server recovery inspection and start fresh on explicit click',()=>{
  const main=readFileSync('src/main.js','utf8');
  assert.match(main,/async function offerExistingExamAttemptChoice\(\) \{ return false; \}/);
  assert.match(main,/if \(meta.entryTab !== 'contest'\)/);
  assert.match(main,/clearStoredActiveExamResume\(\)/);
  assert.match(main,/startSchoolExamHeartbeat\(\)/);
});
test('Tenant-prefixed routing exposes recovery and abandonment only within the trusted slug',()=>{
  const router = readFileSync('functions/[slug]/api/[[path]].ts','utf8');
  assert.match(router, /'exam\/recover': examRecover/);
  assert.match(router, /'exam\/abandon': examAbandon/);
  assert.match(router, /resolveTenantRoutingFromRequest/);
  assert.match(router, /route.source !== 'path'/);
});

test('READY preparation does not override an active snapshot before DB replacement succeeds',()=>{
  const main=readFileSync('src/main.js','utf8');
  assert.match(main,/const preserveActive = previousMeta.phase === 'active'/);
  assert.match(main,/if \(!preserveActive\)/);
  const start=readFileSync('functions/api/exam/start.ts','utf8');
  assert.match(start,/const replacementId = oldSchoolAttemptSessionId/);
});
test('A stale school attempt is never resumed through browser state',()=>{
  const main=readFileSync('src/main.js','utf8');
  assert.match(main,/if \(meta.entryTab !== 'contest'\)/);
  assert.match(main,/clearStoredActiveExamResume\(\)/);
  assert.match(main,/return false/);
});
test('Fresh school attempt uses DB-resolved old lock rather than trusting replaceSessionId from browser',()=>{
  const start=readFileSync('functions/api/exam/start.ts','utf8');
  assert.match(start,/SELECT session_id FROM _exam_active_attempts WHERE attempt_key = \? AND exam_id = \? AND user_id = \?/);
  assert.match(start,/oldSchoolAttemptSessionId = String\(active.session_id\)/);
  assert.doesNotMatch(start,/body\?\.replaceSessionId/);
});
test('Student recovery accepts signed generic user accounts but excludes teachers and admins',()=>{
  const student={id:'user-1',role:'user',target_audience:'Học sinh'};
  assert.equal(isAuthenticatedSchoolExamStudent(student),true);
  assert.equal(isAuthenticatedSchoolExamStudent({...student,role:'student'}),true);
  assert.equal(isAuthenticatedSchoolExamStudent({...student,role:'teacher'}),false);
  assert.equal(isAuthenticatedSchoolExamStudent({...student,role:'admin'}),false);
  assert.equal(isAuthenticatedSchoolExamStudent({...student,target_audience:'Giáo viên'}),false);
  assert.equal(isAuthenticatedSchoolExamStudent(null),false);
});

test('Inspect refuses the resume button for missing, corrupt, expired and not-started snapshots',()=>{
  assert.deepEqual(inspectActiveExamRecoveryState(session,'exam-1','user-1',now),
    {canResume:true,reason:null});
  assert.equal(inspectActiveExamRecoveryState(null,'exam-1','user-1',now).canResume,false);
  assert.equal(inspectActiveExamRecoveryState({...session,question_snapshot:'[]'},'exam-1','user-1',now).canResume,false);
  assert.equal(inspectActiveExamRecoveryState({...session,started_at:null},'exam-1','user-1',now).canResume,false);
  assert.equal(inspectActiveExamRecoveryState({...session,expires_at:new Date(now-1).toISOString()},'exam-1','user-1',now).canResume,false);
});

test('Snapshot cleanup preserves all started attempts for eventual recovery/audit',()=>{
  const generate=readFileSync('functions/api/exam/generate.ts','utf8');
  assert.match(generate,/DELETE FROM _exam_grade_sessions WHERE expires_at < \? AND started_at IS NULL/);
  const inspect=readFileSync('functions/api/exam/recover.ts','utf8');
  assert.match(inspect,/inspectActiveExamRecoveryState\(snapshot, examId, userId\)/);
  assert.match(inspect,/canResume: recoveryState.canResume/);
});

test('Submitted-result reconciliation releases only the exact matching active lock',()=>{
  const source=readFileSync('functions/api/exam/recover.ts','utf8');
  assert.match(source,/SELECT id FROM results WHERE submission_token_hash = \? LIMIT 1/);
  assert.match(source,/DELETE FROM _exam_active_attempts WHERE attempt_key = \? AND exam_id = \? AND user_id = \? AND session_id = \?/);
  assert.match(source,/EXAM_INSPECT_STATE_CHANGED/);
});

test('Heartbeat uses bounded timeout and never revokes a session on transient fetch failure',()=>{
  const main=readFileSync('src/main.js','utf8');
  assert.match(main,/fetchExamStartResponse\(fetch, '\/api\/exam\/heartbeat'/);
  assert.match(main,/\}, 12000\)/);
  assert.match(main,/schoolExamHeartbeatTimer = setInterval/);
  assert.match(main,/30000/);
  assert.match(main,/EXAM_SESSION_CLOSED/);
});
test('Exam selection is not blocked by recovery mode or inspection failures',()=>{
  const main=readFileSync('src/main.js','utf8');
  assert.match(main,/async function offerExistingExamAttemptChoice\(\) \{ return false; \}/);
  assert.match(main,/const handledExisting = await offerExistingExamAttemptChoice/);
  assert.match(main,/if \(await offerExistingExamAttemptChoice\(selectedExamId, examName\)\) return/);
});
test('Heartbeat verifies tenant-authenticated user, signed session and strict 90-second lease',()=>{
  const heartbeat=readFileSync('functions/api/exam/heartbeat.ts','utf8');
  const clock=readFileSync('src/exam-connection-lifecycle.js','utf8');
  const router=readFileSync('functions/[slug]/api/[[path]].ts','utf8');
  assert.match(clock,/EXAM_HEARTBEAT_INTERVAL_MS = 30_000/);
  assert.match(clock,/EXAM_DISCONNECT_GRACE_MS = 90_000/);
  assert.match(heartbeat,/verifyAuthSession/);
  assert.match(heartbeat,/verifyJWT/);
  assert.match(heartbeat,/claims\.studentUserId/);
  assert.match(heartbeat,/last_seen_at/);
  assert.match(heartbeat,/EXAM_SESSION_CLOSED/);
  assert.match(router,/'exam\/heartbeat': examHeartbeat/);
});
