import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('Heavy PDF and Excel tools are loaded on demand without changing the export implementations',()=>{
 const source=readFileSync('src/main.js','utf8');
 assert.ok(source.includes("await import('./exam-pdf-generator.ts')"));
 assert.ok(source.includes("await import('./exam-excel-generator.ts')"));
 assert.ok(source.includes('const excelBuffer = await generateExamAnswerExcel('));
 assert.ok(!source.includes("import { generateExamPdfBlob } from"));
 assert.ok(!source.includes("import { generateExamAnswerExcel } from"));
});
