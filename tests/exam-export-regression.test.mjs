import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { generateExamDocx } from '../src/exam-docx-generator.ts';
import { generateExamAnswerExcel } from '../src/exam-excel-generator.ts';
import { cleanHTMLText } from '../src/exam-pdf-generator.ts';
import { renderScientificContent } from '../src/scientific-formula-engine.ts';

const header = { soGiaoDuc: 'SO GIAO DUC', truongHoc: 'THPT TEST', deThiTitle: 'DE TEST', namHoc: '2026-2027', monHoc: 'TOAN LY HOA', thoiGian: 45, maDe: '8101' };
const questions = [
  { id: 1, type: '4-1', lesson: 'Toan', level: 'NB', content: 'Giai $\\\\frac{\\\\sqrt{x}}{2}$', options: { A: '$\\\\frac{1}{2}$', B: '$x^2$', C: '$\\\\pi$', D: '$\\\\sqrt{3}$' }, answer: 'A' },
  { id: 2, type: 'TF4', lesson: 'Hoa', level: 'TH', content: 'Chat $\\\\ce{H2O}$', options: { A: '$\\\\ce{H2O}$', B: '$\\\\ce{CO2}$', C: '$\\\\ce{NH4+}$', D: '$\\\\ce{SO4^{2-}}$' }, answer: 'AB' },
  { id: 3, type: 'SQ', lesson: 'Ly', level: 'VD', content: 'Nang luong $E=mc^2$', answer: '42' },
  { id: 4, type: 'TL', lesson: 'Toan', level: 'VD', content: 'He $\\\\begin{cases}x+y=3\\\\\\\\x-y=1\\\\end{cases}$', answer: 'x=2' },
];

test('DOCX export creates a nonempty valid Office package with formulas and all four sections', async () => {
  const data = await generateExamDocx(header, questions);
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /<m:oMath/);
  for (const label of ['PHẦN I', 'PHẦN II', 'PHẦN III', 'Câu 1']) assert.ok(xml.includes(label), label);
  assert.ok(data.byteLength > 2000);
});

test('DOCX plus XLSX can be bundled into a valid ZIP', async () => {
  const word = await generateExamDocx(header, questions);
  const excel = generateExamAnswerExcel(header, [{ maDe: header.maDe, questions }]);
  const zip = new JSZip();
  zip.file('exam.docx', word);
  zip.file('answers.xlsx', excel);
  const bytes = await zip.generateAsync({type:'uint8array'});
  const archive = await JSZip.loadAsync(bytes);
  assert.deepEqual(Object.keys(archive.files).sort(), ['answers.xlsx','exam.docx']);
});

test('PDF export matches the student math renderer source', () => {
  for (const q of questions) {
    assert.equal(cleanHTMLText(q.content), renderScientificContent(q.content));
  }
});

test('Export failure has local recovery path and modern CSS renderer', () => {
  const app = readFileSync('src/main.js', 'utf8');
  const pdf = readFileSync('src/exam-pdf-generator.ts', 'utf8');
  assert.match(app, /Server API export failed, switching to client-side generator/);
  assert.match(app, /if \(useClientFallback && !downloaded\)/);
  assert.match(pdf, /html2canvas-pro/);
});
