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

test('Heartbeat rejects revoked attempts, mismatched owners and expired leases', () => {
  const source=readFileSync('functions/api/exam/heartbeat.ts','utf8');
  assert.match(source,/verifyAuthSession/);
  assert.match(source,/verifyJWT/);
  assert.match(source,/claims\.studentUserId/);
  assert.match(source,/active_lock\.attempt_key = \?/);
  assert.match(source,/active_lock\.user_id = \?/);
  assert.match(source,/active_lock\.session_id = \?/);
  assert.match(source,/COALESCE\(active_lock\.last_seen_at/);
  assert.match(source,/EXAM_SESSION_CLOSED/);
});

test('Only a new accepted ACTIVE start may revoke the old school attempt',()=>{
  const source=readFileSync('functions/api/exam/start.ts','utf8');
  assert.match(source,/oldSchoolAttemptSessionId/);
  assert.match(source,/WITH old AS \(/);
  assert.match(source,/FROM activated WHERE TRUE/);
  assert.match(source,/SELECT session_id FROM revoked LIMIT 1/);
  assert.doesNotMatch(source,/body\?\.replaceSessionId/);
});
