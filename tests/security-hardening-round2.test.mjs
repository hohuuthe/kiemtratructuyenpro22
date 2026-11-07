import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL('../'+p, import.meta.url), 'utf8');
const teacherClasses = read('functions/api/teacher-classes.ts');
const proxyImage = read('functions/api/proxy-image.ts');
const uploadImage = read('functions/api/upload-image.ts');
const login = read('functions/api/auth/login.ts');
const generate = read('functions/api/exam/generate.ts');
const save = read('functions/api/exam/save.ts');
const grade = read('functions/api/exam/grade.ts');
const main = read('src/main.js');
const accounts = read('functions/api/accounts.ts');
const headers = read('public/_headers');
const server = read('server.ts');
const authSession = read('functions/api/auth/session.ts');

test('teacher assignment reads and deletes are scoped to authenticated teacher', () => {
  assert.match(teacherClasses, /if \(isTeacher && !isAdmin\) \{[\s\S]*teacherId = user\.user_id \|\| user\.id/);
  assert.match(teacherClasses, /SELECT teacher_id FROM teacher_classes WHERE id = \? LIMIT 1/);
  assert.match(teacherClasses, /Không có quyền thao tác trên phân công của giáo viên khác/);
  assert.match(teacherClasses, /jsonb_to_recordset/);
});

test('image proxy rejects arbitrary hosts and active content', () => {
  assert.match(proxyImage, /CLOUDFLARE_R2_PUBLIC_URL/);
  assert.match(proxyImage, /url\.protocol!=='https:'/);
  assert.match(proxyImage, /contentType\.includes\('svg'\)/);
  assert.match(proxyImage, /X-Content-Type-Options/);
  assert.doesNotMatch(proxyImage, /fetch\(imageUrl\)(?!\.href)/);
});

test('exam image upload uses ACTIVE exam session and forbids exam Base64 fallback', () => {
  assert.match(uploadImage, /EXAM_SESSION_PURPOSE_ACTIVE/);
  assert.match(uploadImage, /_exam_grade_sessions/);
  assert.match(uploadImage, /now <= deadline/);
  assert.match(uploadImage, /Kho ảnh R2 chưa sẵn sàng/);
  assert.match(uploadImage, /exam-submissions/);
});

test('browser never persists plaintext login password and restores by JWT', () => {
  assert.doesNotMatch(main, /setItem\(window\.tenantStorageKey\('remember_password'\)/);
  assert.doesNotMatch(main, /getItem\(window\.tenantStorageKey\('remember_password'\)/);
  assert.match(main, /removeItem\(window\.tenantStorageKey\('remember_password'\)\)/);
  assert.match(main, /\/api\/auth\/session/);
  assert.match(authSession, /verifyAuthSession/);
  assert.match(authSession, /Cache-Control.*no-store/);
  assert.match(main, /ACCOUNT_EXPIRED/);
  assert.match(main, /Tài khoản đã hết hạn sử dụng/);
});

test('bulk account creation does not reuse a password hash', () => {
  assert.doesNotMatch(accounts, /lastHashed/);
  assert.doesNotMatch(accounts, /lastPassword/);
  assert.match(accounts, /const hashedPassword = await hashPasswordPBKDF2\(password\)/);
});

test('submission image data is validated server-side before persistence', () => {
  assert.match(grade, /normalizeSubmissionImage/);
  assert.match(grade, /EXAM_SUBMISSION_IMAGE_INVALID/);
  assert.match(main, /safeImageUrl/);
  assert.match(main, /escapeHTML\(safeImageUrl\(studentAnsImage\)\)/);
  assert.match(main, /escapeHTML\(d\.aiFeedback/);
});

test('Cloudflare rate limits login and protected exam code attempts', () => {
  assert.match(login, /consumeSecurityAttempt/);
  assert.match(login, /AUTH_RATE_LIMITED/);
  assert.match(generate, /EXAM_ACCESS_CODE_RATE_LIMITED/);
});

test('concurrent tabs cannot overwrite an active autosave writer', () => {
  assert.match(save, /writer_id/);
  assert.match(save, /EXAM_WRITER_CONFLICT/);
  assert.match(save, /15_000/);
  assert.match(main, /getExamWriterId/);
  assert.match(main, /writerId: currentExam\.writerId/);
});

test('safe browser headers are present without enforcing a breaking CSP migration', () => {
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /X-Frame-Options: SAMEORIGIN/);
  assert.match(headers, /Referrer-Policy: strict-origin-when-cross-origin/);
  assert.match(headers, /Permissions-Policy:/);
});


test('Node fallback runtime mirrors critical image, health and unit protections', () => {
  assert.match(server, /hardenedUploadImageHandler/);
  assert.match(server, /signCloudflareAuthSession/);
  assert.match(server, /req\.path === '\/upload-image'/);
  assert.match(server, /Nguồn ảnh không được phép/);
  assert.match(server, /contentType\.includes\("svg"\)/);
  assert.doesNotMatch(server, /userDonvi\.includes\(teacherDonvi\)/);
  assert.doesNotMatch(server, /!teacherDonvi && allowedUnits\.length === 0/);
  assert.match(server, /SELECT 1 AS ok/);
  assert.doesNotMatch(server, /user_count: userCount/);
  assert.match(server, /jsonb_to_recordset/);
});
