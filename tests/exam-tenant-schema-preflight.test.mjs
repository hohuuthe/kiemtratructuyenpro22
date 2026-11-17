import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=readFileSync('migrations/20261117_exam_start_tenant_preflight.sql','utf8');
const school=readFileSync('functions/api/exam/school-result-lifecycle.ts','utf8');
const contest=readFileSync('functions/api/exam/contest-start-claims.ts','utf8');

test('tenant migration is additive, repeatable and protects the contest ledger', async()=>{
  const pg=new PGlite();
  try {
    await pg.exec(`
      CREATE TABLE results (
        id TEXT PRIMARY KEY, exam_id TEXT, user_id TEXT,
        submission_token_hash TEXT, grading_status TEXT DEFAULT 'FINAL',
        score_finalized_at TEXT
      );
      INSERT INTO results(id,exam_id,user_id,grading_status)
        VALUES ('historical','exam-1','learner-1','FINAL');
    `);
    await pg.exec(migration);
    await pg.exec(migration);
    const cols=await pg.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='results'
        AND column_name IN ('attempt_no','last_seen_at','grading_status',
          'submission_token_hash','score_finalized_at')
    `);
    assert.equal(cols.rows.length,5);
    const ledger=await pg.query(`
      SELECT relrowsecurity FROM pg_class
      WHERE oid=to_regclass('public._contest_start_claims')
    `);
    assert.equal(ledger.rows[0].relrowsecurity,true);
    const indexes=await pg.query(`
      SELECT indexname FROM pg_indexes WHERE schemaname='public'
      AND indexname IN ('uq_contest_start_claim_slot',
        'uq_results_school_attempt_no','uq_results_submission_token_hash')
    `);
    assert.equal(indexes.rows.length,3);
    const original=await pg.query("SELECT grading_status FROM results WHERE id='historical'");
    assert.equal(original.rows[0].grading_status,'FINAL');
    await pg.exec(`
      INSERT INTO _contest_start_claims(session_id,participant_id,exam_id,attempt_no,created_at)
      VALUES ('new-1','candidate-1','exam-1',1,now())
    `);
    await assert.rejects(pg.exec(`
      INSERT INTO _contest_start_claims(session_id,participant_id,exam_id,attempt_no,created_at)
      VALUES ('new-2','candidate-1','exam-1',1,now())
    `));
    await assert.rejects(pg.exec(`
      INSERT INTO results(id,exam_id,user_id,submission_token_hash)
      VALUES ('row-a','exam-1','learner-1','token-1'),
             ('row-b','exam-1','learner-1','token-1')
    `));
  } finally { await pg.close(); }
});

test('school and contest preflights are cached per tenant, retry failures, and bypass repeat DDL',()=>{
  for (const source of [school,contest]) {
    assert.match(source,/new Map<string, Promise<void>>\(\)/);
    assert.match(source,/String\(db\?\.connectionUrl \|\| ''\)/);
    assert.match(source,/if \(!dbKey\) return initialize/);
    assert.match(source,/if \(.*\.get\(dbKey\) === pending\).*\.delete\(dbKey\)/);
    assert.match(source,/if \(await .*SchemaReady\(db\)\) return;/);
    assert.match(source,/if \(!await .*SchemaReady\(db\)\)/);
  }
  assert.match(contest,/relrowsecurity/);
  assert.match(contest,/uq_contest_start_claim_slot/);
  assert.match(school,/uq_results_school_attempt_no/);
});
