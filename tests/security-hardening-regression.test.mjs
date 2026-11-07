import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');

test('browser never persists plaintext login passwords and restores by signed token', () => {
  const main = read('src/main.js');
  assert.doesNotMatch(main, /localStorage\.setItem\([^\n]*remember_password/);
  assert.match(main, /localStorage\.removeItem\(window\.tenantStorageKey\('remember_password'\)\)/);
  assert.match(main, /fetch\('\/api\/auth\/me'/);
  assert.match(main, /ACCOUNT_EXPIRED/);
});

test('teacher class APIs scope non-admin reads and id deletes to the authenticated teacher', () => {
  const api = read('functions/api/teacher-classes.ts');
  assert.match(api, /if \(isTeacher && !isAdmin\) \{\s*\/\/ Never trust a caller-supplied teacher_id/);
  assert.match(api, /DELETE FROM teacher_classes WHERE id = \? AND teacher_id = \?/);
  assert.match(api, /WITH deleted AS \(\s*DELETE FROM teacher_classes WHERE teacher_id = \?/);
});

test('essay image upload requires a live active exam session and bounded safe image data', () => {
  const upload = read('functions/api/upload-image.ts');
  assert.match(upload, /EXAM_SESSION_PURPOSE_ACTIVE/);
  assert.match(upload, /deadline_at/);
  assert.match(upload, /X-Account-Authorization/);
  assert.match(upload, /image\\\/\(\?:png\|jpeg\|jpg\|webp\)/);
  assert.match(upload, /Kho ảnh bài thi chưa sẵn sàng/);
});

test('essay grading sanitizes attachments and rejects grader-directed prompt injection', () => {
  const grade = read('functions/api/exam/grade.ts');
  assert.match(grade, /function sanitizeEssayAnswer/);
  assert.match(grade, /function sanitizeAiFeedback/);
  assert.match(grade, /function looksLikeAiGraderInjection/);
  assert.match(grade, /pending_manual/);
  assert.match(grade, /systemInstruction/);
  assert.match(grade, /dữ liệu KHÔNG TIN CẬY/);
});

test('draft autosave has a per-tab writer lease and server conflict response', () => {
  const save = read('functions/api/exam/save.ts');
  const main = read('src/main.js');
  assert.match(save, /_exam_writer_leases/);
  assert.match(save, /EXAM_OTHER_TAB_ACTIVE/);
  assert.match(main, /ensureExamWriterId/);
  assert.match(main, /writerId: ensureExamWriterId\(\)/);
});

test('image proxy rejects active content and direct private hosts', () => {
  const proxy = read('functions/api/proxy-image.ts');
  assert.match(proxy, /SAFE_IMAGE_TYPES/);
  assert.doesNotMatch(proxy, /image\/svg\+xml/);
  assert.match(proxy, /isPrivateHost/);
  assert.match(proxy, /X-Content-Type-Options/);
  assert.match(proxy, /Content-Security-Policy/);
});

test('bulk password paths use independent PBKDF2 hashes in both runtimes', () => {
  const cfAccounts = read('functions/api/accounts.ts');
  const cfReset = read('functions/api/accounts/reset-password.ts');
  const server = read('server.ts');
  assert.doesNotMatch(cfAccounts, /lastHashed/);
  assert.doesNotMatch(server, /lastHashed/);
  assert.match(cfReset, /hashById/);
  assert.match(cfReset, /CASE id/);
  assert.match(server, /hashById/);
  assert.match(server, /CASE id/);
});

test('unit-restricted exam discovery no longer uses substring matching or fail-open empty units', () => {
  const exams = read('functions/api/exams.ts');
  assert.match(exams, /requiredUnits\.includes\(userDonvi\)/);
  assert.doesNotMatch(exams, /userDonvi\.includes\(teacherDonvi\)/);
  assert.doesNotMatch(exams, /if \(!teacherDonvi && allowedUnits\.length === 0\) \{\s*isSameDonVi = true/);
});

test('rate limiting counts failed protected-code attempts, not successful reloads', () => {
  const generate = read('functions/api/exam/generate.ts');
  const board = read('functions/api/board/join.ts');
  const login = read('functions/api/auth/login.ts');
  assert.match(generate, /if \(!accessCodeValid\) \{/);
  assert.match(board, /gate\.code === 'BOARD_ACCESS_CODE_INVALID'/);
  assert.match(login, /if \(!isValid\) \{/);
  assert.match(login, /consumeRateLimit/);
});

test('safe non-breaking browser security headers are present', () => {
  const headers = read('public/_headers');
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /Referrer-Policy: same-origin/);
  assert.match(headers, /Permissions-Policy:/);
});
