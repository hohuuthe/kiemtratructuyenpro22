import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeVietnamExpiryForStorage,
  getAccountAccessStatus
} from '../src/account-expiry.ts';

const cfLogin = fs.readFileSync(new URL('../functions/api/auth/login.ts', import.meta.url), 'utf8');
const cfAccounts = fs.readFileSync(new URL('../functions/api/accounts.ts', import.meta.url), 'utf8');
const cfAccountEdit = fs.readFileSync(new URL('../functions/api/accounts/[id].ts', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/account-expiry-ui.js', import.meta.url), 'utf8');

test('blank account expiry is unlimited', () => {
  assert.equal(normalizeVietnamExpiryForStorage(''), null);
  assert.equal(normalizeVietnamExpiryForStorage(null), null);
});

test('calendar expiry is stored at the end of the selected day in Vietnam', () => {
  assert.equal(
    normalizeVietnamExpiryForStorage('2026-12-06'),
    '2026-12-06T23:59:59.999+07:00'
  );
  assert.equal(
    normalizeVietnamExpiryForStorage('30/06/2027'),
    '2027-06-30T23:59:59.999+07:00'
  );
});

test('legacy UTC-midnight date-picker values retain Vietnam end-of-day meaning', () => {
  assert.equal(
    normalizeVietnamExpiryForStorage('2026-12-06T00:00:00.000Z'),
    '2026-12-06T23:59:59.999+07:00'
  );
});

test('expiry boundary is evaluated against the Vietnam timestamp exactly', () => {
  const row = { id:'a', password:'hash', is_active:1, expiry_date:'2026-12-06' };
  assert.equal(
    getAccountAccessStatus(row, Date.parse('2026-12-06T23:59:59.999+07:00')).allowed,
    true
  );
  const expired = getAccountAccessStatus(row, Date.parse('2026-12-07T00:00:00.000+07:00'));
  assert.equal(expired.allowed, false);
  assert.equal(expired.reason, 'expired');
});

test('login reports expired account distinctly from bad credentials', () => {
  for (const source of [cfLogin, server]) {
    assert.match(source, /ACCOUNT_EXPIRED/);
    assert.match(source, /Tài khoản đã hết hạn/);
    assert.match(source, /Tên đăng nhập hoặc mật khẩu không đúng/);
  }
});

test('account create and edit paths normalize expiry before persistence', () => {
  assert.match(cfAccounts, /normalizeVietnamExpiryForStorage\(expiry_date\)/);
  assert.match(cfAccountEdit, /normalizeVietnamExpiryForStorage\(expiry_date\)/);
  assert.match(server, /normalizeVietnamExpiryForStorage\(expiry_date\)/);
});

test('bulk account UI has an optional Vietnam expiry date and defaults to unlimited', () => {
  assert.match(ui, /Thời hạn tài khoản/);
  assert.match(ui, /Theo giờ Việt Nam \(UTC\+7\)/);
  assert.match(ui, /Để trống = vô thời hạn/);
  assert.match(ui, /bulkExpiryDate = ''/);
  assert.match(ui, /expiry_date: value/);
  assert.match(ui, /const value = bulkExpiryDate \|\| null/);
});
