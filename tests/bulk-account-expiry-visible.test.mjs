import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/components/tab-users.html', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/account-expiry-ui.js', import.meta.url), 'utf8');

test('bulk account modal exposes expiry date input directly', () => {
  assert.match(html, /id="batch-create-accounts-modal"/);
  assert.match(html, /id="batch-acc-expiry"/);
  assert.match(html, /Ngày hết hạn tài khoản/);
  assert.match(html, /Để trống = vô thời hạn/);
  assert.match(html, /23:59:59/);
  assert.match(html, /UTC\+7/);
});

test('bulk expiry bridge binds to the real lazy-loaded modal', () => {
  assert.match(ui, /getElementById\('batch-create-accounts-modal'\)/);
  assert.match(ui, /querySelector\('#batch-acc-expiry'\)/);
  assert.match(ui, /bulkExpiryDate = directInput\.value \|\| ''/);
});

test('blank expiry remains unlimited and selected expiry is sent to account API', () => {
  assert.match(ui, /const value = bulkExpiryDate \|\| null/);
  assert.match(ui, /expiry_date: value/);
  assert.match(ui, /direct\.value = ''/);
});
