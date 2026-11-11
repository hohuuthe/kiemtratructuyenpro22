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
  const xml=parseXml(await z.file('word/document.xml').async('string'));
  const objects=Array.from(xml.getElementsByTagNameNS(NS.w,'object'));
  assert.equal(objects.length,121);
  const oleIds=new Set(),shapeIds=new Set();
  for(let i=0;i<objects.length;i++){
    const entry=result.report.equations[i],object=objects[i],run=object.parentNode;
    assert.equal(run.localName,'r');
    assert.equal(run.parentNode.localName,'p');
    assert.equal(run.getElementsByTagNameNS(NS.w,'position').length,0,
      'No MathType run should be displaced outside its native Word hit box');
    const shape=object.getElementsByTagNameNS(NS.v,'shape')[0];
    const oleNode=object.getElementsByTagNameNS(NS.o,'OLEObject')[0];
    assert.ok(shape&&oleNode);
    assert.doesNotMatch(shape.getAttribute('style'),/vertical-align|position:|margin-top|margin-bottom/);
    assert.equal(oleNode.getAttribute('ProgID'),'Equation.DSMT4');
    assert.equal(oleNode.getAttribute('Type'),'Embed');
    assert.equal(oleNode.getAttribute('ShapeID'),shape.getAttribute('id'));
    assert.ok(!oleIds.has(oleNode.getAttributeNS(NS.r,'id')));
    assert.ok(!shapeIds.has(shape.getAttribute('id')));
    oleIds.add(oleNode.getAttributeNS(NS.r,'id'));shapeIds.add(shape.getAttribute('id'));
    readMtef(inspectOle(await z.file(entry.olePath).async('uint8array')).mtef);
  }
  assert.equal(oleIds.size,121);
  assert.equal(shapeIds.size,121);
  assert.equal(result.report.nativeEditorVerified,false,'Structural gate must not claim native-editor testing.');
});
