import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {finalizeWordExport,MATHTYPE_EXPORT_QUALIFICATION} from '../src/word-export-format.js';
import {NS,parseXml,ommlToAst,astToMathml} from '../src/word-mathtype-export/omml-ast.js';
import {astToMtef} from '../src/word-mathtype-export/mtef-writer.js';
import {createMathTypeOle} from '../src/word-mathtype-export/cfb-writer.js';
import {convertDocxToMathType,sha256} from '../src/word-mathtype-export/docx-converter.js';
import {renderFormulaSvg} from '../qualification/mathtype-export/renderer.mjs';
import {corpus,math,run,arg,fraction,nary,matrix,makeDocx} from './helpers/math-export-fixtures.mjs';
import {inspectOle,readMtef,glyphs} from './helpers/read-exported-ole.mjs';
const ast=body=>ommlToAst(parseXml(math(body)).documentElement);
const load=async blob=>JSZip.loadAsync(await blob.arrayBuffer());
const flatten=n=>[n,...(n.children||n.cells||[]).flatMap(flatten)];
// Packaging tests inject a tiny *explicitly stubbed* PNG. The real preview-SVG
// tests below use MathJax, and the qualification document generator uses Sharp.
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64'));
const stubPreview=async input=>({png,widthPt:20,heightPt:10,baselinePt:2,ast:input});

test('Default Equation path returns the exact original Blob and ignores MathType dependencies/options',async()=>{
  const b=await makeDocx();const hash=await sha256(new Uint8Array(await b.arrayBuffer()));
  const options={get renderPreview(){throw new Error('MathType renderer accessed');},get signal(){throw new Error('MathType accessed');}};
  assert.equal(await finalizeWordExport(b,options),b);
  assert.equal(await finalizeWordExport(b,{equationFormat:'equation'}),b);
  assert.equal(await sha256(new Uint8Array(await b.arrayBuffer())),hash);
});
test('Unknown format is rejected; native MathType remains gated rather than claiming qualification',async()=>{
  const b=await makeDocx();await assert.rejects(finalizeWordExport(b,{equationFormat:'image'}),{code:'INVALID_FORMAT'});
  assert.equal(MATHTYPE_EXPORT_QUALIFICATION.nativeEditorVerified,false);
  await assert.rejects(finalizeWordExport(b,{equationFormat:'mathtype',force:true,nativeEditorVerified:true}),{code:'NATIVE_ACCEPTANCE_REQUIRED'});
});
for(const [id,body] of corpus){
  test('Structural MathType export: '+id,()=>{
    const original=ast(body),source=JSON.stringify(original);
    const encoded=astToMtef(original),ole=createMathTypeOle(encoded),readback=inspectOle(ole);
    assert.deepEqual(readback.mtef,Buffer.from(encoded));
    const tree=readMtef(readback.mtef);assert.equal(tree.k,'line');
    assert.equal(JSON.stringify(original),source,'writer mutates AST');
    const ml=astToMathml(original);assert.match(ml,/<math /);
    const preview=renderFormulaSvg(original);assert.match(preview.svg,/<path /);assert.ok(preview.widthPt>0&&preview.heightPt>0);
    assert.doesNotMatch(preview.svg,/<(?:text|image|script|foreignObject)\b/);
  });
}
test('Numerator/denominator and lower/upper operator limits preserve source order',()=>{
  const fractionTree=readMtef(astToMtef(ast(fraction(run('NUM'),run('DEN')))));
  const f=flatten(fractionTree).find(n=>n.selector===11);assert.equal(glyphs(f.children[0]),'NUM');assert.equal(glyphs(f.children[1]),'DEN');
  for(const symbol of ['\u2211','\u220f','\u222b','\u222c','\u222d']){
    const tree=readMtef(astToMtef(ast(nary(symbol,run('BODY'),run('LOW'),run('UP')))));
    const op=flatten(tree).find(n=>n.k==='template');
    assert.equal(glyphs(op.children[0]),'BODY');assert.equal(glyphs(op.children[1]),'UP');assert.equal(glyphs(op.children[2]),'LOW');assert.equal(op.children[3].code,symbol.codePointAt(0));
  }
});
test('Matrices preserve row-major order and real dimensions, not a flattened text run',()=>{
  const tree=readMtef(astToMtef(ast(matrix([[run('1'),run('2')],[run('3'),run('4')]]))));
  const m=flatten(tree).find(n=>n.k==='matrix');assert.equal(m.rows,2);assert.equal(m.cols,2);assert.deepEqual(m.cells.map(glyphs),['1','2','3','4']);
});
test('CFB regular FAT and MiniFAT both round-trip bounded native streams',()=>{
  for(const size of [1,80,900,3000,8000]){
    const source=astToMtef(ast(run('x'.repeat(size))));const ole=createMathTypeOle(source);
    assert.deepEqual(inspectOle(ole).mtef,Buffer.from(source));
  }
});
test('Unsupported semantic properties fail closed, without unsupported-as-image fallback',()=>{
  const bad=[
    '<m:f><m:fPr><m:type m:val="noBar"/></m:fPr>'+arg('num',run('n'))+arg('den',run('k'))+'</m:f>',
    '<m:r><m:rPr><m:scr m:val="double-struck"/></m:rPr><m:t>R</m:t></m:r>',
    '<m:phant>'+arg('e',run('x'))+'</m:phant>',
    '<m:rad><m:radPr><m:degHide/></m:radPr>'+arg('deg',run('3'))+arg('e',run('x'))+'</m:rad>',
    '<m:nary><m:naryPr><m:subHide/></m:naryPr>'+arg('sub',run('0'))+arg('e',run('x'))+'</m:nary>',
    '<m:box><m:boxPr><m:opEmu/></m:boxPr>'+arg('e',run('mod'))+'</m:box>'
  ];
  for(const body of bad)assert.throws(()=>ast(body),{code:'UNSUPPORTED_OMML'});
  assert.throws(()=>astToMtef(ast(run('x','b')+run('y','bi'))),{code:'UNSUPPORTED_STYLE'});
});
test('Unsafe XML, entity expansion and deeply nested formulas are rejected',()=>{
  assert.throws(()=>parseXml('<!DOCTYPE x [<!ENTITY a "x">]><x>&a;</x>'),{code:'INVALID_XML'});
  assert.throws(()=>parseXml('<m:oMath>'),{code:'INVALID_XML'});
  let body=run('x');for(let i=0;i<40;i++)body=fraction(run('1'),body);
  assert.throws(()=>ast(body),{code:'RESOURCE_LIMIT'});
});
test('Postprocess all occurrences atomically with unique native objects and matching media relationships',async()=>{
  const input=await makeDocx(corpus,{header:true}),original=new Uint8Array(await input.arrayBuffer());
  let renders=0;const {blob,report}=await convertDocxToMathType(input,{renderPreview:async a=>{renders++;return stubPreview(a);}});
  assert.equal(report.converted,corpus.length+1);assert.equal(renders,corpus.length+1);
  assert.deepEqual(new Uint8Array(await input.arrayBuffer()),original);
  const z=await load(blob);const xml=await z.file('word/document.xml').async('string'),doc=parseXml(xml);
  assert.equal(doc.getElementsByTagNameNS(NS.m,'oMath').length,0);
  assert.equal(doc.getElementsByTagNameNS(NS.o,'OLEObject').length,corpus.length);
  const ids=Array.from(doc.getElementsByTagNameNS(NS.o,'OLEObject')).map(o=>o.getAttributeNS(NS.r,'id'));
  assert.equal(new Set(ids).size,ids.length);
  for(const item of report.equations){
    const bytes=await z.file(item.olePath).async('uint8array');readMtef(inspectOle(bytes).mtef);
    assert.equal(await sha256(bytes),item.oleSha256);
    assert.equal(await sha256(await z.file(item.imagePath).async('uint8array')),item.previewSha256);
  }
  assert.equal((xml.match(/Answer A\./g)||[]).length,corpus.length);
  assert.equal(report.nativeEditorVerified,false);
});
test('Preflight checks all formulas before any output/renderer work; formula errors include location',async()=>{
  const input=await makeDocx([corpus[0],['unsupported','<m:phant>'+arg('e',run('x'))+'</m:phant>']]);let called=0;
  await assert.rejects(convertDocxToMathType(input,{renderPreview:()=>{called++;return stubPreview();}}),e=>e.code==='UNSUPPORTED_OMML'&&e.details.equation===2);
  assert.equal(called,0);
});
test('Cancellation and render failure do not mutate source or return partial output',async()=>{
  const b=await makeDocx(corpus.slice(0,3)),hash=await sha256(new Uint8Array(await b.arrayBuffer()));
  const ctrl=new AbortController();let renders=0;
  await assert.rejects(convertDocxToMathType(b,{signal:ctrl.signal,renderPreview:async a=>{if(++renders===1)ctrl.abort();return stubPreview(a);}}),{code:'ABORTED'});
  await assert.rejects(convertDocxToMathType(b,{renderPreview:async()=>{throw new Error('preview unavailable');}}),/preview unavailable/);
  assert.equal(hash,await sha256(new Uint8Array(await b.arrayBuffer())));
});
test('Invalid media, existing embedded OLE and missing content types are rejected',async()=>{
  const b=await makeDocx(corpus.slice(0,1));
  await assert.rejects(convertDocxToMathType(b,{renderPreview:async()=>({png:Uint8Array.from([1,2,3]),widthPt:1,heightPt:1,baselinePt:0})}),{code:'PREVIEW_FAILED'});
  const z=await load(b);z.file('word/embeddings/existing.bin',new Uint8Array([1]));
  await assert.rejects(convertDocxToMathType(await z.generateAsync({type:'uint8array'})),{code:'UNSUPPORTED_PACKAGE'});
  await assert.rejects(convertDocxToMathType(await makeDocx([],{contentTypes:false})),{code:'INVALID_PACKAGE'});
});
test('Documents without formulas return the same Blob, not a repacked variant',async()=>{
  const b=await makeDocx([]);assert.equal((await convertDocxToMathType(b)).blob,b);
});
test('Existing relationship IDs and media file names are never overwritten',async()=>{
  const z=await load(await makeDocx(corpus.slice(0,1)));
  z.file('word/_rels/document.xml.rels','<Relationships xmlns="'+NS.rel+'"><Relationship Id="rIdKtttMt2" Type="'+NS.r+'/hyperlink" Target="https://example.invalid" TargetMode="External"/></Relationships>');
  z.file('word/media/kttt-mathtype-1.png',png);
  const {blob}=await convertDocxToMathType(await z.generateAsync({type:'uint8array'}),{renderPreview:stubPreview});
  const out=await load(blob),rels=parseXml(await out.file('word/_rels/document.xml.rels').async('string'));
  const ids=Array.from(rels.getElementsByTagNameNS(NS.rel,'Relationship')).map(r=>r.getAttribute('Id'));assert.equal(ids.length,3);assert.equal(new Set(ids).size,3);
  assert.deepEqual(await out.file('word/media/kttt-mathtype-1.png').async('uint8array'),png);
});
