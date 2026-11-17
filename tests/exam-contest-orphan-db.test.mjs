import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const source=readFileSync('functions/api/exam/orphan-reconcile.ts','utf8');
const start=readFileSync('functions/api/exam/start.ts','utf8');
const prefix='export const EXPIRED_CONTEST_ORPHAN_SQL = '+String.fromCharCode(96);
const i=source.indexOf(prefix);
assert.ok(i>=0,'production contest orphan SQL exists');
const end=source.indexOf(String.fromCharCode(96)+';',i+prefix.length);
assert.ok(end>i,'production contest orphan SQL closes');
let index=0;
const sql=source.slice(i+prefix.length,end).replace(/\?/g,()=>'$'+(++index));
assert.equal(index,9);
const old='2026-11-16T05:00:00Z';
const now='2026-11-17T00:00:00Z';
const hash=createHash('sha256').update('exam-session:old-session').digest('hex');
const args=['exam1:contest:person1','old-session','contest:person1','person1',
  '2026-11-16T23:58:30Z','2026-11-16T23:58:30Z',hash,hash,'exam1:contest:person1'];

async function fixture({snapshot=false,heartbeat=false,result=false,processing=false,
  recent=false,owner='person1',status='DANG_LAM'}={}) {
 const db=new PGlite();
 await db.exec([
  'CREATE TABLE _exam_active_attempts(attempt_key TEXT PRIMARY KEY,session_id TEXT NOT NULL,exam_id TEXT NOT NULL,user_id TEXT NOT NULL,created_at TEXT,expires_at TEXT)',
  'CREATE TABLE contest_attempts(ma_phien_thi TEXT PRIMARY KEY,ma_de_thi TEXT,ma_nguoi_du_thi TEXT,trang_thai TEXT,ma_ket_qua TEXT,thoi_diem_nop TEXT)',
  'CREATE TABLE _exam_answer_drafts(session_id TEXT PRIMARY KEY,answers_json TEXT,saved_at TEXT)',
  'CREATE TABLE _exam_grade_sessions(session_id TEXT PRIMARY KEY)',
  'CREATE TABLE _exam_attempt_liveness(session_id TEXT PRIMARY KEY)',
  'CREATE TABLE _submitted_exam_tokens(token_hash TEXT PRIMARY KEY,status TEXT)',
  'CREATE TABLE results(id TEXT PRIMARY KEY,ma_phien_thi TEXT,submission_token_hash TEXT)',
  'CREATE TABLE _exam_discarded_session_archive(session_id TEXT NOT NULL,kind TEXT NOT NULL,source_data JSONB NOT NULL,reason TEXT NOT NULL,archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(session_id,kind))'
 ].join(';')+';');
 await db.query('INSERT INTO _exam_active_attempts VALUES($1,$2,$3,$4,$5,$6)',
   ['exam1:contest:person1','old-session','exam1','contest:person1',recent?now:old,now]);
 await db.query('INSERT INTO contest_attempts VALUES($1,$2,$3,$4,$5,$6)',
   ['old-session','exam1',owner,status,null,null]);
 await db.query('INSERT INTO _exam_answer_drafts VALUES($1,$2,$3)',
   ['old-session','["partial"]',recent?now:old]);
 if(snapshot) await db.query('INSERT INTO _exam_grade_sessions VALUES($1)',['old-session']);
 if(heartbeat) await db.query('INSERT INTO _exam_attempt_liveness VALUES($1)',['old-session']);
 if(processing) await db.query('INSERT INTO _submitted_exam_tokens VALUES($1,$2)',[hash,'processing']);
 if(result) await db.query('INSERT INTO results VALUES($1,$2,$3)',['r1','old-session',hash]);
 return db;
}
test('an invalid old contest session is archived and cleared without grading or consuming a completion',async()=>{
 const db=await fixture();
 try{
  const row=await db.query(sql,args);
  assert.equal(row.rows[0]?.session_id,'old-session');
  assert.equal((await db.query('SELECT trang_thai FROM contest_attempts')).rows[0].trang_thai,'HUY');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM _exam_active_attempts')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM _exam_answer_drafts')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM _exam_discarded_session_archive')).rows[0].n,3);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM results')).rows[0].n,0);
  assert.equal((await db.query(sql,args)).rowCount,0);
 }finally{await db.close();}
});
for(const [name,opts] of [
 ['frozen snapshot exists',{snapshot:true}],
 ['heartbeat exists',{heartbeat:true}],
 ['a committed result exists',{result:true}],
 ['a submission is processing',{processing:true}],
 ['attempt remains fresh',{recent:true}],
 ['participant mismatch',{owner:'person2'}],
 ['contest is already canceled',{status:'HUY'}]
]){
 test('contest cleanup refuses if '+name,async()=>{
  const db=await fixture(opts);
  try{
   assert.equal((await db.query(sql,args)).rowCount,0);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM _exam_active_attempts')).rows[0].n,1);
   assert.equal((await db.query('SELECT count(*)::int AS n FROM _exam_discarded_session_archive')).rows[0].n,0);
  }finally{await db.close();}
 });
}
test('new contest session does not wait for legacy orphan lookup',()=>{
 assert.doesNotMatch(start,/reconcileExpiredContestOrphan\(db,oldKey,oldId/);
 assert.match(start,/claimFreshExamAttempt\(db,/);
});
