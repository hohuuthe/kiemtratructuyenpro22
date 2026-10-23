import assert from 'node:assert/strict';
import test from 'node:test';
import {validateBatchPayload,persistVerifiedWordImport,MAX_WORD_IMPORT_QUESTIONS} from '../functions/api/questions/import-word.ts';
import {checkWordImportBeforeSave,correctImportedWordEquation} from '../src/word-import-verification.js';

const question = (id='question0001')=>({
 id,type:'TL',level:'NB',lesson:'BÀI 1',content:'Tính $\\frac{a}{b}$',
 answer:'A',options:{},image:'',
 formulaSources:[{token:'__WMATH_000001__',field:'content',sourceType:'omml',
    sourceOmml:'<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>',
    latex:'\\frac{a}{b}',status:'verified',engineVersion:'word-omml-1.0'}],
 reviewPending:false,importIssues:[]
});
const validBatch=()=>({
 batchId:'batch-20261023-aaaaaaaa',
 fileName:'Kiểm tra.docx',
 sourceSha256:'a'.repeat(64),
 engineVersion:'word-omml-1.0',questions:[question()]
});
test('Payload validation rejects ambiguous/broken/duplicate imports before transactions',()=>{
 assert.deepEqual(validateBatchPayload(validBatch()),[]);
 const bad=validBatch();bad.questions=[question(),question()];assert.ok(validateBatchPayload(bad).some(x=>x.includes('trùng')));
 const unverified=validBatch();unverified.questions[0].content='__WMATH_000001__';
 assert.ok(validateBatchPayload(unverified).some(x=>x.includes('chưa xác minh')));
 const mislabeled=validBatch();mislabeled.questions[0].type='UNKNOWN';
 assert.ok(validateBatchPayload(mislabeled).some(x=>x.includes('phân loại')));
 const pending=validBatch();pending.questions[0].formulaSources[0].status='review';
 assert.ok(validateBatchPayload(pending).some(x=>x.includes('metadata công thức chưa được xác minh')));
 const huge=validBatch();huge.questions=Array.from({length:MAX_WORD_IMPORT_QUESTIONS+1},(_,i)=>question('question'+i));
 assert.ok(validateBatchPayload(huge).some(x=>x.includes('400')));
});
test('Atomic DB interface logs original OMML and verifies exact imported count',async()=>{
 const b=validBatch();
 const calls=[],transactions=[];
 const sql={
   async query(text,params) {
     calls.push({text,params});
     if(text.includes('COUNT(*)::integer AS n FROM question_formula_sources')) return [{n:b.questions.reduce((sum,q)=>sum+q.formulaSources.length,0)}];
     if(text.includes('COUNT(*)::integer'))return [{n:b.questions.length}];
     if(text.includes('SELECT q.id,q.type,q.level')) return b.questions.map(q=>({
       id:q.id,type:q.type,level:q.level,lesson:q.lesson,content:q.content,
       options:JSON.stringify(q.options),answer:q.answer,image:q.image
     }));
     return [];
   },
   async transaction(parts,opts){transactions.push({parts,opts});await Promise.all(parts);return parts;}
 };
 const result=await persistVerifiedWordImport(sql,'owner-123',b);
 assert.equal(result.count,1);
 assert.equal(result.batchId,b.batchId);
 assert.equal(transactions.length,1);
 assert.equal(transactions[0].opts.isolationLevel,'Serializable');
 assert.ok(calls.some(x=>x.text.includes('INSERT INTO question_formula_sources')));
 assert.ok(calls.some(x=>x.text.includes('INSERT INTO word_import_items')));
 assert.ok(calls.some(x=>x.params?.includes('owner-123')));
 assert.ok(calls.some(x=>x.params?.includes(b.questions[0].formulaSources[0].sourceOmml)));
 assert.ok(!calls.some(x=>x.text.includes('owner-123')),'Values must remain parameters, not concatenated SQL');
});
test('Failed DB transaction propagates failure; no success receipt is produced',async()=>{
 const sql={
    async query(text){if(text.includes('COUNT(*)'))return [{n:1}];return [];},
    async transaction(){throw new Error('Simulated database rollback');}
 };
 await assert.rejects(persistVerifiedWordImport(sql,'owner',validBatch()),/Simulated database rollback/);
});
test('Count mismatch is explicitly reported instead of false success',async()=>{
 const sql={
   async query(text){return text.includes('COUNT(*)')?[{n:0}]:[];},
   async transaction(){return [];}
 };
 await assert.rejects(persistVerifiedWordImport(sql,'owner',validBatch()),/đối soát/);
});

test('API independently rejects malformed LaTeX despite a verified client label',()=>{
 const b=validBatch();
 b.questions[0].content='Tính $\\frac{x}$';
 b.questions[0].formulaSources[0].latex='\\frac{x}';
 assert.ok(validateBatchPayload(b).some(x=>/thiếu|Thiếu|không đạt/.test(x)));
 const textOnly=validBatch();
 textOnly.questions[0].formulaSources=[];
 textOnly.questions[0].answer='$\\frac{x}$';
 assert.ok(validateBatchPayload(textOnly).some(x=>/thiếu|Thiếu/.test(x)));
});

test('API rejects a source token reused across different questions',()=>{
 const b=validBatch();b.questions.push(question('question0002'));
 assert.ok(validateBatchPayload(b).some(x=>/công thức Word gốc bị trùng/.test(x)));
});

test('Automatic approval must agree with original OMML, manual corrections retain valid source',()=>{
 const b=validBatch();
 b.questions[0].content='Tính $\\frac{c}{d}$';
 b.questions[0].formulaSources[0].latex='\\frac{c}{d}';
 assert.ok(validateBatchPayload(b).some(x=>/không khớp/.test(x)));
 b.questions[0].formulaSources[0].status='manual_verified';
 assert.deepEqual(validateBatchPayload(b),[]);
 b.questions[0].formulaSources[0].sourceOmml='';
 assert.ok(validateBatchPayload(b).some(x=>/gốc bị thiếu/.test(x)));
});

test('Malformed or non-math XML cannot claim automatic Office Math verification',()=>{
 for(const xml of [
   '<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:f></m:oMath>',
   '<plain>not Office Math</plain>',
   '<!DOCTYPE x [<!ENTITY x "bad">]><plain>&x;</plain>'
 ]) {
  const b=validBatch();b.questions[0].formulaSources[0].sourceOmml=xml;
  assert.ok(validateBatchPayload(b).some(x=>/nguồn Equation|Nguồn Equation/.test(x)),xml);
 }
});

test('Valid image-only options stay valid through server and preview verification',()=>{
 const b=validBatch();b.questions[0].type='4-1';
 b.questions[0].options=Object.fromEntries(['A','B','C','D'].map(key=>[key,{text:'',image:'data:image/png;base64,iVBORw0KGgo='}]));
 assert.deepEqual(validateBatchPayload(b),[]);
});

function repeatedEquations() {
 const b=validBatch(),q=b.questions[0];
 q.content='Thứ nhất $x$, thứ hai $x$';
 q.formulaSources=[1,2].map(number=>({
  token:'__WMATH_'+String(number).padStart(6,'0')+'__',field:'content',sourceType:'omml',
  sourceOmml:'<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>x</m:t></m:r></m:oMath>',
  latex:'x',status:'verified',engineVersion:'word-omml-1.1'
 }));
 q.__wordFormulaSources=q.formulaSources;
 q.__wordImportIssues=[];
 return b;
}

test('Each equal source Equation requires its own occurrence in the same field',()=>{
 const b=repeatedEquations(),q=b.questions[0];
 assert.deepEqual(validateBatchPayload(b),[]);
 assert.equal(checkWordImportBeforeSave([q]).ok,true);
 q.content='Chỉ còn một công thức $x$';
 assert.ok(validateBatchPayload(b).some(error=>error.includes('công thức Equation khác nội dung')));
 assert.equal(checkWordImportBeforeSave([q]).ok,false);
 q.answer='$x$';
 assert.equal(checkWordImportBeforeSave([q]).ok,false,'An occurrence in another field cannot cover the deleted source');
 q.content='Công thức $x$, mã nguồn `$x$`';
 assert.equal(checkWordImportBeforeSave([q]).ok,false,'A code fragment cannot cover the deleted Equation');
 const decimal=repeatedEquations(),numberQuestion=decimal.questions[0];
 for(const source of numberQuestion.formulaSources) {
  source.latex='3,14159';
  source.sourceOmml=source.sourceOmml.replace('<m:t>x</m:t>','<m:t>3,14159</m:t>');
 }
 numberQuestion.content='Số thứ nhất $3,14159$, số thứ hai $3,14159$';
 assert.deepEqual(validateBatchPayload(decimal),[],'Known decimal Equations must not be mistaken for currency');
 correctImportedWordEquation(numberQuestion,'__WMATH_000002__','4,2');
 assert.equal(numberQuestion.content,'Số thứ nhất $3,14159$, số thứ hai $4,2$');
 assert.deepEqual(validateBatchPayload(decimal),[]);
 numberQuestion.content='Chỉ còn $3,14159$';
 assert.equal(checkWordImportBeforeSave([numberQuestion]).ok,false);
});

test('Correcting the second equal Equation preserves the first and its original source',()=>{
 const b=repeatedEquations(),q=b.questions[0];
 const sources=q.formulaSources.map(source=>source.sourceOmml);
 correctImportedWordEquation(q,'__WMATH_000002__','y');
 assert.equal(q.content,'Thứ nhất $x$, thứ hai $y$');
 assert.deepEqual(q.formulaSources.map(source=>source.latex),['x','y']);
 assert.deepEqual(q.formulaSources.map(source=>source.sourceOmml),sources);
 assert.equal(q.formulaSources[0].status,'verified');
 assert.equal(q.formulaSources[1].status,'manual_verified');
 assert.deepEqual(validateBatchPayload(b),[]);
 correctImportedWordEquation(q,'__WMATH_000001__','y');
 correctImportedWordEquation(q,'__WMATH_000002__','z');
 assert.equal(q.content,'Thứ nhất $y$, thứ hai $z$');
 assert.deepEqual(validateBatchPayload(b),[]);
});

test('An ambiguous manual correction changes neither the question nor its source records',()=>{
 for(const content of ['Chỉ còn $x$','Thêm $x$, $x$, $x$','Công thức $x$, mã nguồn `$x$`','Công thức $x$, ký tự \\$x$']) {
  const q=repeatedEquations().questions[0];
  q.content=content;
  const before=JSON.stringify(q);
  assert.throws(()=>correctImportedWordEquation(q,'__WMATH_000002__','y'),/vị trí/);
  assert.equal(JSON.stringify(q),before);
 }
});

