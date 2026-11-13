import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app = readFileSync('src/main.js', 'utf8');
function section(start, end) {
  const a = app.indexOf(start);
  assert.ok(a >= 0, 'missing: ' + start);
  const b = app.indexOf(end, a + start.length);
  assert.ok(b > a, 'missing section end: ' + end);
  return app.slice(a, b);
}

test('loadQuestions deduplicates simultaneous requests, rejects stale sessions and refreshes both lesson selectors', () => {
  const src = section('async function loadQuestions(', 'async function fetchAllResultsChunked');
  assert.match(src, /teacherId = null/);
  assert.match(src, /questionBankScopeKey\(teacherId\)/);
  assert.match(src, /questionsLoadPromise && questionsLoadPromiseScope === requestedScope\) return questionsLoadPromise/);
  assert.match(src, /questionsLoadPromiseScope !== requestedScope/);
  assert.match(src, /generation !== authDataGeneration/);
  assert.match(src, /revision !== questionBankRevision/);
  assert.match(src, /userId !== String\(currentUser\?\.id/);
  assert.match(src, /questionsLoaded = true/);
  for (const call of ['updateLessonFilter()', 'updateExamTeacherFilter()', 'renderLessonCheckboxes()']) {
    assert.ok(src.includes(call), 'missing refresh: ' + call);
  }
  assert.match(src, /questionsLoaded = false/);
});

test('question bank pagination rejects malformed/error responses and retries transient errors without treating them as empty data', () => {
  const src = section('async function fetchAllQuestionsChunked(', 'window.fetchAllQuestionsChunked = fetchAllQuestionsChunked');
  assert.match(src, /teacherId = null/);
  assert.match(src, /fetchAuthoritativeTotal/);
  assert.match(src, /const expectedTotal = await fetchAuthoritativeTotal\(\)/);
  assert.match(src, /const finalTotal = await fetchAuthoritativeTotal\(\)/);
  assert.match(src, /allQuestions\.length !== expectedTotal/);
  assert.match(src, /receivedIds\.size !== allQuestions\.length/);
  assert.match(src, /cache: 'no-store'/);
  assert.match(src, /!res\.ok/);
  assert.match(src, /!json \|\| !Array\.isArray\(json\.data\) \|\| json\.error/);
  assert.match(src, /err\.status === 401 \|\| err\.status === 403/);
  assert.match(src, /attempt < 3/);
  assert.match(src, /pageNum > 100\) throw new Error/);
});

test('exam editor awaits question loading before being considered initialized; reopen can recover', () => {
  const panel = section('async function initExamPanel()', 'function updateExamGlobalStats()');
  assert.match(panel, /if \(!questionsLoaded\) await loadQuestions\(\)/);
  assert.match(panel, /if \(!questionsLoaded && !\(await loadQuestions\(\)\)\) return/);
  assert.match(panel, /examEditorInitialized = true/);
  assert.ok(panel.indexOf('if (!questionsLoaded && !(await loadQuestions())) return;') < panel.indexOf('examEditorInitialized = true;'));
});

test('guest/student exam filters never wipe teacher bank or editor draft', () => {
  for (const [start,end] of [
    ['window.onStudentTeacherFilterChange = async function onStudentTeacherFilterChange()', 'window._studentExamChangeSeq = 0'],
    ['window.onStudentExamNameChange = async function onStudentExamNameChange()', 'if (!teacherId || !selectedExamId)']
  ]) {
    const part = section(start, end);
    assert.match(part, /if \(isAdminLoggedIn \|\| isTeacherLoggedIn\) return/);
    assert.ok(part.indexOf('if (isAdminLoggedIn || isTeacherLoggedIn) return;') < part.indexOf('questions = []'));
  }
  const tab = section('function switchTab(tabName)', '// ====================',);
  assert.match(tab, /if \(!\(isAdminLoggedIn \|\| isTeacherLoggedIn\)\)/);
  const reset = section('function resetExam()', '// ==================== QUESTIONS MANAGEMENT');
  assert.match(reset, /if \(!\(isAdminLoggedIn \|\| isTeacherLoggedIn\)\)/);
});

test('failure does not permanently mark editor initialized or clear selected lessons', () => {
  const lesson = section('function renderLessonCheckboxes()', 'function toggleAllLessons(checked)');
  assert.match(lesson, /if \(!questionsLoaded\)/);
  assert.match(lesson, /const selectedLessonKeys = new Set\(\(examConfig\.selectedLessons \|\| \[\]\)/);
  assert.match(lesson, /isSelected = selectedLessonKeys\.has\(normalizeExamPoolLesson\(lesson\)\)/);
  assert.doesNotMatch(lesson, /examConfig\.selectedLessons\s*=(?!=)/,
    'Rendering must never overwrite the stored lesson selection');
  const initializer = section('async function initializeExamEditorOnce(', 'function updateExamGlobalStats()');
  assert.match(initializer, /if \(!questionsLoaded && !\(await loadQuestions\(\)\)\) return/);
  assert.ok(initializer.indexOf('if (!questionsLoaded && !(await loadQuestions())) return;') <
    initializer.indexOf('examEditorInitialized = true'), 'Editor must not initialize on incomplete bank data');
});
