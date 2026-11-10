import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inflateSync} from 'node:zlib';
import JSZip from 'jszip';
import {inspectScientificDocx} from '../src/word-omml-reader.js';
import {convertMtefV5ToLatex,readMathTypeOleStream,verifyMathTypeSource,encodeMathTypeSource} from '../src/word-mathtype-reader.js';
import {readMathTypeWmfSource} from '../src/word-mathtype-preview.js';
import {splitScientificContent} from '../src/scientific-formula-tokenizer.js';

const packed=JSON.parse(fs.readFileSync(new URL('./fixtures/mathtype-dsmt4-corpus.json',import.meta.url),'utf8'));
export const corpus=JSON.parse(inflateSync(Buffer.from(packed.deflateBase64,'base64')));
export const bytes=c=>Buffer.from(c.mtef,'base64');
const END=0xfffffffe,FREE=0xffffffff;
export function ole(mtef){
    const native=Buffer.alloc(28+mtef.length);native.writeUInt16LE(28);native.writeUInt32LE(mtef.length,8);Buffer.from(mtef).copy(native,28);
    const miniCount=Math.ceil(native.length/64),rootSectors=Math.ceil(miniCount*64/512);
    assert.ok(miniCount<128);const b=Buffer.alloc((4+rootSectors)*512);
    Buffer.from('d0cf11e0a1b11ae1','hex').copy(b);b.writeUInt16LE(0x3e,24);b.writeUInt16LE(3,26);b.writeUInt16LE(0xfffe,28);b.writeUInt16LE(9,30);b.writeUInt16LE(6,32);
    b.writeUInt32LE(1,44);b.writeUInt32LE(1,48);b.writeUInt32LE(4096,56);b.writeUInt32LE(2,60);b.writeUInt32LE(1,64);b.writeUInt32LE(END,68);
    for(let i=0;i<109;i++)b.writeUInt32LE(i===0?0:FREE,76+i*4);
    for(let i=0;i<128;i++){b.writeUInt32LE(FREE,512+i*4);b.writeUInt32LE(FREE,1536+i*4);}
    b.writeUInt32LE(0xfffffffd,512);b.writeUInt32LE(END,516);b.writeUInt32LE(END,520);
    for(let i=0;i<rootSectors;i++)b.writeUInt32LE(i===rootSectors-1?END:4+i,512+(3+i)*4);
    for(let i=0;i<miniCount;i++)b.writeUInt32LE(i===miniCount-1?END:i+1,1536+i*4);
    const dir=(at,name,type,start,size)=>{const text=Buffer.from(name+'\0','utf16le');text.copy(b,at);b.writeUInt16LE(text.length,at+64);b[at+66]=type;b[at+67]=1;for(const p of [68,72,76])b.writeUInt32LE(FREE,at+p);b.writeUInt32LE(start,at+116);b.writeUInt32LE(size,at+120);};
    dir(1024,'Root Entry',5,3,miniCount*64);b.writeUInt32LE(1,1100);dir(1152,'Equation Native',2,0,native.length);native.copy(b,2048);return b;
}
export function wmf(mtef){
    const signature=Buffer.from('Design Science, Inc.\0'),data=Buffer.from(mtef);
    const c=Buffer.alloc(18+signature.length+data.length);c.write('AppsMFCC');c.writeUInt16LE(1,8);c.writeUInt32LE(data.length,10);c.writeUInt32LE(data.length,14);signature.copy(c,18);data.copy(c,18+signature.length);
    const rec=Buffer.alloc(10+c.length+(c.length%2));rec.writeUInt32LE(rec.length/2);rec.writeUInt16LE(0x626,4);rec.writeUInt16LE(15,6);rec.writeUInt16LE(c.length,8);c.copy(rec,10);
    const head=Buffer.alloc(18),end=Buffer.alloc(6);head.writeUInt16LE(1);head.writeUInt16LE(9,2);head.writeUInt16LE(0x300,4);head.writeUInt32LE((18+rec.length+6)/2,6);head.writeUInt32LE(rec.length/2,12);end.writeUInt32LE(3);
    return Buffer.concat([head,rec,end]);
}
const wordNs='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const relNs='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageNs='http://schemas.openxmlformats.org/package/2006/relationships';
export async function docx(entries,{progId='Equation.DSMT4',previewOverride=null,previewOverrideIndex=0,omml=''}={}){
    const z=new JSZip(),rels=[],paragraphs=[];
    entries.forEach((entry,i)=>{
        const id=i+1,raw=bytes(entry);z.file('word/embeddings/ole'+id+'.bin',ole(raw));
        z.file('word/media/preview'+id+'.wmf',wmf(previewOverride&&i===previewOverrideIndex?previewOverride:raw));
        rels.push(`<Relationship Id="rId${id*2}" Type="${relNs}/oleObject" Target="embeddings/ole${id}.bin"/>`,`<Relationship Id="rId${id*2+1}" Type="${relNs}/image" Target="media/preview${id}.wmf"/>`);
        paragraphs.push(`<w:p><w:r><w:object><v:shape><v:imagedata r:id="rId${id*2+1}"/></v:shape><o:OLEObject ProgID="${progId}" r:id="rId${id*2}"/></w:object></w:r></w:p>`);
    });
    z.file('word/document.xml',`<w:document xmlns:w="${wordNs}" xmlns:r="${relNs}" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${paragraphs.join('')}${omml}</w:body></w:document>`);
    z.file('word/_rels/document.xml.rels',`<Relationships xmlns="${packageNs}">${rels.join('')}</Relationships>`);
    return z.generateAsync({type:'uint8array'});
}
for(const entry of corpus)test('Real MathType native source #'+entry.number,()=>{
    const raw=bytes(entry),latex=convertMtefV5ToLatex(raw);assert.equal(latex,entry.expected);
    assert.deepEqual(Buffer.from(readMathTypeOleStream(ole(raw))),raw);assert.deepEqual(Buffer.from(readMathTypeWmfSource(wmf(raw))),raw);
    assert.equal(verifyMathTypeSource(encodeMathTypeSource(raw),latex,'verified'),true);
    assert.throws(()=>verifyMathTypeSource(encodeMathTypeSource(raw),latex+'+1','verified'),/kh/);
});
test('DSMT4 integrates all 41 native sources exactly once, without importing previews as images',async()=>{
    const r=await inspectScientificDocx(await docx(corpus));assert.equal(r.formulas.length,41);assert.equal(r.imageCount,0);assert.deepEqual(r.issues,[]);
    assert.deepEqual(r.formulas.map(f=>f.latex),corpus.map(f=>f.expected));assert.ok(r.formulas.every(f=>f.sourceType==='mathtype'&&f.status==='parsed'));
    assert.equal(new Set(r.formulas.map(f=>f.token)).size,41);for(let i=0;i<41;i++)assert.equal(r.lines[i].text,r.formulas[i].token);
});
test('A conflicting WMF equation imports the displayed source and retains both sources',async()=>{
    const native=corpus[10],visual=Buffer.from(packed.conflictingPreviewMtefBase64,'base64');
    assert.equal(convertMtefV5ToLatex(bytes(native)),'(-1;5).');assert.equal(convertMtefV5ToLatex(visual),'0,05.');
    const r=await inspectScientificDocx(await docx([native],{previewOverride:visual}));
    assert.equal(r.formulas[0].status,'review');assert.equal(r.formulas[0].latex,'0,05.');assert.equal(r.formulas[0].sourcePreference,'wmf');
    assert.ok(r.issues.some(i=>i.kind==='formula-notice'&&i.token===r.formulas[0].token));assert.equal(r.lines[0].text,r.formulas[0].token);
    assert.equal(verifyMathTypeSource(r.formulas[0].originalOmml,'0,05.','verified'),true);
    assert.throws(()=>verifyMathTypeSource(r.formulas[0].originalOmml,'(-1;5).','verified'));assert.ok(r.formulas[0].originalOmml.includes('originalOle='));
});
test('All 41 equations import together with the conflicting preview at its actual index',async()=>{
    const r=await inspectScientificDocx(await docx(corpus,{previewOverride:Buffer.from(packed.conflictingPreviewMtefBase64,'base64'),previewOverrideIndex:10}));
    assert.equal(r.formulas.length,41);assert.equal(r.formulas.filter(f=>f.status==='parsed').length,40);assert.equal(r.formulas[10].latex,'0,05.');
    assert.equal(r.formulas.filter(f=>f.sourcePreference==='wmf').length,1);assert.equal(r.issues.filter(i=>i.kind==='formula-notice').length,1);
    const {verifyImportedWordQuestions,checkWordImportBeforeSave,correctImportedWordEquation}=await import('../src/word-import-verification.js');
    const q=r.formulas.map((f,i)=>({id:'import-all-'+i,type:'TL',level:'NB',content:f.token,answer:'1',options:{}}));
    const report=verifyImportedWordQuestions(q,r);assert.equal(report.stats.verifiedFormulaObjects,40);assert.equal(report.stats.pendingQuestions,1);
    assert.equal(report.documentIssues.length,0);assert.equal(checkWordImportBeforeSave(report.questions,report.documentIssues).ok,false);
    assert.equal(report.questions[10].content,r.formulas[10].token);
    correctImportedWordEquation(report.questions[10],r.formulas[10].token,'0,05.');
    assert.equal(checkWordImportBeforeSave(report.questions,report.documentIssues).ok,true);
    assert.equal(report.questions[10].content,'$0,05.
});
test('Other embedded application objects remain unsupported even with a readable MTEF payload',async()=>{
    const r=await inspectScientificDocx(await docx([corpus[0]],{progId:'Excel.Sheet.12'}));assert.equal(r.formulas[0].status,'review');
});
test('Legacy Equation.3 and native OMML remain supported beside MathType',async()=>{
    const omml='<w:p><m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath></w:p>';
    const r=await inspectScientificDocx(await docx([corpus[0]],{progId:'Equation.3',omml}));
    assert.deepEqual(r.formulas.map(f=>f.sourceType),['mathtype','omml']);assert.equal(r.formulas[1].latex,'\\frac{a}{b}');assert.deepEqual(r.issues,[]);
});
test('MT Extra typeface 11 survives DOCX OLE import and replaces the internal WMATH token',async()=>{
    const mtef=Buffer.from([5,1,0,4,0,0,0,1,0,2,0,139,120,0,0,0]);
    const entry={number:'MTEXTRA-11',mtef:mtef.toString('base64'),expected:'x'};
    const r=await inspectScientificDocx(await docx([entry]));
    assert.equal(r.formulas.length,1);
    assert.equal(r.formulas[0].sourceType,'mathtype');
    assert.equal(r.formulas[0].status,'parsed');
    assert.equal(r.formulas[0].latex,'x');
    const {verifyImportedWordQuestions,checkWordImportBeforeSave}=await import('../src/word-import-verification.js');
    const q={id:'mathtype-mtextra-11',type:'TL',level:'NB',content:'Cho tập hợp '+r.formulas[0].token+' và trả lời.',answer:'1',options:{}};
    const verified=verifyImportedWordQuestions([q],r);
    assert.equal(verified.stats.pendingQuestions,0);
    assert.equal(verified.questions[0].content,'Cho tập hợp $x$ và trả lời.');
    assert.ok(!verified.questions[0].content.includes('__WMATH_'));
    assert.equal(checkWordImportBeforeSave(verified.questions,verified.documentIssues).ok,true);
});
test('Pending Word IDs are literal text, while real math stays math',()=>{
    const token='__WMATH_000004__';for(const s of [token,'$'+token+'$','\\('+token+'\\)','A. '+token]){
        const result=splitScientificContent(s);assert.ok(result.every(t=>t.type==='text'));assert.equal(result.map(t=>t.value).join(''),s);}
    const mixed=splitScientificContent('$x_1+y^2$ '+token);assert.equal(mixed[0].type,'math');assert.equal(mixed[0].value,'x_1+y^2');assert.match(mixed[1].value,/__WMATH_/);
    assert.equal(splitScientificContent('x_1+y^2')[0].type,'math');
});
test('Every truncated real MTEF source fails closed',()=>{
    for(const c of corpus){const raw=bytes(c);for(let n=0;n<raw.length;n++)assert.throws(()=>convertMtefV5ToLatex(raw.subarray(0,n)),'source '+c.number+' truncated at '+n);}
});
test('Unknown records, trailing data, fake WMF chunks and resource excess fail closed',()=>{
    const raw=bytes(corpus[0]);assert.throws(()=>convertMtefV5ToLatex(Buffer.concat([raw,Buffer.from([0])])));assert.throws(()=>convertMtefV5ToLatex(Buffer.alloc(96*1024+1)));
    const image=wmf(raw);assert.throws(()=>readMathTypeWmfSource(image.subarray(0,image.length-1)));
    const broken=Buffer.from(image);broken.writeUInt32LE(0xffffffff,18);assert.throws(()=>readMathTypeWmfSource(broken));
    const invalid=Buffer.from(raw);invalid[0]=3;assert.throws(()=>convertMtefV5ToLatex(invalid),/phi\u00ean b\u1ea3n 5/);
});
if(process.env.WORD_IMPORT_FULL_TESTS==='1'){
    const {verifyImportedWordQuestions,validateWordFormulaSourceForImport,checkWordImportBeforeSave,correctImportedWordEquation}=await import('../src/word-import-verification.js');
    test('All 41 native equations pass the actual KaTeX, editable Word and server-source gates',async()=>{
        const r=await inspectScientificDocx(await docx(corpus));const q=r.formulas.map((f,i)=>({id:'mathtype-regression-'+i,type:'TL',level:'NB',content:f.token,answer:'1',options:{}}));
        const result=verifyImportedWordQuestions(q,r);assert.equal(result.stats.verifiedFormulaObjects,41,JSON.stringify(result.questions.map(q=>q.__wordImportIssues)));
        assert.equal(checkWordImportBeforeSave(result.questions,result.documentIssues).ok,true);
        for(const q of result.questions)for(const s of q.__wordFormulaSources)assert.equal(validateWordFormulaSourceForImport(s).ok,true);
    });
    test('Conflicting option uses displayed source without a bogus KaTeX underscore error',async()=>{
        const r=await inspectScientificDocx(await docx([corpus[10]],{previewOverride:Buffer.from(packed.conflictingPreviewMtefBase64,'base64')}));
        const q={id:'mathtype-source-conflict',type:'4-1',level:'NB',content:'Source review',answer:'A',options:{A:'1',B:'2',C:r.formulas[0].token,D:'4'}};
        const result=verifyImportedWordQuestions([q],r);
        assert.equal(result.stats.verifiedFormulaObjects,0);assert.equal(result.stats.pendingQuestions,1);
        assert.equal(checkWordImportBeforeSave(result.questions,result.documentIssues).ok,false);
        correctImportedWordEquation(result.questions[0],r.formulas[0].token,'0,05.');
        assert.equal(result.questions[0].options.C,'$0,05.
        assert.ok(r.issues.some(i=>i.kind==='formula-notice'&&i.reason.includes('OLE')));assert.equal(validateWordFormulaSourceForImport(result.questions[0].__wordFormulaSources[0]).ok,true);
    });
}
test('Latin text with w:bCs only does not invent bold or block import',async()=>{
    const zip=new JSZip(),text='Quy tr\u00f2n s\u1ed1 v\u00e0 \u0111\u00e1p \u00e1n A.';
    zip.file('word/document.xml','<w:document xmlns:w="'+wordNs+'"><w:body><w:p><w:r><w:rPr><w:bCs/></w:rPr><w:t>'+text+'</w:t></w:r></w:p></w:body></w:document>');
    const report=await inspectScientificDocx(await zip.generateAsync({type:'uint8array'}));assert.equal(report.lines[0].text,text);assert.deepEqual(report.issues,[]);
});
test('Complex-script w:bCs-only text retains its explicit verification warning',async()=>{
    const zip=new JSZip(),text='\u0627\u0644\u0639\u0631\u0628\u064a\u0629';
    zip.file('word/document.xml','<w:document xmlns:w="'+wordNs+'"><w:body><w:p><w:r><w:rPr><w:bCs/></w:rPr><w:t>'+text+'</w:t></w:r></w:p></w:body></w:document>');
    const report=await inspectScientificDocx(await zip.generateAsync({type:'uint8array'}));assert.equal(report.lines[0].text,text);assert.ok(report.issues.some(i=>i.kind==='style'&&i.reason.includes('w:bCs')));
});


test('Recover valid WMF MTEF when native OLE is unreadable, but require teacher approval',async()=>{
    const source=corpus[0],z=await JSZip.loadAsync(await docx([source]));
    z.file('word/embeddings/ole1.bin',Buffer.from([0,1,2,3]));
    const report=await inspectScientificDocx(await z.generateAsync({type:'uint8array'}));
    assert.equal(report.formulas.length,1);
    assert.equal(report.formulas[0].status,'review');
    assert.equal(report.formulas[0].sourceType,'mathtype');
    assert.equal(report.formulas[0].sourcePreference,'wmf-recovery');
    assert.equal(report.formulas[0].latex,source.expected);
    assert.ok(report.issues.some(i=>i.kind==='formula-notice'&&/cần giáo viên/.test(i.reason)));
    const {verifyImportedWordQuestions,checkWordImportBeforeSave,correctImportedWordEquation,
        validateWordFormulaSourceForImport}=await import('../src/word-import-verification.js');
    const raw={id:'wmf-recovered-review',type:'TL',level:'NB',
        content:'Câu hỏi '+report.formulas[0].token,answer:'1',options:{}};
    const review=verifyImportedWordQuestions([raw],report);
    assert.equal(review.stats.pendingQuestions,1);
    assert.equal(checkWordImportBeforeSave(review.questions,review.documentIssues).ok,false);
    const approved=correctImportedWordEquation(review.questions[0],report.formulas[0].token,source.expected);
    assert.equal(approved.__wordFormulaSources[0].status,'manual_verified');
    assert.equal(validateWordFormulaSourceForImport(approved.__wordFormulaSources[0]).ok,true);
    assert.equal(checkWordImportBeforeSave([approved],review.documentIssues).ok,true);
});
test('Broken WMF preview cannot mask a valid OLE equation',async()=>{
    const z=await JSZip.loadAsync(await docx([corpus[0]]));
    z.file('word/media/preview1.wmf',Buffer.from([0,1,2,3]));
    const report=await inspectScientificDocx(await z.generateAsync({type:'uint8array'}));
    assert.equal(report.formulas.length,1);
    assert.equal(report.formulas[0].status,'parsed');
    assert.equal(report.formulas[0].sourcePreference,'ole');
    assert.equal(report.formulas[0].latex,corpus[0].expected);
    assert.equal(report.issues.filter(i=>i.kind==='formula').length,0);
});
test('Unambiguous standard Unicode MTCode symbols decode even with MathType symbol face',()=>{
    for(const [code,command] of [[0x2220,'\\angle{}'],[0x221d,'\\propto{}'],
        [0x2261,'\\equiv{}'],[0x2234,'\\therefore{}'],[0x03c2,'\\varsigma{}']]){
        const b=Uint8Array.from([5,1,0,4,0,0,0,1,0,2,0,150,code&255,code>>8,0,0]);
        assert.equal(convertMtefV5ToLatex(b),command);
    }
    const arbitraryPrivate=Uint8Array.from([5,1,0,4,0,0,0,1,0,2,0,150,0x01,0xe0,0,0]);
    assert.throws(()=>convertMtefV5ToLatex(arbitraryPrivate),/unmapped MTCode/);
});
);
});
test('Other embedded application objects remain unsupported even with a readable MTEF payload',async()=>{
    const r=await inspectScientificDocx(await docx([corpus[0]],{progId:'Excel.Sheet.12'}));assert.equal(r.formulas[0].status,'review');
});
test('Legacy Equation.3 and native OMML remain supported beside MathType',async()=>{
    const omml='<w:p><m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath></w:p>';
    const r=await inspectScientificDocx(await docx([corpus[0]],{progId:'Equation.3',omml}));
    assert.deepEqual(r.formulas.map(f=>f.sourceType),['mathtype','omml']);assert.equal(r.formulas[1].latex,'\\frac{a}{b}');assert.deepEqual(r.issues,[]);
});
test('MT Extra typeface 11 survives DOCX OLE import and replaces the internal WMATH token',async()=>{
    const mtef=Buffer.from([5,1,0,4,0,0,0,1,0,2,0,139,120,0,0,0]);
    const entry={number:'MTEXTRA-11',mtef:mtef.toString('base64'),expected:'x'};
    const r=await inspectScientificDocx(await docx([entry]));
    assert.equal(r.formulas.length,1);
    assert.equal(r.formulas[0].sourceType,'mathtype');
    assert.equal(r.formulas[0].status,'parsed');
    assert.equal(r.formulas[0].latex,'x');
    const {verifyImportedWordQuestions,checkWordImportBeforeSave}=await import('../src/word-import-verification.js');
    const q={id:'mathtype-mtextra-11',type:'TL',level:'NB',content:'Cho tập hợp '+r.formulas[0].token+' và trả lời.',answer:'1',options:{}};
    const verified=verifyImportedWordQuestions([q],r);
    assert.equal(verified.stats.pendingQuestions,0);
    assert.equal(verified.questions[0].content,'Cho tập hợp $x$ và trả lời.');
    assert.ok(!verified.questions[0].content.includes('__WMATH_'));
    assert.equal(checkWordImportBeforeSave(verified.questions,verified.documentIssues).ok,true);
});
test('Pending Word IDs are literal text, while real math stays math',()=>{
    const token='__WMATH_000004__';for(const s of [token,'$'+token+'$','\\('+token+'\\)','A. '+token]){
        const result=splitScientificContent(s);assert.ok(result.every(t=>t.type==='text'));assert.equal(result.map(t=>t.value).join(''),s);}
    const mixed=splitScientificContent('$x_1+y^2$ '+token);assert.equal(mixed[0].type,'math');assert.equal(mixed[0].value,'x_1+y^2');assert.match(mixed[1].value,/__WMATH_/);
    assert.equal(splitScientificContent('x_1+y^2')[0].type,'math');
});
test('Every truncated real MTEF source fails closed',()=>{
    for(const c of corpus){const raw=bytes(c);for(let n=0;n<raw.length;n++)assert.throws(()=>convertMtefV5ToLatex(raw.subarray(0,n)),'source '+c.number+' truncated at '+n);}
});
test('Unknown records, trailing data, fake WMF chunks and resource excess fail closed',()=>{
    const raw=bytes(corpus[0]);assert.throws(()=>convertMtefV5ToLatex(Buffer.concat([raw,Buffer.from([0])])));assert.throws(()=>convertMtefV5ToLatex(Buffer.alloc(96*1024+1)));
    const image=wmf(raw);assert.throws(()=>readMathTypeWmfSource(image.subarray(0,image.length-1)));
    const broken=Buffer.from(image);broken.writeUInt32LE(0xffffffff,18);assert.throws(()=>readMathTypeWmfSource(broken));
    const invalid=Buffer.from(raw);invalid[0]=3;assert.throws(()=>convertMtefV5ToLatex(invalid),/phi\u00ean b\u1ea3n 5/);
});
if(process.env.WORD_IMPORT_FULL_TESTS==='1'){
    const {verifyImportedWordQuestions,validateWordFormulaSourceForImport,checkWordImportBeforeSave,correctImportedWordEquation}=await import('../src/word-import-verification.js');
    test('All 41 native equations pass the actual KaTeX, editable Word and server-source gates',async()=>{
        const r=await inspectScientificDocx(await docx(corpus));const q=r.formulas.map((f,i)=>({id:'mathtype-regression-'+i,type:'TL',level:'NB',content:f.token,answer:'1',options:{}}));
        const result=verifyImportedWordQuestions(q,r);assert.equal(result.stats.verifiedFormulaObjects,41,JSON.stringify(result.questions.map(q=>q.__wordImportIssues)));
        assert.equal(checkWordImportBeforeSave(result.questions,result.documentIssues).ok,true);
        for(const q of result.questions)for(const s of q.__wordFormulaSources)assert.equal(validateWordFormulaSourceForImport(s).ok,true);
    });
    test('Conflicting option uses displayed source without a bogus KaTeX underscore error',async()=>{
        const r=await inspectScientificDocx(await docx([corpus[10]],{previewOverride:Buffer.from(packed.conflictingPreviewMtefBase64,'base64')}));
        const q={id:'mathtype-source-conflict',type:'4-1',level:'NB',content:'Source review',answer:'A',options:{A:'1',B:'2',C:r.formulas[0].token,D:'4'}};
        const result=verifyImportedWordQuestions([q],r);assert.deepEqual(result.questions[0].__wordImportIssues,[]);assert.equal(result.questions[0].options.C,'$0,05.$');
        assert.equal(result.stats.verifiedFormulaObjects,1);assert.equal(checkWordImportBeforeSave(result.questions,result.documentIssues).ok,true);
        assert.ok(r.issues.some(i=>i.kind==='formula-notice'&&i.reason.includes('OLE')));assert.equal(validateWordFormulaSourceForImport(result.questions[0].__wordFormulaSources[0]).ok,true);
    });
}
test('Latin text with w:bCs only does not invent bold or block import',async()=>{
    const zip=new JSZip(),text='Quy tr\u00f2n s\u1ed1 v\u00e0 \u0111\u00e1p \u00e1n A.';
    zip.file('word/document.xml','<w:document xmlns:w="'+wordNs+'"><w:body><w:p><w:r><w:rPr><w:bCs/></w:rPr><w:t>'+text+'</w:t></w:r></w:p></w:body></w:document>');
    const report=await inspectScientificDocx(await zip.generateAsync({type:'uint8array'}));assert.equal(report.lines[0].text,text);assert.deepEqual(report.issues,[]);
});
test('Complex-script w:bCs-only text retains its explicit verification warning',async()=>{
    const zip=new JSZip(),text='\u0627\u0644\u0639\u0631\u0628\u064a\u0629';
    zip.file('word/document.xml','<w:document xmlns:w="'+wordNs+'"><w:body><w:p><w:r><w:rPr><w:bCs/></w:rPr><w:t>'+text+'</w:t></w:r></w:p></w:body></w:document>');
    const report=await inspectScientificDocx(await zip.generateAsync({type:'uint8array'}));assert.equal(report.lines[0].text,text);assert.ok(report.issues.some(i=>i.kind==='style'&&i.reason.includes('w:bCs')));
});


test('Recover valid WMF MTEF when native OLE is unreadable, but require teacher approval',async()=>{
    const source=corpus[0],z=await JSZip.loadAsync(await docx([source]));
    z.file('word/embeddings/ole1.bin',Buffer.from([0,1,2,3]));
    const report=await inspectScientificDocx(await z.generateAsync({type:'uint8array'}));
    assert.equal(report.formulas.length,1);
    assert.equal(report.formulas[0].status,'review');
    assert.equal(report.formulas[0].sourceType,'mathtype');
    assert.equal(report.formulas[0].sourcePreference,'wmf-recovery');
    assert.equal(report.formulas[0].latex,source.expected);
    assert.ok(report.issues.some(i=>i.kind==='formula-notice'&&/cần giáo viên/.test(i.reason)));
    const {verifyImportedWordQuestions,checkWordImportBeforeSave,correctImportedWordEquation,
        validateWordFormulaSourceForImport}=await import('../src/word-import-verification.js');
    const raw={id:'wmf-recovered-review',type:'TL',level:'NB',
        content:'Câu hỏi '+report.formulas[0].token,answer:'1',options:{}};
    const review=verifyImportedWordQuestions([raw],report);
    assert.equal(review.stats.pendingQuestions,1);
    assert.equal(checkWordImportBeforeSave(review.questions,review.documentIssues).ok,false);
    const approved=correctImportedWordEquation(review.questions[0],report.formulas[0].token,source.expected);
    assert.equal(approved.__wordFormulaSources[0].status,'manual_verified');
    assert.equal(validateWordFormulaSourceForImport(approved.__wordFormulaSources[0]).ok,true);
    assert.equal(checkWordImportBeforeSave([approved],review.documentIssues).ok,true);
});
test('Broken WMF preview cannot mask a valid OLE equation',async()=>{
    const z=await JSZip.loadAsync(await docx([corpus[0]]));
    z.file('word/media/preview1.wmf',Buffer.from([0,1,2,3]));
    const report=await inspectScientificDocx(await z.generateAsync({type:'uint8array'}));
    assert.equal(report.formulas.length,1);
    assert.equal(report.formulas[0].status,'parsed');
    assert.equal(report.formulas[0].sourcePreference,'ole');
    assert.equal(report.formulas[0].latex,corpus[0].expected);
    assert.equal(report.issues.filter(i=>i.kind==='formula').length,0);
});
test('Unambiguous standard Unicode MTCode symbols decode even with MathType symbol face',()=>{
    for(const [code,command] of [[0x2220,'\\angle{}'],[0x221d,'\\propto{}'],
        [0x2261,'\\equiv{}'],[0x2234,'\\therefore{}'],[0x03c2,'\\varsigma{}']]){
        const b=Uint8Array.from([5,1,0,4,0,0,0,1,0,2,0,150,code&255,code>>8,0,0]);
        assert.equal(convertMtefV5ToLatex(b),command);
    }
    const arbitraryPrivate=Uint8Array.from([5,1,0,4,0,0,0,1,0,2,0,150,0x01,0xe0,0,0]);
    assert.throws(()=>convertMtefV5ToLatex(arbitraryPrivate),/unmapped MTCode/);
});
);
        assert.equal(checkWordImportBeforeSave(result.questions,result.documentIssues).ok,true);
        assert.ok(r.issues.some(i=>i.kind==='formula-notice'&&i.reason.includes('OLE')));assert.equal(validateWordFormulaSourceForImport(result.questions[0].__wordFormulaSources[0]).ok,true);
    });
}
test('Latin text with w:bCs only does not invent bold or block import',async()=>{
    const zip=new JSZip(),text='Quy tr\u00f2n s\u1ed1 v\u00e0 \u0111\u00e1p \u00e1n A.';
    zip.file('word/document.xml','<w:document xmlns:w="'+wordNs+'"><w:body><w:p><w:r><w:rPr><w:bCs/></w:rPr><w:t>'+text+'</w:t></w:r></w:p></w:body></w:document>');
    const report=await inspectScientificDocx(await zip.generateAsync({type:'uint8array'}));assert.equal(report.lines[0].text,text);assert.deepEqual(report.issues,[]);
});
test('Complex-script w:bCs-only text retains its explicit verification warning',async()=>{
    const zip=new JSZip(),text='\u0627\u0644\u0639\u0631\u0628\u064a\u0629';
    zip.file('word/document.xml','<w:document xmlns:w="'+wordNs+'"><w:body><w:p><w:r><w:rPr><w:bCs/></w:rPr><w:t>'+text+'</w:t></w:r></w:p></w:body></w:document>');
    const report=await inspectScientificDocx(await zip.generateAsync({type:'uint8array'}));assert.equal(report.lines[0].text,text);assert.ok(report.issues.some(i=>i.kind==='style'&&i.reason.includes('w:bCs')));
});


test('Recover valid WMF MTEF when native OLE is unreadable, but require teacher approval',async()=>{
    const source=corpus[0],z=await JSZip.loadAsync(await docx([source]));
    z.file('word/embeddings/ole1.bin',Buffer.from([0,1,2,3]));
    const report=await inspectScientificDocx(await z.generateAsync({type:'uint8array'}));
    assert.equal(report.formulas.length,1);
    assert.equal(report.formulas[0].status,'review');
    assert.equal(report.formulas[0].sourceType,'mathtype');
    assert.equal(report.formulas[0].sourcePreference,'wmf-recovery');
    assert.equal(report.formulas[0].latex,source.expected);
    assert.ok(report.issues.some(i=>i.kind==='formula-notice'&&/cần giáo viên/.test(i.reason)));
    const {verifyImportedWordQuestions,checkWordImportBeforeSave,correctImportedWordEquation,
        validateWordFormulaSourceForImport}=await import('../src/word-import-verification.js');
    const raw={id:'wmf-recovered-review',type:'TL',level:'NB',
        content:'Câu hỏi '+report.formulas[0].token,answer:'1',options:{}};
    const review=verifyImportedWordQuestions([raw],report);
    assert.equal(review.stats.pendingQuestions,1);
    assert.equal(checkWordImportBeforeSave(review.questions,review.documentIssues).ok,false);
    const approved=correctImportedWordEquation(review.questions[0],report.formulas[0].token,source.expected);
    assert.equal(approved.__wordFormulaSources[0].status,'manual_verified');
    assert.equal(validateWordFormulaSourceForImport(approved.__wordFormulaSources[0]).ok,true);
    assert.equal(checkWordImportBeforeSave([approved],review.documentIssues).ok,true);
});
test('Broken WMF preview cannot mask a valid OLE equation',async()=>{
    const z=await JSZip.loadAsync(await docx([corpus[0]]));
    z.file('word/media/preview1.wmf',Buffer.from([0,1,2,3]));
    const report=await inspectScientificDocx(await z.generateAsync({type:'uint8array'}));
    assert.equal(report.formulas.length,1);
    assert.equal(report.formulas[0].status,'parsed');
    assert.equal(report.formulas[0].sourcePreference,'ole');
    assert.equal(report.formulas[0].latex,corpus[0].expected);
    assert.equal(report.issues.filter(i=>i.kind==='formula').length,0);
});
test('Unambiguous standard Unicode MTCode symbols decode even with MathType symbol face',()=>{
    for(const [code,command] of [[0x2220,'\\angle{}'],[0x221d,'\\propto{}'],
        [0x2261,'\\equiv{}'],[0x2234,'\\therefore{}'],[0x03c2,'\\varsigma{}']]){
        const b=Uint8Array.from([5,1,0,4,0,0,0,1,0,2,0,150,code&255,code>>8,0,0]);
        assert.equal(convertMtefV5ToLatex(b),command);
    }
    const arbitraryPrivate=Uint8Array.from([5,1,0,4,0,0,0,1,0,2,0,150,0x01,0xe0,0,0]);
    assert.throws(()=>convertMtefV5ToLatex(arbitraryPrivate),/unmapped MTCode/);
});
);
});
test('Other embedded application objects remain unsupported even with a readable MTEF payload',async()=>{
    const r=await inspectScientificDocx(await docx([corpus[0]],{progId:'Excel.Sheet.12'}));assert.equal(r.formulas[0].status,'review');
});
test('Legacy Equation.3 and native OMML remain supported beside MathType',async()=>{
    const omml='<w:p><m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath></w:p>';
    const r=await inspectScientificDocx(await docx([corpus[0]],{progId:'Equation.3',omml}));
    assert.deepEqual(r.formulas.map(f=>f.sourceType),['mathtype','omml']);assert.equal(r.formulas[1].latex,'\\frac{a}{b}');assert.deepEqual(r.issues,[]);
});
test('MT Extra typeface 11 survives DOCX OLE import and replaces the internal WMATH token',async()=>{
    const mtef=Buffer.from([5,1,0,4,0,0,0,1,0,2,0,139,120,0,0,0]);
    const entry={number:'MTEXTRA-11',mtef:mtef.toString('base64'),expected:'x'};
    const r=await inspectScientificDocx(await docx([entry]));
    assert.equal(r.formulas.length,1);
    assert.equal(r.formulas[0].sourceType,'mathtype');
    assert.equal(r.formulas[0].status,'parsed');
    assert.equal(r.formulas[0].latex,'x');
    const {verifyImportedWordQuestions,checkWordImportBeforeSave}=await import('../src/word-import-verification.js');
    const q={id:'mathtype-mtextra-11',type:'TL',level:'NB',content:'Cho tập hợp '+r.formulas[0].token+' và trả lời.',answer:'1',options:{}};
    const verified=verifyImportedWordQuestions([q],r);
    assert.equal(verified.stats.pendingQuestions,0);
    assert.equal(verified.questions[0].content,'Cho tập hợp $x$ và trả lời.');
    assert.ok(!verified.questions[0].content.includes('__WMATH_'));
    assert.equal(checkWordImportBeforeSave(verified.questions,verified.documentIssues).ok,true);
});
test('Pending Word IDs are literal text, while real math stays math',()=>{
    const token='__WMATH_000004__';for(const s of [token,'$'+token+'$','\\('+token+'\\)','A. '+token]){
        const result=splitScientificContent(s);assert.ok(result.every(t=>t.type==='text'));assert.equal(result.map(t=>t.value).join(''),s);}
    const mixed=splitScientificContent('$x_1+y^2$ '+token);assert.equal(mixed[0].type,'math');assert.equal(mixed[0].value,'x_1+y^2');assert.match(mixed[1].value,/__WMATH_/);
    assert.equal(splitScientificContent('x_1+y^2')[0].type,'math');
});
test('Every truncated real MTEF source fails closed',()=>{
    for(const c of corpus){const raw=bytes(c);for(let n=0;n<raw.length;n++)assert.throws(()=>convertMtefV5ToLatex(raw.subarray(0,n)),'source '+c.number+' truncated at '+n);}
});
test('Unknown records, trailing data, fake WMF chunks and resource excess fail closed',()=>{
    const raw=bytes(corpus[0]);assert.throws(()=>convertMtefV5ToLatex(Buffer.concat([raw,Buffer.from([0])])));assert.throws(()=>convertMtefV5ToLatex(Buffer.alloc(96*1024+1)));
    const image=wmf(raw);assert.throws(()=>readMathTypeWmfSource(image.subarray(0,image.length-1)));
    const broken=Buffer.from(image);broken.writeUInt32LE(0xffffffff,18);assert.throws(()=>readMathTypeWmfSource(broken));
    const invalid=Buffer.from(raw);invalid[0]=3;assert.throws(()=>convertMtefV5ToLatex(invalid),/phi\u00ean b\u1ea3n 5/);
});
if(process.env.WORD_IMPORT_FULL_TESTS==='1'){
    const {verifyImportedWordQuestions,validateWordFormulaSourceForImport,checkWordImportBeforeSave,correctImportedWordEquation}=await import('../src/word-import-verification.js');
    test('All 41 native equations pass the actual KaTeX, editable Word and server-source gates',async()=>{
        const r=await inspectScientificDocx(await docx(corpus));const q=r.formulas.map((f,i)=>({id:'mathtype-regression-'+i,type:'TL',level:'NB',content:f.token,answer:'1',options:{}}));
        const result=verifyImportedWordQuestions(q,r);assert.equal(result.stats.verifiedFormulaObjects,41,JSON.stringify(result.questions.map(q=>q.__wordImportIssues)));
        assert.equal(checkWordImportBeforeSave(result.questions,result.documentIssues).ok,true);
        for(const q of result.questions)for(const s of q.__wordFormulaSources)assert.equal(validateWordFormulaSourceForImport(s).ok,true);
    });
    test('Conflicting option uses displayed source without a bogus KaTeX underscore error',async()=>{
        const r=await inspectScientificDocx(await docx([corpus[10]],{previewOverride:Buffer.from(packed.conflictingPreviewMtefBase64,'base64')}));
        const q={id:'mathtype-source-conflict',type:'4-1',level:'NB',content:'Source review',answer:'A',options:{A:'1',B:'2',C:r.formulas[0].token,D:'4'}};
        const result=verifyImportedWordQuestions([q],r);assert.deepEqual(result.questions[0].__wordImportIssues,[]);assert.equal(result.questions[0].options.C,'$0,05.$');
        assert.equal(result.stats.verifiedFormulaObjects,1);assert.equal(checkWordImportBeforeSave(result.questions,result.documentIssues).ok,true);
        assert.ok(r.issues.some(i=>i.kind==='formula-notice'&&i.reason.includes('OLE')));assert.equal(validateWordFormulaSourceForImport(result.questions[0].__wordFormulaSources[0]).ok,true);
    });
}
test('Latin text with w:bCs only does not invent bold or block import',async()=>{
    const zip=new JSZip(),text='Quy tr\u00f2n s\u1ed1 v\u00e0 \u0111\u00e1p \u00e1n A.';
    zip.file('word/document.xml','<w:document xmlns:w="'+wordNs+'"><w:body><w:p><w:r><w:rPr><w:bCs/></w:rPr><w:t>'+text+'</w:t></w:r></w:p></w:body></w:document>');
    const report=await inspectScientificDocx(await zip.generateAsync({type:'uint8array'}));assert.equal(report.lines[0].text,text);assert.deepEqual(report.issues,[]);
});
test('Complex-script w:bCs-only text retains its explicit verification warning',async()=>{
    const zip=new JSZip(),text='\u0627\u0644\u0639\u0631\u0628\u064a\u0629';
    zip.file('word/document.xml','<w:document xmlns:w="'+wordNs+'"><w:body><w:p><w:r><w:rPr><w:bCs/></w:rPr><w:t>'+text+'</w:t></w:r></w:p></w:body></w:document>');
    const report=await inspectScientificDocx(await zip.generateAsync({type:'uint8array'}));assert.equal(report.lines[0].text,text);assert.ok(report.issues.some(i=>i.kind==='style'&&i.reason.includes('w:bCs')));
});


test('Recover valid WMF MTEF when native OLE is unreadable, but require teacher approval',async()=>{
    const source=corpus[0],z=await JSZip.loadAsync(await docx([source]));
    z.file('word/embeddings/ole1.bin',Buffer.from([0,1,2,3]));
    const report=await inspectScientificDocx(await z.generateAsync({type:'uint8array'}));
    assert.equal(report.formulas.length,1);
    assert.equal(report.formulas[0].status,'review');
    assert.equal(report.formulas[0].sourceType,'mathtype');
    assert.equal(report.formulas[0].sourcePreference,'wmf-recovery');
    assert.equal(report.formulas[0].latex,source.expected);
    assert.ok(report.issues.some(i=>i.kind==='formula-notice'&&/cần giáo viên/.test(i.reason)));
    const {verifyImportedWordQuestions,checkWordImportBeforeSave,correctImportedWordEquation,
        validateWordFormulaSourceForImport}=await import('../src/word-import-verification.js');
    const raw={id:'wmf-recovered-review',type:'TL',level:'NB',
        content:'Câu hỏi '+report.formulas[0].token,answer:'1',options:{}};
    const review=verifyImportedWordQuestions([raw],report);
    assert.equal(review.stats.pendingQuestions,1);
    assert.equal(checkWordImportBeforeSave(review.questions,review.documentIssues).ok,false);
    const approved=correctImportedWordEquation(review.questions[0],report.formulas[0].token,source.expected);
    assert.equal(approved.__wordFormulaSources[0].status,'manual_verified');
    assert.equal(validateWordFormulaSourceForImport(approved.__wordFormulaSources[0]).ok,true);
    assert.equal(checkWordImportBeforeSave([approved],review.documentIssues).ok,true);
});
test('Broken WMF preview cannot mask a valid OLE equation',async()=>{
    const z=await JSZip.loadAsync(await docx([corpus[0]]));
    z.file('word/media/preview1.wmf',Buffer.from([0,1,2,3]));
    const report=await inspectScientificDocx(await z.generateAsync({type:'uint8array'}));
    assert.equal(report.formulas.length,1);
    assert.equal(report.formulas[0].status,'parsed');
    assert.equal(report.formulas[0].sourcePreference,'ole');
    assert.equal(report.formulas[0].latex,corpus[0].expected);
    assert.equal(report.issues.filter(i=>i.kind==='formula').length,0);
});
test('Unambiguous standard Unicode MTCode symbols decode even with MathType symbol face',()=>{
    for(const [code,command] of [[0x2220,'\\angle{}'],[0x221d,'\\propto{}'],
        [0x2261,'\\equiv{}'],[0x2234,'\\therefore{}'],[0x03c2,'\\varsigma{}']]){
        const b=Uint8Array.from([5,1,0,4,0,0,0,1,0,2,0,150,code&255,code>>8,0,0]);
        assert.equal(convertMtefV5ToLatex(b),command);
    }
    const arbitraryPrivate=Uint8Array.from([5,1,0,4,0,0,0,1,0,2,0,150,0x01,0xe0,0,0]);
    assert.throws(()=>convertMtefV5ToLatex(arbitraryPrivate),/unmapped MTCode/);
});
