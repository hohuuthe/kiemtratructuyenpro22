import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const source=readFileSync('functions/api/exam/school-result-lifecycle.ts','utf8');
const m=source.match(/const claimed: any = await db\.prepare\(`([\s\S]*?)`\)\.bind\(/);
assert.ok(m,'Must test production reservation SQL, not a mock');
let k=0;
const sql=m[1].replace(/\?/g,()=> '$'+(++k));
assert.equal(k,22,'Reservation bind count changed; review statement');
const now='2026-11-17T08:00:00.000Z';
const end='2026-11-17T08:45:00.000Z';
const expires='2026-11-17T09:45:00.000Z';

async function fixture(max=2){
  const db=new PGlite();
  await db.exec(`
    CREATE TABLE results (
      id TEXT PRIMARY KEY,user_id TEXT,student_name TEXT,student_class TEXT,lop TEXT,don_vi TEXT,
      exam_name TEXT,exam_id TEXT,score REAL,time_taken INTEGER,correct_count INTEGER,
      total_questions INTEGER,details TEXT,loai_thi_sinh TEXT,submission_token_hash TEXT,
      grading_status TEXT DEFAULT 'FINAL',score_finalized_at TEXT,created_at TEXT,
      attempt_no INTEGER,last_seen_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX uq_results_school_attempt_no ON results(exam_id,user_id,attempt_no)
      WHERE user_id IS NOT NULL AND attempt_no IS NOT NULL;
    CREATE UNIQUE INDEX uq_results_submission_token_hash ON results(submission_token_hash)
      WHERE submission_token_hash IS NOT NULL;
    CREATE TABLE _exam_grade_sessions(
      session_id TEXT PRIMARY KEY,exam_id TEXT,
      started_at TEXT,deadline_at TEXT,expires_at TEXT
    );
  `);
  await db.query('INSERT INTO _exam_grade_sessions(session_id,exam_id) VALUES ($1,$2),($3,$2)', ['session-1','exam-1','session-2']);
  const args=(session,hash,id,limit=max)=>[
    'exam-1','user-1',now,end,expires,session,'exam-1',
    limit,0,limit,
    id,'user-1','Student','12A','12A','Gia Lai','Sample','exam-1',
    20,hash,now,now
  ];
  return {db,args};
}
test('First accepted start atomically reserves zero provisional result and starts snapshot',async()=>{
  const {db,args}=await fixture();
  try{
    const r=await db.query(sql,args('session-1','hash-1','result-1'));
    assert.equal(r.rowCount,1);
    assert.equal(Number(r.rows[0].attempt_no),1);
    const row=(await db.query("SELECT score,grading_status,total_questions FROM results WHERE id='result-1'")).rows[0];
    assert.equal(row.score,0);
    assert.equal(row.grading_status,'IN_PROGRESS');
    assert.equal(row.total_questions,20);
    const snap=(await db.query("SELECT started_at FROM _exam_grade_sessions WHERE session_id='session-1'")).rows[0];
    assert.equal(snap.started_at,now);
  }finally{await db.close();}
});
test('Second start consumes exactly second slot without reading old session lock',async()=>{
  const {db,args}=await fixture();
  try{
    await db.query(sql,args('session-1','hash-1','result-1'));
    const r=await db.query(sql,args('session-2','hash-2','result-2'));
    assert.equal(Number(r.rows[0].attempt_no),2);
    assert.equal((await db.query('SELECT count(*)::int AS used FROM results')).rows[0].used,2);
  }finally{await db.close();}
});
test('Quota refusal keeps new session unstarted and never inserts ghost result',async()=>{
  const {db,args}=await fixture(1);
  try{
    await db.query(sql,args('session-1','hash-1','result-1'));
    const r=await db.query(sql,args('session-2','hash-2','result-2'));
    assert.equal(r.rowCount,0);
    assert.equal((await db.query("SELECT started_at FROM _exam_grade_sessions WHERE session_id='session-2'")).rows[0].started_at,null);
    assert.equal((await db.query('SELECT COUNT(*)::int AS used FROM results')).rows[0].used,1);
  }finally{await db.close();}
});
test('Duplicate session reservation rolls back activation rather than trapping UI',async()=>{
  const {db,args}=await fixture();
  try{
    await db.query(sql,args('session-1','hash-1','result-1'));
    await assert.rejects(db.query(sql,args('session-2','hash-1','result-2')));
    assert.equal((await db.query("SELECT started_at FROM _exam_grade_sessions WHERE session_id='session-2'")).rows[0].started_at,null);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM results')).rows[0].count,1);
  }finally{await db.close();}
});
test('Legacy attempts count toward quota but do not require old-session lookup',async()=>{
  const {db,args}=await fixture(2);
  try{
    const updated=args('session-1','hash-1','result-1');
    updated[8]=1;
    assert.equal((await db.query(sql,updated)).rowCount,1);
    const next=args('session-2','hash-2','result-2');
    next[8]=1;
    assert.equal((await db.query(sql,next)).rowCount,0);
  }finally{await db.close();}
});
test('Result finalization uses only matching provisional identity and rejects newer attempt',()=>{
  const grade=readFileSync('functions/api/exam/grade.ts','utf8');
  assert.match(grade,/UPDATE results AS reserved SET/);
  assert.match(grade,/reserved.grading_status = 'IN_PROGRESS'/);
  assert.match(grade,/newer.attempt_no > reserved.attempt_no/);
  assert.match(grade,/EXAM_RESULT_NOT_ACTIVE/);
  assert.match(grade,/claimedResultId = String\(schoolReservation.id\)/);
  assert.match(grade,/isSchoolResultProvisional/);
});
