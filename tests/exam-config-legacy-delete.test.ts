import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {convertSqliteToPostgres} from '../src/neon-adapter.ts';
import {canManageExamConfig,examConfigGuardedDeleteStatement} from '../src/exam-config-deletion-policy.ts';
test('Admin role aliases and owner profile IDs are honored; unknown users fail closed',()=>{
 const admin={id:'admin-1',role:'user',target_audience:'Quản trị viên'};
 const teacher={id:'account-A',user_id:'profile-A',role:'teacher'};
 assert.equal(canManageExamConfig(admin,null,true),true);
 assert.equal(canManageExamConfig(teacher,'account-A',false),true);
 assert.equal(canManageExamConfig(teacher,'profile-A',false),true);
 for(const owner of ['',null,'account-B','profile-B','profile-A2'])
  assert.equal(canManageExamConfig(teacher,owner,false),false);
 assert.equal(canManageExamConfig({id:'student',role:'student',user_id:'profile-A'},'profile-A',false),false);
 assert.equal(canManageExamConfig(null,null,true),false);
});
test('Postgres deletes orphan legacy exams only for authorized admin and leaves historical result rows',async()=>{
 const db=new PGlite();
 try{
  await db.exec('CREATE TABLE exam_configs(id TEXT PRIMARY KEY,creator_id TEXT);CREATE TABLE results(id TEXT PRIMARY KEY,exam_id TEXT);');
  await db.exec("INSERT INTO exam_configs VALUES ('old',NULL),('teacher-old','profile-A'),('has-results','profile-A');INSERT INTO results VALUES ('r1','has-results');");
  const run=async (id,owner)=>{const stmt=examConfigGuardedDeleteStatement(id,owner);return db.query(convertSqliteToPostgres(stmt.sql),stmt.params);};
  assert.equal((await run('old',null)).affectedRows,1);
  assert.equal((await run('teacher-old','wrong-owner')).affectedRows,0);
  assert.equal((await run('teacher-old','profile-A')).affectedRows,1);
  assert.equal((await run('has-results','profile-A')).affectedRows,0);
  assert.deepEqual((await db.query('SELECT id FROM results')).rows.map(x=>x.id),['r1']);
  assert.deepEqual((await db.query('SELECT id FROM exam_configs')).rows.map(x=>x.id),['has-results']);
 } finally {await db.close();}
});
test('Both backends use shared guard and never bypass result history',()=>{
 const cf=readFileSync('functions/api/exams.ts','utf8');
 const node=readFileSync('server.ts','utf8');
 const security=readFileSync('functions/api/exam/security.ts','utf8');
 const ui=readFileSync('src/main.js','utf8');
 for(const source of [cf,node]){
  assert.match(source,/canManageExamConfig\(user,exam.creator_id,isAdmin\)/);
  assert.match(source,/examConfigGuardedDeleteStatement\(id,exam.creator_id\)/);
  assert.match(source,/EXAM_HAS_RESULTS/);
  assert.match(source,/EXAM_DELETE_FORBIDDEN/);
 }
 assert.match(cf,/const isAdmin = checkIsAdmin\(user\)/);
 assert.match(security,/canManageExamConfig\(user,row.creator_id,admin\)/);
 assert.doesNotMatch(ui,/Lỗi khi xóa đề thi! \(Bạn có thể không có quyền xóa đề này\)/);
 assert.match(ui,/showToast\('Không thể xóa đề thi: ' \+ message, 'error'\)/);
});

test('Cloudflare DELETE rejects bad requests as JSON without a Neon connection',async()=>{
 const {onRequestDelete}=await import('../functions/api/exams.ts');
 for(const item of [
  {url:'https://school-a.test/api/exams',status:400,code:'EXAM_ID_REQUIRED'},
  {url:'https://school-a.test/api/exams?id=legacy-1',status:401,code:'EXAM_AUTH_REQUIRED'}
 ]){
  const response=await onRequestDelete({request:new Request(item.url,{method:'DELETE'}),env:{}} as any);
  assert.equal(response.status,item.status);
  assert.ok((response.headers.get('content-type')||'').includes('application/json'));
  const body=await response.json();
  assert.equal(body.code,item.code);
  assert.equal(typeof body.error,'string');
 }
});
test('Cloudflare DELETE has its own JSON responder and error boundary',()=>{
 const api=readFileSync('functions/api/exams.ts','utf8');
 const handler=api.slice(api.indexOf('export const onRequestDelete: PagesFunction<Env>'));
 assert.ok(handler.includes('const respond = (obj:any,status=200)'));
 assert.ok(handler.includes('const db=getDatabase(context)'));
 assert.ok(handler.includes('catch (err:any)'));
 assert.ok(handler.includes('return respond('));
});
