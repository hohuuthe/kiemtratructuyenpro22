import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const source=readFileSync('functions/api/exam/lifecycle.ts','utf8');
const tick=String.fromCharCode(96);
const extract=(start)=>{
  const pos=source.indexOf(start);
  assert.ok(pos>=0,'Missing production query '+start);
  const begin=source.indexOf(tick,pos);
  const end=source.indexOf(tick,begin+1);
  assert.ok(end>begin);
  let n=0;
  return {sql:source.slice(begin+1,end).replace(/\?/g,()=>'$'+(++n)),arity:n};
};
const heartbeat=extract('const updated: any = await db.prepare(');
const finalizer=extract('const claimed: any = await db.prepare(');
const orphan=extract('const orphan: any = await db.prepare(');
assert.equal(heartbeat.arity,10);
assert.equal(finalizer.arity,9);
assert.equal(orphan.arity,10);

async function fixture(){
  const db=new PGlite();
  await db.exec([
    'CREATE TABLE _exam_active_attempts (attempt_key TEXT PRIMARY KEY,exam_id TEXT,user_id TEXT,session_id TEXT,expires_at TEXT,created_at TEXT,heartbeat_at TEXT,finalizing_at TEXT)',
    'CREATE TABLE _exam_grade_sessions (session_id TEXT PRIMARY KEY,started_at TEXT,deadline_at TEXT,expires_at TEXT)',
    'CREATE TABLE _exam_abandoned_attempts (session_id TEXT PRIMARY KEY,exam_id TEXT,user_id TEXT,reason TEXT,abandoned_at TEXT)',
    'CREATE TABLE _submitted_exam_tokens (token_hash TEXT PRIMARY KEY,status TEXT)',
    'CREATE TABLE results (id TEXT PRIMARY KEY,submission_token_hash TEXT)'
  ].join(';')+';');
  const now=Date.parse('2026-11-17T06:00:00Z');
  const current=new Date(now).toISOString();
  const stale=new Date(now-91_000).toISOString();
  const cutoff=new Date(now-90_000).toISOString();
  const retry=new Date(now-300_000).toISOString();
  const future=new Date(now+600_000).toISOString();
  await db.query('INSERT INTO _exam_active_attempts (attempt_key,exam_id,user_id,session_id,expires_at,created_at,heartbeat_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
   ['exam-1:user-1','exam-1','user-1','session-1',future,stale,stale]);
  await db.query('INSERT INTO _exam_grade_sessions VALUES ($1,$2,$3,$4)',['session-1',stale,future,future]);
  return {db,current,stale,cutoff,retry,future};
}
const hb=f=>[f.current,'exam-1:user-1','exam-1','user-1','session-1',f.cutoff,'session-1',f.current,f.current,'token-hash'];
const fin=f=>[f.current,'exam-1:user-1','exam-1','user-1','session-1',f.retry,f.cutoff,'session-1',f.current];
const orph=f=>['exam-1:user-1','exam-1','user-1','session-1',f.cutoff,'exam-1','user-1',f.current,'token-hash','exam-1:user-1'];

test('Heartbeat refuses expired/disconnected, finalizing and already-completed attempts',async()=>{
  const f=await fixture();
  try {
    assert.equal((await f.db.query(heartbeat.sql,hb(f))).rowCount,0);
    await f.db.query('UPDATE _exam_active_attempts SET heartbeat_at=$1',[f.current]);
    assert.equal((await f.db.query(heartbeat.sql,hb(f))).rowCount,1);
    await f.db.query('UPDATE _exam_active_attempts SET finalizing_at=$1',[f.current]);
    assert.equal((await f.db.query(heartbeat.sql,hb(f))).rowCount,0);
    await f.db.query('UPDATE _exam_active_attempts SET finalizing_at=NULL');
    await f.db.query("INSERT INTO _submitted_exam_tokens VALUES ('token-hash','completed')");
    assert.equal((await f.db.query(heartbeat.sql,hb(f))).rowCount,0);
  } finally {await f.db.close();}
});
test('Finalization claim is single-winner and refuses fresh heartbeats',async()=>{
  const f=await fixture();
  try {
    assert.equal((await f.db.query(finalizer.sql,fin(f))).rowCount,1);
    assert.equal((await f.db.query(finalizer.sql,fin(f))).rowCount,0);
    await f.db.query('UPDATE _exam_active_attempts SET finalizing_at=NULL, heartbeat_at=$1',[f.current]);
    assert.equal((await f.db.query(finalizer.sql,fin(f))).rowCount,0);
  } finally {await f.db.close();}
});
test('Orphan release consumes one audit attempt and never releases a fresh or scored attempt',async()=>{
  const f=await fixture();
  try {
    await f.db.query('UPDATE _exam_active_attempts SET heartbeat_at=$1',[f.current]);
    assert.equal((await f.db.query(orphan.sql,orph(f))).rowCount,0);
    await f.db.query('UPDATE _exam_active_attempts SET heartbeat_at=$1',[f.stale]);
    assert.equal((await f.db.query(orphan.sql,orph(f))).rowCount,1);
    assert.equal((await f.db.query(orphan.sql,orph(f))).rowCount,0);
    assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM _exam_abandoned_attempts')).rows[0].n,1);
    assert.equal((await f.db.query('SELECT COUNT(*)::int AS n FROM _exam_active_attempts')).rows[0].n,0);
  } finally {await f.db.close();}
});
test('Orphan release refuses a previously committed result',async()=>{
  const f=await fixture();
  try {
    await f.db.query("INSERT INTO results VALUES ('result-1','token-hash')");
    assert.equal((await f.db.query(orphan.sql,orph(f))).rowCount,0);
  } finally {await f.db.close();}
});
