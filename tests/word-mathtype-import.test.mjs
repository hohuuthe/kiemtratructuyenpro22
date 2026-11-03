import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {inspectScientificDocx} from '../src/word-omml-reader.js';
import {verifyImportedWordQuestions,validateWordFormulaSourceForImport,checkWordImportBeforeSave} from '../src/word-import-verification.js';
import {convertMtefV5ToLatex,readMathTypeOleStream,encodeMathTypeSource,verifyMathTypeSource,readMathTypeRelationship} from '../src/word-mathtype-reader.js';

const prefix='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>';
const suffix='</w:body></w:document>';
const mtHeader=[5,1,0,4,0,0,0];
const line=chars=>Uint8Array.from([...mtHeader,1,0,...chars.flatMap(x=>[2,0,133,x.charCodeAt(0),0]),0,0]);
async function fixture(block) {
  const z=new JSZip();
  z.file('word/document.xml',prefix+block+suffix);
  return z.generateAsync({type:'uint8array'});
}
test('MathType v5 trivial MTEF is interpreted, not rasterized',()=>{
  const input=line(['x','+','1']);
  assert.equal(convertMtefV5ToLatex(input),'x+1');
  const sourceXml=encodeMathTypeSource(input);
  assert.equal(verifyMathTypeSource(sourceXml,'x+1','verified'),true);
  assert.equal(validateWordFormulaSourceForImport({sourceType:'mathtype',sourceOmml:sourceXml,latex:'x+1',status:'verified'}).ok,true);
  assert.throws(()=>verifyMathTypeSource(sourceXml,'x+2','verified'),/không khớp/);
});
test('Unrecognized MathType versions, templates, OLE streams and corrupt source are rejected',()=>{
  assert.throws(()=>convertMtefV5ToLatex(Uint8Array.from([3,...line(['x']).slice(1)])),/phiên bản 5/);
  assert.throws(()=>convertMtefV5ToLatex(Uint8Array.from([...mtHeader,1,0,3,0,244,0,0,0,0,0])),/template/);
  assert.throws(()=>readMathTypeOleStream(new Uint8Array(512)),/không phải tệp OLE/);
  assert.throws(()=>verifyMathTypeSource('<!DOCTYPE x><x/>','x','verified'),/không an toàn/);
});
test('Legacy Equation OLE without relationship remains pending, preventing silent save',async()=>{
  const ole='<w:p><w:object><o:OLEObject xmlns:o="urn:schemas-microsoft-com:office:office" ProgID="Equation.3" r:id="rId2" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" /></w:object></w:p>';
  const report=await inspectScientificDocx(await fixture('<w:p><w:r><w:t>Câu 1:</w:t></w:r></w:p>'+ole));
  assert.equal(report.formulas.length,1);
  assert.equal(report.formulas[0].sourceType,'embedded');
  assert.equal(report.formulas[0].status,'review');
  const q={id:'question0001',type:'TL',level:'NB',content:report.lines[1].text,answer:'1',options:{}};
  const evaluated=verifyImportedWordQuestions([q],report);
  assert.equal(checkWordImportBeforeSave(evaluated.questions,evaluated.documentIssues).ok,false);
});
test('Native OMML document is unchanged after MathType reader is introduced',async()=>{
  const report=await inspectScientificDocx(await fixture('<w:p><m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath></w:p>'));
  assert.equal(report.formulas[0].sourceType,'omml');
  assert.equal(report.formulas[0].latex,'\\frac{a}{b}');
  assert.equal(report.formulas[0].status,'parsed');
});
test('Relationship cannot be external or outside embeddings folder',async()=>{
  const z=new JSZip();
  z.file('word/_rels/document.xml.rels','<Relationships><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" TargetMode="External" Target="https://evil.invalid/ole.bin"/></Relationships>');
  await assert.rejects(readMathTypeRelationship(z,'rId3'),/không phải OLE nội bộ/);
});

test('MTEF font record IDs use variable-width unsigned indexes without corrupting following records',()=>{
  const source=Uint8Array.from([...mtHeader,8,255,1,1,0,1,0,2,0,133,120,0,0,0]);
  assert.equal(convertMtefV5ToLatex(source),'x');
});
test('MTEF font definition indexes use variable width and preserve following line records',()=>{
  const source=Uint8Array.from([...mtHeader,17,255,0,1,65,0,1,0,2,0,133,120,0,0,0]);
  assert.equal(convertMtefV5ToLatex(source),'x');
});

test('MTEF standard MT Extra and user typefaces do not fail only because of typeface id',()=>{
  // CHAR face is stored biased by +128: 139 = fnMTEXTRA (11), 137/138 = USER1/USER2.
  for (const [encodedFace,label] of [[137,'USER1'],[138,'USER2'],[139,'MTEXTRA']]) {
    const source=Uint8Array.from([...mtHeader,1,0,2,0,encodedFace,120,0,0,0]);
    assert.doesNotThrow(()=>convertMtefV5ToLatex(source),label);
    assert.equal(convertMtefV5ToLatex(source),'x',label);
  }
});

test('MTEF MT Extra remains fail-closed for private-use glyphs',()=>{
  const source=Uint8Array.from([...mtHeader,1,0,2,0,139,0x02,0xef,0,0]);
  assert.throws(()=>convertMtefV5ToLatex(source),/unmapped MTCode/);
});

test('real DSMT7 MathType sources from the reported Word file decode exactly',()=>{
  const samples=[
    ['BQEABwREU01UNwAAE1dpbkFsbEJhc2ljQ29kZVBhZ2VzABEFVGltZXMgTmV3IFJvbWFuABEDU3ltYm9sABEFQ291cmllciBOZXcAEQRNVCBFeHRyYQASAAghL0WPRC9BUPQQD0dfQVDyHx5BUPQVD0EA9EX0JfSPQl9BAPQQD0NfQQD0j0X0Kl9I9I9BAPQQD0D0j0F/SPQQD0EqX0RfRfRfRfRfQQ8MAQABAAECAgICAAIAAQEBAAMAAQAEAAAKAQACAINBAAIEhj0APQMAAgMAAQACAIN4AAIEhggizgIEixUhpQIAgnwAAgCDeAACBIY8ADwCAIg0AAACAJZ7AAIAln0AAAAA','A=\\left\\{x\\in{}\\mathbb{N}|x<4\\right\\}'],
    ['BQEABwREU01UNwAAE1dpbkFsbEJhc2ljQ29kZVBhZ2VzABEFVGltZXMgTmV3IFJvbWFuABEDU3ltYm9sABEFQ291cmllciBOZXcAEQRNVCBFeHRyYQASAAghL0WPRC9BUPQQD0dfQVDyHx5BUPQVD0EA9EX0JfSPQl9BAPQQD0NfQQD0j0X0Kl9I9I9BAPQQD0D0j0F/SPQQD0EqX0RfRfRfRfRfQQ8MAQABAAECAgICAAIAAQEBAAMAAQAEAAAKAQACAINCAAIEhj0APQMAAgMAAQACAIN4AAIEhggizgIEiyQhogIAgnwAAgSGEiItAgCIMQACBIZkIqMCAIN4AAIEhmQiowIAiDIAAAIAlnsAAgCWfQAAAAA=','B=\\left\\{x\\in{}\\mathbb{Z}|-1\\leq{}x\\leq{}2\\right\\}'],
    ['BQEABwREU01UNwAAE1dpbkFsbEJhc2ljQ29kZVBhZ2VzABEFVGltZXMgTmV3IFJvbWFuABEDU3ltYm9sABEFQ291cmllciBOZXcAEQRNVCBFeHRyYQASAAghL0WPRC9BUPQQD0dfQVDyHx5BUPQVD0EA9EX0JfSPQl9BAPQQD0NfQQD0j0X0Kl9I9I9BAPQQD0D0j0F/SPQQD0EqX0RfRfRfRfRfQQ8MAQABAAECAgICAAIAAQEBAAMAAQAEAAAKAQACBIYFIsYCAIIuAAAA','\\emptyset{}.'],
    ['BQEABwREU01UNwAAE1dpbkFsbEJhc2ljQ29kZVBhZ2VzABEFVGltZXMgTmV3IFJvbWFuABEDU3ltYm9sABEFQ291cmllciBOZXcAEQRNVCBFeHRyYQASAAghL0WPRC9BUPQQD0dfQVDyHx5BUPQVD0EA9EX0JfSPQl9BAPQQD0NfQQD0j0X0Kl9I9I9BAPQQD0D0j0F/SPQQD0EqX0RfRfRfRfRfQQ8MAQABAAECAgICAAIAAQEBAAMAAQAEAAAKAQACAINBAAIEhj0APQMAAgMAAQACAIN4AAIEhggizgIEix0hoQIAgnwAAgCCKAACAIN4AAIEhhIiLQIAiDEAAgCCKQACAIIoAAIAg3gAAgSGEiItAgCIMwACAIIpAAIEhj0APQIAiDAAAAIAlnsAAgCWfQAAAAA=','A=\\left\\{x\\in{}\\mathbb{R}|(x-1)(x-3)=0\\right\\}']
  ];
  for(const [base64,expected] of samples) {
    const source=Uint8Array.from(Buffer.from(base64,'base64'));
    assert.equal(convertMtefV5ToLatex(source),expected);
    const sourceXml=encodeMathTypeSource(source);
    assert.equal(verifyMathTypeSource(sourceXml,expected,'verified'),true);
    assert.equal(validateWordFormulaSourceForImport({sourceType:'mathtype',sourceOmml:sourceXml,latex:expected,status:'verified'}).ok,true);
  }
});

test('MTEF function-start metadata no longer rejects ordinary function text',()=>{
  // face 1 = fnTEXT, option bit 2 = mtefOPT_CHAR_FUNC_START on the first character.
  const source=Uint8Array.from([...mtHeader,1,0,
    2,2,129,115,0,
    2,0,129,105,0,
    2,0,129,110,0,
    2,0,133,120,0,
    0,0]);
  assert.equal(convertMtefV5ToLatex(source),'\\mathrm{s}\\mathrm{i}\\mathrm{n}x');
});

test('MTEF version 5 requires a valid producer version in header',()=>{
  assert.throws(()=>convertMtefV5ToLatex(Uint8Array.from([5,1,0,0,0,0,0,1,0,2,0,133,120,0,0,0])),/header MTEF/);
});
