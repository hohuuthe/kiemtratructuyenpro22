import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import {claimContestStart, countContestUsedAttempts, findContestStartClaim} from '../functions/api/exam/contest-start-claims.ts';

function shim(pg) {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          let i = 0;
          const queryText = sql.replace(/\?/g, () => '$' + (++i));
          assert.equal(i, values.length, 'all query placeholders must be bound');
          return {
            async first() {
              const result = await pg.query(queryText, values);
              return result.rows[0] || null;
            }
          };
        },
        async run() { await pg.query(sql); return {meta:{changes:0}}; }
      };
    }
  };
}
async function setup(pg) {
  await pg.exec(`
    CREATE TABLE contest_attempts (
      ma_phien_thi TEXT PRIMARY KEY, ma_nguoi_du_thi TEXT NOT NULL,
      ma_de_thi TEXT NOT NULL, trang_thai TEXT NOT NULL DEFAULT 'DANG_LAM'
    );
    CREATE UNIQUE INDEX uq_contest_attempt_active
      ON contest_attempts(ma_nguoi_du_thi, ma_de_thi)
      WHERE trang_thai='DANG_LAM';
    CREATE TABLE results (
      id TEXT PRIMARY KEY, ma_phien_thi TEXT, ma_nguoi_du_thi TEXT, exam_id TEXT
    );
    CREATE TABLE _exam_grade_sessions (
      session_id TEXT PRIMARY KEY, exam_id TEXT, started_at TEXT,
      deadline_at TEXT, expires_at TEXT
    );
  `);
}
const times={startedAt:'2026-11-17T14:00:00Z',deadlineAt:'2026-11-17T14:30:00Z',expiresAt:'2026-11-17T15:30:00Z'};
const claim = (db, sessionId, participantId, examId, maxAttempts) =>
  claimContestStart(db,{sessionId,participantId,examId,maxAttempts,...times});

test('new contest starts bypass a stuck ACTIVE row, but accurately count old and new attempts',async()=>{
 const pg=new PGlite();
 try {
  await setup(pg);
  await pg.exec(`
    INSERT INTO contest_attempts VALUES ('old-stuck','p1','exam-1','DANG_LAM');
    INSERT INTO _exam_grade_sessions(session_id,exam_id) VALUES
      ('new-1','exam-1'),('new-2','exam-1'),('other','exam-1');
  `);
  const db=shim(pg);
  assert.equal(await countContestUsedAttempts(db,'p1','exam-1'),1);
  const ok=await claim(db,'new-1','p1','exam-1',2);
  assert.equal(ok.sessionId,'new-1');
  assert.equal(ok.attemptNo,1);
  assert.equal(await countContestUsedAttempts(db,'p1','exam-1'),2);
  assert.equal((await findContestStartClaim(db,'new-1','p1','exam-1')).session_id,'new-1');
  await pg.exec("INSERT INTO results VALUES ('new-result','new-1','p1','exam-1')");
  assert.equal(await countContestUsedAttempts(db,'p1','exam-1'),2,'final score never double-counts a start');
  assert.equal(await claim(db,'new-2','p1','exam-1',2),null);
  assert.equal((await pg.query("SELECT started_at FROM _exam_grade_sessions WHERE session_id='new-2'")).rows[0].started_at,null);
  assert.equal((await claim(db,'other','p2','exam-1',1)).sessionId,'other');
  assert.equal((await pg.query("SELECT count(*)::integer AS n FROM contest_attempts WHERE ma_nguoi_du_thi='p1'")).rows[0].n,1);
 }finally{await pg.close();}
});
test('historical scores without contest_attempt rows still consume quota exactly once',async()=>{
 const pg=new PGlite();
 try{
  await setup(pg);
  await pg.exec(`
    INSERT INTO results VALUES
      ('historic-a',NULL,'p1','exam-1'),
      ('historic-b','missing','p1','exam-1'),
      ('other',NULL,'p2','exam-1');
    INSERT INTO _exam_grade_sessions(session_id,exam_id) VALUES ('fresh','exam-1');
  `);
  const db=shim(pg);
  assert.equal(await countContestUsedAttempts(db,'p1','exam-1'),2);
  assert.equal(await countContestUsedAttempts(db,'p2','exam-1'),1);
  assert.equal(await claim(db,'fresh','p1','exam-1',2),null);
  assert.equal((await claim(db,'fresh','p1','exam-1',3)).sessionId,'fresh');
 }finally{await pg.close();}
});
test('concurrent starts cannot overspend last remaining contest attempt',async()=>{
 const pg=new PGlite();
 try{
  await setup(pg);
  await pg.exec(`
    INSERT INTO _exam_grade_sessions(session_id,exam_id) VALUES
    ('parallel-a','exam-1'),('parallel-b','exam-1');
  `);
  const db=shim(pg);
  const attempts=await Promise.all([
    claim(db,'parallel-a','p1','exam-1',1),
    claim(db,'parallel-b','p1','exam-1',1)
  ]);
  assert.equal(attempts.filter(Boolean).length,1);
  assert.equal(await countContestUsedAttempts(db,'p1','exam-1'),1);
  assert.equal((await pg.query("SELECT count(*)::integer AS n FROM _exam_grade_sessions WHERE started_at IS NOT NULL")).rows[0].n,1);
  assert.equal((await pg.query("SELECT count(*)::integer AS n FROM _contest_start_claims WHERE participant_id='p1'")).rows[0].n,1);
 }finally{await pg.close();}
});
