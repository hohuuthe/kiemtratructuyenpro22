import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EXAM_HEARTBEAT_MS,EXAM_IDLE_TIMEOUT_MS,shouldFinalizeExamLiveness,normalizeExamStudentInfo} from '../src/exam-exit-policy.js';

const source=p=>readFileSync(p,'utf8');
const base=Date.parse('2026-11-16T07:00:00Z');
const row=(seen=base,deadline=base+600_000)=>({
  last_seen_at:new Date(seen).toISOString(),
  deadline_at:new Date(deadline).toISOString(),
  leave_requested_at:null,finalizing_at:null,finalized_at:null
});

test('heartbeat is 30s, 90s silence is the server-side cutoff',()=>{
  assert.equal(EXAM_HEARTBEAT_MS,30_000);
  assert.equal(EXAM_IDLE_TIMEOUT_MS,90_000);
  assert.equal(shouldFinalizeExamLiveness(row(),base+89_999),false);
  assert.equal(shouldFinalizeExamLiveness(row(),base+90_000),true);
  assert.equal(shouldFinalizeExamLiveness(row(),base+31_000),false);
  assert.equal(shouldFinalizeExamLiveness(row(),base+600_000),true);
  assert.equal(shouldFinalizeExamLiveness({...row(),leave_requested_at:new Date(base+2_000).toISOString()},base+3_000),true);
});

test('concurrent finalizers hold a five-minute retry lease',()=>{
  const busy={...row(),leave_requested_at:new Date(base).toISOString(),finalizing_at:new Date(base+5_000).toISOString()};
  assert.equal(shouldFinalizeExamLiveness(busy,base+10_000),false);
  assert.equal(shouldFinalizeExamLiveness(busy,base+305_001),true);
});

test('browser never restores persisted exam token or invokes recovery APIs',()=>{
  const main=source('src/main.js');
  const lifecycle=source('src/exam-lifecycle-client.js');
  const resume=source('functions/api/exam/resume.ts');
  const recover=source('functions/api/exam/recover.ts');
  assert.doesNotMatch(main,/\/api\/exam\/resume|\/api\/exam\/recover|tryResumeActiveExam|offerExistingExamAttemptChoice/);
  assert.doesNotMatch(main,/localStorage\.setItem\(window\.tenantStorageKey\('currentExamToken'\)/);
  assert.doesNotMatch(main,/localStorage\.getItem\(window\.tenantStorageKey\('currentExamToken'\)/);
  assert.match(lifecycle,/window\.addEventListener\('pagehide'/);
  assert.doesNotMatch(lifecycle,/addEventListener\(['"](?:visibilitychange|beforeunload)/);
  assert.match(resume,/EXAM_RESUME_DISABLED/);
  assert.match(recover,/EXAM_RESUME_DISABLED/);
});

test('finalizer never trusts client scoring and uses frozen answers with one unique claim',()=>{
  const service=source('functions/api/exam/finalize-service.ts');
  const grade=source('functions/api/exam/grade.ts');
  const save=source('functions/api/exam/save.ts');
  assert.match(service,/question_snapshot/);
  assert.match(service,/_exam_answer_drafts/);
  assert.match(service,/finalizing_at = \?/);
  assert.match(service,/INTERNAL_EXAM_FINALIZER/);
  assert.match(service,/priorHash=await hashToken/);
  assert.match(grade,/mustUseSavedDraft = trustedFinalizer \|\| authoritativeTiming\.expired/);
  assert.match(grade,/ON CONFLICT \(token_hash\) DO NOTHING/);
  assert.match(grade,/submission_token_hash/);
  assert.match(save,/revision > _exam_answer_drafts\.revision/);
});

test('liveness event verifies account owner and exact active attempt before mutating',()=>{
  const heartbeat=source('functions/api/exam/heartbeat.ts');
  assert.match(heartbeat,/verifyAuthSession/);
  assert.match(heartbeat,/snapshot\?\.started_at/);
  assert.match(heartbeat,/_exam_active_attempts/);
  assert.match(heartbeat,/leave_requested_at=COALESCE/);
  assert.match(heartbeat,/sanitizeDraftAnswers/);
});

test('empty or partial student metadata is safe and bounded',()=>{
  assert.deepEqual(normalizeExamStudentInfo(),{
    name:'',lop:'',donvi:'',unit:'',studentClass:'',teacherId:'',examId:'',examName:'',loaiThiSinh:''
  });
  assert.equal(normalizeExamStudentInfo({name:'a'.repeat(500)}).name.length,200);
});

test('cron runs per tenant without any fallback to root tenant database',()=>{
  const worker=source('workers/exam-finalizer-worker.ts');
  const wrangler=source('wrangler.exam-finalizer.toml');
  assert.match(worker,/EXAM_FINALIZER_TENANTS/);
  assert.match(worker,/finalizeDueExamLiveness/);
  assert.match(wrangler,/crons = \["\* \* \* \* \*"\]/);
});
