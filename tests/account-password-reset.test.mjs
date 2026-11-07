import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const cf = fs.readFileSync(new URL('../functions/api/accounts/reset-password.ts', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/account-password-reset.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const login = fs.readFileSync(new URL('../functions/api/auth/login.ts', import.meta.url), 'utf8');
const utils = fs.readFileSync(new URL('../functions/api/exam/utils.ts', import.meta.url), 'utf8');

test('bulk password reset is admin-only in Cloudflare and Node runtimes', () => {
  assert.match(cf, /checkIsAdmin\(actor\)/);
  assert.match(cf, /Chỉ Admin mới được reset mật khẩu/);
  assert.match(server, /app\.post\("\/api\/accounts\/reset-password"/);
  assert.match(server, /checkIsAdmin\(actor\)/);
});

test('bulk password reset uses the same PBKDF2 password scheme as login', () => {
  assert.match(utils, /const PBKDF2_ITERATIONS = 100000/);
  assert.match(utils, /return `pbkdf2:sha256:\$\{PBKDF2_ITERATIONS\}/);
  assert.match(login, /verifyPassword\(password, result\.password\)/);
  assert.match(cf, /hashPasswordPBKDF2\(password\)/);
  assert.match(cf, /verifyPassword\(password, hash\)/);
  assert.match(server, /hashPasswordPBKDF2Sync\(password\)/);
  assert.match(server, /verifyPasswordSync\(password, hash\)/);
});

test('bulk reset validates the whole selection and performs one atomic per-account-salt update', () => {
  assert.match(cf, /SELECT id FROM accounts WHERE id IN/);
  assert.match(cf, /ACCOUNT_SELECTION_CHANGED/);
  assert.match(cf, /hashById/);
  assert.match(cf, /SET password = CASE id/);
  assert.match(cf, /PASSWORD_RESET_VERIFY_FAILED/);
  assert.match(server, /SELECT id FROM accounts WHERE id IN/);
  assert.match(server, /hashById/);
  assert.match(server, /SET password = CASE id/);
  assert.match(server, /PASSWORD_RESET_VERIFY_FAILED/);
});

test('password reset UI supports multi-select and never stores plaintext password', () => {
  assert.match(html, /account-password-reset\.js/);
  assert.match(ui, /selectedAccountIds/);
  assert.match(ui, /account_ids: ids, password/);
  assert.match(ui, /autocomplete="new-password"/);
  assert.doesNotMatch(ui, /localStorage\.setItem\([^\n]*password/i);
  assert.match(ui, /Đã reset mật khẩu thành công/);
});

test('session design invalidates old sessions after password reset', () => {
  assert.match(utils, /account\.id, account\.user_id \|\| account\.id, account\.password/);
  assert.match(cf, /session_tokens_invalidated: true/);
  assert.match(server, /session_tokens_invalidated: true/);
  assert.match(ui, /self_reset/);
  assert.match(ui, /clearAuthToken\(\)/);
});
