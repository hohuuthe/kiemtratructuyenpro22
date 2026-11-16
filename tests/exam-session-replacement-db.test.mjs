import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const startSource = readFileSync('functions/api/exam/start.ts','utf8');
const match = startSource.match(/const replaced: any = await db\.prepare\(`([\s\S]*?)`\)\.bind\(/);
assert.ok(match, 'The test must use the exact production replacement SQL, never a mock query');
const exactSql = match[1];
let argNumber = 0;
const replacementSql = exactSql.replace(/\?/g, () => '$' + (++argNumber));
assert.equal(argNumber, 25, 'Replacement statement bind contract changed; review query and test');

async function fixture({used=0, canceled=0, processing=false}={}) {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE _exam_active_attempts (
      attempt_key TEXT PRIMARY KEY,exam_id TEXT NOT NULL,user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL
    );
    CREATE TABLE _exam_grade_sessions (
      session_id TEXT PRIMARY KEY,exam_id TEXT,teacher_id TEXT,question_ids TEXT NOT NULL,
      question_snapshot TEXT NOT NULL,exam_config TEXT NOT NULL,created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,started_at TEXT,deadline_at TEXT
    );
    CREATE TABLE _exam_abandoned_attempts (
      session_id TEXT PRIMARY KEY,exam_id TEXT NOT NULL,user_id TEXT NOT NULL,
      reason TEXT NOT NULL,abandoned_at TEXT NOT NULL
    );
    CREATE TABLE _submitted_exam_tokens (
      token_hash TEXT PRIMARY KEY,status TEXT, result_id TEXT
    );
    CREATE TABLE results (
      id TEXT PRIMARY KEY,exam_id TEXT,user_id TEXT,submission_token_hash TEXT
    );
    CREATE TABLE _exam_answer_drafts (
      session_id TEXT PRIMARY KEY, answers_json TEXT NOT NULL, revision INTEGER NOT NULL,
      saved_at TEXT NOT NULL, writer_id TEXT, writer_seen_at TEXT
    );
  `);
  const now = new Date('2026-11-16T03:00:00.000Z').toISOString();
  const end = new Date('2026-11-16T03:45:00.000Z').toISOString();
  const expiry = new Date('2026-11-16T04:45:00.000Z').toISOString();
  await db.query(`INSERT INTO _exam_active_attempts VALUES ('exam-1:user-1','exam-1','user-1','old-session',$1,$1)`,[expiry]);
  const frozen = JSON.stringify([{id:'q1', answer:'secret'}]);
  for(const id of ['old-session','new-session']) {
    await db.query(`INSERT INTO _exam_grade_sessions
      (session_id,exam_id,teacher_id,question_ids,question_snapshot,exam_config,created_at,expires_at,started_at,deadline_at)
      VALUES ($1,'exam-1','teacher-1','["q1"]',$2,'{}',$3,$4,$5,$6)`,
    [id,frozen,now,expiry,id==='old-session'?now:null,id==='old-session'?end:null]);
  }
  for(let i=0;i<used;i++) await db.query(`INSERT INTO results (id,exam_id,user_id) VALUES ($1,'exam-1','user-1')`,['result-'+i]);
  for(let i=0;i<canceled;i++) await db.query(`INSERT INTO _exam_abandoned_attempts VALUES ($1,'exam-1','user-1','previous', $2)`,['canceled-'+i,now]);
  if(processing) await db.query(`INSERT INTO _submitted_exam_tokens VALUES ('session-hash','processing',NULL)`);
  const args = [
    'exam-1:user-1','exam-1','user-1','old-session',
    'new-session',expiry,now,
    'exam-1:user-1','new-session','new-session','session-hash','session-hash',
    3,'exam-1','user-1','exam-1','user-1',3,
    now,end,expiry,'new-session',
    'exam-1','user-1',now
  ];
  return {db,args};
}

test('DB replacement atomically activates new session and archives old without deleting its questions', async()=>{
  const {db,args}=await fixture();
  try {
    const changed=await db.query(replacementSql,args);
    assert.equal(changed.rowCount,1);
    assert.equal(changed.rows[0].session_id,'old-session');
    const active=await db.query('SELECT session_id FROM _exam_active_attempts');
    assert.equal(active.rows[0].session_id,'new-session');
    const marker=await db.query('SELECT reason FROM _exam_abandoned_attempts WHERE session_id=$1',['old-session']);
    assert.equal(marker.rows[0].reason,'replaced_by_student');
    const newSession=await db.query('SELECT started_at,deadline_at FROM _exam_grade_sessions WHERE session_id=$1',['new-session']);
    assert.ok(newSession.rows[0].started_at);
    assert.ok(newSession.rows[0].deadline_at);
    const old=await db.query('SELECT question_snapshot FROM _exam_grade_sessions WHERE session_id=$1',['old-session']);
    assert.match(old.rows[0].question_snapshot,/secret/);
    assert.equal((await db.query(replacementSql,args)).rowCount,0);
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM _exam_abandoned_attempts')).rows[0].count,1);
  } finally { await db.close(); }
});

test('DB replacement refuses exhausted quota and preserves old session and snapshots',async()=>{
  const {db,args}=await fixture({used:2});
  try {
    assert.equal((await db.query(replacementSql,args)).rowCount,0);
    assert.equal((await db.query('SELECT session_id FROM _exam_active_attempts')).rows[0].session_id,'old-session');
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM _exam_abandoned_attempts')).rows[0].count,0);
    assert.equal((await db.query('SELECT started_at FROM _exam_grade_sessions WHERE session_id=$1',['new-session'])).rows[0].started_at,null);
  } finally { await db.close(); }
});

test('DB replacement refuses an in-progress submission',async()=>{
  const {db,args}=await fixture({processing:true});
  try {
    assert.equal((await db.query(replacementSql,args)).rowCount,0);
    assert.equal((await db.query('SELECT session_id FROM _exam_active_attempts')).rows[0].session_id,'old-session');
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM _exam_abandoned_attempts')).rows[0].count,0);
  } finally { await db.close(); }
});

test('DB replacement counts earlier canceled sessions, never grants unlimited free retries',async()=>{
  const {db,args}=await fixture({canceled:2});
  try {
    assert.equal((await db.query(replacementSql,args)).rowCount,0);
    assert.equal((await db.query('SELECT session_id FROM _exam_active_attempts')).rows[0].session_id,'old-session');
  } finally { await db.close(); }
});

test('DB replacement never revokes the old session when the new READY snapshot vanished',async()=>{
  const {db,args}=await fixture();
  try {
    await db.query("DELETE FROM _exam_grade_sessions WHERE session_id='new-session'");
    assert.equal((await db.query(replacementSql,args)).rowCount,0);
    assert.equal((await db.query('SELECT session_id FROM _exam_active_attempts')).rows[0].session_id,'old-session');
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM _exam_abandoned_attempts')).rows[0].count,0);
  } finally { await db.close(); }
});

test('DB replacement never revokes the old session when the new READY snapshot is already started',async()=>{
  const {db,args}=await fixture();
  try {
    await db.query("UPDATE _exam_grade_sessions SET started_at=$1 WHERE session_id='new-session'",[args[18]]);
    assert.equal((await db.query(replacementSql,args)).rowCount,0);
    assert.equal((await db.query('SELECT session_id FROM _exam_active_attempts')).rows[0].session_id,'old-session');
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM _exam_abandoned_attempts')).rows[0].count,0);
  } finally { await db.close(); }
});

const saveSource = readFileSync('functions/api/exam/save.ts','utf8');
const guardedValues = saveSource.match(/const draftValuesSql = schoolAttempt\s*\? `([\s\S]*?)`\s*:\s*'VALUES/);
const insertTemplate = saveSource.match(/const draftSql = `([\s\S]*?)`;/);
assert.ok(guardedValues && insertTemplate, 'Extract the actual school autosave query from production code');
const schoolSaveSql = insertTemplate[1].replace('${draftValuesSql}', guardedValues[1])
  .replace(/\?/g, (() => { let n=0; return () => '
assert.equal((schoolSaveSql.match(/\$\d+/g)||[]).length,11,'Review school draft-save bind contract');

test('DB: an autosave that begins after replacement cannot modify revoked session answers', async()=>{
  const {db,args} = await fixture();
  const now=new Date('2026-11-16T03:00:00.000Z').toISOString();
  const cutoff=new Date('2026-11-16T02:59:45.000Z').toISOString();
  const draftArgs = ['old-session','["first"]',1,now,'writer-abc123',now,
    'old-session','exam-1','user-1','old-session',cutoff];
  try {
    let saved=await db.query(schoolSaveSql,draftArgs);
    assert.equal(saved.rowCount,1);
    assert.equal((await db.query('SELECT answers_json FROM _exam_answer_drafts WHERE session_id=$1',['old-session'])).rows[0].answers_json,'["first"]');
    const replaced=await db.query(replacementSql,args);
    assert.equal(replaced.rowCount,1);
    const rejected=await db.query(schoolSaveSql,[...draftArgs.slice(0,1),'["tampered"]',2,...draftArgs.slice(3)]);
    assert.equal(rejected.rowCount,0);
    const historical=await db.query('SELECT answers_json,revision FROM _exam_answer_drafts WHERE session_id=$1',['old-session']);
    assert.equal(historical.rows[0].answers_json,'["first"]');
    assert.equal(historical.rows[0].revision,1);
  } finally { await db.close(); }
});

test('DB: autosave cannot write with another account or wrong exam ownership',async()=>{
  const {db}=await fixture();
  const now=new Date('2026-11-16T03:00:00.000Z').toISOString();
  const args=['old-session','["wrong"]',1,now,'writer-abc123',now,
    'old-session','exam-1','user-2','old-session',now];
  try{
    assert.equal((await db.query(schoolSaveSql,args)).rowCount,0);
    args[8]='user-1';args[7]='exam-2';
    assert.equal((await db.query(schoolSaveSql,args)).rowCount,0);
  }finally{await db.close();}
});
 + (++n); })());
assert.equal((schoolSaveSql.match(/\$\d+/g)||[]).length,11,'Review school draft-save bind contract');

test('DB: an autosave that begins after replacement cannot modify revoked session answers', async()=>{
  const {db,args} = await fixture();
  const now=new Date('2026-11-16T03:00:00.000Z').toISOString();
  const cutoff=new Date('2026-11-16T02:59:45.000Z').toISOString();
  const draftArgs = ['old-session','["first"]',1,now,'writer-abc123',now,
    'old-session','exam-1','user-1','old-session',cutoff];
  try {
    let saved=await db.query(schoolSaveSql,draftArgs);
    assert.equal(saved.rowCount,1);
    assert.equal((await db.query('SELECT answers_json FROM _exam_answer_drafts WHERE session_id=$1',['old-session'])).rows[0].answers_json,'["first"]');
    const replaced=await db.query(replacementSql,args);
    assert.equal(replaced.rowCount,1);
    const rejected=await db.query(schoolSaveSql,[...draftArgs.slice(0,1),'["tampered"]',2,...draftArgs.slice(3)]);
    assert.equal(rejected.rowCount,0);
    const historical=await db.query('SELECT answers_json,revision FROM _exam_answer_drafts WHERE session_id=$1',['old-session']);
    assert.equal(historical.rows[0].answers_json,'["first"]');
    assert.equal(historical.rows[0].revision,1);
  } finally { await db.close(); }
});

test('DB: autosave cannot write with another account or wrong exam ownership',async()=>{
  const {db}=await fixture();
  const now=new Date('2026-11-16T03:00:00.000Z').toISOString();
  const args=['old-session','["wrong"]',1,now,'writer-abc123',now,
    'old-session','exam-1','user-2','old-session',now];
  try{
    assert.equal((await db.query(schoolSaveSql,args)).rowCount,0);
    args[8]='user-1';args[7]='exam-2';
    assert.equal((await db.query(schoolSaveSql,args)).rowCount,0);
  }finally{await db.close();}
});
