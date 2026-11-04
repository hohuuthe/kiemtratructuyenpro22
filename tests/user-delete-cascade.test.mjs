import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const cascade = fs.readFileSync(new URL('../src/user-delete-cascade.ts', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../functions/api/users/[id].ts', import.meta.url), 'utf8');
const singleUi = fs.readFileSync(new URL('../src/teacher-delete-ui.js', import.meta.url), 'utf8');
const batchUi = fs.readFileSync(new URL('../src/batch-teacher-delete-ui.js', import.meta.url), 'utf8');
const grade = fs.readFileSync(new URL('../functions/api/exam/grade.ts', import.meta.url), 'utf8');

test('student/user deletion is database-atomic and audits every exact identity reference', () => {
  assert.match(cascade, /CREATE OR REPLACE FUNCTION public\.delete_user_cascade/);
  assert.match(cascade, /LOCK TABLE public\.users, public\.accounts, public\.results/);
  assert.match(cascade, /DELETE FROM public\.results WHERE id = ANY\(v_result_ids\)/);
  assert.match(cascade, /DELETE FROM public\.accounts[\s\S]*DELETE FROM public\.users/);
  assert.match(cascade, /USER_DELETE_ORPHAN_AUDIT_FAILED/);
  assert.match(cascade, /qr_answer_responses/);
  assert.match(cascade, /qr_answer_result_links/);
  assert.match(cascade, /interactive_board_blocks/);
});

test('user API routes every non-admin profile through the atomic cascade', () => {
  assert.match(api, /USER_DELETE_CASCADE_SQL/);
  assert.match(api, /USER_DELETE_CALL_SQL/);
  assert.doesNotMatch(api, /Non-teacher deletion keeps the existing behavior/);
});

test('submission anti-replay records are bound to exact user id', () => {
  assert.match(grade, /_submitted_exam_tokens \(token_hash, exam_id, student_name, user_id, submitted_at\)/);
  assert.match(grade, /authenticatedUserId \|\| null/);
});

test('single and batch deletion UI apply the progress workflow to students too', () => {
  assert.match(singleUi, /if \(!user\) return original\(id\)/);
  assert.match(singleUi, /openUserDeleteModal\(user\)/);
  assert.match(batchUi, /Mọi hồ sơ không phải Admin đều dùng cùng quy trình xóa nguyên tử/);
  assert.doesNotMatch(batchUi, /if \(teacherCount === 0\) return original/);
});
