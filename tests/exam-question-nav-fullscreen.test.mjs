import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scrollExamQuestionNavigator } from '../src/exam-question-navigator.js';

function makeExamDom({ hidden = false, foreignFullscreen = false, noFullscreen = false } = {}) {
  const calls = [];
  const panel = { scrollIntoView: options => calls.push(options) };
  const nav = { parentElement: panel };
  const root = {
    classList: { contains: name => name === 'hidden' && hidden },
    contains: target => target === nav
  };
  const fullscreen = foreignFullscreen
    ? { contains: () => false }
    : noFullscreen ? null : root;
  const doc = {
    getElementById: id => id === 'exam-interface' ? root : id === 'question-nav' ? nav : null,
    fullscreenElement: fullscreen
  };
  return { doc, calls };
}

test('Bảng C/H scrolls to the in-exam question panel without changing fullscreen', () => {
  const { doc, calls } = makeExamDom();
  const activeRoot = doc.fullscreenElement;
  assert.equal(scrollExamQuestionNavigator(doc), true);
  assert.equal(doc.fullscreenElement, activeRoot);
  assert.deepEqual(calls, [{ behavior: 'smooth', block: 'start', inline: 'nearest' }]);
});

test('Bảng C/H works on an in-page exam without fullscreen', () => {
  const { doc, calls } = makeExamDom({ noFullscreen: true });
  assert.equal(scrollExamQuestionNavigator(doc), true);
  assert.equal(calls.length, 1);
});

test('Never scroll hidden exam or a different fullscreen surface', () => {
  for (const options of [{ hidden: true }, { foreignFullscreen: true }]) {
    const { doc, calls } = makeExamDom(options);
    assert.equal(scrollExamQuestionNavigator(doc), false);
    assert.equal(calls.length, 0);
  }
});

test('All three Bảng C/H buttons use local navigation, not switchTab', () => {
  const main = readFileSync('src/main.js', 'utf8');
  const start = main.indexOf('function renderCurrentQuestion(');
  const end = main.indexOf('function renderMultipleChoice(', start);
  assert.ok(start >= 0 && end > start);
  const section = main.slice(start, end);
  const buttons = section.match(/type="button" onclick="openExamQuestionNavigator\(\)"/g) || [];
  assert.equal(buttons.length, 3, 'List, mobile and desktop question views must all use local navigation');
  assert.doesNotMatch(section, /onclick="switchTab\('exam'\)"/);
  assert.match(main, /window\.openExamQuestionNavigator\s*=\s*\(\) => scrollExamQuestionNavigator\(document\)/);
});

test('Cancellation guard remains in place for actual tab changes', () => {
  const main = readFileSync('src/main.js', 'utf8');
  assert.match(main, /if \(tabName !== activeExamOwnerTab && isExamInProgress && !isShowingResults\)/);
  assert.match(main, /showConfirmModal\('Bạn đang trong quá trình làm bài thi/);
});
