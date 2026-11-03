import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { inspectScientificDocx } from '../src/word-omml-reader.js';
import { parseWordBoldOptionLines, parseWordUnderlinedOptionLines } from '../src/word-underline-answers.js';
import { verifyImportedWordQuestions, checkWordImportBeforeSave } from '../src/word-import-verification.js';

const before='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>';
const after='</w:body></w:document>';
const run=(value,rPr='')=>'<w:r>'+(rPr?'<w:rPr>'+rPr+'</w:rPr>':'')+'<w:t xml:space="preserve">'+value+'</w:t></w:r>';
const paragraph=(...contents)=>'<w:p>'+contents.join('')+'</w:p>';
const question=paragraph(run('Câu 1: [BÀI 1][TH][4-1] Chọn đáp án đúng.'));
const plain=(letter,text)=>paragraph(run(letter+'. '+text));
const B='<w:b/>';
const noB='<w:b w:val="0"/>';
const styleDoc=source=>'<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+source+'</w:styles>';
const math='<m:oMath><m:f><m:num><m:e><m:r><m:t>x+1</m:t></m:r></m:e></m:num><m:den><m:e><m:r><m:t>2</m:t></m:r></m:e></m:den></m:f></m:oMath>';
async function inspect(body,styles=null){
    const zip=new JSZip();
    zip.file('word/document.xml',before+body+after);
    if(styles!==null)zip.file('word/styles.xml',styles);
    return inspectScientificDocx(await zip.generateAsync({type:'uint8array'}));
}
const recognize = report=>parseWordBoldOptionLines(report.lines,1,'4-1');
const options = lines=>parseWordBoldOptionLines(lines.map(text=>({text,image:''})),0,'4-1');

test('Direct w:b recognizes a bold letter, preserving punctuation in a separate run',async()=>{
    const report=await inspect(question+plain('A','Sai')+
        paragraph(run('B',B),run('. Đúng'))+plain('C','Sai')+plain('D','Sai'));
    assert.equal(report.issues.length,0);
    assert.deepEqual(recognize(report).marked,['B']);
    assert.equal(recognize(report).options.B.text,'Đúng');
    assert.ok(report.lines[2].text.startsWith('[[B]]B[[/B]].'));
});

test('Direct w:b false overrides inherited bold; nested character-style bold toggles cancel',async()=>{
    const styles=styleDoc(
        '<w:style w:type="character" w:styleId="Base"><w:rPr>'+B+'</w:rPr></w:style>'+
        '<w:style w:type="character" w:styleId="Double"><w:basedOn w:val="Base"/><w:rPr>'+B+'</w:rPr></w:style>'
    );
    const report=await inspect(question+
        paragraph(run('A','<w:rStyle w:val="Double"/>'),run('. Sai'))+
        paragraph(run('B','<w:rStyle w:val="Base"/>'),run('. Đúng'))+
        paragraph(run('C','<w:rStyle w:val="Base"/>'+noB),run('. Sai'))+
        plain('D','Sai'),styles);
    assert.deepEqual(recognize(report).marked,['B']);
    assert.equal(report.issues.length,0);
    assert.ok(!report.lines[1].text.includes('[[B]]'));
    assert.ok(!report.lines[3].text.includes('[[B]]'));
});

test('Paragraph-style inherited bold is applied to runs, but paragraph-mark bold is ignored',async()=>{
    const styles=styleDoc('<w:style w:type="paragraph" w:styleId="Correct"><w:rPr>'+B+'</w:rPr></w:style>');
    const report=await inspect(question+
        paragraph('<w:pPr><w:rPr>'+B+'</w:rPr></w:pPr>',run('A. Sai'))+
        paragraph('<w:pPr><w:pStyle w:val="Correct"/></w:pPr>',run('B. Đúng'))+
        plain('C','Sai')+plain('D','Sai'),styles);
    assert.deepEqual(recognize(report).marked,['B']);
    assert.ok(!report.lines[1].text.includes('[[B]]'));
});

test('Whole bold choice content may span several Word runs and soft line breaks',async()=>{
    const report=await inspect(question+
        paragraph(run('A. Sai'),'<w:r><w:br/></w:r>',run('B. '),run('Đúng ',B),run('chính xác',B),
            '<w:r><w:br/></w:r>',run('C. Sai'),'<w:r><w:br/></w:r>',run('D. Sai')));
    assert.equal(report.lines.length,5);
    assert.deepEqual(recognize(report).marked,['B']);
    assert.equal(recognize(report).options.B.text,'Đúng chính xác');
});

test('Two-column Word table options are retained; content bold in B is recognized',async()=>{
    const cell=inner=>'<w:tc>'+inner+'</w:tc>';
    const row=(a,b)=>'<w:tr>'+cell(a)+cell(b)+'</w:tr>';
    const table='<w:tbl>'+row(paragraph(run('A. Sai')),paragraph(run('B. '),run('Đúng',B)))+
        row(paragraph(run('C. Sai')),paragraph(run('D. Sai')))+'</w:tbl>';
    const report=await inspect(question+table);
    assert.ok(!report.issues.some(issue=>issue.kind==='table'));
    assert.deepEqual(recognize(report).marked,['B']);
    assert.equal(recognize(report).options.C.text,'Sai');
});

test('Uniform bold A-D labels are decoration; distinguish one bold content, or demand explicit answer',()=>{
    const marked=options(['[[B]]A[[/B]]. Sai','[[B]]B[[/B]]. [[B]]Đúng[[/B]]',
        '[[B]]C[[/B]]. Sai','[[B]]D[[/B]]. Sai']);
    assert.deepEqual(marked.marked,['B']);
    const decoration=options(['[[B]]A[[/B]]. Sai','[[B]]B[[/B]]. Đúng',
        '[[B]]C[[/B]]. Sai','[[B]]D[[/B]]. Sai']);
    assert.deepEqual(decoration.marked,[]);
    assert.ok(decoration.ambiguities.some(reason=>reason.includes('Cả bốn nhãn')));
});

test('Partial bold emphasis in a distractor cannot be treated as a correct answer',()=>{
    const r=options(['A. [[B]]Không[[/B]] phải đáp án','B. [[B]]Chính xác[[/B]]',
        'C. Sai','D. Sai']);
    assert.deepEqual(r.marked,['B']);
    assert.deepEqual(r.partialOnly,['A']);
    const noKey=options(['A. Sai','B. [[B]]Một[[/B]] phần','C. Sai','D. Sai']);
    assert.deepEqual(noKey.marked,[]);
    assert.deepEqual(noKey.partialOnly,['B']);
});

test('A bold letter conflicting with a different fully bold answer never chooses automatically',()=>{
    const r=options(['[[B]]A[[/B]]. Sai','B. [[B]]Đúng[[/B]]','C. Sai','D. Sai']);
    assert.deepEqual(r.marked,[]);
    assert.ok(r.ambiguities.some(x=>x.includes('mâu thuẫn')));
    const multiple=options(['A. [[B]]Một[[/B]]','B. [[B]]Hai[[/B]]','C. Sai','D. Sai']);
    assert.deepEqual(multiple.marked,[]);
    assert.ok(multiple.ambiguities.some(x=>x.includes('nhiều')));
});

test('All four fully bold options and malformed markers remain ambiguous',()=>{
    const r=options(['A. [[B]]A[[/B]]','B. [[B]]B[[/B]]',
        'C. [[B]]C[[/B]]','D. [[B]]D[[/B]]']);
    assert.deepEqual(r.marked,[]);
    assert.ok(r.ambiguities.some(x=>x.includes('Cả bốn phương án')));
    const invalid=options(['A. Sai','B. [[B]]Đúng','C. Sai','D. Sai']);
    assert.ok(invalid.issues.some(x=>x.includes('chưa được đóng')));
});

test('TF4 supports separately bolded true statements, but four bold labels are ambiguous',()=>{
    const tf=lines=>parseWordBoldOptionLines(lines.map(text=>({text})),0,'TF4');
    const r=tf(['[[B]]A[[/B]]. Đúng','B. Sai','C. [[B]]Đúng[[/B]]','D. Sai']);
    assert.deepEqual(r.marked,['A','C']);
    assert.deepEqual(r.ambiguities,[]);
    const labels=tf(['[[B]]A[[/B]]. Sai','[[B]]B[[/B]]. Sai',
        '[[B]]C[[/B]]. Sai','[[B]]D[[/B]]. Sai']);
    assert.deepEqual(labels.marked,[]);
    assert.ok(labels.ambiguities.length);
});

test('Word equations remain exact OMML tokens until verified; bold on prose cannot decide an Equation answer',async()=>{
    const report=await inspect(question+plain('A','Sai')+
        paragraph(run('B. '),run('Công thức ',B),math)+plain('C','Sai')+plain('D','Sai'));
    assert.equal(report.formulas.length,1);
    assert.match(report.formulas[0].originalOmml,/<m:f>/);
    const recognized=recognize(report);
    assert.ok(recognized.options.B.text.includes('__WMATH_000001__'));
    assert.deepEqual(recognized.marked,[]);
    assert.ok(recognized.ambiguities.some(s=>s.includes('Equation Word')));
    const q={
        id:'bold-ooxml-math-q-123',lesson:'BÀI 1',level:'TH',type:'4-1',
        content:report.lines[0].text,answer:'B',image:'',
        options:Object.fromEntries(['A','B','C','D'].map(x=>[x,{text:recognized.options[x].text,image:''}]))
    };
    const checked=verifyImportedWordQuestions([q],report);
    assert.equal(checked.stats.totalFormulaObjects,1);
    assert.equal(checked.stats.verifiedFormulaObjects,1);
    assert.ok(checked.questions[0].options.B.text.includes('$\\frac{x+1}{2}$'));
    assert.equal(checkWordImportBeforeSave(checked.questions,checked.documentIssues).ok,true);
});

test('Bold label beside Equation Word is sufficient without rewriting formulas',async()=>{
    const report=await inspect(question+plain('A','Sai')+
        paragraph(run('B',B),run('. '),math)+plain('C','Sai')+plain('D','Sai'));
    const r=recognize(report);
    assert.deepEqual(r.marked,['B']);
    assert.ok(r.options.B.text.includes('__WMATH_000001__'));
    assert.equal(report.formulas.length,1);
});

test('Unknown Word styles and complex-script-only bold are never guessed silently',async()=>{
    const missing=await inspect(question+
        paragraph(run('A. Sai','<w:rStyle w:val="Unknown"/>'))+
        plain('B','Đúng')+plain('C','Sai')+plain('D','Sai'),styleDoc(''));
    assert.ok(missing.issues.some(issue=>issue.kind==='style'));
    // w:bCs applies to complex-script text, not ordinary Latin/Vietnamese runs.
    // Use Arabic content so the test exercises the ambiguity the resolver is
    // intentionally required to block.
    const special=await inspect(question+
        paragraph(run('A. عربي','<w:bCs/>'))+plain('B','Đúng')+plain('C','Sai')+plain('D','Sai'));
    assert.ok(special.issues.some(issue=>issue.kind==='style'));
});

test('Underlined-answer recognition continues to use its own marker and is not changed by bold mode',()=>{
    const lines=['A. Sai','[[U]]B[[/U]]. Đúng','C. Sai','D. Sai'].map(text=>({text}));
    assert.deepEqual(parseWordUnderlinedOptionLines(lines,0,'4-1').marked,['B']);
    assert.deepEqual(parseWordBoldOptionLines(lines,0,'4-1').marked,[]);
});

test('Import handler uses the original OOXML pipeline for bold, cross-checks explicit keys and gates DB writes',()=>{
    const source=readFileSync('src/main.js','utf8');
    const from=source.indexOf('window.importQuestions = async function importQuestions()');
    const to=source.indexOf('window.showImportPreviewModal =',from);
    assert.ok(from>=0&&to>from);
    const code=source.slice(from,to);
    assert.match(code,/answerFormat === 'underline' \|\| answerFormat === 'bold' \|\| documentReport\.formulas\.length/);
    assert.match(code,/parseQuestionsFromObjects\(lines,\s*answerFormat\)/);
    assert.match(source,/parseWordBoldOptionLines\(lines,\s*i,\s*type\)/);
    assert.match(code,/mâu thuẫn với dòng Đáp án/);
    assert.match(code,/boldAnalysis\.ambiguities/);
    assert.match(code,/verifyImportedWordQuestions\(parsedQuestions,documentReport\)/);
    assert.doesNotMatch(code,/zip\.file\("word\/document\.xml", newXmlStr\)/);
    assert.match(source,/checkWordImportBeforeSave\(/);
});
