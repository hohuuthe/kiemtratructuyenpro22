import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const source=readFileSync('functions/api/exam/orphan-reconcile.ts','utf8');
const match=source.match(/export const EXPIRED_LEGACY_ORPHAN_SQL = `([\s\S]*?)`;/);
assert.ok(match,'Use production SQL, not a reimplementation');
let n=0;
const sql=match[1].replace(/\?/g,()=>'$'+(++n));
assert.equal(n,7);
const verifiedMatch=source.match(/export const EXPIRED_SUBMITTED_ORPHAN_SQL = \`([\s\S]*?)\`;/);
assert.ok(verifiedMatch,'Extract production verified-result reconciliation SQL');
let verifiedBindings=0;
const verifiedSql=verifiedMatch[1].replace(/\?/g,()=>'$'+(++verifiedBindings));
assert.equal(verifiedBindings,4);
const sha=s=>createHash('sha256').update(s).digest('hex');
const expiry=new Date('2026-11-10T00:00:00Z').toISOString();
const started=new Date('2026-11-07T00:00:00Z').toISOString();
const now=new Date('2026-11-17T00:00:00Z').toISOString();
async function fixture({snapshot=false,liveness=false,completed=false,processing=false,laterResult=false,submittedResult=false,wrongResultOwner=false,expiryAt=expiry}={}) {
  const db=new PGlite();
  await db.exec(`
    CREATE TABLE _exam_active_attempts (attempt_key TEXT PRIMARY KEY, exam_id TEXT NOT NULL,user_id TEXT NOT NULL,session_id TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE _exam_grade_sessions(session_id TEXT PRIMARY KEY);
    CREATE TABLE _exam_attempt_liveness(session_id TEXT PRIMARY KEY);
    CREATE TABLE _exam_abandoned_attempts(session_id TEXT PRIMARY KEY,exam_id TEXT NOT NULL,user_id TEXT NOT NULL,reason TEXT NOT NULL,abandoned_at TEXT NOT NULL);
    CREATE TABLE _submitted_exam_tokens(token_hash TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE results(id TEXT PRIMARY KEY,exam_id TEXT,user_id TEXT,submission_token_hash TEXT,created_at TEXT);
    CREATE TABLE _exam_answer_drafts(session_id TEXT PRIMARY KEY,answers_json TEXT,revision INT);
  `);
  await db.query('INSERT INTO _exam_active_attempts VALUES ($1,$2,$3,$4,$5,$6)', ['exam1:user1','exam1','user1','oldsession',expiryAt,started]);
  await db.query('INSERT INTO _exam_answer_drafts VALUES ($1,$2,$3)',['oldsession','["work remains"]',7]);
  if(snapshot) await db.query('INSERT INTO _exam_grade_sessions VALUES ($1)',['oldsession']);
  if(liveness) await db.query('INSERT INTO _exam_attempt_liveness VALUES ($1)',['oldsession']);
  if(completed||processing)await db.query('INSERT INTO _submitted_exam_tokens VALUES ($1,$2)',[sha('exam-session:oldsession'),processing?'processing':'completed']);
  if(laterResult)await db.query('INSERT INTO results VALUES ($1,$2,$3,$4,$5)',['res1','exam1','user1','unrelated',now]);
  if(submittedResult||wrongResultOwner)await db.query(
    'INSERT INTO results VALUES ($1,$2,$3,$4,$5)',
    ['graded-result',wrongResultOwner?'another-exam':'exam1','user1',sha('exam-session:oldsession'),now]
  );
  const args=['exam1:user1','oldsession',now,sha('exam-session:oldsession'),sha('exam-session:oldsession'),now,'exam1:user1'];
  return {db,args};
}

test('expired missing snapshot is archived and lock released without erasing draft',async()=>{
 const {db,args}=await fixture();
 try{
  const result=await db.query(sql,args);
  assert.equal(result.rows[0]?.session_id,'oldsession');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM _exam_active_attempts')).rows[0].n,0);
  const archived=await db.query('SELECT reason FROM _exam_abandoned_attempts WHERE session_id=$1',['oldsession']);
  assert.equal(archived.rows[0].reason,'orphan_snapshot_missing');
  assert.equal((await db.query('SELECT answers_json FROM _exam_answer_drafts WHERE session_id=$1',['oldsession'])).rows[0].answers_json,'["work remains"]');
  assert.equal((await db.query(sql,args)).rowCount,0);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM _exam_abandoned_attempts')).rows[0].n,1);
 } finally{await db.close();}
});

for(const [name,opts] of [
 ['a frozen session exists',{snapshot:true}],
 ['a new liveness row exists',{liveness:true}],
 ['submission is already completed',{completed:true}],
 ['submission is processing',{processing:true}],
 ['the same account/exam has a later result',{laterResult:true}],
 ['lock has not expired',{expiryAt:'2026-12-17T00:00:00Z'}],
]){
 test('orphan reconciliation refuses when '+name,async()=>{
  const {db,args}=await fixture(opts);
  try{
   assert.equal((await db.query(sql,args)).rowCount,0);
   assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM _exam_active_attempts')).rows[0].n,1);
   assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM _exam_abandoned_attempts')).rows[0].n,0);
  }finally{await db.close();}
 });
}

test('wrong attempt key or stale session ID cannot release another lock',async()=>{
 const {db,args}=await fixture();
 try{
  assert.equal((await db.query(sql,['exam1:user2',...args.slice(1)])).rowCount,0);
  assert.equal((await db.query(sql,[args[0],'another-session',...args.slice(2)])).rowCount,0);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM _exam_active_attempts')).rows[0].n,1);
 }finally{await db.close();}
});

test('a committed result with exact session hash releases a stale lock without counting another attempt',async()=>{
 const {db,args}=await fixture({submittedResult:true});
 try{
  const got=await db.query(verifiedSql,[args[0],args[1],args[2],args[3]]);
  assert.equal(got.rows[0]?.session_id,'oldsession');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM _exam_active_attempts')).rows[0].n,0);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM _exam_abandoned_attempts')).rows[0].n,0);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM results')).rows[0].n,1);
  assert.equal((await db.query('SELECT answers_json FROM _exam_answer_drafts WHERE session_id=$1',['oldsession'])).rows[0].answers_json,'["work remains"]');
  assert.equal((await db.query(verifiedSql,[args[0],args[1],args[2],args[3]])).rowCount,0);
 }finally{await db.close();}
});

for(const [name,opts] of [
 ['wrong owner of verified result',{wrongResultOwner:true}],
 ['session remains present',{submittedResult:true,snapshot:true}],
 ['heartbeat still present',{submittedResult:true,liveness:true}],
 ['lock not expired',{submittedResult:true,expiryAt:'2026-12-17T00:00:00Z'}],
]){
 test('cannot release completed-result lock if '+name,async()=>{
  const {db,args}=await fixture(opts);
  try{
   assert.equal((await db.query(verifiedSql,[args[0],args[1],args[2],args[3]])).rowCount,0);
   assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM _exam_active_attempts')).rows[0].n,1);
  }finally{await db.close();}
 });
}

test('start retries after an orphan cleanup and does not bypass quota check',()=>{
 const start=readFileSync('functions/api/exam/start.ts','utf8');
 assert.match(start,/reconcileExpiredLegacyOrphan\(/);
 assert.match(start,/const orphanReleased=signedStudentUserId && !contestParticipantId/);
 assert.match(start,/EXAM_PREVIOUS_ATTEMPT_RECONCILED/);
 assert.match(start,/completed \+ usedCanceled/);
 assert.match(start,/if \(orphanReleased\) \{/);
});
