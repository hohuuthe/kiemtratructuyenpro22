import assert from 'node:assert/strict';
import test from 'node:test';
import { splitLabeledScientificRecords } from '../src/scientific-formula-records.js';

test('formula catalog is split into separate records and keeps complete raw TeX', () => {
  const source = String.raw`MAT-007 | Số thập phân dùng dấu phẩy | 3{,}14159 MAT-008 | Lũy thừa | a^{m+n}=a^ma^{n}`;
  const p = splitLabeledScientificRecords(source);
  assert.equal(p.length, 2);
  assert.equal(p[0].formula, '3{,}14159');
  assert.equal(p[1].formula, 'a^{m+n}=a^ma^{n}');
});
test('chemistry and biology options do not merge their formulas', () => {
  const source = String.raw`CHE-002 | Carbon dioxide | \ce{CO2} CHE-003 | Axit sulfuric | \ce{H2SO4}`;
  const p = splitLabeledScientificRecords(source);
  assert.equal(p.length, 2);
  assert.equal(p[0].formula, String.raw`\ce{CO2}`);
  assert.equal(p[1].formula, String.raw`\ce{H2SO4}`);
});
test('unlabeled normal question remains untouched', () => {
  assert.equal(splitLabeledScientificRecords(String.raw`Tính \frac{a}{b} và giải thích`), null);
});
test('multiple pipe separators in one formula remain in source', () => {
  const p = splitLabeledScientificRecords(String.raw`MAT-015 | Giá trị tuyệt đối | \left|\frac{x-1}{x+1}\right|`);
  assert.equal(p.length, 1);
  assert.equal(p[0].formula, String.raw`\left|\frac{x-1}{x+1}\right|`);
});
