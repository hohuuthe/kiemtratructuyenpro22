import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {readFileSync} from 'node:fs';
import {generateExamDocx} from '../src/exam-docx-generator.ts';
import {convertExamExportZipToMathType} from '../src/word-mathtype-export/exam-zip-converter.js';
import {selectExactExamWordQuestions} from '../src/exam-word-export-selection.js';
import {NS,parseXml} from '../src/word-mathtype-export/omml-ast.js';

const header={soGiaoDuc:'SO',truongHoc:'TRUONG',deThiTitle:'KIEM TRA',monHoc:'TOAN',maDe:'1001'};
const questions=[{
  id:'q1',type:'4-1',level:'NB',lesson:'Toan',
  content:'Tinh $\\frac{a}{b}$',options:{
    A:'$x^2$',B:'$\\sqrt{x}$',C:'1',D:'2'
  },answer:'A'
}];
const png=Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64'));
const preview=async()=>({png,widthPt:20,heightPt:10,baselinePt:2});
const previewBatch=async items=>items.map(()=>({png,widthPt:20,heightPt:10,baselinePt:2}));
async function makePackage(count=2,includeExcel=true){
  const zip=new JSZip();
  for(let i=0;i<count;i++)zip.file('De_Thi_'+(i+1)+'.docx',
    await generateExamDocx({...header,maDe:String(1001+i)},questions));
  if(includeExcel)zip.file('Bang_Dap_An.xlsx',new Uint8Array([80,75,3,4,1,2,3]));
  return new Blob([await zip.generateAsync({type:'uint8array'})]);
}
test('MathType preserves server-selected Word content and unchanged Excel answer bytes',async()=>{
  const original=await makePackage();
  const snapshot=new Uint8Array(await original.arrayBuffer());
  const output=await convertExamExportZipToMathType(original,{
    expectedDocCount:2,renderPreview:preview,renderPreviewBatch:previewBatch
  });
  assert.deepEqual(new Uint8Array(await original.arrayBuffer()),snapshot);
  const before=await JSZip.loadAsync(original),after=await JSZip.loadAsync(output);
  assert.deepEqual(Object.keys(after.files).sort(),Object.keys(before.files).sort());
  assert.deepEqual(await after.file('Bang_Dap_An.xlsx').async('uint8array'),
    await before.file('Bang_Dap_An.xlsx').async('uint8array'));
  for(const name of ['De_Thi_1.docx','De_Thi_2.docx']){
    const oldZip=await JSZip.loadAsync(await before.file(name).async('uint8array'));
    const newZip=await JSZip.loadAsync(await after.file(name).async('uint8array'));
    const oldXml=parseXml(await oldZip.file('word/document.xml').async('string'));
    const newXml=parseXml(await newZip.file('word/document.xml').async('string'));
    const count=oldXml.getElementsByTagNameNS(NS.m,'oMath').length;
    assert.ok(count>=2);
    assert.equal(newXml.getElementsByTagNameNS(NS.m,'oMath').length,0);
    assert.equal(newXml.getElementsByTagNameNS(NS.o,'OLEObject').length,count);
    assert.match(Array.from(newXml.getElementsByTagNameNS(NS.w,'t'))
      .map(n=>n.textContent).join(''),/Tinh/);
  }
});
test('Malformed server ZIP, missing answers, and formula failures are rejected atomically',async()=>{
  const input=await makePackage(1),unchanged=new Uint8Array(await input.arrayBuffer());
  await assert.rejects(convertExamExportZipToMathType(input,{
    expectedDocCount:2,renderPreview:preview
  }),{code:'INVALID_EXAM_ZIP'});
  await assert.rejects(convertExamExportZipToMathType(await makePackage(1,false),{
    expectedDocCount:1,renderPreview:preview
  }),{code:'INVALID_EXAM_ZIP'});
  await assert.rejects(convertExamExportZipToMathType(new Blob(['bad zip']),{
    expectedDocCount:1,renderPreview:preview
  }),{code:'INVALID_EXAM_ZIP'});
  await assert.rejects(convertExamExportZipToMathType(input,{
    expectedDocCount:1,renderPreview:async()=>{throw new Error('preview failure');}
  }),/preview failure/);
  assert.deepEqual(new Uint8Array(await input.arrayBuffer()),unchanged);
});
test('Exact levels cannot be silently substituted in generated Word exam',()=>{
  const pool=[{id:'nb1',level:'NB'},{id:'nb2',level:'NB'},{id:'th1',level:'TH'}];
  const shuffle=x=>x.slice();
  const config={targetCount:3,nbTarget:1,thTarget:1,vdTarget:1,typeLabel:'4 lựa chọn'};
  assert.throws(()=>selectExactExamWordQuestions(pool,config,shuffle),/mức VD/);
  assert.throws(()=>selectExactExamWordQuestions(pool,{...config,vdTarget:0},shuffle),/tổng NB\/TH\/VD/);
  assert.deepEqual(selectExactExamWordQuestions(pool,{
    ...config,targetCount:2,vdTarget:0
  },shuffle).map(x=>x.id),['nb1','th1']);
  assert.deepEqual(selectExactExamWordQuestions(pool,{
    targetCount:2,nbTarget:0,thTarget:0,vdTarget:0
  },shuffle).map(x=>x.id),['nb1','nb2']);
});
test('MathType exam export reuses authenticated server ZIP without client redraw',()=>{
  const code=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  const start=code.indexOf('window.executeDocxExport = async function');
  const end=code.indexOf('async function generateDocxClientSide(',start);
  const exportCode=code.slice(start,end);
  assert.match(exportCode,/let useClientFallback = false/);
  assert.match(exportCode,/convertExamExportZipToMathType\(zipBlob/);
  assert.match(exportCode,/equationFormat === 'mathtype' \|\| serverErr\?\.stopClientFallback/);
  assert.match(exportCode,/response\.status >= 400 && response\.status < 500/);
});
test('Server Word answer-key export requires live teacher/admin and exact owner',()=>{
  const code=readFileSync(new URL('../functions/api/exam/export-docx.ts',import.meta.url),'utf8');
  assert.match(code,/if \(!tokenUser\)/);
  assert.match(code,/!checkIsTeacherOrAdmin\(tokenUser\)/);
  assert.match(code,/ownerIds\.includes\(String\(dbExam\.creator_id/);
  assert.match(code,/selectExactExamWordQuestions\(/);
  assert.doesNotMatch(code,/pickedSoFar\.push\(\.\.\.remaining/);
});
