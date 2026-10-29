import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync('src/main.js', 'utf8');
const bootstrap = readFileSync('functions/api/bootstrap.ts', 'utf8');
const teachers = readFileSync('functions/api/exam-teachers.ts', 'utf8');

test('bootstrap never fetches business tables', () => {
  const bootstrapStart = main.indexOf('async function loadData()');
  const bootstrapEnd = main.indexOf('function generateUUID()', bootstrapStart);
  assert.ok(bootstrapStart >= 0 && bootstrapEnd > bootstrapStart);
  const code = main.slice(bootstrapStart, bootstrapEnd);
  for (const route of ['/api/accounts','/api/questions','/api/results','/api/exams','/api/users']) {
    assert.ok(!code.includes(route), 'Unexpected eager route ' + route);
  }
  assert.ok(code.includes('/api/bootstrap'));
});

test('successful login never downloads question bank or exam catalog', () => {
  const start = main.indexOf('async function handleSuccessfulLogin()');
  const end = main.indexOf('function updateThemeForRole()', start);
  assert.ok(start >= 0 && end > start);
  const code = main.slice(start, end);
  assert.ok(!code.includes('loadQuestions(true)'));
  assert.ok(!code.includes('updateExamNamesList(false)'));
});

test('only required components load at startup', () => {
  assert.match(main, /const components\s*=\s*\['modal-container','tab-exam','tab-help','toast-container-center','toast-container-right'\]/);
  for (const route of ['tab-questions','tab-exams','tab-exam-editor','tab-accounts','tab-users','tab-ranking','tab-settings','tab-documents']) {
    const start=main.indexOf('const components=');
    const end=main.indexOf(';',start);
    assert.ok(!main.slice(start,end).includes(route), 'Eager component '+route);
  }
});

test('public bootstrap and teacher APIs exclude sensitive columns', () => {
  assert.ok(bootstrap.includes('SELECT app_title'));
  assert.ok(!bootstrap.includes('SELECT *'));
  assert.ok(!bootstrap.includes('ai_grading_key'));
  assert.ok(!teachers.includes('password'));
  assert.ok(!teachers.includes('phone_number'));
});

test('lazy tab loader and role-based access guard remain present', () => {
  assert.ok(main.includes('async function ensureTabComponent(name)'));
  assert.ok(main.includes('const protectedTabs='));
  assert.ok(main.includes('authDataGeneration'));
  assert.ok(main.includes('async function ensureStudentTeacherDirectory()'));
});


test('settings tab downloads protected configuration only when opened',()=>{
  assert.match(main,/async function ensureAdminSettingsLoaded\(\)/);
  assert.match(main,/tabName === 'settings'[\s\S]{0,140}ensureAdminSettingsLoaded\(\)/);
});
test('student directory is fetched on interaction, not opening exam',()=>{
  assert.match(main,/select\.addEventListener\('focus',load\)/);
  assert.match(main,/select\.addEventListener\('pointerdown',load\)/);
  assert.doesNotMatch(main,/tabName === 'exam'\) \{\s*if\(!isAdminLoggedIn&&!isTeacherLoggedIn\)void ensureStudentTeacherDirectory/);
});
test('late tab response does not navigate after user chooses another tab',()=>{
  assert.match(main,/generation===authDataGeneration&&requestedTab===tabName/);
});


test('tab navigation parses without duplicate lexical declarations', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'kttt-syntax-'));
  try {
    writeFileSync(join(dir, 'main.mjs'), main, 'utf8');
    execFileSync(process.execPath, ['--check', join(dir, 'main.mjs')]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('only user preferences may persist, never admin AI configuration', () => {
  assert.doesNotMatch(main, /localStorage\\.setItem\\(['"]appSettings['"]/);
  assert.doesNotMatch(main, /localStorage\\.getItem\\(['"]appSettings['"]/);
  assert.match(main, /localStorage\\.removeItem\\(['"]appSettings['"]\\)/);
});

test('authorized tab alias is normalized before comparing stale responses', () => {
  const start = main.indexOf('function switchTab(tabName)');
  const end = main.indexOf('const tabExam =', start);
  const code = main.slice(start, end);
  assert.match(code, /requestedTab=tabName; \\/\\/ Guard/);
  assert.equal((code.match(/const protectedTabs/g) || []).length, 1);
});
