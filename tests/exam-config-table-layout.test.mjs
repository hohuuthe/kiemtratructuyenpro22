import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const markup = readFileSync(new URL('../public/components/tab-exams.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const start = js.indexOf('window.renderExamConfigsTable = function renderExamConfigsTable()');
const end = js.indexOf('function renderExamConfigsPaginationControls(', start);
assert.ok(start >= 0 && end > start);
const renderer = js.slice(start, end);

test('Management table keeps ten columns with scroll container and a five-centimeter scope column', () => {
  assert.match(markup, /id="exam-configs-table-scroll"[^>]*overflow-x-auto/);
  assert.match(markup, /class="exam-configs-table w-full text-left border-collapse text-sm"/);
  assert.equal((markup.match(/<th\b/g) || []).length, 10);
  assert.match(markup, /<th[^>]+exam-config-scope-column[^>]*>Áp dụng Lớp\/Trường<\/th>/);
  assert.match(css, /\.exam-configs-table th:nth-child\(6\)\s*\{\s*width:\s*18%;/);
});
test('Scope cells and badges wrap long class/school values without truncation', () => {
  assert.match(renderer, /<td class="exam-config-scope-column[^"]*">\$\{lopBadge\}<\/td>/);
  assert.match(renderer, /exam-config-scope-list/);
  assert.match(renderer, /exam-config-scope-tag/);
  assert.ok(!renderer.includes('whitespace-nowrap">${lopBadge}'));
  assert.match(css, /\.exam-configs-table \.exam-config-scope-tag\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s);
  assert.ok(renderer.includes('escapeHTML(donvi)'));
  assert.ok(renderer.includes('escapeHTML(lop)'));
});
test('Existing exam-management functionality is retained', () => {
  for (const fn of ['loadExamConfigById(', 'openExportDocxModal(', 'deleteExamConfig(', 'renderExamConfigsPaginationControls(']) {
    assert.ok(renderer.includes(fn), fn);
  }
  assert.match(markup, /id="search-exam-config-table"/);
  assert.match(markup, /id="exam-configs-pagination-container"/);
  assert.match(css, /min-width:\s*1020px/);
  assert.doesNotMatch(markup, /min-w-\[1360px\]/);
  assert.match(renderer, /class="exam-config-title-cell[^"]*"/);
  assert.doesNotMatch(renderer, /max-w-xs truncate/);
  assert.match(css, /\.exam-configs-table \.exam-config-title-cell\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s);
});
