/**
 * Read-only integration diagnostic for 100 genuine OMML formula RUNS from
 * ON_TAP_TOAN_10_LAN_1.docx. Prose, answers and illustrations are excluded.
 * Rebuild synthetic Word math nodes, invoke production parsers and validators,
 * and report which original formulas are accepted, blocked or not round-trippable.
 * No upload, database request, credentials or server mutation.
 */
import JSZip from 'jszip';
import {inflateSync} from 'node:zlib';
import {mkdirSync,writeFileSync} from 'node:fs';
import {inspectScientificDocx} from '../src/word-omml-reader.js';
import {validateScientificLatexForImport,verifyImportedWordQuestions,checkWordImportBeforeSave} from '../src/word-import-verification.js';
const fixtureBase64='eNrNV81q20AQfpXBJ5lIWKs/21FSiAy9hSY+1viQv9LSkkDjgERjKJRS5dpjDqWH5tCe4jyCz8UPoSfpzK7sWNqRqiY5FOLgnfnmm9nVzLfyaCTM0agV2PPbltmiv/F4bI4cMsbzO9gAJ8Z/PmyD/b8BXAJk6cd4aTRHLcjSFIabgOvjs4vDdyfW+eT9xdHbpZ/4sqsbiJ+C6BlDs/f78ybGfvpXrq2nKSm7+lEk8ohoJxpotr1GqHJjSON+swSQffkK+w9PwwGb2hoTPipzk2CfbBH27ocDEw5NODLh2IQTE15N12GBDCWYHYITghdCwADWLd1ViNYlL+ESrKo+cVSXYMv5U52Pz2CJELAwIWtzsbxpBQ7dGjZkE7G0NVCOuYDtEZY/i8vKmbnEYxBNaapYXBo9C4/UAo9Uqgnffg2fovNI9URTvmENn7MitBjCvhRadPkJaa3sDlsD9JUU9xIEdqWG6hiXWJwEhVH3eUQuRKzTC1sVIDlDoF0nEoVPWCq/q5a9uiBZXA708zi1CrgwdOZq6YfyuSmsp2MTti5DxrQNlafN1Cfv1cWsme38zSksZvRkTKzn6OxcrbL02u1gq08OTtcMLiEm94YauiXBilHyP5iuQXUlss4jq6unk68Iu7opS7/HL3YxpnTW0plnK/VowbdV49uu9YmCz61W6GGdQrv0OqC6c6oTRpWElXqCu3WmXGlZ+hOIz0BN9cc84pdCWPgwNrL0W5vfovRzFJFuGrKF3vutfiHGW86sJ6VlNd048IyalNC6z4hDGlksGanstg74O/2O3K0oxsqbXuRhNyUt6ao2yXuZ8e2h2ekYOBwoTItZmzaAH5wGuS4EyCtgoJsi3bTTDBXJ6fMYz0B6Ai6GQ+u28kuS6K8yujbj0E2RbpKnGPjz2xAWd/jVZ5O8LvyesJm3M2WMqIEDxk6b75VFUflQY2gL2i8nNotYu6xMSJZf7q8Uka/yG0z4evhz6hvCBAkdnZHfPBtgqEB1CXk+l3gbuiStFOiYa4jxH9SexCQ=';
const formulas=JSON.parse(inflateSync(Buffer.from(fixtureBase64,'base64')).toString('utf8'));
const xmlEscape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
if(formulas.length!==100)throw new Error('OMML original fixture has unexpected formula count');
const mathRun=([value,script,style])=>'<m:r>'+
  ((script||style)?'<m:rPr>'+
    (script?'<m:scr m:val="'+xmlEscape(script)+'"/>':'')+
    (style?'<m:sty m:val="'+xmlEscape(style)+'"/>':'')+'</m:rPr>':'')+
  '<m:t xml:space="preserve">'+xmlEscape(value)+'</m:t></m:r>';
const rows=formulas.map(([question,runs])=>'<w:p><w:r><w:t>Q'+question+
  '</w:t></w:r><m:oMath>'+runs.map(mathRun).join('')+'</m:oMath></w:p>').join('');
const xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '+
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>'+rows+
  '</w:body></w:document>';
const zip=new JSZip();
zip.file('word/document.xml',xml);
const report=await inspectScientificDocx(await zip.generateAsync({type:'uint8array'}));
if(report.formulas.length!==formulas.length)throw new Error('Imported formula count mismatch');
const grouped=new Map();
formulas.forEach(([question],i)=>{
  if(!grouped.has(question))grouped.set(question,[]);
  grouped.get(question).push(report.formulas[i].token);
});
const questions=[...grouped].map(([question,tokens])=>({
  id:'math-qa-'+question,type:'TL',level:'NB',
  content:tokens.join(' '),answer:'Test',options:{}
}));
const verified=verifyImportedWordQuestions(questions,report);
const errors=[];
let parsed=0,formulasVerified=0;
formulas.forEach(([question,runs],i)=>{
  const record=report.formulas[i];
  if(record.status==='parsed')parsed++;
  const verdict=record.status==='parsed'
    ? validateScientificLatexForImport(record.latex)
    : {ok:false,reason:record.reason||'OMML converter rejected the formula'};
  if(verdict.ok)formulasVerified++;
  else errors.push({question,index:i+1,sourceText:runs.map(x=>x[0]).join('').slice(0,140),
    conversionStatus:record.status,reason:verdict.reason,latex:record.latex.slice(0,180)});
});
const byQuestion=[...grouped].map(([question,tokens])=>({
  question,formulaCount:tokens.length,
  blocked:errors.filter(x=>x.question===question).length
}));
const out={
  sample:'ON_TAP_TOAN_10_LAN_1.docx (100 original OMML math runs only)',
  sourceQuestionCount:21,
  sourceEquationFormat:'Office Math OMML, not legacy MathType OLE/MTEF',
  note:'Synthetic DOCX contains exact math text/script properties, not original prose or images.',
  formulasFound:report.formulas.length,parsed,formulasVerified,
  pending:errors.length,canSaveAll:checkWordImportBeforeSave(verified.questions,verified.documentIssues).ok,
  verificationStats:verified.stats,byQuestion,errors,
  parserIssues:report.issues.filter(i=>i.kind!=='formula')
};
mkdirSync('public',{recursive:true});
writeFileSync('public/qa-on-tap-toan10-omml.json',JSON.stringify(out,null,2)+'\n');
console.log('ON_TAP_TOAN_10_LAN_1 math objects:',out.formulasFound,
  'parsed:',parsed,'verified:',formulasVerified,'pending:',errors.length);
for(const e of errors.slice(0,40))
  console.log('Q'+e.question+' formula '+e.index+': '+e.reason+' ['+e.sourceText.slice(0,65)+']');
