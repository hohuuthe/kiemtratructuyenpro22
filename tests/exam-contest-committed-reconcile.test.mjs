import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const service=readFileSync('functions/api/exam/finalize-service.ts','utf8');
const start=readFileSync('functions/api/exam/start.ts','utf8');
const match=service.match(new RegExp('export const RECONCILE_COMMITTED_CONTEST_RESULT_SQL = `([\\s\\S]*?)`;'));
assert.ok(match,'Use production reconciliation SQL');
let index=0;
const sql=match[1].replace(/\?/g,()=>'$'+(++index));
assert.equal(index,5);
async function fixture({result=true,wrongOwner=false,wrongExam=false,canceled=false}={}) {
 const db=new PGlite();
 await db.exec(`
  CREATE TABLE _exam_active_attempts (attempt_key TEXT PRIMARY KEY,session_id TEXT NOT NULL,exam_id TEXT,user_id TEXT);
  CREATE TABLE contest_attempts (ma_phien_thi TEXT PRIMARY KEY,ma_de_thi TEXT,ma_nguoi_du_thi TEXT,trang_thai TEXT,ma_ket_qua TEXT,thoi_diem_nop TIMESTAMPTZ);
  CREATE TABLE results(id TEXT PRIMARY KEY,ma_phien_thi TEXT,exam_id TEXT,ma_nguoi_du_thi TEXT);
 `);
 await db.query('INSERT INTO _exam_active_attempts VALUES ($1,$2,$3,$4)',
  ['exam1:contest:person1','old-session','exam1','contest:person1']);
 await db.query('INSERT INTO contest_attempts (ma_phien_thi,ma_de_thi,ma_nguoi_du_thi,trang_thai) VALUES ($1,$2,$3,$4)',
  ['old-session','exam1','person1',canceled?'HUY':'DANG_LAM']);
 if(result)await db.query('INSERT INTO results VALUES ($1,$2,$3,$4)',
  ['saved-result','old-session',wrongExam?'exam2':'exam1',wrongOwner?'person2':'person1']);
 return db;
}
const params=['exam1:contest:person1','old-session','contest:person1','person1','exam1:contest:person1'];
test('committed contest result releases exactly its stale lock and preserves saved grade',async()=>{
 const db=await fixture();
 try{
  assert.equal((await db.query(sql,params)).rows[0]?.session_id,'old-session');
  assert.equal((await db.query('SELECT trang_thai FROM contest_attempts')).rows[0].trang_thai,'DA_NOP');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM _exam_active_attempts')).rows[0].n,0);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM results')).rows[0].n,1);
  assert.equal((await db.query(sql,params)).rowCount,0);
 }finally{await db.close();}
});
for(const [name,opts] of [
 ['ungraded old session',{result:false}],
 ['result belongs to another participant',{wrongOwner:true}],
 ['result belongs to another exam',{wrongExam:true}],
 ['canceled contest attempt',{canceled:true}],
]){
 test('never release contest lock when '+name,async()=>{
  const db=await fixture(opts);
  try{
   assert.equal((await db.query(sql,params)).rowCount,0);
   assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM _exam_active_attempts')).rows[0].n,1);
  }finally{await db.close();}
 });
}
test('a different contest participant cannot modify this session',async()=>{
 const db=await fixture();
 try{
  assert.equal((await db.query(sql,[params[0],params[1],'contest:person2','person2',params[4]])).rowCount,0);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM _exam_active_attempts')).rows[0].n,1);
 }finally{await db.close();}
});
test('fresh claim safely owns contest replacement instead of old lookup',()=>{
 assert.doesNotMatch(start,/reconcileCommittedContestResult\(/);
 assert.match(start,/claimFreshExamAttempt\(db,/);
});
