import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {convertSqliteToPostgres} from '../src/neon-adapter.ts';
import {processExamResultsDeletion} from '../src/exam-results-delete-service.ts';
import {resolveLiveExamResultsActor} from '../src/exam-results-delete-actor.ts';
import {
  ExamResultsDeletionError, requiredExamResultsId, requireExamResultsConfirmation,
  isExamResultsAdministrator, mayDeleteExamResults
} from '../src/exam-results-delete-policy.ts';

const admin={id:'admin-A',role:'admin'};
const teacher={id:'account-A',user_id:'profile-A',role:'teacher',target_audience:'Giáo viên'};
const outsider={id:'account-B',user_id:'profile-B',role:'teacher',target_audience:'Giáo viên'};
const student={id:'student-A',role:'user',target_audience:'Học sinh'};
const json={action:'preview',examId:'exam-A'};
const expected=(examId,count,confirmation='1234')=>({action:'delete',examId,expectedCount:count,confirmation});

function adapter(db) {
  return {
    first:async(sql,params)=>{
      const out=await db.query(convertSqliteToPostgres(sql),params);
      return out.rows[0] ?? null;
    },
    run:async(sql,params)=>{
      const out=await db.query(convertSqliteToPostgres(sql),params);
      return {changes:out.affectedRows};
    }
  };
}
async function makeTenant(){
  const db=new PGlite();
  await db.exec('CREATE TABLE exam_configs(id TEXT PRIMARY KEY,name TEXT,creator_id TEXT); CREATE TABLE results(id TEXT PRIMARY KEY,exam_id TEXT,exam_name TEXT,user_id TEXT);');
  await db.query("INSERT INTO exam_configs VALUES('exam-A','Đề trùng tên','profile-A'),('exam-B','Đề trùng tên','profile-B'),('exam-C','Đề chưa thi','profile-A'),('exam-legacy','Đề cũ',NULL)");
  await db.query("INSERT INTO results VALUES('r1','exam-A','Đề trùng tên','student'),('r2','exam-A','Đề trùng tên','student'),('r3','exam-B','Đề trùng tên','student'),('r4',NULL,'Đề trùng tên','student')");
  return db;
}
async function rejects(fn,status,code){
  await assert.rejects(fn,err=>err instanceof ExamResultsDeletionError && err.status===status && err.code===code);
}
test('Destructive confirmation code is exactly 1234 and count must be positive integer',()=>{
  assert.equal(requireExamResultsConfirmation('1234',2),2);
  for(const input of [1234,' 1234','1234 ','01234','123','',undefined,null])assert.throws(()=>requireExamResultsConfirmation(input,2));
  for(const count of [-1,0,1.5,'2',NaN,Infinity,undefined])assert.throws(()=>requireExamResultsConfirmation('1234',count));
  for(const id of ['',null,undefined,123,' ', 'a'.repeat(257)])assert.throws(()=>requiredExamResultsId(id));
  assert.equal(requiredExamResultsId(' exam-A '),' exam-A ');
});
test('Roles are based on verified account id and teacher is not given admin scope',()=>{
  assert.equal(isExamResultsAdministrator(admin),true);
  assert.equal(isExamResultsAdministrator(teacher),false);
  for(const user of [student,{},null,{role:'admin',id:''}])assert.equal(mayDeleteExamResults(user),false);
  assert.equal(mayDeleteExamResults(teacher),true);
  assert.equal(mayDeleteExamResults(admin),true);
});
test('Preview is read-only, cross-owner is 403, and deletion matches exact exam_id',async()=>{
  const db=await makeTenant(),sql=adapter(db);
  try {
    const preview=await processExamResultsDeletion(sql,teacher,json);
    assert.equal(preview.count,2);
    assert.equal(preview.examName,'Đề trùng tên');
    assert.deepEqual((await db.query("SELECT id FROM results ORDER BY id")).rows.map(x=>x.id),['r1','r2','r3','r4']);
    await rejects(()=>processExamResultsDeletion(sql,outsider,json),403,'EXAM_RESULTS_FORBIDDEN');
    await rejects(()=>processExamResultsDeletion(sql,student,json),403,'EXAM_RESULTS_FORBIDDEN');
    await rejects(()=>processExamResultsDeletion(sql,teacher,expected('exam-B',1)),403,'EXAM_RESULTS_FORBIDDEN');
    await rejects(()=>processExamResultsDeletion(sql,teacher,expected('exam-A',2,'wrong')),400,'INVALID_CONFIRMATION');
    const done=await processExamResultsDeletion(sql,teacher,expected('exam-A',2));
    assert.equal(done.deletedCount,2);
    assert.equal(done.remainingCount,0);
    assert.deepEqual((await db.query("SELECT id FROM results ORDER BY id")).rows.map(x=>x.id),['r3','r4']);
    assert.equal((await db.query("SELECT COUNT(*) AS c FROM exam_configs")).rows[0].c,4);
  }finally {await db.close();}
});
test('Stale preview cannot delete after a new submission; atomic SQL checks count again',async()=>{
 const db=await makeTenant(),sql=adapter(db);
 try {
   await db.query("INSERT INTO results VALUES('r-new','exam-A','Đề trùng tên','student')");
   await rejects(()=>processExamResultsDeletion(sql,teacher,expected('exam-A',2)),409,'RESULT_COUNT_CHANGED');
   assert.equal((await db.query("SELECT COUNT(*) AS c FROM results WHERE exam_id='exam-A'")).rows[0].c,3);
   const count=(await processExamResultsDeletion(sql,teacher,json)).count;
   const done=await processExamResultsDeletion(sql,teacher,expected('exam-A',count));
   assert.equal(done.deletedCount,3);
   assert.equal(done.remainingCount,0);
 } finally {await db.close();}
});
test('Guarded SQL rechecks owner and count in one atomic DELETE statement',async()=>{
 const db=await makeTenant(),sql=adapter(db);
 try {
   const base=sql.run.bind(sql);
   sql.run=async(statement,params)=>{
     await db.query("INSERT INTO results VALUES('r-concurrent','exam-A','Đề trùng tên','student')");
     return base(statement,params);
   };
   await rejects(()=>processExamResultsDeletion(sql,teacher,expected('exam-A',2)),409,'RESULT_COUNT_CHANGED');
   assert.equal((await db.query("SELECT COUNT(*) AS c FROM results WHERE exam_id='exam-A'")).rows[0].c,3);
 } finally {await db.close();}
});
test('Admin can clean orphaned legacy results but teacher cannot; tenants stay isolated',async()=>{
 const db=await makeTenant(),other=await makeTenant();
 try {
   const sql=adapter(db);
   await db.query("INSERT INTO results VALUES('r-legacy','exam-legacy','Đề cũ','student')");
   const p=await processExamResultsDeletion(sql,admin,{action:'preview',examId:'exam-legacy'});
   assert.equal(p.count,1);
   await rejects(()=>processExamResultsDeletion(sql,teacher,expected('exam-legacy',1)),403,'EXAM_RESULTS_FORBIDDEN');
   assert.equal((await processExamResultsDeletion(sql,admin,expected('exam-legacy',1))).deletedCount,1);
   assert.equal((await other.query("SELECT COUNT(*) AS c FROM results WHERE exam_id='exam-A'")).rows[0].c,2);
 }finally{await db.close();await other.close();}
});
test('Unavailable count must fail closed rather than deleting a presumed zero',async()=>{
 const db=await makeTenant();let calls=0;
 try{
  const dbWrapper={
    first:async(sql,params)=>{calls++;return calls===2?{total:null}:adapter(db).first(sql,params);},
    run:()=>{throw new Error('should not delete');}
  };
  await rejects(()=>processExamResultsDeletion(dbWrapper,teacher,json),503,'INVALID_RESULT_COUNT');
 }finally{await db.close();}
});
test('Integration: both backends call shared service; frontend has compact modal and keeps 12 columns',()=>{
 const pages=readFileSync('functions/api/results.ts','utf8');
 const route=readFileSync('functions/api/results/delete-by-exam.ts','utf8');
 const server=readFileSync('server.ts','utf8');
 const main=readFileSync('src/main.js','utf8');
 assert.match(route,/onRequestPostDeleteByExam as onRequestPost/);
 for(const code of [pages,server]){
   assert.match(code,/processExamResultsDeletion\(/);
   assert.match(code,/ExamResultsDeletionError/);
 }
 assert.match(server,/app\.post\("\/api\/results\/delete-by-exam"/);
 assert.match(main,/window\.deleteExamResultsByExamId = async function/);
 assert.match(main,/onclick="deleteExamResultsByExamId\('/);
 assert.match(main,/confirmation !== '1234'/);
 assert.match(main,/expectedCount: count/);
 assert.match(main,/delete-exam-results-name/);
 assert.match(main,/delete-exam-results-count/);
 assert.match(main,/updateExamNamesList\(true\)/);
 const renderer=main.slice(main.indexOf('window.renderExamConfigsTable = function'),main.indexOf('function renderExamConfigsPaginationControls('));
 assert.equal((renderer.match(/<td class=/g)||[]).length,12);
 assert.match(renderer,/exam-config-created-cell/);
 assert.match(renderer,/deleteExamConfig\('/);
 assert.match(renderer,/deleteExamResultsByExamId\('/);
});
test('Cloudflare endpoint requires auth header before initializing DB',async()=>{
 const {onRequestPostDeleteByExam}=await import('../functions/api/results.ts');
 const response=await onRequestPostDeleteByExam({request:new Request('https://school.test/api/results/delete-by-exam',{method:'POST',body:'{}'}),env:{}} as any);
 assert.equal(response.status,401);
 const json=await response.json();
 assert.equal(json.code,'AUTH_REQUIRED');
});

test('Node deletion actor rechecks live profile and never trusts stale JWT audience',()=>{
 const claims={id:'account-A',role:'teacher',target_audience:'Giáo viên'};
 const live={id:'account-A',user_id:'profile-A',password:'hash',role:'user',is_active:1,target_audience:'Học sinh',profile_active:1};
 const actor=resolveLiveExamResultsActor(claims,live);
 assert.equal(actor.role,'user');
 assert.equal(mayDeleteExamResults(actor),false);
 assert.equal(actor.target_audience,'Học sinh');
 assert.equal(mayDeleteExamResults(resolveLiveExamResultsActor(claims,{...live,role:'teacher',target_audience:'Giáo viên'})),true);
 for (const patch of [{profile_active:0},{is_active:0},{profile_expiry_date:'2020-01-01'},{expiry_date:'2020-01-01'}]) {
   assert.throws(()=>resolveLiveExamResultsActor(claims,{...live,...patch}));
 }
 assert.throws(()=>resolveLiveExamResultsActor(claims,{...live,id:'another-account'}));
});
