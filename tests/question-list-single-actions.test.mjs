import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const start = source.indexOf('function renderQuestionsList() {');
const end = source.indexOf('window.toggleQuestionSelection = function toggleQuestionSelection', start);
assert.ok(start >= 0 && end > start, 'Question list renderer must exist');
const renderer = source.slice(start, end);
const countActions = (text, method) => text.split('onclick="' + method + '(').length - 1;

test('Each question card renders one Edit and one Delete action in the header', () => {
  const headerStart = renderer.indexOf('<!-- Header thẻ câu hỏi');
  const headerEnd = renderer.indexOf('<!-- Nội dung câu hỏi', headerStart);
  assert.ok(headerStart >= 0 && headerEnd > headerStart, 'Card header and content must exist');
  const header = renderer.slice(headerStart, headerEnd);
  for (const method of ['editQuestion', 'deleteQuestion']) {
    assert.equal(countActions(header, method), 1, method + ' must be visible in the card header');
    assert.equal(countActions(renderer, method), 1, method + ' must not be duplicated anywhere in the card');
  }
});

test('Answer footer and answer image remain without extra action buttons', () => {
  const footerStart = renderer.indexOf('<!-- Footer đáp án:', renderer.indexOf('<!-- Header thẻ câu hỏi'));
  const footerEnd = renderer.indexOf('q.options && q.options.answerImage', footerStart);
  assert.ok(footerStart >= 0 && footerEnd > footerStart, 'Answer footer must precede answer image');
  const footer = renderer.slice(footerStart, footerEnd);
  assert.ok(footer.includes('Đáp án:'), 'Answer label is preserved');
  assert.ok(footer.includes('formatContent(q.answer)'), 'Formatted answer is preserved');
  assert.equal(countActions(footer, 'editQuestion'), 0);
  assert.equal(countActions(footer, 'deleteQuestion'), 0);
  assert.ok(source.includes('window.editQuestion = function editQuestion(id)'));
  assert.ok(source.includes('window.deleteQuestion = function deleteQuestion(id)'));
});
