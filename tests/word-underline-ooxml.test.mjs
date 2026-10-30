import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { inspectScientificDocx, WORD_IMPORT_ENGINE_VERSION } from '../src/word-omml-reader.js';
import { parseWordUnderlinedOptionLines, extractWordMarkedChoices } from '../src/word-underline-answers.js';
import { verifyImportedWordQuestions, checkWordImportBeforeSave } from '../src/word-import-verification.js';

const pre='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>';
const post='</w:body></w:document>';
const textRun=(text,props='')=>'<w:r>'+(props?'<w:rPr>'+props+'</w:rPr>':'')+'<w:t xml:space="preserve">'+text+'</w:t></w:r>';
const p=(...parts)=>'<w:p>'+parts.join('')+'</w:p>';
const heading=p(textRun('Câu 1: [BÀI 1][NB][4-1] Chọn đáp án đúng.'));
const plain=(letter,value)=>p(textRun(letter+'. '+value));
const u='<w:u w:val="single"/>';
const stylesXml=body=>'<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+body+'</w:styles>';
const optionLines=(report)=>parseWordUnderlinedOptionLines(report.lines,1,'4-1');
const equations='<m:oMath><m:f><m:num><m:e><m:r><m:t>x+1</m:t></m:r></m:e></m:num><m:den><m:e><m:r><m:t>2</m:t></m:r></m:e></m:den></m:f></m:oMath>';

async function docx(body,styles=null) {
    const zip=new JSZip();
    zip.file('word/document.xml',pre+body+post);
    if(styles!==null)zip.file('word/styles.xml',styles);
    return zip.generateAsync({type:'uint8array'});
}
test('native OOXML recognizes a single underlined letter even when period is a separate run',async()=>{
    const report=await inspectScientificDocx(await docx(
        heading+plain('A','Sai')+
        p(textRun('B',u),textRun('. Đúng'))+
        plain('C','Sai')+plain('D','Sai')
    ));
    assert.equal(report.issues.length,0);
    assert.match(report.lines[2].text,/^\[\[U\]\]B\[\[\/U\]\]\. Đúng/);
    const found=optionLines(report);
    assert.deepEqual(found.marked,['B']);
    assert.deepEqual(found.issues,[]);
    assert.equal(found.options.B.text,'. Đúng'.replace(/^\.\s*/,'')); // label is removed by parser
    assert.ok(WORD_IMPORT_ENGINE_VERSION.startsWith('word-omml-1.'));
});

test('character style inherits underline; direct w:u none takes precedence',async()=>{
    const styles=stylesXml(
        '<w:style w:type="character" w:styleId="Base"><w:rPr>'+u+'</w:rPr></w:style>'+
        '<w:style w:type="character" w:styleId="Correct"><w:basedOn w:val="Base"/></w:style>'
    );
    const report=await inspectScientificDocx(await docx(
        heading+
        p(textRun('A','<w:rStyle w:val="Correct"/><w:u w:val="none"/>'),textRun('. Sai'))+
        p(textRun('B','<w:rStyle w:val="Correct"/>'),textRun('. Đúng'))+
        plain('C','Sai')+plain('D','Sai'),
        styles
    ));
    assert.deepEqual(optionLines(report).marked,['B']);
    assert.equal(report.issues.length,0);
});

test('paragraph style underlining of the entire option is detected but paragraph-mark rPr is not',async()=>{
    const styles=stylesXml('<w:style w:type="paragraph" w:styleId="AnswerParagraph"><w:rPr>'+u+'</w:rPr></w:style>');
    const report=await inspectScientificDocx(await docx(
        heading+
        p('<w:pPr><w:rPr>'+u+'</w:rPr></w:pPr>',textRun('A. Sai'))+
        p('<w:pPr><w:pStyle w:val="AnswerParagraph"/></w:pPr>',textRun('B. Đúng'))+
        plain('C','Sai')+plain('D','Sai'),
        styles
    ));
    assert.ok(!report.lines[1].text.includes('[[U]]'));
    assert.ok(report.lines[2].text.includes('[[U]]'));
    assert.deepEqual(optionLines(report).marked,['B']);
});

test('partial underline of wrong option is ignored when the right option label is explicitly marked',async()=>{
    const report=await inspectScientificDocx(await docx(
        heading+
        p(textRun('A. Điều '),textRun('không',u),textRun(' đúng'))+
        p(textRun('B',u),textRun('. Đúng'))+
        plain('C','Sai')+plain('D','Sai')
    ));
    const found=optionLines(report);
    assert.deepEqual(found.marked,['B']);
    assert.deepEqual(found.partialOnly,['A']);
});

test('multi-run fully underlined content and native Office Math remain in original source order',async()=>{
    const report=await inspectScientificDocx(await docx(
        heading+plain('A','Sai')+
        p(textRun('B. '),textRun('Chọn ',u),textRun('công thức',u),equations)+
        plain('C','Sai')+plain('D','Sai')
    ));
    const parsed=optionLines(report);
    assert.deepEqual(parsed.marked,['B']);
    assert.ok(parsed.options.B.text.includes('__WMATH_000001__'));
    assert.equal(report.formulas.length,1);
    const q={id:'underline-math-question-1',lesson:'BÀI 1',level:'NB',type:'4-1',
        content:report.lines[0].text,answer:'B',
        options:Object.fromEntries(['A','B','C','D'].map(k=>[k,{text:parsed.options[k].text,image:''}]))};
    const verified=verifyImportedWordQuestions([q],report);
    assert.equal(verified.stats.verifiedFormulaObjects,1);
    assert.equal(verified.stats.pendingQuestions,0);
    assert.ok(verified.questions[0].options.B.text.includes('$\\frac{x+1}{2}$'));
    assert.ok(checkWordImportBeforeSave(verified.questions,verified.documentIssues).ok);
});

test('soft line breaks and a safe two-column option table retain all four choices',async()=>{
    const soft=await inspectScientificDocx(await docx(
        heading+p(textRun('A. Sai'),'<w:r><w:br/></w:r>',textRun('B',u),textRun('. Đúng'),
            '<w:r><w:br/></w:r>',textRun('C. Sai'),'<w:r><w:br/></w:r>',textRun('D. Sai'))
    ));
    assert.equal(soft.lines.length,5);
    assert.deepEqual(optionLines(soft).marked,['B']);
    const cell=x=>'<w:tc>'+x+'</w:tc>';
    const row=(a,b)=>'<w:tr>'+cell(a)+cell(b)+'</w:tr>';
    const table='<w:tbl>'+row(p(textRun('A. Sai')),p(textRun('B',u),textRun('. Đúng')))+
        row(p(textRun('C. Sai')),p(textRun('D. Sai')))+'</w:tbl>';
    const structured=await inspectScientificDocx(await docx(heading+table));
    assert.ok(!structured.issues.some(issue=>issue.kind==='table'));
    assert.deepEqual(optionLines(structured).marked,['B']);
    assert.equal(optionLines(structured).options.C.text,'Sai');
});

test('reject multiple candidates, duplicated letter, missing option, and underlining only a fragment',()=>{
    const make=lines=>parseWordUnderlinedOptionLines(lines.map(text=>({text})),0,'4-1');
    const ambiguity=make(['[[U]]A[[/U]]. Sai','B. [[U]]Đúng[[/U]]','C. Sai','D. Sai']);
    assert.deepEqual(ambiguity.marked,['A','B']);
    assert.ok(ambiguity.issues.some(message=>message.includes('nhiều đáp án')));
    assert.ok(make(['A. Sai','B. [[U]]Đúng[[/U]]','B. khác','D. Sai'])
        .issues.some(message=>message.includes('bị lặp nhãn')));
    assert.ok(make(['A. Sai','B. [[U]]Đúng[[/U]]','C. Sai'])
        .issues.some(message=>message.includes('Thiếu phương án D')));
    const partial=make(['A. Sai','B. [[U]]một[[/U]] phần','C. Sai','D. Sai']);
    assert.deepEqual(partial.marked,[]);
    assert.deepEqual(partial.partialOnly,['B']);
});

test('TF4 keeps each true-statement marker, and all-four detection is explicit',()=>{
    const make=lines=>parseWordUnderlinedOptionLines(lines.map(text=>({text})),0,'TF4');
    assert.deepEqual(make(['[[U]]A.[[/U]] Đúng','B. Sai','C. [[U]]Đúng[[/U]]','D. Sai']).marked,['A','C']);
    assert.equal(make(['[[U]]A.[[/U]]','[[U]]B.[[/U]]','[[U]]C.[[/U]]','[[U]]D.[[/U]]']).allFourMarked,true);
});

test('unsupported style references and unsafe multi-column tables are flagged before saving',async()=>{
    const missingStyle=await inspectScientificDocx(await docx(heading+
        p(textRun('A. Sai','<w:rStyle w:val="Missing"/>'))+
        plain('B','Đúng')+plain('C','Sai')+plain('D','Sai'),
        stylesXml('')
    ));
    assert.ok(missingStyle.issues.some(issue=>issue.kind==='style'));
    const table='<w:tbl><w:tr><w:tc>'+p(textRun('Câu hỏi'))+'</w:tc><w:tc>'+p(textRun('A. Sai'))+'</w:tc></w:tr></w:tbl>';
    const unsafe=await inspectScientificDocx(await docx(heading+table));
    assert.ok(unsafe.issues.some(issue=>issue.kind==='table'));
});

test('underlined marks and equations have one authoritative OOXML pipeline in the import handler',()=>{
    const source=readFileSync('src/main.js','utf8');
    const start=source.indexOf('window.importQuestions = async function importQuestions()');
    const end=source.indexOf('window.showImportPreviewModal =',start);
    assert.ok(start>=0&&end>start);
    const section=source.slice(start,end);
    assert.match(section,/answerFormat === 'underline' \|\| documentReport\.formulas\.length/);
    assert.match(section,/parseWordUnderlinedOptionLines\(lines, i, type\)/);
    assert.match(section,/mâu thuẫn với dòng Đáp án/);
    assert.match(section,/underlineAnalysis\.allFourMarked/);
    assert.match(section,/verifyImportedWordQuestions\(parsedQuestions,documentReport\)/);
    assert.match(section,/answerFormat === 'bold' && window\.JSZip/);
    assert.doesNotMatch(section,/if \(\(answerFormat === 'underline' \|\| answerFormat === 'bold'\) && window\.JSZip\)/);
});
