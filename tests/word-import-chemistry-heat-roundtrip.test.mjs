import assert from 'node:assert/strict';
import test from 'node:test';
import {Document, Packer, Paragraph, TextRun} from 'docx';
import {Math as WordMath} from 'docx/math';
import {DOMParser} from '@xmldom/xmldom';
import JSZip from 'jszip';
import {makeWordMathRun, generateExamDocx} from '../src/exam-docx-generator.ts';
import {generateQuestionBankDocx} from '../src/question-bank-docx-generator.ts';
import {buildQuestionBankExportInventory,buildQuestionBankExportPlan} from '../src/question-bank-word-selection.js';
import {inspectScientificDocx,convertOmmlToLatex} from '../src/word-omml-reader.js';
import {verifyImportedWordQuestions,checkWordImportBeforeSave,validateScientificLatexForImport,validateWordFormulaSourceForImport} from '../src/word-import-verification.js';

const HEAT=String.raw`\ce{CaCO3 ->[t^o] CaO + CO2}`;
const variants=[
    HEAT,
    String.raw`\ce{CaCO3 ->[t^{o}] CaO + CO2}`,
    String.raw`\ce{CaCO3 ->[t^\circ] CaO + CO2}`,
    String.raw`\ce{CaCO3 ->[t^{\circ}] CaO + CO2}`,
];
const header={soGiaoDuc:'TEST',truongHoc:'TEST',deThiTitle:'PHẢN ỨNG HÓA HỌC',
    monHoc:'HÓA HỌC',maDe:'9001'};
const xmlMath=raw=>new DOMParser().parseFromString(
    '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">'+
    raw+'</m:oMath>','application/xml').documentElement;
async function docxWithEquations(formulas) {
    const paragraphs=[];
    formulas.forEach((formula,i)=>{
        const equation=makeWordMathRun(formula);
        assert.ok(equation instanceof WordMath,'The source must be native editable Word Equation: '+formula);
        paragraphs.push(new Paragraph({children:[
            new TextRun({text:'Câu '+(i+1)+': [BÀI 1][NB][TL] Nhiệt phân '}),
            equation
        ]}));
        paragraphs.push(new Paragraph({children:[new TextRun({text:'Đáp án: '}),
            makeWordMathRun(formula)]}));
    });
    const doc=new Document({sections:[{children:paragraphs}]});
    return Packer.toBuffer(doc);
}
function checkCanonicalEquation(latex) {
    assert.match(latex,/^\\ce\{/, 'The annotation must remain an mhchem chemical reaction');
    assert.match(latex,/->\[t\^\{\\circ\}\]/, 't° must remain ABOVE the reaction arrow');
    assert.ok(latex.includes('CaCO3'),'Calcium carbonate must be preserved');
    assert.ok(latex.includes('CaO + CO2'),'Reaction products must not be changed');
    assert.ok(!/⟶\}\^\{|→\}\^\{|\\overset|\\underset/.test(latex),
        'An arrow exponent is not a centered reaction condition');
    assert.equal(validateScientificLatexForImport(latex).ok,true,'The saved LaTeX must be validated and editable');
}
async function assertImportRoundTrip(data,minCount) {
    const parsed=await inspectScientificDocx(data);
    assert.equal(parsed.issues.length,0,'A well-formed Word Equation must not require manual review');
    assert.ok(parsed.formulas.length>=minCount);
    for(const formula of parsed.formulas) {
        assert.equal(formula.status,'parsed',formula.reason);
        checkCanonicalEquation(formula.latex);
        assert.match(formula.originalOmml,/<m:limUpp>/);
        const source={sourceType:'omml',sourceOmml:formula.originalOmml,
            latex:formula.latex,status:'verified'};
        const verdict=validateWordFormulaSourceForImport(source);
        assert.ok(verdict.ok,verdict.reason);
        const exported=makeWordMathRun(formula.latex);
        assert.ok(exported instanceof WordMath,'The imported source must export back as a native editable Word equation');
        const reverse=await docxWithEquations([formula.latex]);
        const reimport=await inspectScientificDocx(reverse);
        assert.ok(reimport.formulas.length>=1);
        assert.equal(reimport.formulas[0].latex,formula.latex,
            'Word → LaTeX → Word must preserve exact chemical reaction semantics');
    }
    return parsed;
}
test('Exported Word temperature conditions reimport from every t° source variant',async()=>{
    const docx=await docxWithEquations(variants);
    const imported=await assertImportRoundTrip(docx,variants.length*2);
    assert.equal(imported.formulas.length,8,'Question and answer equations must be retained');
    assert.equal(imported.formulas.filter(x=>x.latex===imported.formulas[0].latex).length,8,
        'All t° variants must canonicalize to the same correct reaction');
});
test('Import Word content, option A-D and answer retain the ORIGINAL OMML location of temperature',async()=>{
    const doc=new Document({sections:[{children:[
        new Paragraph({children:[new TextRun({text:'Câu 1: [BÀI 1][NB][4-1] Chọn phương trình: '}),makeWordMathRun(HEAT)]}),
        new Paragraph({children:[new TextRun({text:'A. '}),makeWordMathRun(HEAT)]}),
        new Paragraph({children:[new TextRun({text:'B. '}),makeWordMathRun(HEAT)]}),
        new Paragraph({children:[new TextRun({text:'C. '}),makeWordMathRun(HEAT)]}),
        new Paragraph({children:[new TextRun({text:'D. '}),makeWordMathRun(HEAT)]}),
        new Paragraph({text:'Đáp án: A'}),
        new Paragraph({children:[new TextRun({text:'Câu 2: [BÀI 1][NB][TL] Viết phản ứng nhiệt phân: '}),makeWordMathRun(HEAT)]}),
        new Paragraph({children:[new TextRun({text:'Đáp án: '}),makeWordMathRun(HEAT)]})
    ]}]});
    const report=await inspectScientificDocx(await Packer.toBuffer(doc));
    assert.equal(report.formulas.length,7);
    const questions=[
        {id:'q1',type:'4-1',level:'NB',lesson:'BÀI 1',content:report.lines[0].text,
         options:Object.fromEntries('ABCD'.split('').map((letter,j)=>[letter,report.lines[j+1].text])),
         answer:'A'},
        {id:'q2',type:'TL',level:'NB',lesson:'BÀI 1',content:report.lines[6].text,answer:report.lines[7].text,options:{}}
    ];
    const verified=verifyImportedWordQuestions(questions,report);
    assert.equal(verified.stats.totalFormulaObjects,7);
    assert.equal(verified.stats.verifiedFormulaObjects,7);
    assert.equal(verified.stats.pendingQuestions,0);
    assert.ok(checkWordImportBeforeSave(verified.questions,verified.documentIssues).ok);
    for(const q of verified.questions) {
        assert.ok(!JSON.stringify({content:q.content,answer:q.answer,options:q.options}).includes('__WMATH_'),'Do not leave token placeholders in saved question fields');
        const inputs=[q.content,q.answer,...Object.values(q.options).map(x=>typeof x==='string'?x:x.text)];
        for(const field of inputs.filter(x=>x.includes('\\ce{')))checkCanonicalEquation(
            field.slice(field.indexOf('\\ce{'),field.lastIndexOf('$'))
        );
    }
});
test('Bank export → Word import retains heating condition in question/options/answer',async()=>{
    const teacher='teacher-temp';
    const questions=[
       {id:'H1',creatorId:teacher,lesson:'BÀI 1',type:'4-1',level:'NB',
        content:'Phân hủy $'+HEAT+'$',options:{A:'$'+HEAT+'$',B:'Nước',C:'Khí',D:'Chất rắn'},answer:'A'},
       {id:'H2',creatorId:teacher,lesson:'BÀI 1',type:'TL',level:'TH',
        content:'Viết phản ứng phân hủy muối',answer:'$'+HEAT+'$'}
    ];
    const inventory=buildQuestionBankExportInventory(questions,teacher);
    const plan=buildQuestionBankExportPlan(inventory,
        inventory.groups.map(g=>({lesson:g.lesson,type:g.type,count:g.available})));
    const word=await generateQuestionBankDocx(plan);
    const report=await inspectScientificDocx(new Uint8Array(await word.arrayBuffer()));
    assert.equal(report.formulas.length,3);
    for(const src of report.formulas)checkCanonicalEquation(src.latex);
    assert.ok(report.lines.some(line=>/Câu\s*1:/.test(line.text)),'Source Word must retain first question heading');
    assert.ok(report.lines.some(line=>/Đáp án:/.test(line.text)),'Source Word must retain answer label');
});
test('Exam export → Word import preserves annotated arrow structure and chemical identities',async()=>{
    const questions=[{type:'4-1',lesson:'HÓA',level:'NB',
        content:'Nung $'+HEAT+'$; chất khí thu được là gì?',
        options:{A:'$'+HEAT+'$',B:'$'+HEAT+'$',C:'CaO',D:'CO2'},answer:'D'}];
    const data=await generateExamDocx(header,questions);
    const report=await inspectScientificDocx(data);
    assert.equal(report.formulas.length,3);
    for(const src of report.formulas) {
        checkCanonicalEquation(src.latex);
        assert.equal(src.status,'parsed');
    }
});
test('Upper/lower conditions, catalysts and photochemical arrows remain positioned correctly',async()=>{
    const chemicals=[
       String.raw`\ce{N2 + 3H2 <=>[t^o][\text{áp suất}] 2NH3}`,
       String.raw`\ce{CaCO3 ->[][t^o] CaO + CO2}`,
       String.raw`\ce{2AgCl ->[h\nu] 2Ag + Cl2}`,
       String.raw`\ce{2H2O2 ->[MnO2] 2H2O + O2}`
    ];
    const report=await inspectScientificDocx(await docxWithEquations(chemicals));
    assert.equal(report.formulas.length,8);
    assert.ok(report.formulas.every(x=>x.status==='parsed'),JSON.stringify(report.formulas.map(x=>x.reason)));
    const [equilibrium,lower,photo,catalyst]=report.formulas.filter((_,i)=>i%2===0);
    assert.ok(equilibrium.latex.replace(/\s+(?=(?:<=>|2NH3))/g,'').startsWith('\\ce{N2 + 3H2<=>[t^{\\circ}][\\text{áp suất}]'),
        'The top and bottom conditions must not change order: '+equilibrium.latex);
    assert.ok(lower.latex.includes('->[][t^{\\circ}]'),'Lower-only heat must stay BELOW arrow');
    assert.ok(photo.latex.includes('->[h') && (photo.latex.includes('\\nu]') || photo.latex.includes('ν]')), 'Light and Greek nu must remain centered above arrow: '+photo.latex);
    assert.ok(catalyst.latex.includes('->[MnO2]'),'Catalyst must remain centered above arrow');
    for(const f of report.formulas) {
        const verdict=validateScientificLatexForImport(f.latex);
        assert.ok(verdict.ok,f.latex+' — '+verdict.reason);
    }
});
test('Unsupported Word reaction annotations fail CLOSED; no false verified LaTeX',async()=>{
    const m='<m:limUpp><m:e><m:r><m:t>⟶</m:t></m:r></m:e>'+
        '<m:lim><m:phant><m:e><m:r><m:t>t</m:t></m:r></m:e></m:phant></m:lim></m:limUpp>';
    assert.throws(()=>convertOmmlToLatex(xmlMath(m)),/chưa được hỗ trợ|chưa được nhận diện/);
    const normalMath='<m:limUpp><m:e><m:r><m:t>x</m:t></m:r></m:e><m:lim><m:r><m:t>n</m:t></m:r></m:lim></m:limUpp>';
    assert.equal(convertOmmlToLatex(xmlMath(normalMath)),'{x}^{n}',
        'Ordinary nonchemical Word limits must preserve their existing semantics');
});
