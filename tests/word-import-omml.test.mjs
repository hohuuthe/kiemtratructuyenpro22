import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { inspectScientificDocx, convertOmmlToLatex } from '../src/word-omml-reader.js';
import { verifyImportedWordQuestions, checkWordImportBeforeSave, validateScientificLatexForImport } from '../src/word-import-verification.js';

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
