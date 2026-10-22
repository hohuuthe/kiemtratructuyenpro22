import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { Document, Packer, Paragraph } from 'docx';
import { Math as WordMath } from 'docx/math';
import { makeWordMathRun, parseFormattedText, generateExamDocx } from '../src/exam-docx-generator.ts';
import { standaloneMhchemCommand, makeEditableChemistryEquation, makeEditableUnitEquation, expandMhchemForWordMath } from '../src/word-editable-chemistry.js';
import { repairLegacyScientificLatexForWord } from '../src/word-legacy-latex-repair.js';

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


test('Annotated industrial chemistry arrow remains a native editable Word equation', async () => {
  const complex=String.raw`\ce{N2(g) + 3H2(g) <=>[\text{Fe},\,$450^{\circ}$\mathrm C][\text{áp suất}] 2NH3(g)}`;
  const run=makeWordMathRun(complex);
  assert.ok(run instanceof WordMath, 'Labeled reaction must never fall back to raw TeX');
  const xml=await xmlFor([run]);
  assert.match(xml, /<m:sSubSup>|<m:sSup>/);
  assert.ok(xml.includes('Fe'));
  assert.ok(xml.includes('450'));
  assert.ok(xml.includes('áp suất'));
  assert.ok(xml.includes('⇌'));
  assert.ok(!xml.includes('\\text{'));
  assert.ok(!xml.includes('\\ce{'));
});

test('Embedded isotope in scientific math is converted exactly once', async () => {
  const input=String.raw`N=\frac{[\ce{^{235}_{92}U}]}{V}`;
  const normalized=expandMhchemForWordMath(input);
  assert.ok(!normalized.includes('\\ce{'));
  assert.ok(!normalized.includes('\\mathrm{\\mathrm{'));
  const xml=await xmlFor([makeWordMathRun(input)]);
  assert.match(xml, /<m:f\b/);
  assert.ok(!xml.includes('\\ce{'));
});

test('Common standalone math and biology nomenclature are editable rather than literal TeX', async () => {
  const sources=[
    String.raw`|x-3|\le 5`,
    String.raw`A\cup B,\quad A\cap B,\quad A\setminus B`,
    String.raw`P\Rightarrow Q,\quad P\Leftrightarrow Q`,
    String.raw`A\oplus B`,
    String.raw`x\ll1`,
    String.raw`x\sim y,\quad x\propto y`,
    String.raw`\texttt{5'-ATGCCATTA-3'}`,
    String.raw`3{,}14159`,
    String.raw`3:1`,
    String.raw`1:50\,000`,
  ];
  for (const src of sources) {
    const runs=parseFormattedText(src);
    assert.ok(runs.some(x=>x instanceof WordMath),'Source should be editable math: '+src);
  }
});


const malformedFixtureIDs = ['MAT-022','MAT-079','MAT-086','MAT-088','STR-003','STR-022','STR-030'];

test('Legacy repair touches delimiters only and does not change mathematical operands', () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/scientific-formulas-516.json','utf8'));
  const source = new Map(fixture.cases.map(x=>[x.id,x.latex]));
  for(const id of malformedFixtureIDs){
    const raw = source.get(id);
    assert.ok(raw,id);
    const clean = repairLegacyScientificLatexForWord(raw);
    assert.ok(clean.changed,id + ' must have a repair');
    assert.ok(clean.repairs.length,id + ' must have a diagnostic reason');
    assert.equal(repairLegacyScientificLatexForWord(clean.latex).latex,clean.latex,'idempotent '+id);
    assert.equal(clean.latex.replace(/[\\\\$]/g,''),raw.replace(/[\\\\$]/g,''),'visible operands remain unchanged '+id);
  }
  const alreadyValid = [
    String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`,
    String.raw`\begin{cases}x>1\\x\le1\end{cases}`,
    String.raw`\begin{aligned}x&=2\\y&=3\end{aligned}`,
    String.raw`\frac{\sqrt{x}}{2}`,
    String.raw`\ce{N2 + 3H2 <=> 2NH3}`,
  ];
  for(const raw of alreadyValid) {
    assert.equal(repairLegacyScientificLatexForWord(raw).latex,raw,'already-valid source must not change');
  }
});

test('All 7 previously unrenderable historical sources become editable Office Math', async () => {
  const fixture = JSON.parse(readFileSync('tests/fixtures/scientific-formulas-516.json','utf8'));
  const originals = new Map(fixture.cases.map(x=>[x.id,x.latex]));
  for(const id of malformedFixtureIDs){
    const original = originals.get(id);
    const run = makeWordMathRun(original);
    assert.ok(run instanceof WordMath,id+' fallback to a raw LaTeX text run');
    const xml = await xmlFor([run]);
    const visible = [...xml.matchAll(/<m:t[^>]*>([^<]*)<\/m:t>/g)].map(m=>m[1].replace(/&amp;/g,'&'));
    console.log('[LegacyEquationOMML]',JSON.stringify({
      id,rows:(xml.match(/<m:mr>/g)||[]).length,
      eqRows:(xml.match(/<m:e>/g)||[]).length,
      visible:visible.join('').slice(0,180),
      hlineLiteral:xml.includes('hline'),rawDelimiter:xml.includes(String.raw`\begin{`)
    }));
    assert.match(xml, /<m:oMath\b/,id);
    assert.ok(!xml.includes(String.raw`\begin{`),id+' leaked raw TeX environment');
    if(id==='MAT-086'||id==='MAT-088'||id==='STR-030') {
      assert.match(xml, /<m:m>|<m:eqArr>/,id+' missing native matrix/array structure');
    }
    if(id==='MAT-022'||id==='STR-003'||id==='STR-022'){
      assert.match(xml, /<m:m>|<m:eqArr>/,id+' missing native multiline equation');
    }
  }
  // Never modify the original source in the fixture or database.
  assert.equal(new Map(fixture.cases.map(x=>[x.id,x.latex])).get('MAT-079'),
    String.raw`\angle ABC=$60^{\circ}\text{M}`);
});

test('All 516 ordinary fixture formulas export as native editable Word Math', async () => {
  const fixture=JSON.parse(readFileSync('tests/fixtures/scientific-formulas-516.json','utf8'));
  const regular=fixture.cases.filter(item=>!item.special);
  const nonEditable=[];
  for(const item of regular){
    const runs=parseFormattedText(String(item.latex));
    if(!runs.some(run=>run instanceof WordMath)) nonEditable.push(item.id);
  }
  assert.equal(regular.length,516);
  assert.deepEqual(nonEditable,[],'All provided scientific fixtures must be editable native Word equations');
});
