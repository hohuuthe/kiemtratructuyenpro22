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
assert.equal(count,10);
const now='2026-11-17T01:00:00Z',exp='2026-11-18T01:00:00Z';
const user='contest:student1';
const key='exam1:'+user;
const oldSession='old-session',newSession='new-session';
const args=[key,'exam1',user,newSession,key,'exam1',user,newSession,exp,now];
const tokenHash=createHash('sha256').update('exam-session:'+oldSession).digest('hex');

async function fixture({old=false,contest=false,processing=false,committed=false}={}){
 const db=new PGlite();
 await db.exec(`
 CREATE TABLE _exam_active_attempts(attempt_key TEXT PRIMARY KEY,exam_id TEXT,user_id TEXT,session_id TEXT,expires_at TEXT,created_at TEXT);
 CREATE TABLE _exam_grade_sessions(session_id TEXT PRIMARY KEY,question_snapshot TEXT,question_ids TEXT,created_at TEXT);
 CREATE TABLE _exam_answer_drafts(session_id TEXT PRIMARY KEY,answers_json TEXT,revision INTEGER,saved_at TEXT);
 CREATE TABLE _exam_attempt_liveness(session_id TEXT PRIMARY KEY,finalized_at TEXT,last_error TEXT);
 CREATE TABLE _submitted_exam_tokens(token_hash TEXT PRIMARY KEY,status TEXT);
 CREATE TABLE contest_attempts(ma_phien_thi TEXT PRIMARY KEY,ma_nguoi_du_thi TEXT,ma_de_thi TEXT,trang_thai TEXT,ma_ket_qua TEXT,thoi_diem_nop TIMESTAMPTZ);
 CREATE TABLE results(id TEXT PRIMARY KEY,ma_phien_thi TEXT,ma_nguoi_du_thi TEXT,exam_id TEXT,created_at TIMESTAMPTZ);
 CREATE TABLE _exam_discarded_session_archive(session_id TEXT,kind TEXT,source_data JSONB,reason TEXT,archived_at TIMESTAMPTZ DEFAULT now(),PRIMARY KEY(session_id,kind));
 `);
 if(old){
  await db.query('INSERT INTO _exam_active_attempts VALUES($1,$2,$3,$4,$5,$6)',[key,'exam1',user,oldSession,exp,now]);
  await db.query('INSERT INTO _exam_grade_sessions VALUES($1,$2,$3,$4)',[oldSession,'[{"id":"Q1"}]','["Q1"]',now]);
  await db.query('INSERT INTO _exam_answer_drafts VALUES($1,$2,$3,$4)',[oldSession,'["A"]',3,now]);
  await db.query('INSERT INTO _exam_attempt_liveness VALUES($1,$2,$3)',[oldSession,null,null]);
  if(contest)await db.query('INSERT INTO contest_attempts VALUES($1,$2,$3,$4,$5,$6)',[oldSession,'student1','exam1','DANG_LAM',null,null]);
  if(processing) await db.query('INSERT INTO _submitted_exam_tokens VALUES($1,$2)',[tokenHash,'processing']);
  if(committed)await db.query('INSERT INTO results VALUES($1,$2,$3,$4,$5)',['result1',oldSession,'student1','exam1',now]);
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
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM _exam_grade_sessions WHERE session_id=$1',[oldSession])).rows[0].n,0);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM _exam_answer_drafts WHERE session_id=$1',[oldSession])).rows[0].n,0);
  assert.equal((await db.query('SELECT finalized_at FROM _exam_attempt_liveness WHERE session_id=$1',[oldSession])).rows[0].finalized_at!==null,true);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM _exam_discarded_session_archive')).rows[0].n,4);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM results')).rows[0].n,0);
 }finally{await db.close();}
});
test('authenticated school learner starts a new exam even with a previous unfinished lock',async()=>{
 const db=await fixture({old:true});
 const school='student1',schoolKey='exam1:'+school;
 const schoolArgs=[schoolKey,'exam1',school,newSession,schoolKey,'exam1',school,newSession,exp,now];
 try{
  await db.query('UPDATE _exam_active_attempts SET attempt_key=$1,user_id=$2',[schoolKey,school]);
  const r=await db.query(sql,schoolArgs);
  assert.equal(r.rows[0]?.session_id,newSession);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM _exam_grade_sessions')).rows[0].n,0);
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

test('a processing submission cannot be superseded',async()=>{
 const db=await fixture({old:true,contest:true,processing:true});
 try{
  const r=await db.query(sql,args);
  assert.equal(r.rowCount,0);
  assert.equal((await db.query('SELECT session_id FROM _exam_active_attempts')).rows[0].session_id,oldSession);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM _exam_discarded_session_archive')).rows[0].n,0);
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
test('start code does not wait for prior grade, legacy session or recovery token',()=>{
 assert.match(start,/claimFreshExamAttempt\(db,/);
 assert.doesNotMatch(start,/finalizeExamLiveness|reconcileExpiredLegacyOrphan|reconcileExpiredContestOrphan|registerExpiredLegacyExamAttemptById/);
 assert.doesNotMatch(start,/EXAM_PREVIOUS_ATTEMPT_FINALIZE_RETRY|EXAM_ATTEMPT_ALREADY_ACTIVE/);
 const main=readFileSync('src/main.js','utf8');
 assert.doesNotMatch(main,/Đang hoàn tất lượt thi trước|activateExamAfterPreviousFinalization\(fetch/);
 assert.match(main,/fetchExamStartResponse\(fetch, '\/api\/exam\/start'/);
});
