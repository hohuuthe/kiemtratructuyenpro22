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

test('Management table keeps twelve aligned columns with creation date and scroll container', () => {
  assert.match(markup, /id="exam-configs-table-scroll"[^>]*overflow-x-auto/);
  assert.match(markup, /class="exam-configs-table w-full text-left border-collapse text-sm"/);
  assert.equal((markup.match(/<th\b/g) || []).length, 12);
  assert.match(markup, /<th[^>]+exam-config-scope-column[^>]*>[\s\S]*?Áp dụng Lớp\/Trường[\s\S]*?<\/th>/);
  assert.match(css, /\.exam-configs-table th:nth-child\(7\)\s*\{\s*width:\s*13%;/);
  assert.match(markup, /<th[^>]+exam-config-created-heading[^>]*>[\s\S]*?Thời gian tạo[\s\S]*?<\/th>/);
  assert.match(renderer, /<td class="exam-config-created-cell text-center">\$\{creationHtml\}<\/td>/);
  assert.match(markup, /Số bài đã làm[\s\S]*?<\/th>/);
  assert.match(markup, /<td colspan="12"/);
  assert.match(renderer, /<td colspan="12"/);
  assert.match(renderer, /<td class="exam-attempt-count-cell[^>]*>\$\{attemptCountText\}<\/td>/);
  assert.match(renderer, /class="exam-config-row-actions"/);
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
  assert.match(css, /min-width:\s*1380px/);
  assert.doesNotMatch(markup, /min-w-\[1360px\]/);
  assert.match(renderer, /class="exam-config-title-cell[^"]*"/);
  assert.doesNotMatch(renderer, /max-w-xs truncate/);
  assert.match(renderer, /<td class="exam-config-title-cell[^"]*" title="\$\{escapedName\}">\s*\$\{escapedName\}/);
  assert.match(css, /\.exam-configs-table \.exam-config-title-cell\s*\{[^}]*font-size:\s*11px;[^}]*white-space:\s*nowrap;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s);
});

test('Exam title column uses small single-line text while preserving the full name on hover', () => {
  assert.match(markup, /<th[^>]*class="exam-config-title-column"[^>]*>/);
  assert.match(css, /\.exam-configs-table \.exam-config-title-column\s*\{\s*white-space:\s*nowrap;/s);
  assert.match(css, /\.exam-configs-table \.exam-config-title-cell\s*\{[^}]*font-size:\s*11px;[^}]*white-space:\s*nowrap;[^}]*overflow-wrap:\s*normal;[^}]*word-break:\s*normal;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s);
  assert.match(renderer, /<td class="exam-config-title-cell[^"]*" title="\$\{escapedName\}">\s*\$\{escapedName\}/);
  assert.ok(!renderer.includes('max-w-xs truncate'), 'No other truncation should be injected');
  assert.match(css, /#exam-configs-table-scroll\s*\{\s*max-width:\s*100%;/);
});

test('Long exam IDs wrap safely without covering the following title column', () => {
  assert.match(renderer, /<td class="exam-config-id-cell[^"]*">/);
  assert.match(renderer, /<span class="exam-config-id-value[^"]*" title="\$\{escapeHTML\(String\(item\.id \|\| ''\)\)\}">/);
  assert.doesNotMatch(renderer, /<td class="[^"]*whitespace-nowrap"[^>]*>\s*<span class="[^"]*select-all">\$\{item\.id\}<\/span>/);
  assert.match(css, /\.exam-configs-table \.exam-config-id-cell\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(css, /\.exam-configs-table \.exam-config-id-value\s*\{[^}]*display:\s*block;[^}]*max-width:\s*100%;[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-all;/s);
  assert.match(css, /\.exam-configs-table th:nth-child\(2\) \{ width: 9%; \}/);
  assert.match(css, /\.exam-configs-table \.exam-config-id-cell\s*\{\s*width:\s*9%;/);
  assert.match(css, /\.exam-configs-table th:nth-child\(3\) \{ width: 17%; \}/);
});
