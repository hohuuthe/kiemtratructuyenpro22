import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { Math as WordMath } from 'docx/math';
import { makeWordMathRun } from '../src/exam-docx-generator.ts';
import { DOMParser } from '@xmldom/xmldom';
import { inspectScientificDocx, convertOmmlToLatex } from '../src/word-omml-reader.js';
import { verifyImportedWordQuestions, checkWordImportBeforeSave, validateScientificLatexForImport, correctImportedWordEquation } from '../src/word-import-verification.js';

const pre='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '+
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '+
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '+
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>';
const post='</w:body></w:document>';
const p = t => '<w:p><w:r><w:t xml:space="preserve">'+t+'</w:t></w:r></w:p>';
const eqFraction='<m:oMath><m:f>'+
    '<m:num><m:e><m:r><m:t>f(x+h)-f(x)</m:t></m:r></m:e></m:num>'+
    '<m:den><m:e><m:r><m:t>h</m:t></m:r></m:e></m:den>'+
    '</m:f></m:oMath>';
const eqMatrix='<m:oMath><m:m>'+
    '<m:mr><m:e><m:r><m:t>1</m:t></m:r></m:e><m:e><m:r><m:t>2</m:t></m:r></m:e></m:mr>'+
    '<m:mr><m:e><m:r><m:t>3</m:t></m:r></m:e><m:e><m:r><m:t>4</m:t></m:r></m:e></m:mr>'+
    '</m:m></m:oMath>';
const prefix='<w:p><w:r><w:t>Câu 1: [BÀI 1][NB][TL] Tính </w:t></w:r>';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==';
async function fixture(parts, options={}) {
    const zip=new JSZip();
    zip.file('word/document.xml',pre+parts+post);
    if(options.images) {
        zip.file('word/_rels/document.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
            '<Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/tiny.png"/></Relationships>');
        zip.file('word/media/tiny.png',png,{base64:true});
    }
    return zip.generateAsync({type:'uint8array'});
}
test('Direct OOXML reader preserves denominator, order, superscript and matrix',async()=>{
    const data=await fixture(prefix+eqFraction+'<w:r><w:t>?</w:t></w:r></w:p>'+
        p('Đáp án: h')+
        '<w:p>'+eqMatrix+'</w:p>');
    const result=await inspectScientificDocx(data);
    assert.equal(result.formulas.length,2);
    assert.equal(result.issues.length,0);
    assert.match(result.formulas[0].latex,/\\frac\{f\(x\+h\)-f\(x\)\}\{h\}/);
    assert.match(result.formulas[1].latex,/\\begin\{matrix\}1 & 2 \\\\ 3 & 4\\end\{matrix\}/);
    assert.equal(result.lines.length,3);
    assert.ok(result.lines[0].text.includes('__WMATH_000001__'));
    assert.ok(result.lines[2].text.includes('__WMATH_000002__'));
    assert.ok(!result.lines[0].text.includes('__WMATH_000002__'));
});
test('Word Equation becomes verified LaTeX in questions; source OMML stays available for audit',async()=>{
    const report=await inspectScientificDocx(await fixture(prefix+eqFraction+'</w:p>'+p('Đáp án: A')));
    const q={id:'question0001',type:'TL',level:'NB',lesson:'BÀI 1',
        content:report.lines[0].text.replace(/^Câu 1: \[BÀI 1\]\[NB\]\[TL\]/,'').trim(),answer:'A',options:{}};
    const audited=verifyImportedWordQuestions([q],report);
    assert.equal(audited.questions.length,1);
    assert.equal(audited.stats.totalFormulaObjects,1);
    assert.equal(audited.stats.verifiedFormulaObjects,1);
    assert.ok(audited.questions[0].content.includes('$\\frac{'));
    assert.ok(!audited.questions[0].content.includes('__WMATH_'));
    assert.match(audited.questions[0].__wordFormulaSources[0].sourceOmml,/<m:f>/);
    assert.ok(checkWordImportBeforeSave(audited.questions,audited.documentIssues).ok);
});
test('Unsupported OMML is held for review, never silently converted or dropped',async()=>{
    const unsupported='<m:oMath><m:phant><m:e><m:r><m:t>x</m:t></m:r></m:e></m:phant></m:oMath>';
    const report=await inspectScientificDocx(await fixture(prefix+unsupported+'</w:p>'+p('Đáp án: A')));
    assert.equal(report.formulas.length,1);
    assert.equal(report.formulas[0].status,'review');
    const q={id:'question0002',type:'TL',level:'NB',lesson:'BÀI 1',content:report.lines[0].text,answer:'A'};
    const reviewed=verifyImportedWordQuestions([q],report);
    assert.equal(reviewed.questions[0].__wordImportIssues.length,1);
    assert.equal(reviewed.stats.pendingQuestions,1);
    const fail=checkWordImportBeforeSave(reviewed.questions,reviewed.documentIssues);
    assert.equal(fail.ok,false);
    assert.ok(fail.errors.some(error=>error.includes('Word chưa chuyển đổi')));
});
test('Unsupported embedded equation or source error cannot be silently approved',async()=>{
    const ole='<w:p><w:object><o:OLEObject xmlns:o="urn:schemas-microsoft-com:office:office" ProgID="Equation.3" /></w:object></w:p>';
    const report=await inspectScientificDocx(await fixture(p('Câu 1: [BÀI 1][NB][TL]')+ole+p('Đáp án: A')));
    assert.equal(report.formulas[0].sourceType,'embedded');
    assert.equal(report.formulas[0].status,'review');
    assert.ok(report.lines.some(x=>x.text.includes('__WMATH_')));
});
test('Inline formatted superscript/subscript stays in original order, not OCR or guessed chemistry',async()=>{
    const markup='<w:p><w:r><w:t>H</w:t></w:r><w:r><w:rPr>'+
        '<w:vertAlign w:val="subscript"/></w:rPr><w:t>2</w:t></w:r><w:r><w:t>O</w:t></w:r></w:p>';
    const report=await inspectScientificDocx(await fixture(markup));
    assert.equal(report.lines[0].text,'H<sub>2</sub>O');
});
test('Embedded image relationship resolves exact raster bytes; two images flag a document blocker',async()=>{
    const image='<w:drawing><a:blip r:embed="rId8"/></w:drawing>';
    const report=await inspectScientificDocx(await fixture('<w:p>'+image+'</w:p>',{images:true}));
    assert.match(report.lines[0].image,/^data:image\/png;base64,/);
    assert.equal(report.imageCount,1);
    const duplicate=await inspectScientificDocx(await fixture('<w:p>'+image+image+'</w:p>',{images:true}));
    assert.ok(duplicate.issues.some(i=>i.kind==='image'));
    assert.equal(duplicate.lines[0].images.length,2);
});
test('Chemistry and scientific units validate with Word-native editor even when KaTeX lacks mhchem',()=>{
    assert.equal(validateScientificLatexForImport('\\ce{H2SO4}').ok,true);
    assert.equal(validateScientificLatexForImport('\\ce{2H2 + O2 -> 2H2O}').ok,true);
    assert.equal(validateScientificLatexForImport('\\ce{SO4^{2-}}').ok,true);
    assert.equal(validateScientificLatexForImport('\\pu{123 kJ*mol-1}').ok,true);
    assert.equal(validateScientificLatexForImport('\\ce{H2O').ok,false);
});

test('Malformed formulas and invalid question fields fail strict gate',()=>{
    assert.equal(validateScientificLatexForImport('\\frac{f(x+h)-f(x)}').ok,false);
    assert.equal(validateScientificLatexForImport('\\frac{f(x+h)-f(x)}{h}').ok,true);
    const q={id:'question003',type:'INVALID',level:'NB',content:'Tính $\\frac{a}$',answer:'A'};
    const result=checkWordImportBeforeSave([q],[]);
    assert.equal(result.ok,false);
    assert.ok(result.errors.some(x=>/phân loại/.test(x)));
});
test('DOCX without document.xml and oversized file fail closed',async()=>{
    const zipped=new JSZip();zipped.file('foo.txt','bar');
    await assert.rejects(inspectScientificDocx(await zipped.generateAsync({type:'uint8array'})),/document.xml/);
    await assert.rejects(inspectScientificDocx(new Uint8Array(24*1024*1024+1)),/24 MB/);
});
test('Word import main path uses verified direct-XML strategy and no legacy count-success path',async()=>{
    const fs=await import('node:fs');
    const code=fs.readFileSync('src/main.js','utf8');
    for(const term of ['inspectScientificDocx(arrayBuffer)','verifyImportedWordQuestions(parsedQuestions,documentReport)',
        'checkWordImportBeforeSave(', '/api/questions/import-word','wordImportFileMeta.sourceSha256']){
        assert.ok(code.includes(term),'Missing Word import integration '+term);
    }
    const section=code.slice(code.indexOf('async function finalizeImport()'),code.indexOf('function parseQuestionsFromObjects(lines'));
    assert.ok(!section.includes('questions.push(...pendingImportQuestions)'));
    assert.ok(!section.includes('saveQuestionsToDB(pendingImportQuestions)'));
});


test('Real editable Word Equation generated by our exporter round-trips back to verified LaTeX',async()=>{
    const cases=[
        '\\frac{x+1}{2}',
        '\\sqrt{x^2+y^2}',
        'x_1^2',
        '\\int_0^1 x^2\\,dx',
        '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}',
        '\\begin{aligned}U&=IR\\\\P&=UI\\end{aligned}',
        '\\ce{H2SO4}',
        '\\ce{SO4^{2-}}'
    ];
    const paragraphs=[];
    const supported=[];
    for(let i=0;i<cases.length;i++){
        const m=makeWordMathRun(cases[i]);
        if(!(m instanceof WordMath))continue;
        supported.push(cases[i]);
        paragraphs.push(new Paragraph({
            children:[new TextRun({text:'Câu '+(i+1)+': [BÀI 1][NB][TL] Tính '}),m]
        }));
        paragraphs.push(new Paragraph({text:'Đáp án: 1'}));
    }
    assert.ok(supported.length>=6,'Must support at least six representative editable formula types');
    const doc=new Document({sections:[{children:paragraphs}]});
    const file=await Packer.toBlob(doc);
    const result=await inspectScientificDocx(new Uint8Array(await file.arrayBuffer()));
    assert.equal(result.formulas.length,supported.length);
    assert.ok(result.formulas.every(f=>f.originalOmml.includes('oMath')),'Never flatten native Office Math to text');
    const unresolved=result.formulas.filter(f=>f.status!=='parsed').map(f=>f.reason);
    assert.deepEqual(unresolved,[], 'Unsupported exported OMML blocks: '+unresolved.join('; '));
    for(const f of result.formulas) {
        const v=validateScientificLatexForImport(f.latex);
        assert.ok(v.ok,'OMML reverse conversion not verified: '+f.latex+' ('+v.reason+')');
    }
});


test('Mixed inline image/text and Word automatic list numbering become explicit blockers',async()=>{
  const image='<w:drawing><a:blip r:embed="rId8"/></w:drawing>';
  const report=await inspectScientificDocx(await fixture(
    '<w:p><w:r><w:t>Câu 1 có hình </w:t></w:r>'+image+'</w:p>'+
    '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>A.</w:t></w:r></w:p>',
    {images:true}
  ));
  assert.ok(report.issues.some(i=>i.kind==='image'));
  assert.ok(report.issues.some(i=>i.kind==='numbering'));
});


test('Manual correction must retain one-to-one OMML provenance; deleting formula is never an approval',async()=>{
    const bad='<m:oMath><m:phant><m:e><m:r><m:t>x</m:t></m:r></m:e></m:phant></m:oMath>';
    const report=await inspectScientificDocx(await fixture(prefix+bad+'</w:p>'+p('Đáp án: A')));
    const q={id:'source000011',type:'TL',level:'NB',lesson:'BÀI 1',content:report.lines[0].text,answer:'A'};
    const item=verifyImportedWordQuestions([q],report).questions[0];
    assert.equal(checkWordImportBeforeSave([item],[]).ok,false);
    // A malicious or mistaken review may not remove the formula silently.
    item.content=item.content.replace('__WMATH_000001__','');
    item.__wordReviewed=true;
    assert.equal(checkWordImportBeforeSave([item],[]).ok,false);
    item.content=report.lines[0].text;
    const fixed=correctImportedWordEquation(item,'__WMATH_000001__','\\frac{x+1}{h}');
    assert.equal(fixed.__wordFormulaSources[0].status,'manual_verified');
    assert.equal(fixed.__wordFormulaSources[0].latex,'\\frac{x+1}{h}');
    assert.ok(fixed.content.includes('$\\frac{x+1}{h}$'));
    assert.match(fixed.__wordFormulaSources[0].sourceOmml,/<m:phant>/);
    assert.deepEqual(fixed.__wordImportIssues,[]);
    assert.equal(checkWordImportBeforeSave([fixed],[]).ok,true);
    fixed.content=fixed.content.replace('frac','sqrt');
    assert.equal(checkWordImportBeforeSave([fixed],[]).ok,false);
});


test('A single original Word Equation cannot be silently duplicated across separate questions',async()=>{
 const report=await inspectScientificDocx(await fixture(prefix+eqFraction+'</w:p>'+p('Đáp án: A')));
 const token=report.formulas[0].token;
 const questions=[
   {id:'record001',type:'TL',level:'NB',lesson:'BÀI 1',content:token,answer:'A'},
   {id:'record002',type:'TL',level:'NB',lesson:'BÀI 1',content:token,answer:'A'}
 ];
 const res=verifyImportedWordQuestions(questions,report);
 assert.ok(res.documentIssues.some(x=>x.kind==='structure'));
 assert.equal(checkWordImportBeforeSave(res.questions,res.documentIssues).ok,false);
});


const parsedMath = xml => new DOMParser().parseFromString(
    '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">'+xml+'</m:oMath>',
    'application/xml').documentElement;
const mathRun = text => '<m:r><m:t>'+text+'</m:t></m:r>';
const mathArg = (tag,text) => '<m:'+tag+'>'+mathRun(text)+'</m:'+tag+'>';

test('OOXML omitted operator and separator use integral and vertical bar defaults',()=>{
    // ISO 29500 chr/sepChr defaults: integral for nary; vertical bar for d.
    const integral=convertOmmlToLatex(parsedMath('<m:nary>'+mathArg('sub','0')+
        mathArg('sup','1')+mathArg('e','x')+'</m:nary>'));
    assert.equal(integral,'\\int_{0}^{1} x');
    assert.equal(validateScientificLatexForImport(integral).ok,true);
    assert.equal(convertOmmlToLatex(parsedMath('<m:nary>'+mathArg('e','x')+'</m:nary>')),'\\int x');
    const delimiter=convertOmmlToLatex(parsedMath('<m:d>'+mathArg('e','A')+mathArg('e','B')+'</m:d>'));
    assert.equal(delimiter,'\\left(A|B\\right)');
    assert.equal(validateScientificLatexForImport(delimiter).ok,true);
    // A present CT_Char without val is explicitly empty, not the omitted default.
    assert.equal(convertOmmlToLatex(parsedMath('<m:d><m:dPr><m:begChr/><m:sepChr/></m:dPr>'+
        mathArg('e','A')+mathArg('e','B')+'</m:d>')),'\\left.AB\\right)');
    assert.throws(()=>convertOmmlToLatex(parsedMath('<m:nary><m:naryPr><m:chr/></m:naryPr>'+
        mathArg('e','x')+'</m:nary>')),/chưa được hỗ trợ/);
});

test('Binomial noBar preserves its meaning; a standalone stack cannot become a quotient',async()=>{
    const noBar='<m:f><m:fPr><m:type m:val="noBar"/></m:fPr>'+mathArg('num','n')+
        mathArg('den','k')+'</m:f>';
    const binomial=convertOmmlToLatex(parsedMath('<m:d><m:e>'+noBar+'</m:e></m:d>'));
    assert.equal(binomial,'\\binom{n}{k}');
    assert.equal(validateScientificLatexForImport(binomial).ok,true);
    const report=await inspectScientificDocx(await fixture(prefix+'<m:oMath>'+noBar+'</m:oMath></w:p>'+p('Đáp án: 1')));
    assert.equal(report.formulas[0].status,'review');
    assert.match(report.formulas[0].reason,/noBar/);
    const audited=verifyImportedWordQuestions([{id:'binomial01',type:'TL',level:'NB',lesson:'BÀI 1',
        content:report.lines[0].text,answer:'1',options:{}}],report);
    assert.equal(checkWordImportBeforeSave(audited.questions,audited.documentIssues).ok,false);
});

test('Distinct mathematical alphabets and bold vectors survive native Word roundtrip',async()=>{
    const cases=['\\mathbb{R}','\\mathcal{F}','\\mathfrak{g}','\\mathsf{X}','\\mathtt{A}',
        '\\mathbf{v}','\\boldsymbol{v}','\\mathrm{H2O}'];
    for(const latex of cases) {
        const word=makeWordMathRun(latex);
        assert.ok(word instanceof WordMath,'Must create editable Equation: '+latex);
        const file=await Packer.toBlob(new Document({sections:[{children:[
            new Paragraph({children:[new TextRun('Câu 1: [BÀI 1][NB][TL] '),word]}),
            new Paragraph({text:'Đáp án: 1'})
        ]}]}));
        const report=await inspectScientificDocx(new Uint8Array(await file.arrayBuffer()));
        assert.equal(report.formulas.length,1);
        assert.equal(report.formulas[0].status,'parsed',report.formulas[0].reason);
        assert.equal(report.formulas[0].latex,latex,'The alphabet/style carries mathematical meaning');
        assert.equal(validateScientificLatexForImport(report.formulas[0].latex).ok,true);
    }
    assert.throws(()=>convertOmmlToLatex(parsedMath('<m:r><m:rPr><m:scr m:val="double-struck"/>'+
        '<m:sty m:val="bi"/></m:rPr><m:t>R</m:t></m:r>')),/cần xác minh/);
});

test('Group arrows are not braces, and semantic properties without a faithful mapping require review',()=>{
    assert.equal(convertOmmlToLatex(parsedMath('<m:groupChr><m:groupChrPr>'+
        '<m:chr m:val="→"/><m:pos m:val="top"/></m:groupChrPr>'+
        mathArg('e','AB')+'</m:groupChr>')),'\\overrightarrow{AB}');
    for(const xml of [
        '<m:borderBox><m:borderBoxPr><m:hideTop/><m:hideBot/><m:hideRight/></m:borderBoxPr>'+mathArg('e','x')+'</m:borderBox>',
        '<m:borderBox><m:borderBoxPr><m:strikeH/></m:borderBoxPr>'+mathArg('e','x')+'</m:borderBox>',
        '<m:groupChr><m:groupChrPr><m:chr m:val="⌢"/><m:pos m:val="top"/></m:groupChrPr>'+mathArg('e','AB')+'</m:groupChr>',
        '<m:nary><m:naryPr><m:subHide/></m:naryPr>'+mathArg('sub','0')+mathArg('e','x')+'</m:nary>',
        '<m:rad><m:radPr><m:degHide/></m:radPr>'+mathArg('deg','3')+mathArg('e','x')+'</m:rad>',
        '<m:box><m:boxPr><m:opEmu/></m:boxPr>'+mathArg('e','mod')+'</m:box>',
        '<m:r><m:rPr><m:lit/></m:rPr><m:t>a b</m:t></m:r>',
        '<m:r><m:t>x^2</m:t></m:r>'
    ])assert.throws(()=>convertOmmlToLatex(parsedMath(xml)),/xác minh/,xml);
    assert.equal(convertOmmlToLatex(parsedMath('<m:borderBox><m:borderBoxPr><m:hideTop m:val="0"/>'+
        '</m:borderBoxPr>'+mathArg('e','x')+'</m:borderBox>')),'\\boxed{x}');
});

test('Adjacent Unicode symbols do not become different LaTeX command names',()=>{
    assert.equal(convertOmmlToLatex(parsedMath(mathRun('αx'))),'\\alpha{}x');
    const latex=convertOmmlToLatex(parsedMath(mathRun('α')+mathRun('x')));
    assert.equal(latex,'\\alpha{}x');
    assert.equal(validateScientificLatexForImport(latex).ok,true);
});

test('Content controls and custom XML wrappers retain every question and formula in source order',async()=>{
    const normal=prefix+eqFraction+'</w:p>'+p('Đáp án: 1');
    const second='<w:sdt><w:sdtPr/><w:sdtContent>'+
        normal.replace('Câu 1:','Câu 2:')+'</w:sdtContent></w:sdt>';
    const third='<w:customXml><w:customXmlPr/>'+
        normal.replace('Câu 1:','Câu 3:')+'</w:customXml>';
    const report=await inspectScientificDocx(await fixture(normal+second+third));
    assert.equal(report.lines.length,6);
    assert.equal(report.formulas.length,3);
    assert.equal(report.issues.length,0);
    assert.match(report.lines[0].text,/Câu 1:/);
    assert.match(report.lines[2].text,/Câu 2:/);
    assert.match(report.lines[4].text,/Câu 3:/);
    assert.equal(new Set(report.formulas.map(f=>f.token)).size,3);
});

test('Unknown document/table wrappers and alternate content cannot silently drop or duplicate questions',async()=>{
    const cases=[
        '<w:altChunk r:id="chunk1"/>',
        '<w:sdt><w:sdtPr/></w:sdt>',
        '<w:tbl><w:sdt><w:sdtContent><w:tr><w:tc>'+p('Câu 2: hidden')+
            '</w:tc></w:tr></w:sdtContent></w:sdt></w:tbl>',
        '<w:p><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">'+
            '<mc:Choice Requires="w">'+p('Câu 2: choice')+'</mc:Choice>'+
            '<mc:Fallback>'+p('Câu 2: fallback')+'</mc:Fallback></mc:AlternateContent></w:p>'
    ];
    for(const extra of cases){
        const report=await inspectScientificDocx(await fixture(prefix+eqFraction+'</w:p>'+p('Đáp án: 1')+extra));
        assert.ok(report.issues.some(x=>x.kind==='structure'),'Unsupported source must be a document blocker: '+extra);
        const audited=verifyImportedWordQuestions([{id:'wrapper001',type:'TL',level:'NB',lesson:'BÀI 1',
            content:report.lines[0].text,answer:'1',options:{}}],report);
        assert.equal(checkWordImportBeforeSave(audited.questions,audited.documentIssues).ok,false);
    }
});


test('Greek variants and an existing superscript degree keep their source symbols',async()=>{
    for(const [source,latex] of [['φ','\\varphi{}'],['ϕ','\\phi{}'],['ε','\\varepsilon{}'],['ϵ','\\epsilon{}']]){
        assert.equal(convertOmmlToLatex(parsedMath(mathRun(source))),latex);
        const blob=await Packer.toBlob(new Document({sections:[{children:[new Paragraph({
            children:[makeWordMathRun(latex)]
        })]}]}));
        const zip=await JSZip.loadAsync(await blob.arrayBuffer());
        const xml=await zip.file('word/document.xml').async('string');
        assert.ok(xml.includes('<m:t>'+source+'</m:t>'),'Source glyph must survive a second Word export: '+source);
    }
    const degree=convertOmmlToLatex(parsedMath('<m:sSup>'+mathArg('e','450')+mathArg('sup','°')+'</m:sSup>'));
    assert.equal(degree,'{450}^{°}');
    const blob=await Packer.toBlob(new Document({sections:[{children:[new Paragraph({children:[makeWordMathRun(degree)]})]}]}));
    const zip=await JSZip.loadAsync(await blob.arrayBuffer());
    const xml=await zip.file('word/document.xml').async('string');
    assert.equal((xml.match(/<m:sSup>/g)||[]).length,1,'Do not add a second exponent to a degree already in m:sup');
    assert.ok(xml.includes('<m:t>°</m:t>'),'Preserve the original degree glyph rather than replacing it with a composition circle');
    assert.equal(convertOmmlToLatex(parsedMath(mathRun('450°'))),'450°');
});

test('Normal and upright Vietnamese text preserve spaces through import and re-export',async()=>{
    for(const properties of ['<m:nor/>','<m:sty m:val="p"/>']){
        const converted=convertOmmlToLatex(parsedMath('<m:r><m:rPr>'+properties+
            '</m:rPr><m:t xml:space="preserve">áp suất</m:t></m:r>'));
        assert.equal(converted,'\\text{áp suất}');
        const blob=await Packer.toBlob(new Document({sections:[{children:[new Paragraph({
            children:[makeWordMathRun(converted)]
        })]}]}));
        const zip=await JSZip.loadAsync(await blob.arrayBuffer());
        const xml=await zip.file('word/document.xml').async('string');
        assert.ok(xml.includes('áp suất'),'Vietnamese text cannot collapse its spaces');
    }
});

test('Double and triple integrals keep their exact operator glyphs',async()=>{
    for(const [symbol,command] of [['∬','\\iint'],['∭','\\iiint']]){
        const converted=convertOmmlToLatex(parsedMath('<m:nary><m:naryPr><m:chr m:val="'+symbol+
            '"/></m:naryPr>'+mathArg('e','f')+'</m:nary>'));
        assert.equal(converted,command+' f');
        assert.equal(validateScientificLatexForImport(converted).ok,true);
        const blob=await Packer.toBlob(new Document({sections:[{children:[new Paragraph({
            children:[makeWordMathRun(converted)]
        })]}]}));
        const zip=await JSZip.loadAsync(await blob.arrayBuffer());
        const xml=await zip.file('word/document.xml').async('string');
        assert.ok(xml.includes('m:val="'+symbol+'"'),'The integral must retain its multiplicity');
    }
});


test('Ruled Word matrices reconstruct array lines and preserve every cell border on re-export',async()=>{
    const namespace='http://schemas.openxmlformats.org/officeDocument/2006/math';
    const direct=(node,name)=>Array.from(node.childNodes||[]).filter(x=>x.nodeType===1&&x.localName===name);
    const propertyOn=(properties,name)=>{
        const node=direct(properties||{},name)[0];
        return Boolean(node)&&!['0','false','off'].includes(node.getAttributeNS(namespace,'val'));
    };
    const matrixSignature=xml=>{
        const dom=new DOMParser().parseFromString(xml,'application/xml');
        const matrix=dom.getElementsByTagNameNS(namespace,'m')[0];
        assert.ok(matrix,'Must retain a native OMML matrix');
        const columns=Array.from(matrix.getElementsByTagNameNS(namespace,'mc')).flatMap(column=>{
            const count=column.getElementsByTagNameNS(namespace,'count')[0];
            const alignment=column.getElementsByTagNameNS(namespace,'mcJc')[0];
            return Array(Number(count.getAttributeNS(namespace,'val'))).fill(alignment.getAttributeNS(namespace,'val'));
        });
        const rows=direct(matrix,'mr').map(row=>direct(row,'e').map(cell=>{
            const box=direct(cell,'borderBox')[0];
            const properties=box?direct(box,'borderBoxPr')[0]:null;
            return {
                text:Array.from(cell.getElementsByTagNameNS(namespace,'t')).map(t=>t.textContent).join(''),
                borders:{
                    top:Boolean(box)&&!propertyOn(properties,'hideTop'),
                    bottom:Boolean(box)&&!propertyOn(properties,'hideBot'),
                    left:Boolean(box)&&!propertyOn(properties,'hideLeft'),
                    right:Boolean(box)&&!propertyOn(properties,'hideRight')
                }
            };
        }));
        return {columns,rows};
    };
    const exportMath=async latex=>{
        const word=makeWordMathRun(latex);
        assert.ok(word instanceof WordMath);
        const blob=await Packer.toBlob(new Document({sections:[{children:[
            new Paragraph({children:[new TextRun('Câu 1: [BÀI 1][NB][TL] '),word]}),
            new Paragraph({text:'Đáp án: 1'})
        ]}]}));
        const data=new Uint8Array(await blob.arrayBuffer());
        const zip=await JSZip.loadAsync(data);
        return {data,xml:await zip.file('word/document.xml').async('string')};
    };
    const patterns=[
        '\\begin{array}{c|cc}&A&B\\\\\\hline A&1&0\\\\B&0&1\\end{array}',
        '\\begin{array}{l|rc|}\\hline x&y&z\\\\\\hline a&b&c\\\\\\hline\\end{array}'
    ];
    for(let i=0;i<patterns.length;i++){
        const original=await exportMath(patterns[i]);
        const report=await inspectScientificDocx(original.data);
        assert.equal(report.formulas[0].status,'parsed',report.formulas[0].reason);
        assert.match(report.formulas[0].latex,/^\\begin\{array\}/);
        assert.equal(validateScientificLatexForImport(report.formulas[0].latex).ok,true);
        const regenerated=await exportMath(report.formulas[0].latex);
        const sourceSignature=matrixSignature(original.xml);
        assert.deepEqual(matrixSignature(regenerated.xml),sourceSignature,'Every border must remain on the same cell');
        if(i===0){
            assert.deepEqual(sourceSignature.columns,['center','center','center']);
            assert.equal(sourceSignature.rows.length,3);
            for(let r=0;r<3;r++)for(let c=0;c<3;c++){
                assert.deepEqual(sourceSignature.rows[r][c].borders,{
                    top:false,bottom:r===0,left:false,right:c===0
                });
            }
        }
    }
});

test('An isolated or inconsistent partial cell border cannot be inferred as a full array rule',()=>{
    const props='<m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="2"/>'+
        '<m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs></m:mPr>';
    const cell=(text,boxed=false)=>'<m:e>'+(boxed?'<m:borderBox><m:borderBoxPr>'+
        '<m:hideTop/><m:hideBot/><m:hideLeft/></m:borderBoxPr>':'')+
        (boxed?mathArg('e',text):mathRun(text))+(boxed?'</m:borderBox>':'')+'</m:e>';
    // Right border exists only in row 1. Making a c|c array would add a new
    // border to row 2, which must never be inferred.
    const matrix='<m:m>'+props+'<m:mr>'+cell('a',true)+cell('b')+'</m:mr>'+
        '<m:mr>'+cell('c')+cell('d')+'</m:mr></m:m>';
    assert.throws(()=>convertOmmlToLatex(parsedMath(matrix)),/xác minh/);
    const literalSeparator='<m:m>'+props+'<m:mr>'+cell('a&amp;b',true)+cell('b')+'</m:mr>'+
        '<m:mr>'+cell('c',true)+cell('d')+'</m:mr></m:m>';
    assert.throws(()=>convertOmmlToLatex(parsedMath(literalSeparator)),/xác minh/,
        'A literal ampersand cannot be mistaken for an extra array column');
});
