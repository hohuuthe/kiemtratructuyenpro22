import test from 'node:test';
import assert from 'node:assert/strict';
import { EXAM_HEARTBEAT_MS, EXAM_IDLE_TIMEOUT_MS,
  isExamFinalizationDue, allowExamHeartbeat } from '../src/exam-lifecycle-policy.js';

const at = (ms) => new Date(ms).toISOString();
const now = Date.parse('2026-11-16T12:00:00Z');
const live = { started_at:at(now-200000), last_seen_at:at(now-50000),
  deadline_at:at(now+180000), leave_requested_at:null };

test('Approved heartbeat/timeout are exactly 30 and 90 seconds', () => {
  assert.equal(EXAM_HEARTBEAT_MS,30000);
  assert.equal(EXAM_IDLE_TIMEOUT_MS,90000);
});
test('Heartbeat within 90 seconds keeps active attempt open', () => {
  assert.equal(isExamFinalizationDue(live,now),false);
  assert.equal(allowExamHeartbeat(live),true);
});
test('90 second timeout finalizes exactly on threshold', () => {
  assert.equal(isExamFinalizationDue({...live,last_seen_at:at(now-89999)},now),false);
  assert.equal(isExamFinalizationDue({...live,last_seen_at:at(now-90000)},now),true);
});
test('Explicit exit and exam deadline both finalize promptly', () => {
  assert.equal(isExamFinalizationDue({...live,leave_requested_at:at(now-100)},now),true);
  assert.equal(isExamFinalizationDue({...live,deadline_at:at(now-100)},now),true);
});
test('Never retroactively auto-submit old sessions missing a tracked heartbeat', () => {
  assert.equal(isExamFinalizationDue({...live,last_seen_at:null,leave_requested_at:at(now-100)},now),false);
  assert.equal(allowExamHeartbeat({...live,last_seen_at:null}),false);
});
test('Reject skewed, invalid and unstarted sessions', () => {
  assert.equal(isExamFinalizationDue({...live,last_seen_at:'INVALID'},now),false);
  assert.equal(isExamFinalizationDue({...live,started_at:null},now),false);
  assert.equal(isExamFinalizationDue({...live,last_seen_at:at(now+1000)},now),false);
});
