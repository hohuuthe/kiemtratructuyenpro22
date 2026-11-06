import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const accountApi = fs.readFileSync(new URL('../functions/api/accounts/bulk-expiry.ts', import.meta.url), 'utf8');
const userApi = fs.readFileSync(new URL('../functions/api/users/bulk-expiry.ts', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/bulk-expiry-management.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

test('bulk expiry endpoints are admin-only and normalize Vietnam expiry', () => {
  for (const source of [accountApi, userApi]) {
    assert.match(source, /checkIsAdmin\(actor\)/);
    assert.match(source, /normalizeVietnamExpiryForStorage/);
    assert.match(source, /MAX_BULK_EXPIRY = 500/);
  }
  assert.match(server, /app\.post\("\/api\/accounts\/bulk-expiry"/);
  assert.match(server, /app\.post\("\/api\/users\/bulk-expiry"/);
  assert.match(server, /normalizeVietnamExpiryForStorage\(req\.body\?\.expiry_date\)/);
});

test('account bulk expiry validates the complete selection before writing and verifies after writing', () => {
  assert.match(accountApi, /SELECT id FROM accounts WHERE id IN/);
  assert.match(accountApi, /ACCOUNT_SELECTION_CHANGED/);
  assert.match(accountApi, /UPDATE accounts SET expiry_date = \?/);
  assert.match(accountApi, /SELECT id, expiry_date FROM accounts WHERE id IN/);
  assert.match(accountApi, /ACCOUNT_EXPIRY_VERIFY_FAILED/);
});

test('user bulk expiry validates the complete selection before writing and verifies after writing', () => {
  assert.match(userApi, /SELECT id FROM users WHERE id IN/);
  assert.match(userApi, /USER_SELECTION_CHANGED/);
  assert.match(userApi, /UPDATE users SET expiry_date = \?/);
  assert.match(userApi, /SELECT id, expiry_date FROM users WHERE id IN/);
  assert.match(userApi, /USER_EXPIRY_VERIFY_FAILED/);
});

test('management UI exposes bulk expiry in both accounts and users tabs', () => {
  assert.match(html, /bulk-expiry-management\.js/);
  assert.match(ui, /tab-accounts/);
  assert.match(ui, /tab-users/);
  assert.match(ui, /data-bulk-expiry-open/);
  assert.match(ui, /Cập nhật hạn dùng/);
  assert.match(ui, /Vô thời hạn/);
  assert.match(ui, /UTC\+7/);
});

test('UI sends exactly the selected ids to the matching endpoint', () => {
  assert.match(ui, /selectedAccountIds\(\)/);
  assert.match(ui, /selectedUserIds\(\)/);
  assert.match(ui, /account_ids/);
  assert.match(ui, /user_ids/);
  assert.match(ui, /\/api\/accounts\/bulk-expiry/);
  assert.match(ui, /\/api\/users\/bulk-expiry/);
});


test('bulk expiry controls live inside native management action bars, not detached top panels', () => {
  assert.match(ui, /management-native-actions/);
  assert.match(ui, /actionBarForScope/);
  assert.match(ui, /mountExpiryButton\('accounts'/);
  assert.match(ui, /mountExpiryButton\('users'/);
  assert.doesNotMatch(ui, /className = 'bulk-expiry-tools'/);
});

test('successful expiry update reloads server-backed lists before showing success', () => {
  assert.match(ui, /window\.refreshAccountsData/);
  assert.match(ui, /await window\.refreshAccountsData\(\)/);
  assert.match(ui, /window\.refreshUsersData/);
  assert.match(ui, /await window\.refreshUsersData\(\)/);
  assert.match(ui, /window\.selectedAccountIds\.clear\(\)/);
  assert.match(ui, /window\.selectedUserIds\.clear\(\)/);
});
