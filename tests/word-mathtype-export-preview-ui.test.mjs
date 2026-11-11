import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {finalizeWordExport,canExportMathTypeHere,isMathTypePreviewHost} from '../src/word-export-format.js';

const app=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const examStart=app.indexOf('window.openExportDocxModal = async function');
const examEnd=app.indexOf('async function fetchAllExamsChunked(',examStart);
const exam=app.slice(examStart,examEnd);
const bankStart=app.indexOf('📤 Tùy chọn xuất file Word');
const bankExec=app.indexOf('window.executeExportWord = async function',bankStart);
const bankEnd=app.indexOf('window.exportStatsToExcel',bankExec);
const bank=app.slice(bankStart,bankEnd);

test('Equation stays the default in both Preview export dialogs',()=>{
  assert.ok(examStart>=0&&examEnd>examStart);
  assert.match(exam,/name="docx-equation-format" value="equation" checked/);
  assert.match(exam,/name="docx-equation-format" value="mathtype"/);
  assert.match(bank,/name="bank-word-equation-format" value="equation" checked/);
  assert.match(bank,/name="bank-word-equation-format" value="mathtype"/);
});

test('MathType is enabled on Production and Preview while Equation stays default',()=>{
  assert.equal(isMathTypePreviewHost('feat-word-export-mathtype-20.kiemtratructuyenpro.pages.dev'),true);
  assert.equal(isMathTypePreviewHost('947ce87a.kiemtratructuyenpro.pages.dev'),true);
  assert.equal(isMathTypePreviewHost('kiemtratructuyenpro.pages.dev'),false);
  assert.equal(canExportMathTypeHere('testpro.id.vn'),true);
  assert.equal(canExportMathTypeHere('kiemtratructuyenpro.pages.dev'),true);
  assert.equal(canExportMathTypeHere('feat-word-export-mathtype-20.kiemtratructuyenpro.pages.dev'),true);
});

test('Equation finalize path is an object-identity no-op',async()=>{
  const blob=new Blob(['unchanged-equation-docx']);
  assert.equal(await finalizeWordExport(blob,{equationFormat:'equation',hostname:'testpro.id.vn'}),blob);
});

test('Exam MathType selection bypasses the existing server Equation ZIP and post-processes only client DOCX',()=>{
  assert.match(exam,/const equationFormat = document\.querySelector\('input\[name="docx-equation-format"\]:checked'\)\?\.value \|\| 'equation'/);
  assert.match(exam,/let useClientFallback = equationFormat === 'mathtype'/);
  assert.match(exam,/if \(!useClientFallback\) try \{/);
  assert.match(exam,/generateDocxClientSide\(targetExamId, headerOpts, soLuongDe, updateProgress, equationFormat, mathTypeController\?\.signal\)/);
  assert.match(exam,/const equationBlob = await generateExamDocx\(currentHeader, selectedQuestions\)/);
  assert.match(exam,/const docBlob = await finalizeWordExport\(equationBlob,/);
});

test('Question-bank MathType selection post-processes the generated copy and saves outputBlob',()=>{
  assert.match(bank,/const equationFormat = modal\.querySelector\('input\[name="bank-word-equation-format"\]:checked'\)\?\.value \|\| 'equation'/);
  assert.match(bank,/const outputBlob = await finalizeWordExport\(blob,/);
  assert.match(bank,/writeQuestionBankWordFile\(choice\.handle, outputBlob\)/);
  assert.match(bank,/createQuestionBankWordDownload\(outputBlob, downloadName\)/);
  assert.doesNotMatch(bank,/writeQuestionBankWordFile\(choice\.handle, blob\)/);
  assert.doesNotMatch(bank,/createQuestionBankWordDownload\(blob, downloadName\)/);
});


test('Preview runtime uses app CHTML MathJax and batch host capture instead of SVG or per-formula screenshots',()=>{
  const renderer=fs.readFileSync(new URL('../src/word-mathtype-export/preview-browser-mathjax.js',import.meta.url),'utf8');
  assert.match(renderer,/globalThis\.MathJax/);
  assert.match(renderer,/querySelector\('mjx-container'\)/);
  assert.match(renderer,/await html2canvas\(host/);
  assert.doesNotMatch(renderer,/html2canvas\(math/);
  assert.doesNotMatch(renderer,/querySelector\('svg'\)/);
  assert.match(renderer,/cooperativeYield/);
});

test('MathType Preview export has cancellation, timeout and actionable formula-level errors',()=>{
  const converter=fs.readFileSync(new URL('../src/word-mathtype-export/docx-converter.js',import.meta.url),'utf8');
  assert.match(converter,/PREVIEW_TIMEOUT/);
  assert.match(converter,/previewTimeoutMs/);
  assert.match(app,/new AbortController\(\)/);
  assert.match(app,/describeMathTypeExportFailure/);
  assert.match(app,/signal: mathTypeSignal/);
  assert.match(app,/signal: mathTypeController\?\.signal/);
});


test('MathType renderer batches MathJax/html2canvas work and keeps a bounded duplicate-preview cache',()=>{
  const renderer=fs.readFileSync(new URL('../src/word-mathtype-export/preview-browser-mathjax.js',import.meta.url),'utf8');
  assert.match(renderer,/createBrowserMathTypePreviewBatchRenderer/);
  assert.match(renderer,/batchLimit\(\)/);
  assert.match(renderer,/previewCache=new Map\(\)/);
  assert.match(renderer,/CACHE_MAX_BYTES=24\*1024\*1024/);
  assert.match(renderer,/await html2canvas\(host/);
  assert.match(renderer,/cropPng\(sheet/);
});

test('DOCX converter streams bounded MathType preview windows and retains per-formula fallback',()=>{
  const converter=fs.readFileSync(new URL('../src/word-mathtype-export/docx-converter.js',import.meta.url),'utf8');
  assert.match(converter,/const renderPreviewBatch=options\.renderPreviewBatch/);
  assert.match(converter,/previewWindowSize/);
  assert.match(converter,/loadPreviewWindow\(i\)/);
  assert.match(converter,/previewWindow=\[\]/);
  assert.match(converter,/renderPreviewBatch\(pending\.map/);
  assert.match(converter,/renderPreview\(item\.ast/);
  assert.doesNotMatch(converter,/preparedPreviews=await Promise\.race/);
});
