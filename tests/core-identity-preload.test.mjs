import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const coreApi = fs.readFileSync(new URL('../functions/api/core-identity.ts', import.meta.url), 'utf8');
const usersApi = fs.readFileSync(new URL('../functions/api/users.ts', import.meta.url), 'utf8');
const accountsApi = fs.readFileSync(new URL('../functions/api/accounts.ts', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const session = fs.readFileSync(new URL('../src/security-session.ts', import.meta.url), 'utf8');

test('login uses one role-scoped core identity endpoint', () => {
  assert.match(main, /preloadRoleScopedIdentityOnLogin/);
  assert.match(main, /\/api\/core-identity\?paged=1/);
  assert.match(main, /fetchAllUsersChunked\(\)/);
  assert.match(main, /fetchAllAccountsChunked\(\)/);
  assert.doesNotMatch(main, /preloadFullIdentityTablesOnLogin/);
  assert.match(main, /ROLE_SCOPE_MISMATCH/);
  assert.match(main, /window\.__coreIdentitySnapshot/);
});

test('admin scope supports paged metadata plus full legacy payload', () => {
  assert.match(coreApi, /role_scope: 'admin'/);
  assert.match(coreApi, /paged: true/);
  assert.match(coreApi, /adminPagedPayload/);
  assert.match(coreApi, /FROM users[\s\S]*CASE[\s\S]*'giáo viên','teacher'[\s\S]*'học sinh','student'[\s\S]*users\.created_at DESC/);
  assert.match(coreApi, /FROM accounts a[\s\S]*CASE[\s\S]*'giáo viên','teacher'[\s\S]*'học sinh','student'[\s\S]*a\.created_at DESC/);
});

test('teacher scope returns self profile plus only assigned-class students', () => {
  assert.match(coreApi, /role_scope:\s*'teacher'/);
  assert.match(coreApi, /teacher_classes/);
  assert.match(coreApi, /LOWER\(TRIM\(tc\.class_name\)\).*LOWER\(TRIM\(COALESCE\(u\.lop/);
  assert.match(coreApi, /LOWER\(TRIM\(COALESCE\(u\.target_audience,''\)\)\) IN \('học sinh','student'\)/);
  assert.match(coreApi, /const accounts = studentAccounts/);
  assert.match(coreApi, /teacherPagedPayload/);
  assert.match(coreApi, /paged: true/);
  assert.doesNotMatch(coreApi, /const accounts = \[\s*\.\.\.\(selfAccount/);
  assert.match(main, /assignmentPairs/);
  assert.match(main, /ngoài đúng cặp lớp \+ đơn vị được phân công/);
  assert.match(main, /Teacher preload nhận dư tài khoản Giáo viên\/Admin/);
});

test('student scope returns exactly self profile, at most self account, and minimal necessary teachers', () => {
  assert.match(coreApi, /role_scope: 'student'/);
  assert.match(coreApi, /const users = \[selfProfile\]/);
  assert.match(coreApi, /const accounts = selfAccount \? \[selfAccount\] : \[\]/);
  assert.match(coreApi, /async function studentTeachers/);
  assert.match(coreApi, /ec\.target_donvi, ec\.donvi/);
  assert.match(coreApi, /scopedUnits\.includes\(studentUnit\)/);
  assert.doesNotMatch(coreApi, /studentUnit\.includes\(teacherUnit\)/);
  assert.match(main, /Học sinh chỉ được nhận đúng 1 hồ sơ của chính mình/);
  assert.match(main, /Học sinh nhận dư tài khoản/);
});

test('logged-in student never falls back to the public full teacher directory', () => {
  assert.match(main, /if\(currentUser\)\{[\s\S]*await preloadRoleScopedIdentityOnLogin\(\)/);
  assert.match(main, /Tuyệt đối không fallback sang danh bạ công khai toàn hệ thống/);
});

test('legacy users and accounts APIs are also server-scoped by role', () => {
  // Student responses return early with role_scope='student'. Admin/teacher
  // responses share the paginated tail and must never collapse back to an
  // unscoped three-role expression.
  assert.match(usersApi, /role_scope: 'student'/);
  assert.match(usersApi, /role_scope: isAdmin \? 'admin' : 'teacher'/);
  assert.match(usersApi, /teacher_classes/);
  assert.match(accountsApi, /role_scope: 'student'/);
  assert.match(accountsApi, /role_scope: isAdmin \? 'admin' : 'teacher'/);
  assert.match(accountsApi, /teacher_classes/);
});

test('node runtime enforces the same strict role scope as Cloudflare', () => {
  assert.doesNotMatch(server, /role === 'khác'/);
  assert.match(server, /role_scope:isAdmin\?'admin':'teacher'/);
  assert.match(server, /role_scope:'student'/);
  assert.match(server, /tc\.teacher_id IN \(\?,\?\)/);
  assert.match(server, /LOWER\(TRIM\(tc\.class_name\)\)=LOWER\(TRIM\(COALESCE\(u\.lop,''\)\)\)/);
  assert.match(server, /LOWER\(TRIM\(tc\.donvi\)\)=LOWER\(TRIM\(COALESCE\(u\.donvi,''\)\)\)/);
  assert.match(server, /ec\.target_donvi,ec\.donvi/);
  assert.match(server, /scopedUnits\.includes\(sUnit\)/);
  assert.doesNotMatch(server, /sUnit\.includes\(tUnit\)/);
});

test('node teacher account pagination cannot stop after the first 1000 assigned students', () => {
  // has_more must be computed from verified total, not from whether a page
  // happened to be completely full. Client advances by the actual row count.
  assert.match(server, /has_more:limit>0\?offset\+rows\.length<total:false/);
  assert.match(main, /fetchAllAccountsChunked/);
  assert.match(main, /offset \+= chunk\.length/);
  assert.match(main, /expectedTotal/);
  assert.match(main, /seenIds/);
});

test('node session scope follows the current target audience without breaking unchanged legacy sessions', () => {
  assert.match(session, /String\(row\.target_audience \|\| ''\)/);
  assert.match(session, /legacyAccountSessionMaterialV1/);
  assert.match(server, /COALESCE\(u\.target_audience,''\) AS target_audience/);
  assert.match(server, /sameAudience/);
  assert.match(server, /legacyState !== decoded\.auth_state \|\| !sameAudience/);
});

test('exam editor does not reload unscoped accounts over the core snapshot', () => {
  assert.match(main, /Không tải lại \/api\/accounts ở đây/);
  assert.match(main, /preloadRoleScopedIdentityOnLogin/);
});
