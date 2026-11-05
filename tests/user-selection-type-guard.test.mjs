import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const guard = fs.readFileSync(new URL('../src/user-selection-type-guard.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('multi-select guard blocks mixed student and teacher selections', () => {
  assert.match(guard, /TYPE_STUDENT/);
  assert.match(guard, /TYPE_TEACHER/);
  assert.match(guard, /state\.lockedType && state\.lockedType !== candidateType/);
  assert.match(guard, /Không được chọn lẫn Học sinh và Giáo viên/);
});

test('select-all respects current locked profile type', () => {
  assert.match(guard, /let targetType = state\.lockedType/);
  assert.match(guard, /visibleTypes\.size !== 1/);
  assert.match(guard, /type === targetType/);
});

test('delete action has a final mixed-type fail-safe', () => {
  assert.match(guard, /const guardedDelete/);
  assert.match(guard, /if \(state\.mixed\)/);
  assert.match(guard, /Không thể xóa đồng thời Học sinh và Giáo viên/);
});

test('guard is loaded after batch deletion controller', () => {
  const batchPos = index.indexOf('/src/batch-teacher-delete-ui.js');
  const guardPos = index.indexOf('/src/user-selection-type-guard.js');
  assert.ok(batchPos >= 0);
  assert.ok(guardPos > batchPos);
});
