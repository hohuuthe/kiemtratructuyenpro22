import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inflateSync} from 'node:zlib';
import {convertMtefV5ToLatex} from '../src/word-mtef-v5-reader.js';

const packed=JSON.parse(fs.readFileSync(new URL('./fixtures/mathtype-121-corpus.json',import.meta.url),'utf8'));
const corpus=JSON.parse(inflateSync(Buffer.from(packed.deflateBase64,'base64')));
const raw=c=>Buffer.from(c.mtef,'base64');
assert.equal(corpus.length,121);
assert.equal(packed.answers.length,24);
for(const c of corpus)test('121-source corpus: equation '+c.number+' / Q'+c.question+' '+c.field,()=>{
    assert.equal(convertMtefV5ToLatex(raw(c)),c.expected);
});
const h=[5,1,0,6,9,68,83,77,84,52,0,1,10];
const ch=(code,face=3)=>[2,0,128+face,code&255,code>>8];
const line=a=>[1,0,...a,0];
const root=a=>Uint8Array.from([...h,...line(a),0]);
const tmpl=(s,v,slots)=>[3,0,s,v,0,...slots,0];
test('Documented and legacy non-final NULL slot encodings retain the entire exponent',()=>{
    const x=ch(120),two=line(ch(50,8));
    assert.equal(convertMtefV5ToLatex(root([...x,...tmpl(28,0,[1,1,...two])])),'x^{2}');
    assert.equal(convertMtefV5ToLatex(root([...x,...tmpl(28,0,[1,1,0,...two])])),'x^{2}');
    assert.throws(()=>convertMtefV5ToLatex(Uint8Array.from([...root(x),0])));
});
test('Every truncated source in the 121-equation corpus is rejected',()=>{
    for(const c of corpus){const b=raw(c);for(let i=0;i<b.length;i++)
        assert.throws(()=>convertMtefV5ToLatex(b.subarray(0,i)),'equation '+c.number+' cut at '+i);}
});
test('Appended END and appended semantic records are never silently dropped',()=>{
    for(const c of corpus)for(const tail of [[0],[1,1],[2,0,131,120,0,0]])
        assert.throws(()=>convertMtefV5ToLatex(Buffer.concat([raw(c),Buffer.from(tail)])));
});
test('Matrix arity, unknown record, size and operator glyph mismatches fail closed',()=>{
    assert.throws(()=>convertMtefV5ToLatex(root([5,0,3,2,3,1,2,0,0,...line(ch(49,8)),0])),/matrix cell count/);
    assert.throws(()=>convertMtefV5ToLatex(root([5,0,3,2,3,0,2,0,0,0])),/matrix dimensions/);
    assert.throws(()=>convertMtefV5ToLatex(root([99,0])),/unsupported record/);
    assert.throws(()=>convertMtefV5ToLatex(new Uint8Array(96*1024+1)),/stream size/);
    const wrong=tmpl(16,0x43,[...line([]),...line(ch(110)),...line(ch(49,8)),...ch(0x220f,6)]);
    assert.throws(()=>convertMtefV5ToLatex(root(wrong)),/glyph mismatch/);
});
test('Operator slot order is main / upper / lower; integral glyph determines multiplicity',()=>{
    for(const [code,command] of [[0x222b,'int'],[0x222c,'iint'],[0x222d,'iiint']]){
        const t=tmpl(15,3,[...line(ch(120)),...line(ch(49,8)),...line(ch(48,8)),...ch(code,6)]);
        assert.equal(convertMtefV5ToLatex(root(t)),'\\'+command+'_{0}^{1} x');
    }
});
test('Explicit degree in a superscript is not raised a second time',()=>{
    assert.equal(convertMtefV5ToLatex(raw(corpus[87])),'t^{\\circ{}}');
});

// Full mode uses the real application libraries, not mocked renderers or validators.
if(process.env.WORD_IMPORT_FULL_TESTS==='1'){
    const {default:JSZip}=await import('jszip');
    const {inspectScientificDocx}=await import('../src/word-omml-reader.js');
    const {verifyImportedWordQuestions,checkWordImportBeforeSave,validateWordFormulaSourceForImport,
        validateScientificLatexForImport}=await import('../src/word-import-verification.js');
    const {makeWordMathRun}=await import('../src/exam-docx-generator.ts');
    const {Document,Paragraph,Packer}=await import('docx');
    const {Math:WordMath}=await import('docx/math');
    const {readMathTypeOleStream}=await import('../src/word-mathtype-reader.js');
    const END=0xfffffffe,FREE=0xffffffff;
    function ole(mtef){
        const native=Buffer.alloc(28+mtef.length);native.writeUInt16LE(28);native.writeUInt32LE(mtef.length,8);mtef.copy(native,28);
        const minis=Math.ceil(native.length/64),sectors=Math.ceil(minis*64/512);
        assert.ok(minis<128);const b=Buffer.alloc((4+sectors)*512);
        Buffer.from('d0cf11e0a1b11ae1','hex').copy(b);b.writeUInt16LE(0x3e,24);b.writeUInt16LE(3,26);b.writeUInt16LE(0xfffe,28);b.writeUInt16LE(9,30);b.writeUInt16LE(6,32);
        b.writeUInt32LE(1,44);b.writeUInt32LE(1,48);b.writeUInt32LE(4096,56);b.writeUInt32LE(2,60);b.writeUInt32LE(1,64);b.writeUInt32LE(END,68);
        for(let i=0;i<109;i++)b.writeUInt32LE(i===0?0:FREE,76+i*4);
        for(let i=0;i<128;i++){b.writeUInt32LE(FREE,512+i*4);b.writeUInt32LE(FREE,1536+i*4);}
        b.writeUInt32LE(0xfffffffd,512);b.writeUInt32LE(END,516);b.writeUInt32LE(END,520);
        for(let i=0;i<sectors;i++)b.writeUInt32LE(i===sectors-1?END:4+i,512+(3+i)*4);
        for(let i=0;i<minis;i++)b.writeUInt32LE(i===minis-1?END:i+1,1536+i*4);
        function dir(at,name,type,start,size){const t=Buffer.from(name+'\0','utf16le');t.copy(b,at);b.writeUInt16LE(t.length,at+64);b[at+66]=type;b[at+67]=1;for(const p of [68,72,76])b.writeUInt32LE(FREE,at+p);b.writeUInt32LE(start,at+116);b.writeUInt32LE(size,at+120);}
        dir(1024,'Root Entry',5,3,minis*64);b.writeUInt32LE(1,1100);dir(1152,'Equation Native',2,0,native.length);native.copy(b,2048);return b;
    }
    const z=new JSZip(),rels=[],paragraphs=[];
    for(const c of corpus){
        const bytes=raw(c);const embedded=ole(bytes);
        assert.deepEqual(Buffer.from(readMathTypeOleStream(embedded)),bytes);
        z.file('word/embeddings/ole'+c.number+'.bin',embedded);
        rels.push('<Relationship Id="rIdMTOLE'+c.number+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/ole'+c.number+'.bin"/>');
        paragraphs.push('<w:p><w:r><w:object><o:OLEObject ProgID="Equation.DSMT4" r:id="rIdMTOLE'+c.number+'"/></w:object></w:r></w:p>');
    }
    z.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:o="urn:schemas-microsoft-com:office:office"><w:body>'+paragraphs.join('')+'</w:body></w:document>');
    z.file('word/_rels/document.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+rels.join('')+'</Relationships>');
    const report=await inspectScientificDocx(await z.generateAsync({type:'uint8array'}));
    test('Actual DOCX/OLE inspector parses all 121 objects without lost or duplicate tokens',()=>{
        assert.equal(report.formulas.length,121);assert.equal(report.imageCount,0);assert.deepEqual(report.issues,[]);
        assert.equal(new Set(report.formulas.map(f=>f.token)).size,121);
        assert.deepEqual(report.formulas.map(f=>f.latex),corpus.map(c=>c.expected));
        assert.ok(report.formulas.every(f=>f.status==='parsed'&&f.sourceType==='mathtype'));
    });
    const questions=Array.from({length:24},(_,i)=>({id:'mathtype121-q'+(i+1),type:'4-1',level:'NB',content:'Q'+(i+1)+' ',answer:packed.answers[i],options:{A:'',B:'',C:'',D:''}}));
    for(let i=0;i<corpus.length;i++){
        const c=corpus[i],q=questions[c.question-1],token=report.formulas[i].token;
        if(c.field==='content')q.content+=token+' ';else q.options[c.field.slice(7)]+=token;
    }
    test('All 24 questions and 121 equations pass KaTeX, editable Word and server-source save gates',()=>{
        const audited=verifyImportedWordQuestions(questions,report);
        assert.equal(audited.stats.verifiedFormulaObjects,121,JSON.stringify(audited.questions.map(q=>q.__wordImportIssues)));
        assert.equal(audited.stats.pendingQuestions,0);assert.deepEqual(audited.documentIssues,[]);
        assert.deepEqual(audited.questions.map(q=>q.answer),packed.answers);
        const gate=checkWordImportBeforeSave(audited.questions,audited.documentIssues);assert.equal(gate.ok,true,JSON.stringify(gate.errors));
        for(const q of audited.questions)for(const s of q.__wordFormulaSources){
            const v=validateWordFormulaSourceForImport(s);assert.equal(v.ok,true,s.token+': '+v.reason);
        }
        assert.ok(!JSON.stringify(audited.questions.map(q=>[q.content,q.options])).includes('__WMATH_'));
    });
    test('All 121 native equations re-export as editable Word equations and re-import without loss',async()=>{
        const math=corpus.map(c=>{const m=makeWordMathRun(c.expected);assert.ok(m instanceof WordMath,'equation '+c.number);return new Paragraph({children:[m]});});
        const file=await Packer.toBuffer(new Document({sections:[{children:math}]}));
        const again=await inspectScientificDocx(file);assert.equal(again.formulas.length,121);
        assert.deepEqual(again.formulas.filter(f=>f.status!=='parsed').map(f=>({token:f.token,reason:f.reason})),[]);
        for(const f of again.formulas){const v=validateScientificLatexForImport(f.latex);assert.equal(v.ok,true,f.token+': '+v.reason);}
    });
}
