import assert from 'node:assert/strict';
import test from 'node:test';
import {validateBatchPayload,persistVerifiedWordImport,MAX_WORD_IMPORT_QUESTIONS} from '../functions/api/questions/import-word.ts';

const question = (id='question0001')=>({
 id,type:'TL',level:'NB',lesson:'BÀI 1',content:'Tính $\\frac{a}{b}$',
 answer:'A',options:{},image:'',
 formulaSources:[{token:'__WMATH_000001__',field:'content',sourceType:'omml',
    sourceOmml:'<m:oMath><m:r><m:t>a</m:t></m:r></m:oMath>',
    latex:'a',status:'verified',engineVersion:'word-omml-1.0'}],
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
 assert.ok(validateBatchPayload(pending).some(x=>x.includes('chưa được duyệt')));
 const huge=validBatch();huge.questions=Array.from({length:MAX_WORD_IMPORT_QUESTIONS+1},(_,i)=>question('question'+i));
 assert.ok(validateBatchPayload(huge).some(x=>x.includes('400')));
});
test('Atomic DB interface logs original OMML and verifies exact imported count',async()=>{
 const b=validBatch();
 const calls=[],transactions=[];
 const sql={
   async query(text,params) {
     calls.push({text,params});
     if(text.includes('COUNT(*)::integer'))return [{n:b.questions.length}];
     return [];
   },
   async transaction(parts,opts){transactions.push({parts,opts});await Promise.all(parts);return parts;}
 };
 const result=await persistVerifiedWordImport(sql,'owner-123',b);
 assert.equal(result.count,1);
 assert.equal(result.batchId,b.batchId);
 assert.equal(transactions.length,1);
 assert.equal(transactions[0].opts.isolationMode,'Serializable');
 assert.ok(calls.some(x=>x.text.includes('INSERT INTO question_formula_sources')));
 assert.ok(calls.some(x=>x.text.includes('INSERT INTO word_import_items')));
 assert.ok(calls.some(x=>x.params?.includes('owner-123')));
 assert.ok(calls.some(x=>x.params?.includes('<m:oMath><m:r><m:t>a</m:t></m:r></m:oMath>')));
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
