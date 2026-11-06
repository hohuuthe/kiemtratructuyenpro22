import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isLiveAccount, hashPasswordPBKDF2, verifyPassword } from '../functions/api/exam/utils.ts';

const cloudflareLogin = fs.readFileSync(new URL('../functions/api/auth/login.ts', import.meta.url), 'utf8');
const cloudflareAccounts = fs.readFileSync(new URL('../functions/api/accounts.ts', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

test('Vietnamese dd/mm/yyyy profile expiry remains valid for a live account', () => {
  assert.equal(isLiveAccount({
    id: 'a1',
    password: 'hash',
    is_active: 1,
    profile_active: 1,
    profile_expiry_date: '30/06/2027'
  }), true);
});

test('expired or impossible Vietnamese dates fail closed', () => {
  assert.equal(isLiveAccount({
    id: 'a1',
    password: 'hash',
    is_active: 1,
    profile_active: 1,
    profile_expiry_date: '01/01/2020'
  }), false);
  assert.equal(isLiveAccount({
    id: 'a1',
    password: 'hash',
    is_active: 1,
    profile_active: 1,
    profile_expiry_date: '31/02/2027'
  }), false);
});

test('new PBKDF2 hashes round-trip through the login verifier', async () => {
  const password = 'MatKhau 123!';
  const hash = await hashPasswordPBKDF2(password);
  assert.match(hash, /^pbkdf2:sha256:100000:[0-9a-f]{32}:[0-9a-f]{64}$/);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword(password + 'x', hash), false);
});

test('login trims username but preserves password characters in both runtimes', () => {
  assert.match(cloudflareLogin, /String\(body\?\.username \?\? ''\)\.trim\(\)/);
  assert.match(cloudflareLogin, /String\(body\?\.password \?\? ''\)/);
  assert.match(server, /String\(req\.body\?\.username \?\? ''\)\.trim\(\)/);
  assert.match(server, /String\(req\.body\?\.password \?\? ''\)/);
});

test('account creation verifies its fresh hash before reporting success', () => {
  assert.match(cloudflareAccounts, /verifyPassword\(String\(password\), hashedPassword\)/);
  assert.match(server, /verifyPasswordSync\(String\(password\), hashedPassword\)/);
});
