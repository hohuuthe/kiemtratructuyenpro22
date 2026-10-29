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
