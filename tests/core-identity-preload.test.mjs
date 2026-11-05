import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('login preloads complete users and accounts in parallel', () => {
  assert.match(main, /preloadFullIdentityTablesOnLogin/);
  assert.match(main, /fetchCompleteTable\('\/api\/users\?limit=all'/);
  assert.match(main, /fetchCompleteTable\('\/api\/accounts\?limit=all'/);
  assert.match(main, /Promise\.all\(\[/);
  assert.match(main, /reportedTotal !== rows\.length/);
  assert.match(main, /window\.__coreIdentitySnapshot/);
});

test('account tab preserves the complete preload snapshot', () => {
  assert.match(main, /hasCompleteIdentitySnapshot/);
  assert.match(main, /accountsTotalServer !== null && !hasCompleteIdentitySnapshot/);
});
