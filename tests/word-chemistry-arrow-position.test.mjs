import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { Document, Packer, Paragraph } from 'docx';
import { Math as WordMath } from 'docx/math';
import { parseFormattedText, makeWordMathRun, generateExamDocx } from '../src/exam-docx-generator.ts';
import { buildQuestionBankExportInventory, buildQuestionBankExportPlan } from '../src/question-bank-word-selection.js';
import { generateQuestionBankDocx } from '../src/question-bank-docx-generator.ts';

const MATH_NS='http://schemas.openxmlformats.org/officeDocument/2006/math';
const TEXT=String.raw`\ce{CaCO3 ->[t^o] CaO + CO2}`;
const temperatureVariants=[
    TEXT,
    String.raw`\ce{CaCO3 ->[t^{o}] CaO + CO2}`,
    String.raw`\ce{CaCO3 ->[t^\circ] CaO + CO2}`,
    String.raw`\ce{CaCO3 ->[t^{\circ}] CaO + CO2}`
];
const parse=xml=>new DOMParser().parseFromString(xml,'application/xml');
const nodes=(parent,tag)=>Array.from(parent.getElementsByTagNameNS(MATH_NS,tag));
const child=(parent,tag)=>Array.from(parent.childNodes).find(n=>n.nodeType===1 && n.namespaceURI===MATH_NS && n.localName===tag);
async function documentXml(docx) {
    const zip=await JSZip.loadAsync(docx);
    const xml=await zip.file('word/document.xml').async('string');
    assert.ok(xml.includes('<m:oMath'), 'Word math must remain native and editable');
    assert.ok(!xml.includes('\\ce{'), 'Do not leak chemistry source as literal TeX');
    return xml;
}
async function directXml(runs) {
    const d=new Document({sections:[{children:[new Paragraph({children:runs})]}]});
    return documentXml(await Packer.toBuffer(d));
}
function assertHeatingArrow(xml,expectedMinimum=1) {
    const root=parse(xml);
    const uppers=nodes(root,'limUpp');
    const matches=uppers.filter(node=>{
        const base=child(node,'e'),annotation=child(node,'lim');
        if(!base||!annotation)return false;
        const arrow=nodes(base,'t').map(t=>t.textContent).join('');
        const upper=nodes(annotation,'t').map(t=>t.textContent).join('');
        if(!arrow.includes('⟶')||!upper.includes('t')||!upper.includes('°'))return false;
        assert.ok(nodes(annotation,'sSup').length,'Temperature ° must be a real superscript on t');
        assert.ok(!upper.includes('^o')&&!upper.includes('\\circ'),'Do not print literal source control characters');
        assert.equal(nodes(base,'sSup').length,0,'Temperature must NOT be a superscript of the arrow itself');
        return true;
    });
    assert.ok(matches.length>=expectedMinimum,
        'Expected '+expectedMinimum+' temperature labels centered above long arrows, got '+matches.length);
    assert.ok(nodes(root,'limUpp').length>=expectedMinimum);
    assert.ok(!xml.includes('t^o'),'Original t^o must be rendered, not printed');
}
test('DOCX writer centers heating t° above reaction arrow, preserving native chemistry and subscripts',async()=>{
    const runs=temperatureVariants.map(s=>makeWordMathRun(s));
    for(const run of runs)assert.ok(run instanceof WordMath);
    const xml=await directXml(runs);
    assertHeatingArrow(xml,4);
    assert.ok(nodes(parse(xml),'sSub').length>=4,'CaCO3 and CO2 need real chemical subscripts');
});
test('Inline reaction, Greek photo-label and upper/lower catalysts are native editable OMML',async()=>{
    const conditions=[
       String.raw`\ce{2AgCl ->[h\nu] 2Ag + Cl2}`,
       String.raw`\ce{2H2O2 ->[MnO2] 2H2O + O2}`,
       String.raw`\ce{A <=>[t^o][\text{áp suất}] B}`,
       String.raw`\ce{CaCO3 ->[][t^o] CaO + CO2}`,
       String.raw`\ce{H2 + O2 -> H2O}`
    ];
    const xml=await directXml(conditions.map(q=>makeWordMathRun(q)));
    const doc=parse(xml);
    assertHeatingArrow(xml,1);
    assert.ok(nodes(doc,'limLow').length>=2,'Dual and lower-only labels must be centered below arrows');
    assert.ok(xml.includes('áp suất')&&xml.includes('ν')&&xml.includes('Mn'),'Catalysts and lower conditions remain intact');
    assert.ok(xml.includes('⇌'),'Equilibrium arrow must remain equilibrium, not a single arrow');
    assert.ok(xml.includes('→'),'Unlabeled reaction arrow should retain normal appearance');
    assert.ok(!xml.includes('h\\nu')&&!xml.includes('MnO2]'));
});
test('Question-bank Word export uses centered heating condition in question, option and answer',async()=>{
    const teacher='teacher-heat';
    const rows=[
      {id:'HEAT-Q1',creatorId:teacher,lesson:'Phản ứng nhiệt',type:'4-1',level:'NB',
       content:'Xét phản ứng $'+TEXT+'$',options:{
         A:'$'+TEXT+'$',B:'$'+String.raw`\ce{CaCO3 ->[t^\circ] CaO + CO2}`+'$',
         C:'$'+String.raw`\ce{H2 + O2 -> H2O}`+'$',D:'Không phản ứng'
       },answer:'B'},
      {id:'HEAT-Q2',creatorId:teacher,lesson:'Phản ứng nhiệt',type:'TL',level:'TH',
       content:'Viết phương trình phân hủy muối cacbonat',
       answer:'$'+TEXT+'$'}
    ];
    const inventory=buildQuestionBankExportInventory(rows,teacher);
    const choices=inventory.groups.map(g=>({lesson:g.lesson,type:g.type,count:g.available}));
    const plan=buildQuestionBankExportPlan(inventory,choices);
    const docx=await generateQuestionBankDocx(plan);
    const xml=await documentXml(await docx.arrayBuffer());
    assertHeatingArrow(xml,4);
    assert.ok(xml.includes('Đáp án:'));
    assert.equal((xml.match(/Câu \d+:/g)||[]).length,2);
});
test('Exam Word export uses exactly the SAME positioned native equation for question and A–D choices',async()=>{
    const header={soGiaoDuc:'SỞ GDĐT',truongHoc:'Trường',deThiTitle:'KIỂM TRA HÓA HỌC',monHoc:'HÓA HỌC',maDe:'8001'};
    const rows=[{id:'HEAT-EXAM',type:'4-1',level:'NB',lesson:'Hóa học',
        content:'Nhiệt phân $'+TEXT+'$ thu được chất nào?',
        options:{
          A:'Phản ứng $'+TEXT+'$',
          B:'$'+String.raw`\ce{CaCO3 ->[t^{\circ}] CaO + CO2}`+'$',
          C:'$'+String.raw`\ce{N2 + 3H2 <=>[Fe][t^o] 2NH3}`+'$',
          D:'$'+String.raw`\ce{2H2 + O2 -> 2H2O}`+'$'
        },answer:'B'}];
    const xml=await documentXml(await generateExamDocx(header,rows));
    assertHeatingArrow(xml,3);
    assert.ok(nodes(parse(xml),'limLow').length>=1,'Exam must retain lower condition under equilibrium arrow');
    assert.ok(xml.includes('PHẦN I')&&xml.includes('Câu 1'));
});
