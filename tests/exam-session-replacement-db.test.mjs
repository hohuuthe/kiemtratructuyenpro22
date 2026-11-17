import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Obsolete ACTIVE-lock replacement SQL has been removed from school attempt start',()=>{
  const start=readFileSync('functions/api/exam/start.ts','utf8');
  assert.doesNotMatch(start,/replaced_by_student|oldSchoolAttemptSessionId|replaceSessionId/);
  assert.match(start,/claimSchoolResultAtStart/);
});
test('School draft save requires a reserved result rather than an old active lock',()=>{
  const save=readFileSync('functions/api/exam/save.ts','utf8');
  const region=save.slice(save.indexOf('const draftValuesSql ='),save.indexOf('const draftSql ='));
  assert.match(region,/FROM results reserved/);
  assert.match(region,/grading_status = 'IN_PROGRESS'/);
  assert.doesNotMatch(region,/_exam_active_attempts/);
});
test('On aborted attempt, original snapshot is retained for audit but never reactivated',()=>{
  const helper=readFileSync('functions/api/exam/school-result-lifecycle.ts','utf8');
  assert.match(helper,/UPDATE results SET grading_status = 'ABANDONED'/);
  assert.doesNotMatch(helper,/DELETE FROM _exam_grade_sessions/);
  assert.doesNotMatch(helper,/INSERT INTO _exam_active_attempts/);
});
