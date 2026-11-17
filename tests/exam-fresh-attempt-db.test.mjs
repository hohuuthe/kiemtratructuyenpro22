import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const source=readFileSync('functions/api/exam/fresh-attempt.ts','utf8');
const start=readFileSync('functions/api/exam/start.ts','utf8');
const mark='export const FRESH_EXAM_ATTEMPT_CLAIM_SQL = '+String.fromCharCode(96);
const begin=source.indexOf(mark);
assert.ok(begin>=0);
const end=source.indexOf(String.fromCharCode(96)+';',begin+mark.length);
let count=0;
const sql=source.slice(begin+mark.length,end).replace(/\?/g,()=>'$'+(++count));
assert.equal(count,19);
const now='2026-11-17T01:00:00Z',exp='2026-11-18T01:00:00Z';
const user='contest:student1';
const key='exam1:'+user;
const oldSession='old-session',newSession='new-session';
const args=[key,'exam1',user,newSession,key,0,newSession,0,0,0,0,0,0,key,'exam1',user,newSession,exp,now];
const tokenHash=createHash('sha256').update('exam-session:'+oldSession).digest('hex');

async function fixture({old=false,contest=false,processing=false,committed=false,finalizing=false,staleProcessing=false,committedProcessing=false,missingClaimedAt=false,missingResultId=false}={}){
 const db=new PGlite();
 await db.exec(`
 CREATE TABLE _exam_active_attempts(attempt_key TEXT PRIMARY KEY,exam_id TEXT,user_id TEXT,session_id TEXT,expires_at TEXT,created_at TEXT);
 CREATE TABLE _exam_grade_sessions(session_id TEXT PRIMARY KEY,question_snapshot TEXT,question_ids TEXT,created_at TEXT,exam_id TEXT,started_at TEXT,deadline_at TEXT);
 CREATE TABLE _exam_answer_drafts(session_id TEXT PRIMARY KEY,answers_json TEXT,revision INTEGER,saved_at TEXT);
 CREATE TABLE _exam_attempt_liveness(session_id TEXT PRIMARY KEY,finalized_at TEXT,last_error TEXT,finalizing_at TEXT,last_seen_at TEXT,exam_id TEXT,user_id TEXT,contest_participant_id TEXT,student_info_json TEXT,deadline_at TEXT,leave_requested_at TEXT);
 CREATE TABLE _submitted_exam_tokens(token_hash TEXT PRIMARY KEY,status TEXT,claimed_at TEXT,result_id TEXT);
 CREATE TABLE contest_attempts(ma_phien_thi TEXT PRIMARY KEY,ma_nguoi_du_thi TEXT,ma_de_thi TEXT,trang_thai TEXT,ma_ket_qua TEXT,thoi_diem_nop TIMESTAMPTZ);
 CREATE TABLE results(id TEXT PRIMARY KEY,ma_phien_thi TEXT,ma_nguoi_du_thi TEXT,exam_id TEXT,created_at TIMESTAMPTZ,submission_token_hash TEXT);
 CREATE TABLE _exam_attempt_quota_guard(attempt_key TEXT PRIMARY KEY,used_attempts INTEGER NOT NULL,last_session_id TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE _exam_discarded_session_archive(session_id TEXT,kind TEXT,source_data JSONB,reason TEXT,archived_at TIMESTAMPTZ DEFAULT now(),PRIMARY KEY(session_id,kind));
 `);
 if(old){
  await db.query('INSERT INTO _exam_active_attempts VALUES($1,$2,$3,$4,$5,$6)',[key,'exam1',user,oldSession,exp,now]);
  await db.query('INSERT INTO _exam_grade_sessions VALUES($1,$2,$3,$4,$5,$6,$7)',[oldSession,'[{"id":"Q1"}]','["Q1"]',now,'exam1',now,exp]);
  await db.query('INSERT INTO _exam_answer_drafts VALUES($1,$2,$3,$4)',[oldSession,'["A"]',3,now]);
  await db.query('INSERT INTO _exam_attempt_liveness (session_id,finalized_at,last_error,finalizing_at,last_seen_at,exam_id,user_id,contest_participant_id,student_info_json,deadline_at,leave_requested_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[oldSession,null,null,finalizing?new Date().toISOString():null,'2026-01-01T00:00:00Z','exam1','',contest?'student1':'','{}',exp,null]);
  if(contest)await db.query('INSERT INTO contest_attempts VALUES($1,$2,$3,$4,$5,$6)',[oldSession,'student1','exam1','DANG_LAM',null,null]);
  if(processing||staleProcessing||committedProcessing) await db.query('INSERT INTO _submitted_exam_tokens VALUES($1,$2,$3,$4)',[tokenHash,'processing',missingClaimedAt?null:staleProcessing?'2026-01-01T00:00:00Z':new Date().toISOString(),committedProcessing&&!missingResultId?'result1':null]);
  if(committed||committedProcessing)await db.query('INSERT INTO results VALUES($1,$2,$3,$4,$5,$6)',['result1',oldSession,'student1','exam1',now,committedProcessing?tokenHash:null]);
 }
 return db;
}
test('new student starts directly with no previous lock',async()=>{
 const db=await fixture();
 try{
  const r=await db.query(sql,args);
  assert.equal(r.rows[0]?.session_id,newSession);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM _exam_active_attempts')).rows[0].n,1);
 }finally{await db.close();}
});
test('new session replaces previous frozen attempt atomically, archives source, revokes old token',async()=>{
 const db=await fixture({old:true,contest:true});
 try{
  const r=await db.query(sql,args);
  assert.equal(r.rows[0]?.session_id,newSession);
  assert.equal((await db.query('SELECT session_id FROM _exam_active_attempts')).rows[0].session_id,newSession);
  assert.equal((await db.query('SELECT trang_thai FROM contest_attempts')).rows[0].trang_thai,'HUY');
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM _exam_grade_sessions WHERE session_id=$1',[oldSession])).rows[0].n,1);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM _exam_answer_drafts WHERE session_id=$1',[oldSession])).rows[0].n,1);
  assert.equal((await db.query('SELECT finalized_at,leave_requested_at FROM _exam_attempt_liveness WHERE session_id=$1',[oldSession])).rows[0].finalized_at,null);
  assert.ok((await db.query('SELECT leave_requested_at FROM _exam_attempt_liveness WHERE session_id=$1',[oldSession])).rows[0].leave_requested_at);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM _exam_discarded_session_archive')).rows[0].n,4);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM results')).rows[0].n,0);
 }finally{await db.close();}
});
test('authenticated school learner starts a new exam even with a previous unfinished lock',async()=>{
 const db=await fixture({old:true});
 const school='student1',schoolKey='exam1:'+school;
 const schoolArgs=[schoolKey,'exam1',school,newSession,schoolKey,0,newSession,0,0,0,0,0,0,schoolKey,'exam1',school,newSession,exp,now];
 try{
  await db.query('UPDATE _exam_active_attempts SET attempt_key=$1,user_id=$2',[schoolKey,school]);
  const r=await db.query(sql,schoolArgs);
  assert.equal(r.rows[0]?.session_id,newSession);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM _exam_grade_sessions')).rows[0].n,1);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM _exam_discarded_session_archive')).rows[0].n,4);
 }finally{await db.close();}
});

test('two READY tokens for the same account cannot keep two ACTIVE sessions',async()=>{
 const db=await fixture();
 try{
  const first=await db.query(sql,args);
  assert.equal(first.rows[0]?.session_id,newSession);
  const finalId='newer-session';
  const second=await db.query(sql,args.map(v=>v===newSession?finalId:v));
  assert.equal(second.rows[0]?.session_id,finalId);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM _exam_active_attempts')).rows[0].n,1);
  assert.equal((await db.query('SELECT session_id FROM _exam_active_attempts')).rows[0].session_id,finalId);
 }finally{await db.close();}
});

test('atomic server quota permits exactly the configured number of started attempts',async()=>{
 const db=await fixture();
 const quotaArgs=(id,max,baseline=0)=>[
  key,'exam1',user,id,key,baseline,id,max,baseline,max,max,max,max,
  key,'exam1',user,id,exp,now
 ];
 try {
  const first=await db.query(sql,quotaArgs('first-quota',2));
  assert.equal(first.rows[0]?.session_id,'first-quota');
  const second=await db.query(sql,quotaArgs('second-quota',2));
  assert.equal(second.rows[0]?.session_id,'second-quota');
  const third=await db.query(sql,quotaArgs('third-quota',2));
  assert.equal(third.rowCount,0);
  assert.equal((await db.query('SELECT used_attempts::int AS used FROM _exam_attempt_quota_guard')).rows[0].used,2);
  assert.equal((await db.query('SELECT session_id FROM _exam_active_attempts')).rows[0].session_id,'second-quota');
 } finally {await db.close();}
});

test('existing graded result baseline counts before a fresh attempt is admitted',async()=>{
 const db=await fixture();
 const quotaArgs=(id,baseline)=>[
  key,'exam1',user,id,key,baseline,id,2,baseline,2,2,2,2,
  key,'exam1',user,id,exp,now
 ];
 try {
  assert.equal((await db.query(sql,quotaArgs('first-after-grade',1))).rows[0]?.session_id,'first-after-grade');
  assert.equal((await db.query(sql,quotaArgs('should-be-denied',1))).rowCount,0);
  assert.equal((await db.query('SELECT used_attempts::int AS used FROM _exam_attempt_quota_guard')).rows[0].used,2);
 } finally {await db.close();}
});

test('an in-flight submission is retained and cannot block a new eligible attempt',async()=>{
 const db=await fixture({old:true,contest:true,processing:true});
 try{
  const r=await db.query(sql,args);
  assert.equal(r.rows[0]?.session_id,newSession);
  assert.equal((await db.query('SELECT status FROM _submitted_exam_tokens')).rows[0].status,'processing');
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM _exam_grade_sessions WHERE session_id=$1',[oldSession])).rows[0].n,1);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM _exam_answer_drafts WHERE session_id=$1',[oldSession])).rows[0].n,1);
  assert.ok((await db.query('SELECT leave_requested_at FROM _exam_attempt_liveness WHERE session_id=$1',[oldSession])).rows[0].leave_requested_at);
 }finally{await db.close();}
});
test('old claim from crashed Worker retains snapshot for queued finalization',async()=>{
 const db=await fixture({old:true,contest:true,staleProcessing:true});
 try{
  const r=await db.query(sql,args);
  assert.equal(r.rows[0]?.session_id,newSession);
  assert.equal((await db.query('SELECT status FROM _submitted_exam_tokens')).rows[0].status,'processing');
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM results')).rows[0].n,0);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM _exam_grade_sessions WHERE session_id=$1',[oldSession])).rows[0].n,1);
 }finally{await db.close();}
});
test('legacy processing claim with missing timestamp remains available to finalizer',async()=>{
 const db=await fixture({old:true,contest:true,staleProcessing:true,missingClaimedAt:true});
 try{
  const r=await db.query(sql,args);
  assert.equal(r.rows[0]?.session_id,newSession);
  assert.equal((await db.query('SELECT status FROM _submitted_exam_tokens')).rows[0].status,'processing');
 }finally{await db.close();}
});

test('already-committed processing claim becomes completed without deleting score',async()=>{
 const db=await fixture({old:true,contest:true,committedProcessing:true});
 try{
  const r=await db.query(sql,args);
  assert.equal(r.rows[0]?.session_id,newSession);
  assert.equal((await db.query('SELECT status FROM _submitted_exam_tokens')).rows[0].status,'completed');
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM results')).rows[0].n,1);
 }finally{await db.close();}
});

test('committed legacy result without claim result ID is recognized by signed hash',async()=>{
 const db=await fixture({old:true,contest:true,committedProcessing:true,missingResultId:true});
 try{
  const result=await db.query(sql,args);
  assert.equal(result.rows[0]?.session_id,newSession);
  assert.equal((await db.query('SELECT status,result_id FROM _submitted_exam_tokens')).rows[0].status,'completed');
  assert.equal((await db.query('SELECT result_id FROM _submitted_exam_tokens')).rows[0].result_id,'result1');
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM results')).rows[0].n,1);
 }finally{await db.close();}
});

test('a fresh heartbeat does not permit loss of old answers when a new attempt starts',async()=>{
 const db=await fixture({old:true,contest:true,staleProcessing:true});
 try{
  await db.query('UPDATE _exam_attempt_liveness SET last_seen_at=$1',[new Date().toISOString()]);
  const r=await db.query(sql,args);
  assert.equal(r.rows[0]?.session_id,newSession);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM _exam_grade_sessions WHERE session_id=$1',[oldSession])).rows[0].n,1);
  assert.equal((await db.query('SELECT status FROM _submitted_exam_tokens')).rows[0].status,'processing');
 }finally{await db.close();}
});
test('an active finalizer keeps the original snapshot while a new attempt starts',async()=>{
 const db=await fixture({old:true,contest:true,finalizing:true});
 try{
  const r=await db.query(sql,args);
  assert.equal(r.rows[0]?.session_id,newSession);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM _exam_grade_sessions WHERE session_id=$1',[oldSession])).rows[0].n,1);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM _exam_discarded_session_archive')).rows[0].n,4);
 }finally{await db.close();}
});

test('already-committed result is preserved and counted once while new session starts',async()=>{
 const db=await fixture({old:true,contest:true,committed:true});
 try{
  const r=await db.query(sql,args);
  assert.equal(r.rows[0]?.session_id,newSession);
  assert.equal((await db.query('SELECT trang_thai FROM contest_attempts')).rows[0].trang_thai,'DA_NOP');
  assert.equal((await db.query('SELECT ma_ket_qua FROM contest_attempts')).rows[0].ma_ket_qua,'result1');
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM results')).rows[0].n,1);
 }finally{await db.close();}
});
test('grader serializes score insert with still-active claim, preventing late score writes',()=>{
 const grade=readFileSync('functions/api/exam/grade.ts','utf8');
 assert.match(grade,/WHERE EXISTS \(SELECT 1 FROM _submitted_exam_tokens t/);
 assert.match(grade,/t\.token_hash=\? AND t\.status='processing' AND t\.result_id=\?/);
 assert.match(grade,/FOR UPDATE\)/);
 assert.match(grade,/RETURNING id/);
 assert.match(grade,/if \(!committedByThisClaim\?\.id\)/);
 const fresh=readFileSync('functions/api/exam/fresh-attempt.ts','utf8');
 assert.doesNotMatch(fresh,/SET status='superseded'/);
 assert.match(fresh,/SET status='completed'/);
 assert.match(fresh,/queued_for_grading AS/);
 assert.doesNotMatch(fresh,/DELETE FROM _exam_grade_sessions|DELETE FROM _exam_answer_drafts/);
});

test('start code does not wait for prior grade, legacy session or recovery token',()=>{
 assert.match(start,/claimFreshExamAttempt\(db,/);
 assert.doesNotMatch(start,/finalizeExamLiveness|reconcileExpiredLegacyOrphan|reconcileExpiredContestOrphan|registerExpiredLegacyExamAttemptById/);
 assert.doesNotMatch(start,/EXAM_PREVIOUS_ATTEMPT_FINALIZE_RETRY|EXAM_ATTEMPT_ALREADY_ACTIVE/);
 const main=readFileSync('src/main.js','utf8');
 assert.doesNotMatch(main,/Đang hoàn tất lượt thi trước|activateExamAfterPreviousFinalization\(fetch/);
 assert.match(main,/fetchExamStartResponse\(fetch, '\/api\/exam\/start'/);
});
