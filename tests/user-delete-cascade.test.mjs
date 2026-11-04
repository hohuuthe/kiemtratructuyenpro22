import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const genericCascade = fs.readFileSync(new URL('../src/user-delete-cascade.ts', import.meta.url), 'utf8');
const studentCascade = fs.readFileSync(new URL('../src/student-delete-cascade.ts', import.meta.url), 'utf8');
const teacherCascade = fs.readFileSync(new URL('../src/teacher-delete-cascade.ts', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../functions/api/users/[id].ts', import.meta.url), 'utf8');
const singleUi = fs.readFileSync(new URL('../src/teacher-delete-ui.js', import.meta.url), 'utf8');
const batchUi = fs.readFileSync(new URL('../src/batch-teacher-delete-ui.js', import.meta.url), 'utf8');
const grade = fs.readFileSync(new URL('../functions/api/exam/grade.ts', import.meta.url), 'utf8');

test('student deletion is a dedicated atomic workflow', () => {
  assert.match(studentCascade, /CREATE OR REPLACE FUNCTION public\.delete_student_cascade/);
  assert.match(studentCascade, /LOCK TABLE public\.users, public\.accounts, public\.results/);
  assert.match(studentCascade, /DELETE FROM public\.results/);
  assert.match(studentCascade, /DELETE FROM public\._submitted_exam_tokens/);
  assert.match(studentCascade, /DELETE FROM public\.qr_answer_responses WHERE user_id/);
  assert.match(studentCascade, /DELETE FROM public\.qr_answer_cards WHERE user_id/);
  assert.match(studentCascade, /DELETE FROM public\.interactive_board_blocks WHERE user_id/);
  assert.match(studentCascade, /DELETE FROM public\.accounts[\s\S]*DELETE FROM public\.users/);
  assert.match(studentCascade, /STUDENT_DELETE_ORPHAN_AUDIT_FAILED/);
});

test('student deletion never deletes teacher-owned resources', () => {
  assert.doesNotMatch(studentCascade, /DELETE FROM public\.questions/);
  assert.doesNotMatch(studentCascade, /DELETE FROM public\.exam_configs/);
  assert.doesNotMatch(studentCascade, /DELETE FROM public\.teacher_classes/);
  assert.doesNotMatch(studentCascade, /DELETE FROM public\.interactive_boards/);
  assert.doesNotMatch(studentCascade, /DELETE FROM public\.interactive_board_pages/);
  assert.doesNotMatch(studentCascade, /DELETE FROM public\.qr_answer_sessions/);
  assert.doesNotMatch(studentCascade, /DELETE FROM public\.quan_ly_tai_lieu/);
  assert.match(studentCascade, /STUDENT_DELETE_ROLE_DATA_CONFLICT/);
});

test('API dispatches teacher and student profiles to different database functions', () => {
  assert.match(api, /TEACHER_DELETE_CASCADE_SQL/);
  assert.match(api, /STUDENT_DELETE_CASCADE_SQL/);
  assert.match(api, /audience === 'giáo viên'/);
  assert.match(api, /\['học sinh','student'\]\.includes\(audience\)/);
  assert.match(api, /STUDENT_DELETE_CALL_SQL/);
  assert.match(api, /TEACHER_DELETE_CALL_SQL/);
});

test('submission anti-replay records are bound to exact student user id', () => {
  assert.match(grade, /_submitted_exam_tokens \(token_hash, exam_id, student_name, user_id, submitted_at\)/);
  assert.match(grade, /authenticatedUserId \|\| null/);
});

test('single and batch UI show student-specific steps', () => {
  assert.match(singleUi, /STUDENT_DELETE_STEPS/);
  assert.match(singleUi, /Xóa kết quả và các lần làm bài/);
  assert.match(singleUi, /Xóa dữ liệu phiên\/nộp bài chống nộp trùng/);
  assert.match(singleUi, /Xóa dữ liệu tham gia quét thẻ và bảng tương tác/);
  assert.match(batchUi, /STUDENT_BATCH_STEPS/);
  assert.match(batchUi, /stepsForEntry/);
});

test('teacher and generic deletion remain available for their own profile types', () => {
  assert.match(teacherCascade, /delete_teacher_cascade/);
  assert.match(genericCascade, /delete_user_cascade/);
});
