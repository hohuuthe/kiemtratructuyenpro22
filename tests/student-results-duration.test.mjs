import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const start = source.indexOf('        function formatMyStudentResultTime(value) {');
const end = source.indexOf('        function resetMyStudentResults()', start);

test('Student-result formatter is defined in the student view and used for result cards', () => {
  assert.ok(start > -1 && end > start);
  const studentView = source.slice(source.indexOf('// Student history is isolated'), source.indexOf('window.myStudentResultsPage'));
  assert.match(studentView, /formatMyStudentResultTime\(result\.time_taken\)/);
  assert.doesNotMatch(studentView, /\bformatTime\(/);
  assert.match(studentView, /fetch\('\/api\/results\/me\?grouped=1&limit=30&offset='/);
  assert.doesNotMatch(studentView, /fetch\('\/api\/results\?(?!me)/);
});

test('Student-result durations are displayed without runtime reference errors', () => {
  assert.ok(start > -1 && end > start);
  const context = vm.createContext({});
  vm.runInContext(source.slice(start, end), context);
  const format = (value) => vm.runInContext('formatMyStudentResultTime(' + JSON.stringify(value) + ')', context);
  for (const [value, expected] of [[0,'0:00'],[9,'0:09'],[65,'1:05'],[3605,'60:05'],[12.9,'0:12'],[null,'0:00'],[-1,'0:00'],['invalid','0:00']]) {
    assert.equal(format(value), expected, String(value));
  }
});
