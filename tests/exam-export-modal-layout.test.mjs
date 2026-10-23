import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
const app=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
const a=app.indexOf('window.openExportDocxModal = async function');
const b=app.indexOf('async function fetchAllExamsChunked(',a);
assert.ok(a>=0&&b>a);
const block=app.slice(a,b);
test('Word/Excel dialog has dedicated stable desktop and mobile dimensions',()=>{
 assert.match(block,/showModal\(modalContent, 'exam-export'\)/);
 assert.match(app,/fullScreen === 'exam-export'/);
 assert.match(css,/#modal-content\.exam-export-modal\s*\{[^}]*width:\s*min\(760px,[^}]*height:\s*min\(740px,/s);
 assert.match(css,/@media\s*\(max-width:\s*639px\)/);
 assert.match(css,/#modal-content\.exam-export-modal #export-made-note-box\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
});
test('PDF choice and PDF export code are completely absent from exam export flow',()=>{
 assert.match(block,/Xuất đề thi \(Word \/ Excel đáp án\)/);
 for(const forbidden of ['value="pdf"','File PDF (.pdf)','generateExamPdfBlob','isPdfFormat',"exportFormat === 'pdf'",'input[name="export-format"]'])assert.ok(!block.includes(forbidden),forbidden);
 assert.match(block,/exportFormat:\s*'docx'/);
 assert.match(block,/generateExamDocx\(/);
 assert.match(block,/generateExamAnswerExcel\(/);
 assert.match(block,/\.docx/);
 assert.match(block,/\.xlsx/);
});
test('Exam and batch settings are preserved',()=>{
 for(const id of ['docx-export-title','docx-export-so','docx-export-truong','docx-export-monhoc','docx-export-namhoc','docx-export-so-luong','docx-export-made','docx-export-thoigian','btn-submit-docx-export','export-docx-progress-container'])assert.ok(block.includes(id),id);
 assert.match(block,/window\.executeDocxExport/);
 assert.match(block,/\/api\/exam\/export-docx/);
});
