import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { Document, Packer, Paragraph } from 'docx';
import { Math as WordMath } from 'docx/math';
import { makeWordMathRun, parseFormattedText, generateExamDocx } from '../src/exam-docx-generator.ts';
import { standaloneMhchemCommand, makeEditableChemistryEquation, makeEditableUnitEquation, expandMhchemForWordMath } from '../src/word-editable-chemistry.js';

const samples = [
  String.raw`\ce{H2O}`,
  String.raw`\ce{H2SO4}`,
  String.raw`\ce{Ca(OH)2}`,
  String.raw`\ce{NH4+}`,
  String.raw`\ce{SO4^{2-}}`,
  String.raw`\ce{SO4^{2}-}`,
  String.raw`\ce{[Cu(NH3)4]^{2}+}`,
  String.raw`\ce{^{235}_{92}U}`,
  String.raw`\ce{2H2 + O2 -> 2H2O}`,
  String.raw`\ce{N2 + 3H2 <=> 2NH3}`,
  String.raw`\ce{2AgCl ->[h\nu] 2Ag + Cl2}`,
  String.raw`\ce{2H2O2 ->[MnO2] 2H2O + O2}`,
  String.raw`\ce{Fe^{3}+ + 3OH- -> Fe(OH)3 v}`,
  String.raw`\ce{CaCO3 + 2HCl -> CaCl2 + CO2 ^ + H2O}`,
  String.raw`\ce{CH3-CH(OH)-COOH}`,
  String.raw`\ce{(-CH2-CH2-)_{n}}`,
  String.raw`\ce{CH3COOH + C2H5OH <=> CH3COOC2H5 + H2O}`,
];

async function xmlFor(children) {
  const doc = new Document({ sections:[{children:[new Paragraph({children})]}]});
  const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
  return zip.file('word/document.xml').async('string');
}

test('Every representative chemical syntax produces native editable OMML (never literal \\ce)', async () => {
  for (const formula of samples) {
    const run = makeWordMathRun(formula);
    assert.ok(run instanceof WordMath, formula + ' should be native Word Math');
    const xml = await xmlFor([run]);
    assert.match(xml, /<m:oMath\b/, formula);
    assert.ok(!xml.includes('\\ce{'),formula+' leaked literal latex to Word');
    assert.ok(!xml.includes('\\pu{'),formula+' leaked a unit command');
  }
});

test('Native chemical subscripts, charges, isotope prescripts and labeled reactions exist', async () => {
  const xml = await xmlFor(samples.map(item => makeWordMathRun(item)));
  for (const element of ['<m:sSub>', '<m:sSup>', '<m:sPre>']) {
    assert.ok(xml.includes(element), 'Missing native Office Math element '+element);
  }
  for (const symbol of ['→','⇌','↓','↑','235','92']) {
    assert.ok(xml.includes(symbol), 'Missing chemical symbol '+symbol);
  }
  assert.match(xml, /<m:sty\b[^>]*m:val="p"/, 'Element letters must be upright rather than italic');
});

test('All supplied CHE and BIO mhchem catalogue commands are editable Word math', async () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/scientific-formulas-516.json','utf8'));
  const cases = fixture.cases.filter(x=> (x.id.startsWith('CHE-') || x.id.startsWith('BIO-')) &&
    /\\(?:ce|pu)\{/.test(x.latex));
  assert.ok(cases.length >= 45, 'Chemistry coverage unexpectedly shrank');
  const bad = [];
  for (const row of cases) {
    const run = makeWordMathRun(row.latex);
    if (!(run instanceof WordMath)) bad.push(row.id + ': ' + row.latex);
  }
  assert.deepEqual(bad, [], 'No supported CHE/BIO formula may remain raw LaTeX');
});

test('Chemistry embedded in nested mathematical fractions is still editable', async () => {
  const sample=String.raw`K_{a}=\frac{[\ce{H+}][\ce{A-}]}{[\ce{HA}]}`;
  const expanded=expandMhchemForWordMath(sample);
  assert.ok(!expanded.includes('\\ce{'));
  const xml=await xmlFor([makeWordMathRun(sample)]);
  assert.match(xml, /<m:f\b/);
  assert.match(xml, /<m:oMath\b/);
  assert.ok(!xml.includes('\\ce{'));
});

test('Scientific units are native editable Office Math', async () => {
  const formula=String.raw`\pu{123 kJ*mol-1}`;
  assert.equal(standaloneMhchemCommand(formula)?.kind,'pu');
  const xml=await xmlFor([makeWordMathRun(formula)]);
  assert.match(xml, /<m:sSup>/);
  assert.ok(xml.includes('123'));
  assert.ok(xml.includes('mol'));
  assert.ok(!xml.includes('\\pu{'));
});

test('Four-type exam DOCX preserves native editable chemistry and mathematics across questions/options', async () => {
  const header={deThiTitle:'HOA HOC',monHoc:'HOA',maDe:'2071'};
  const questions=[
    {type:'4-1',content:'Chất $\\ce{H2SO4}$ là axit nào?',options:{
      A:{text:'Ion $\\ce{SO4^{2-}}$'},B:{text:'$\\ce{NH4+}$'},
      C:{text:'$\\ce{2H2 + O2 -> 2H2O}$'},D:{text:'$\\ce{^{235}_{92}U}$'}},answer:'A'},
    {type:'TF4',content:'Phản ứng $\\ce{N2 + 3H2 <=> 2NH3}$',options:{
      A:{text:'$\\ce{CaCO3 -> CaO + CO2}$'},B:{text:'$\\ce{Fe^{3}+}$'},
      C:{text:'$\\ce{Ca(OH)2}$'},D:{text:'$\\ce{Ag+ + Cl- -> AgCl v}$'}},answer:'AB'},
    {type:'SQ',content:'Nồng độ $\\frac{[\\ce{H+}]}{[\\ce{OH-}]}$',answer:'42'},
    {type:'TL',content:'Hệ $\\begin{cases}x+y=3\\\\x-y=1\\end{cases}$ và $\\ce{CO2}$',answer:'x=2'},
  ];
  const docx=await generateExamDocx(header,questions);
  const zip=await JSZip.loadAsync(docx);
  const xml=await zip.file('word/document.xml').async('string');
  assert.match(xml, /<m:oMath\b/);
  assert.match(xml, /<m:f\b/);
  assert.match(xml, /<m:sSub>/);
  assert.match(xml, /<m:sSup>/);
  assert.match(xml, /<m:sPre>/);
  assert.ok(!xml.includes('\\ce{'));
  assert.ok(docx.byteLength>5000);
});

test('Diagnostic coverage for all 516 valid-source scientific formulas', () => {
  const fixture=JSON.parse(readFileSync('tests/fixtures/scientific-formulas-516.json','utf8'));
  const regular=fixture.cases.filter(item=>!item.special);
  assert.equal(regular.length,516);
  let natives=0;
  const unsupported=[];
  for(const item of regular){
    const content=String(item.latex||'');
    try{
      const parsed=parseFormattedText(content);
      if(parsed.some(x=>x instanceof WordMath)) natives++;
      else unsupported.push(item.id);
    }catch(err){
      unsupported.push(item.id+':'+String(err?.message||err).slice(0,70));
    }
  }
  console.log('[ScientificWord] 516-fixture Office Math coverage',JSON.stringify({total:516,native:natives,nonMath:unsupported.slice(0,90),nonMathCount:unsupported.length}));
  assert.ok(natives>=450,'Unexpected regression in conversion of interdisciplinary standard formulas');
});
