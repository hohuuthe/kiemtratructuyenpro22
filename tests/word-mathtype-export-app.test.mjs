/** Run with node --import tsx --test against the REAL unchanged app generators.
 * Uses an explicitly stubbed preview to isolate OMML/MTEF/ZIP correctness.
 * Does NOT claim native MathType acceptance or PNG visual acceptance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inflateSync} from 'node:zlib';
import JSZip from 'jszip';
import {Document,Packer,Paragraph} from 'docx';
import {Math as WordMath} from 'docx/math';
import {generateExamDocx,makeWordMathRun} from '../src/exam-docx-generator.ts';
import {generateQuestionBankDocx} from '../src/question-bank-docx-generator.ts';
import {finalizeWordExport} from '../src/word-export-format.js';
import {convertDocxToMathType} from '../src/word-mathtype-export/docx-converter.js';
import {NS,parseXml} from '../src/word-mathtype-export/omml-ast.js';
import {inspectOle,readMtef} from './helpers/read-exported-ole.mjs';
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64'));
const stub=async()=>({png,widthPt:20,heightPt:10,baselinePt:2});
const q={id:'mt-export-1',type:'4-1',level:'NB',lesson:'TEST',content:'Compute $\\frac{a}{b}$',options:{A:'$x^2$',B:'$\\sqrt{x}$',C:'$x_1$',D:'$a+b$'},answer:'A'};
async function count(blob){const z=await JSZip.loadAsync(blob instanceof Blob?await blob.arrayBuffer():blob);const d=parseXml(await z.file('word/document.xml').async('string'));return {z,math:d.getElementsByTagNameNS(NS.m,'oMath').length,ole:d.getElementsByTagNameNS(NS.o,'OLEObject').length};}
test('Existing exam Equation result is returned identically, while explicit prototype postprocessing is separate',async()=>{
  const original=await generateExamDocx({deThiTitle:'Qualification',maDe:'0001'},[q]);
  const snapshot=Buffer.from(original);assert.equal(await finalizeWordExport(original),original);assert.equal(await finalizeWordExport(original,{equationFormat:'equation'}),original);
  const before=await count(original);assert.ok(before.math>=5);assert.equal(before.ole,0);
  const out=await convertDocxToMathType(original,{renderPreview:stub});const after=await count(out.blob);
  assert.equal(after.math,0);assert.equal(after.ole,before.math);assert.deepEqual(original,snapshot);
});
test('Existing question bank preserves question/option/answer data and default output identity',async()=>{
  const question={...q,type:'TL',answer:'$\\frac{x}{y}$'},snapshot=JSON.stringify(question);
  const plan={questions:[question],ids:[q.id],totalSelected:1,requestedCount:1,selectedLessons:1};
  const original=await generateQuestionBankDocx(plan);assert.equal(await finalizeWordExport(original),original);
  const before=await count(original),out=await convertDocxToMathType(original,{renderPreview:stub}),after=await count(out.blob);
  assert.ok(before.math>=2);assert.equal(after.ole,before.math);assert.equal(after.math,0);assert.equal(JSON.stringify(question),snapshot);
});
test('All 121 established source equations pass the NEW structural writer using actual Equation output',async()=>{
  const packed=JSON.parse(fs.readFileSync(new URL('./fixtures/mathtype-121-corpus.json',import.meta.url),'utf8'));
  const source=JSON.parse(inflateSync(Buffer.from(packed.deflateBase64,'base64')));assert.equal(source.length,121);
  const children=source.map(c=>{const math=makeWordMathRun(c.expected);assert.ok(math instanceof WordMath,'Existing Equation source '+c.number);return new Paragraph({children:[math]});});
  const original=await Packer.toBuffer(new Document({sections:[{children}]}));
  const result=await convertDocxToMathType(original,{renderPreview:stub});assert.equal(result.report.converted,121);
  const {z,math,ole}=await count(result.blob);assert.equal(math,0);assert.equal(ole,121);
  for(const entry of result.report.equations)readMtef(inspectOle(await z.file(entry.olePath).async('uint8array')).mtef);
  assert.equal(result.report.nativeEditorVerified,false,'Structural gate must not claim native-editor testing.');
});


// Real Question Bank -> DOCX -> native MathType OLE -> reader regression.
// Existing tests cover a single essay question; user-facing export also needs
// all four question types, answer strings, chemistry and imported structures.
test('Question Bank MathType keeps all four question types, options and answer lines', async()=>{
  const questions=[
    {...q,id:'QB-1',content:'Phân số $\\frac{a}{b}$',answer:'A'},
    {...q,id:'QB-2',type:'TF4',content:'Hóa học $\\ce{H2SO4}$',
      options:{A:'$\\ce{H2O}$',B:'$\\ce{SO4^{2-}}$',C:'$x^2$',D:'$\\sqrt{2}$'},answer:'A&C'},
    {...q,id:'QB-3',type:'SQ',content:'Nghiệm $\\sqrt{3}$',options:{},answer:'$\\frac{1}{2}$'},
    {...q,id:'QB-4',type:'TL',content:'Hệ $\\begin{cases}x+y=3\\\\x-y=1\\end{cases}$',
      options:{},answer:'$x=2$'}
  ];
  const plan={questions,ids:questions.map(v=>v.id),requestedCount:questions.length,
    totalSelected:questions.length,selectedLessons:1};
  const original=await generateQuestionBankDocx(plan);
  const before=await count(original);
  assert.ok(before.math>=10,'Actual question bank must generate editable OMML');
  const {blob,report}=await convertDocxToMathType(original,{renderPreview:stub});
  const after=await count(blob);
  assert.equal(after.math,0);
  assert.equal(after.ole,before.math);
  assert.equal(report.converted,before.math);
  const xml=await after.z.file('word/document.xml').async('string');
  for(const id of ['Phân số','Hóa học','Nghiệm','Hệ','Đáp án:'])
    assert.ok(xml.includes(id),'Missing question content: '+id);
  for(const item of report.equations)readMtef(inspectOle(await after.z.file(item.olePath).async('uint8array')).mtef);
});

const knownWordBankCases=JSON.parse(fs.readFileSync(new URL('./fixtures/scientific-formulas-516.json',import.meta.url),'utf8')).cases;
for(const id of ['MAT-022','MAT-079','MAT-086','MAT-088','STR-003','STR-022','STR-030']){
  test('Question Bank MathType imports existing scientific regression '+id,async()=>{
    const sample=knownWordBankCases.find(row=>row.id===id);
    assert.ok(sample,'Missing corpus ID '+id);
    const question={...q,id,type:'TL',content:'Công thức $'+sample.latex+'$',options:{},answer:'Đúng'};
    const plan={questions:[question],ids:[id],requestedCount:1,totalSelected:1,selectedLessons:1};
    const original=await generateQuestionBankDocx(plan);
    const before=await count(original);
    assert.ok(before.math>=1,'Formula did not become Word OMML: '+id);
    const {blob,report}=await convertDocxToMathType(original,{renderPreview:stub});
    const after=await count(blob);
    assert.equal(after.ole,before.math);
    assert.equal(after.math,0);
    assert.equal(report.converted,before.math);
  });
}
