import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildActiveExamRecoveryPayload, examAllowsFreshAttempt, unrecoverableExamSnapshotReason } from '../src/exam-active-attempt-recovery.js';

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

test('409 conflict uses authenticated recovery without replacing session or creating another start', () => {
  const main = readFileSync('src/main.js','utf8');
  const section = main.slice(main.indexOf("const startResult = await response.json().catch(() => ({}));"),
    main.indexOf("window.currentExamToken = startResult.token;"));
  assert.match(section, /startResult.code === 'EXAM_ATTEMPT_ALREADY_ACTIVE'/);
  assert.match(section, /fetchExamStartResponse\(fetch, '\/api\/exam\/recover'/);
  assert.match(section, /await tryResumeActiveExam\(\)/);
  const endpoint = readFileSync('functions/api/exam/recover.ts','utf8');
  assert.match(endpoint, /verifyAuthSession\(/);
  assert.match(endpoint, /WHERE attempt_key = \?/);
  assert.match(endpoint, /WHERE session_id = \?/);
  assert.doesNotMatch(endpoint, /INSERT INTO _exam_grade_sessions/);
  assert.doesNotMatch(endpoint, /DELETE FROM _exam_active_attempts/);
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

test('Abandon endpoint cannot delete old student answers or unconditionally bypass quota',()=>{
  const source = readFileSync('functions/api/exam/abandon.ts','utf8');
  assert.match(source,/verifyAuthSession/);
  assert.match(source,/examAllowsFreshAttempt\(maxAttempts, completed\)/);
  assert.match(source,/unrecoverableExamSnapshotReason\(session,examId,Date.now\(\)\)/);
  assert.match(source,/SELECT 1 AS pending FROM _submitted_exam_tokens/);
  assert.match(source,/DELETE FROM _exam_active_attempts/);
  assert.match(source,/INSERT INTO _exam_abandoned_attempts/);
  assert.doesNotMatch(source,/DELETE FROM _exam_answer_drafts/);
  assert.doesNotMatch(source,/DELETE FROM _exam_grade_sessions/);
  assert.doesNotMatch(source,/DELETE FROM results/);
  assert.doesNotMatch(source,/UPDATE exam_configs SET max_attempts/);
  for(const path of ['functions/api/exam/start.ts','functions/api/exam/resume.ts','functions/api/exam/save.ts','functions/api/exam/grade.ts']){
    const text = readFileSync(path,'utf8');
    assert.match(text,/EXAM_ATTEMPT_ABANDONED/);
    assert.match(text,/FROM _exam_abandoned_attempts WHERE session_id = \?/);
  }
});

test('Browser offers retry only for server-confirmed irrecoverable snapshots',()=>{
  const code = readFileSync('src/main.js','utf8');
  const start = code.slice(code.indexOf("startResult.code === 'EXAM_ATTEMPT_ALREADY_ACTIVE'"),code.indexOf('window.currentExamToken = recovery.body.token;'));
  assert.match(start,/safeAbandonCodes/);
  assert.match(start,/EXAM_RECOVERY_SNAPSHOT_MISMATCH/);
  assert.doesNotMatch(start,/safeAbandonCodes[^;]*EXAM_RECOVERY_WRITER_BUSY/s);
  assert.match(start,/\/api\/exam\/abandon/);
  assert.match(start,/confirm:true/);
  assert.match(start,/abandoned.body\?\.canCreateNew !== true/);
});

test('Tenant-prefixed routing exposes recovery and abandonment only within the trusted slug',()=>{
  const router = readFileSync('functions/[slug]/api/[[path]].ts','utf8');
  assert.match(router, /'exam\/recover': examRecover/);
  assert.match(router, /'exam\/abandon': examAbandon/);
  assert.match(router, /resolveTenantRoutingFromRequest/);
  assert.match(router, /route.source !== 'path'/);
});

test('READY preparation cannot overwrite or cancel a previously saved active session',()=>{
  const source=readFileSync('src/main.js','utf8');
  const region=source.slice(source.indexOf("window.currentExamToken = result.token;"),
    source.indexOf("// Cập nhật chế độ công bố kết quả",source.indexOf("window.currentExamToken = result.token;")));
  assert.match(region,/previousMeta.phase === 'active'/);
  assert.match(region,/String\(previousMeta.examId \|\| ''\) === String\(selectedExamId\)/);
  assert.match(region,/if \(!preserveActive\)/);
  const cancelRegion=source.slice(source.indexOf("id('exam-start-ready-cancel')?.addEventListener"),
    source.indexOf("readyButton.focus();",source.indexOf("id('exam-start-ready-cancel')?.addEventListener")));
  assert.match(cancelRegion,/storedToken === cancelledReadyToken/);
});
