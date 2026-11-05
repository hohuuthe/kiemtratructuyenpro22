import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/components/tab-ranking.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const code = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const start = code.indexOf('// Render Desktop View (Table)');
const end = code.indexOf('// Render Mobile View (Cards)', start);
assert.ok(start >= 0 && end > start, 'Cannot find admin/teacher result table renderer');
const desktop = code.slice(start, end);

test('Thirteen columns including violation count fill the table width without horizontal scrolling', () => {
  const container = html.match(/<div id="ranking-container-desktop"[^>]*>/)?.[0];
  assert.ok(container);
  assert.match(container, /hidden lg:block/);
  assert.doesNotMatch(container, /overflow-x-auto/);
  const table = html.match(/<table class="ranking-results-table[\s\S]*?<\/table>/)?.[0];
  assert.ok(table, 'Dedicated management results table');
  const widths = [...table.matchAll(/<col style="width:\s*([0-9.]+)%">/g)].map(m => Number(m[1]));
  assert.equal(widths.length, 13, 'No hidden columns or shifted cells');
  assert.ok(widths.every(v => v > 0));
  assert.ok(Math.abs(widths.reduce((sum, v) => sum + v, 0) - 100) < .001, 'Column shares must add to 100%');
  assert.equal((table.match(/<th\b/g) || []).length, 13);
  assert.match(css, /#ranking-container-desktop \.ranking-results-table\s*\{[^}]*width:\s*100%;[^}]*table-layout:\s*fixed;/s);
  assert.match(css, /#ranking-container-desktop\s*\{[^}]*overflow-x:\s*clip;/s);
  assert.doesNotMatch(css, /#ranking-container-desktop[^{]*\{[^}]*min-width:\s*[1-9][0-9]+px;/);
});

test('Long values wrap within bounded cells, including badges, dates, name, school and AI notes', () => {
  assert.match(css, /#ranking-container-desktop \.ranking-results-table th,[\s\S]*?#ranking-container-desktop \.ranking-results-table td\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(css, /tbody td:nth-child\(3\) span,[\s\S]*?tbody td:nth-child\(10\) span\s*\{[^}]*max-width:\s*100%;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(desktop, /title="\$\{escapeHTML\(r\.studentName\)\}"/);
  assert.match(desktop, /title="\$\{escapeHTML\(r\.donvi \|\| r\.studentClass \|\| '-'\)\}"/);
  assert.match(desktop, /title="\$\{escapeHTML\(r\.examName\)\}"/);
  assert.match(desktop, /title="\$\{escapeHTML\(r\.aiGradingSummary\)\}"/);
  assert.match(desktop, />\$\{escapeHTML\(r\.aiGradingSummary\)\}<\/span>/);
});

test('Actions and privacy notices remain accessible and fit compact cells', () => {
  assert.equal((desktop.match(/<td class=/g) || []).length, 13);
  assert.match(desktop, /class="ranking-result-actions/);
  assert.match(css, /#ranking-container-desktop \.ranking-result-actions\s*\{[^}]*flex-direction:\s*column;/s);
  assert.match(css, /#ranking-container-desktop \.ranking-result-actions button\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s);
  assert.match(desktop, /showExamDetail\('/);
  assert.match(desktop, /deleteSingleRankingResult\('/);
  assert.match(desktop, /canDeleteRankingResult\(r,currentUser,isAdmin,isTeacher\)/);
  assert.match(desktop, /aria-label="Không có quyền xóa kết quả này"/);
  assert.match(html, /id="ranking-select-all"/);
  assert.match(html, /sortRankingBy\('studentName'\)/);
  assert.match(html, /sortRankingBy\('examName'\)/);
  assert.match(html, /sortRankingBy\('cheatWarningCount'\)/);
  assert.match(html, />Vi phạm <span id="sort-icon-cheatWarningCount"/);
  assert.match(desktop, /Number\(r\.cheatWarningCount\) \|\| 0/);
  assert.match(desktop, /Số lần vi phạm quy chế thi/);
});

test('Small screens use readable cards, preserving their selection and actions', () => {
  assert.match(html, /id="ranking-container-mobile" class="lg:hidden/);
  assert.match(html, /class="lg:hidden flex items-center justify-between[^"]*"[^>]*>\s*<label[^>]*>[\s\S]*?id="ranking-select-all-mobile"/);
  assert.match(html, /id="ranking-container-desktop" class="hidden lg:block/);
  assert.match(code.slice(end, code.indexOf('window.showExamDetail =', end)), /showExamDetail\('/);
  assert.match(code.slice(end, code.indexOf('window.showExamDetail =', end)), /deleteSingleRankingResult\('/);
});
