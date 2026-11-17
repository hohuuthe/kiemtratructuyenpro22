import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createHash} from 'node:crypto';

const service=readFileSync('functions/api/exam/finalize-service.ts','utf8');
const start=readFileSync('functions/api/exam/start.ts','utf8');
const match=service.match(/export async function registerExpiredLegacyExamAttemptById[\s\S]*?const row:any=await db\.prepare\(`([\s\S]*?)`\)\.bind\(sessionId,cutoff,new Date\(\)\.toISOString\(\),/);
assert.ok(match,'Use production selection query');
let index=0;
const sql=match[1].replace(/\?/g,()=>'$'+(++index));
assert.equal(index,4);
const sessionHash=createHash('sha256').update('exam-session:oldsession').digest('hex');
const now='2026-11-17T01:00:00Z';
const cutoff='2026-11-17T00:58:30Z';
const old='2026-11-16T23:00:00Z';
async function makeDb({deadline=old,startAt=old,exam='exam1',heartbeat=false,ambiguousResult=false,exactResult=false}={}) {
 const db=new PGlite();
 await db.exec(`
 CREATE TABLE _exam_active_attempts(attempt_key TEXT PRIMARY KEY,session_id TEXT,exam_id TEXT,user_id TEXT,created_at TEXT,expires_at TEXT);
 CREATE TABLE _exam_grade_sessions(session_id TEXT PRIMARY KEY,exam_id TEXT,started_at TEXT,deadline_at TEXT);
 CREATE TABLE _exam_attempt_liveness(session_id TEXT PRIMARY KEY);
 CREATE TABLE results(id TEXT PRIMARY KEY,exam_id TEXT,user_id TEXT,submission_token_hash TEXT,created_at TEXT);
 `);
 await db.query('INSERT INTO _exam_active_attempts VALUES ($1,$2,$3,$4,$5,$6)',
  ['exam1:user1','oldsession','exam1','user1',old,old]);
 await db.query('INSERT INTO _exam_grade_sessions VALUES ($1,$2,$3,$4)',
  ['oldsession',exam,startAt,deadline]);
 if(heartbeat)await db.query('INSERT INTO _exam_attempt_liveness VALUES ($1)',['oldsession']);
 if(ambiguousResult||exactResult)await db.query('INSERT INTO results VALUES ($1,$2,$3,$4,$5)',
   ['old-result','exam1','user1',exactResult?sessionHash:'an-unrelated-hash',now]);
 return db;
}

test('past-deadline legacy frozen session qualifies for exact on-demand finalization',async()=>{
 const db=await makeDb();
 try{
  const result=await db.query(sql,['oldsession',cutoff,now,sessionHash]);
  assert.equal(result.rows[0]?.user_id,'user1');
  assert.equal(result.rows[0]?.exam_id,'exam1');
 }finally{await db.close();}
});

for(const [description,state] of [
 ['a still running exam',{deadline:'2026-12-01T00:00:00Z'}],
 ['not started',{startAt:null}],
 ['started less than 90 seconds ago',{startAt:'2026-11-17T00:59:00Z',deadline:'2026-11-17T00:59:30Z'}],
 ['different frozen exam',{exam:'exam2'}],
 ['already registered heartbeat',{heartbeat:true}],
 ['unverifiable historical result',{ambiguousResult:true}],
]) {
 test('legacy pre-start reconciliation refuses '+description,async()=>{
  const db=await makeDb(state);
  try{
   const result=await db.query(sql,['oldsession',cutoff,now,sessionHash]);
   assert.equal(result.rowCount,0);
  }finally{await db.close();}
 });
}

test('verified result with exact frozen session hash may be reconciled idempotently',async()=>{
 const db=await makeDb({exactResult:true});
 try{
  const result=await db.query(sql,['oldsession',cutoff,now,sessionHash]);
  assert.equal(result.rows[0]?.session_id,'oldsession');
 }finally{await db.close();}
});

test('new exam starts without invoking historical session bootstrap',()=>{
 assert.doesNotMatch(start,/registerExpiredLegacyExamAttemptById\(context, oldId\)/);
 assert.match(start,/claimFreshExamAttempt\(db,/);
 assert.match(service,/initializeExamLiveness\(db,/);
});
