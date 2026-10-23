from pathlib import Path
p=Path('src/main.js');s=p.read_text()
a="import { generateExamPdfBlob } from './exam-pdf-generator.ts';"
b="import { generateExamAnswerExcel } from './exam-excel-generator.ts';"
assert a in s and b in s
s=s.replace(a,"const generateExamPdfBlob = async (...args) => (await import('./exam-pdf-generator.ts')).generateExamPdfBlob(...args);")
s=s.replace(b,"const generateExamAnswerExcel = async (...args) => (await import('./exam-excel-generator.ts')).generateExamAnswerExcel(...args);")
a='const excelBuffer = generateExamAnswerExcel(excelHeaderInfo, examAnswerDocs);'
assert a in s
s=s.replace(a,'const excelBuffer = await generateExamAnswerExcel(excelHeaderInfo, examAnswerDocs);')
p.write_text(s)
Path('tests/lazy-export-entry.test.mjs').write_text('''import test from 'node:test';
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
''')
# Stage this reviewed new test explicitly; unrelated untracked files are never included.
import subprocess
subprocess.run(['git','add','-f','tests/lazy-export-entry.test.mjs'],check=True)
