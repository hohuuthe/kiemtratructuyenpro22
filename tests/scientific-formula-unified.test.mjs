import assert from 'node:assert/strict';
import test from 'node:test';
import { Document, Paragraph, Packer } from 'docx';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { parseFormattedText, makeWordMathRun } from '../src/exam-docx-generator.ts';
import { cleanHTMLText } from '../src/exam-pdf-generator.ts';
import { formatAnswerDisplay, generateExamAnswerExcel } from '../src/exam-excel-generator.ts';
import { renderScientificContent } from '../src/scientific-formula-engine.ts';
import { isScientificEditorField } from '../src/scientific-formula-editor-preview.js';
import { typesetScientificMath } from '../src/scientific-formula-typeset.js';

async function wordXml(contents) {
  const doc = new Document({ sections: [{children:[new Paragraph({children: contents})]}] });
  const buffer = await Packer.toBuffer(doc);
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml').async('string');
}
test('DOCX: nested fractions use editable Office Math, not text replacements', async () => {
  const math = '\\frac{\\frac{a}{b}}{\\frac{c}{d}}';
  const xml = await wordXml(parseFormattedText('Công thức: $' + math + '$'));
  assert.match(xml, /<m:oMath/);
  assert.match(xml, /<m:f\b/);
  assert.ok(!xml.includes('<w:t>(a/b)'), 'must not flatten nested fractions');
});
test('DOCX: bare math, chemistry and options use native Office Math', async () => {
  const a = await wordXml(parseFormattedText('CHE-002 | Carbon dioxide | \\ce{CO2}'));
  assert.match(a, /<m:oMath/);
  const b = await wordXml(parseFormattedText('E=mc^2'));
  assert.match(b, /<m:oMath/);
  assert.ok(makeWordMathRun('x^2+y^2=z^2'));
});
test('DOCX: mixed prose and math preserve surrounding text', async () => {
  const xml = await wordXml(parseFormattedText('Cho $x^2+1$, tính \\frac{a}{b}.'));
  assert.match(xml, /Cho /);
  assert.match(xml, /<m:oMath/);
  assert.match(xml, /tính/);
});
test('PDF: same renderer as student for chemistry and mathematical formulas', () => {
  const sources = [
    '$\\frac{1}{x+2}$',
    '$\\ce{CO2}$',
    'MAT-006 | Hỗn số | 2\\frac{3}{5}',
    'Công thức $E=mc^2$ và \\(\\Delta t=\\gamma\\Delta \\tau\\)'
  ];
  for (const source of sources) assert.equal(cleanHTMLText(source), renderScientificContent(source));
});
test('Excel: math source and delimiters remain verbatim', () => {
  const latex = '$\\frac{a}{b}$ và \\ce{H2O}';
  assert.equal(formatAnswerDisplay('SQ', latex), latex);
  assert.equal(formatAnswerDisplay('TL', latex), latex);
  const out = generateExamAnswerExcel({}, [{
    maDe:'1201',questions:[{type:'SQ',lesson:'Toán',level:'NB',content:latex,answer:latex}]
  }]);
  const wb = XLSX.read(out, {type:'array'});
  const ws = wb.Sheets['CHI_TIET_CAU_HOI'];
  assert.equal(ws.G2.v, latex);
  assert.equal(ws.F2.v, latex);
});
test('Editor previews target only scientific fields, not metadata', () => {
  for (const id of ['new-q-content','new-q-opt-A','edit-q-answer','edit-pending-content','edit-ai-opt-D'])
    assert.equal(isScientificEditorField({id,tagName:'INPUT',type:'text'}),true,id);
  for (const id of ['new-q-lesson','edit-q-level','edit-pending-image','login-password'])
    assert.equal(isScientificEditorField({id,tagName:'INPUT',type:'text'}),false,id);
});
test('Typesetter tolerates missing MathJax and DOM', async () => {
  assert.deepEqual(await typesetScientificMath(null,null),{rendered:0,unresolved:0});
});
