import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EXAM_HEARTBEAT_INTERVAL_MS,
  EXAM_DISCONNECT_GRACE_MS,
  isSchoolExamHeartbeatStale
} from '../src/exam-connection-lifecycle.js';

const now = Date.parse('2026-11-17T07:00:00.000Z');
const stamp = ms => new Date(ms).toISOString();

test('30-second heartbeat with strict 90-second offline limit', () => {
  assert.equal(EXAM_HEARTBEAT_INTERVAL_MS, 30000);
  assert.equal(EXAM_DISCONNECT_GRACE_MS, 90000);
  assert.equal(isSchoolExamHeartbeatStale({last_seen_at:stamp(now - 30000)},now),false);
  assert.equal(isSchoolExamHeartbeatStale({last_seen_at:stamp(now - 89999)},now),false);
  assert.equal(isSchoolExamHeartbeatStale({last_seen_at:stamp(now - 90000)},now),true);
  assert.equal(isSchoolExamHeartbeatStale({last_seen_at:stamp(now - 150000)},now),true);
  assert.equal(isSchoolExamHeartbeatStale({created_at:stamp(now - 90000)},now),true);
  assert.equal(isSchoolExamHeartbeatStale({},now),false);
});

test('Heartbeat rejects closed provisional attempts and mismatched authenticated owners', () => {
  const source=readFileSync('functions/api/exam/heartbeat.ts','utf8');
  assert.match(source,/verifyAuthSession/);
  assert.match(source,/verifyJWT/);
  assert.match(source,/claims\.studentUserId/);
  assert.match(source,/current_attempt\.exam_id = \?/);
  assert.match(source,/current_attempt\.user_id = \?/);
  assert.match(source,/current_attempt\.grading_status = 'IN_PROGRESS'/);
  assert.match(source,/current_attempt\.last_seen_at > \?/);
  assert.match(source,/EXAM_SESSION_CLOSED/);
  assert.doesNotMatch(source,/_exam_active_attempts/);
});

test('Only a new result reservation consumes a school attempt; old locks are irrelevant',()=>{
  const start=readFileSync('functions/api/exam/start.ts','utf8');
  assert.match(start,/claimSchoolResultAtStart/);
  assert.match(start,/schoolReserved/);
  assert.doesNotMatch(start,/oldSchoolAttemptSessionId/);
});

test('Heartbeat must verify the id actually returned by the successful SQL UPDATE', () => {
  const source = readFileSync('functions/api/exam/heartbeat.ts', 'utf8');
  const sql = source.split('const refreshed: any = await db.prepare(')[1]?.split(').bind(')[0];
  assert.ok(sql, 'Heartbeat update SQL exists');
  assert.match(sql, /RETURNING current_attempt\\.id/);
  assert.match(source, /if \\(!refreshed\\?\\.id\\)/);
  assert.doesNotMatch(source, /if \\(!refreshed\\?\\.session_id\\)/);
});

test('PostgreSQL heartbeat renews a valid attempt, not a stale, foreign or superseded attempt', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const source = readFileSync('functions/api/exam/heartbeat.ts', 'utf8');
  const statement = source.split('const refreshed: any = await db.prepare(`')[1]?.split('`).bind(')[0];
  assert.ok(statement, 'Must exercise the production UPDATE SQL');
  let n = 0;
  const sql = statement.replace(/\\?/g, () => '$' + (++n));
  assert.equal(n, 5);
  const db = new PGlite();
  const now = '2026-11-17T08:00:00.000Z';
  const cutoff = '2026-11-17T07:58:30.000Z';
  try {
    await db.exec(`
      CREATE TABLE results (
        id TEXT PRIMARY KEY, submission_token_hash TEXT, exam_id TEXT, user_id TEXT,
        grading_status TEXT, last_seen_at TIMESTAMPTZ, attempt_no INTEGER
      );
      INSERT INTO results VALUES
        ('live','live-hash','exam-1','student-1','IN_PROGRESS','2026-11-17T07:59:45Z',1),
        ('stale','stale-hash','exam-1','student-2','IN_PROGRESS','2026-11-17T07:58:20Z',1),
        ('closed','closed-hash','exam-1','student-3','FINAL','2026-11-17T07:59:45Z',1),
        ('old','old-hash','exam-1','student-4','IN_PROGRESS','2026-11-17T07:59:45Z',1),
        ('newer','new-hash','exam-1','student-4','IN_PROGRESS','2026-11-17T07:59:45Z',2);
    `);
    const run = async (hash, owner, exam = 'exam-1') =>
      (await db.query(sql, [now, hash, exam, owner, cutoff])).rows;
    assert.equal((await run('live-hash', 'student-1'))[0].id, 'live');
    assert.equal((await run('live-hash', 'student-1'))[0].id, 'live');
    assert.equal((await run('live-hash', 'different-user')).length, 0);
    assert.equal((await run('live-hash', 'student-1', 'different-exam')).length, 0);
    assert.equal((await run('stale-hash', 'student-2')).length, 0);
    assert.equal((await run('closed-hash', 'student-3')).length, 0);
    assert.equal((await run('old-hash', 'student-4')).length, 0);
    assert.equal((await run('new-hash', 'student-4'))[0].id, 'newer');
  } finally {
    await db.close();
  }
});
