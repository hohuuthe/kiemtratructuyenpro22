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

test('Management table keeps eleven columns with scroll container and a scope column', () => {
  assert.match(markup, /id="exam-configs-table-scroll"[^>]*overflow-x-auto/);
  assert.match(markup, /class="exam-configs-table w-full text-left border-collapse text-sm"/);
  assert.equal((markup.match(/<th\b/g) || []).length, 11);
  assert.match(markup, /<th[^>]+exam-config-scope-column[^>]*>Áp dụng Lớp\/Trường<\/th>/);
  assert.match(css, /\.exam-configs-table th:nth-child\(6\)\s*\{\s*width:\s*16%;/);
  assert.match(markup, /Số bài đã làm<\/th>/);
  assert.match(markup, /<td colspan="11"/);
  assert.match(renderer, /<td colspan="11"/);
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
  assert.match(css, /min-width:\s*1180px/);
  assert.doesNotMatch(markup, /min-w-\[1360px\]/);
  assert.match(renderer, /class="exam-config-title-cell[^"]*"/);
  assert.doesNotMatch(renderer, /max-w-xs truncate/);
  assert.match(css, /\.exam-configs-table \.exam-config-title-cell\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s);
});

test('Long exam IDs wrap safely without covering the following title column', () => {
  assert.match(renderer, /<td class="exam-config-id-cell[^"]*">/);
  assert.match(renderer, /<span class="exam-config-id-value[^"]*" title="\$\{escapeHTML\(String\(item\.id \|\| ''\)\)\}">/);
  assert.doesNotMatch(renderer, /<td class="[^"]*whitespace-nowrap"[^>]*>\s*<span class="[^"]*select-all">\$\{item\.id\}<\/span>/);
  assert.match(css, /\.exam-configs-table \.exam-config-id-cell\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(css, /\.exam-configs-table \.exam-config-id-value\s*\{[^}]*display:\s*block;[^}]*max-width:\s*100%;[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-all;/s);
  assert.match(css, /\.exam-configs-table th:nth-child\(2\) \{ width: 10%; \}/);
  assert.match(css, /\.exam-configs-table th:nth-child\(3\) \{ width: 19%; \}/);
});
