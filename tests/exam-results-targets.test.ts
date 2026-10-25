import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {convertSqliteToPostgres} from '../src/neon-adapter.ts';
import {listExamResultsDeletionTargets} from '../src/exam-results-targets-service.ts';
import {processExamResultsDeletion} from '../src/exam-results-delete-service.ts';

const admin={id:'admin-1',role:'admin'};
const owner={id:'account-1',user_id:'profile-1',role:'teacher',target_audience:'Giáo viên'};
const outsider={id:'account-2',role:'teacher',target_audience:'Giáo viên'};
const student={id:'student-1',role:'user',target_audience:'Học sinh'};
async function setup(){
 const db=new PGlite();
 await db.exec('CREATE TABLE exam_configs (id TEXT PRIMARY KEY, name TEXT, creator_id TEXT); CREATE TABLE results (id TEXT PRIMARY KEY, exam_id TEXT, exam_name TEXT, user_id TEXT);');
 await db.exec("INSERT INTO exam_configs VALUES ('A','Trùng tên','profile-1'),('B','Trùng tên','profile-2'),('C','Đổi tên','profile-1'); INSERT INTO results VALUES ('r1','A','Trùng tên','s'),('r2','B','Trùng tên','s'),('r3','C','Trùng tên','s'),('r4','legacy','Trùng tên','s'),('r5',NULL,'Trùng tên','s');");
 const sql={
  all:async(q:string,p:unknown[])=> (await db.query(convertSqliteToPostgres(q),p)).rows,
  first:async(q:string,p:unknown[])=> (await db.query(convertSqliteToPostgres(q),p)).rows[0]||null,
  run:async(q:string,p:unknown[])=>{const v=await db.query(convertSqliteToPostgres(q),p);return {changes:v.affectedRows};}
 };
 return {db,sql};
}
test('Admin has every configured exam and old orphan with matching title',async()=>{
 const {db,sql}=await setup();
 try{
  const data=await listExamResultsDeletionTargets(sql,admin,'Trùng tên');
  assert.deepEqual(data.targets.map(t=>t.id),['A','B','C','legacy']);
  assert.equal(data.unlinkedCount,1);
  assert.deepEqual(data.targets.map(t=>t.attemptCount),[1,1,1,1]);
 }finally{await db.close();}
});
test('Teachers can only select own immutable exam IDs; students rejected',async()=>{
 const {db,sql}=await setup();
 try{
  const mine=await listExamResultsDeletionTargets(sql,owner,'Trùng tên');
  assert.deepEqual(mine.targets.map(t=>t.id),['A','C']);
  assert.equal(mine.unlinkedCount,0);
  assert.deepEqual((await listExamResultsDeletionTargets(sql,outsider,'Trùng tên')).targets,[]);
  await assert.rejects(()=>listExamResultsDeletionTargets(sql,student,'Trùng tên'),(e:any)=>e.status===403);
 }finally{await db.close();}
});
test('Admin deletes orphan by exact ID with 1234, others untouched',async()=>{
 const {db,sql}=await setup();
 try{
  await assert.rejects(()=>processExamResultsDeletion(sql,owner,{action:'delete',examId:'legacy',confirmation:'1234',expectedCount:1}),(e:any)=>e.status===404);
  const preview=await processExamResultsDeletion(sql,admin,{action:'preview',examId:'legacy'});
  assert.equal(preview.count,1);
  assert.equal((await processExamResultsDeletion(sql,admin,{action:'delete',examId:'legacy',confirmation:'1234',expectedCount:1})).deletedCount,1);
  assert.deepEqual((await db.query('SELECT id FROM results ORDER BY id')).rows.map((x:any)=>x.id),['r1','r2','r3','r5']);
 }finally{await db.close();}
});
