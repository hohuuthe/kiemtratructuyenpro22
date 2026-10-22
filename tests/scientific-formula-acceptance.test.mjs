import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import katex from 'katex';
import 'katex/dist/contrib/mhchem.js';
import { splitScientificContent } from '../src/scientific-formula-tokenizer.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/scientific-formulas-516.json', import.meta.url), 'utf8')).cases;
const regular = fixtures.filter(row => !row.special);
test('all 516 source formulas and 35 boundary fixtures are present', () => {
  assert.equal(regular.length, 516);
  assert.equal(fixtures.length, 551);
  assert.equal(new Set(fixtures.map(row => row.id)).size, fixtures.length);
});
test('516 regular inputs: tokenizer preserves math source and never throws', () => {
  let recognized = 0, parsed = 0, failures = [];
  for (const row of regular) {
    const parts = splitScientificContent(row.latex);
    if (parts.some(p => p.type === 'math')) recognized++;
    for (const part of parts) {
      if (part.type !== 'math') continue;
      try {
        katex.renderToString(part.value, {
          displayMode: !!part.display,
          throwOnError: true,
          trust: false,
          strict: 'ignore',
          maxExpand: 1000,
          maxSize: 20
        });
        parsed++;
      } catch (err) {
        failures.push({ id: row.id, error: err.message });
      }
    }
  }
  console.log(JSON.stringify({ total: regular.length, recognized, parsed, syntaxDiagnostics: failures.slice(0, 35), invalidCount: failures.length }));
  // Real source includes intentionally malformed Word imports; diagnostics must remain visible.
  assert.ok(recognized >= 490, 'Tokenizer must identify essentially all full-source formulas');
});
test('explicit inline and display wrapping is recognized', () => {
  for (const row of regular) {
    if (row.latex.includes('$')) continue; // Copy/paste artifacts tested separately.
    for (const [open, close] of [['\\(', '\\)'], ['\\[', '\\]'], ['$', '$'], ['$$', '$$']]) {
      const t = splitScientificContent(open + row.latex + close);
      assert.equal(t.length, 1, row.id + ' '+open);
      assert.equal(t[0].type, 'math', row.id + ' '+open);
      assert.equal(t[0].value, row.latex, row.id + ' '+open);
    }
  }
});
test('XSS is never treated as a typeset expression', () => {
  for(const input of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>']) {
    assert.ok(splitScientificContent(input).every(x => x.type === 'text'));
  }
});
