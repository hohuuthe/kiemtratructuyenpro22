import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {convertSqliteToPostgres} from '../src/neon-adapter.ts';
import {parseManagementPage,resultsPageQuery,resultsFacetQuery,teacherOwnedExamNamesQuery} from '../src/management-page-queries.js';

const teacherA={id:'account-A',user_id:'profile-A',role:'teacher',
  assignedScopes:[{className:'12A',unit:'School X'}]};
const teacherB={id:'account-B',user_id:'profile-B',role:'teacher',
  assignedScopes:[{className:'12A',unit:'School X'}]};
const admin={id:'admin',role:'admin'};

async function fixture({sameExamIdOwnedByB=false}={}) {
  const db=new PGlite();
  await db.exec([
    'CREATE TABLE accounts(id text PRIMARY KEY,user_id text,username text);',
    'CREATE TABLE users(id text PRIMARY KEY,full_name text,donvi text);',
    'CREATE TABLE exam_configs(id text PRIMARY KEY,name text,creator_id text);',
    'CREATE TABLE results(id text PRIMARY KEY,user_id text,student_name text,student_class text,score numeric,correct_count int,total_questions int,time_taken int,exam_name text,exam_id text,created_at text,loai_thi_sinh text,cheat_warning_count int,ai_grading_summary text,lop text,don_vi text);',
    "INSERT INTO accounts VALUES ('account-A','profile-A','teacher.a'),('account-B','profile-B','teacher.b');",
    "INSERT INTO users VALUES ('profile-A','Teacher A','School X'),('profile-B','Teacher B','School X');",
    "INSERT INTO exam_configs VALUES ('exam-A-legacy','Đề cũ','profile-A'),('exam-A-empty','Chưa có bài làm','account-A'),('exam-B','Cùng tên','account-B'),('exam-B-only','Đề riêng B','profile-B');",
    "INSERT INTO results(id,exam_id,exam_name,student_name,student_class,lop,don_vi,score,created_at) VALUES ('result-A','exam-A','Cùng tên','Student 1','12A','12A','School X',9,'2026-10-29'),('result-legacy','exam-A-legacy','Đề cũ','Student 1','12A','12A','School X',8,'2026-10-28'),('result-B','exam-B','Cùng tên','Student 1','12A','12A','School X',7,'2026-10-27'),('result-B-only','exam-B-only','Đề riêng B','Student 1','12A','12A','School X',6,'2026-10-26'),('result-orphan','removed-exam','Chưa xác định','Student 1','12A','12A','School X',5,'2026-10-25');"
  ].join('\n'));
  await db.query('INSERT INTO exam_configs VALUES ($1,$2,$3)',
    ['exam-A','Cùng tên',sameExamIdOwnedByB?'account-B':'account-A']);
  const query=(sql,args=[])=>db.query(convertSqliteToPostgres(sql),args);
  return {db,query};
}

test('Two teachers sharing a class and an exam title see only their own exam IDs',async()=>{
  const {db,query}=await fixture();
  try{
    const page=parseManagementPage('https://app.test/api/results-page?facets=1');
    const a=resultsPageQuery(page,teacherA);
    assert.deepEqual((await query(a.rowsSQL,a.rowsArgs)).rows.map(x=>x.id).sort(),['result-A','result-legacy']);
    assert.equal(Number((await query(a.countSQL,a.countArgs)).rows[0].total),2);
    assert.ok(!a.rowsArgs.includes('12A'));
    assert.deepEqual(a.countArgs,['account-A','profile-A']);
    const facets=resultsFacetQuery(teacherA);
    assert.deepEqual((await query(facets.sql,facets.args)).rows.map(r=>r.exam).sort(),['Cùng tên','Đề cũ'].sort());
    const b=resultsPageQuery(page,teacherB);
    assert.deepEqual((await query(b.rowsSQL,b.rowsArgs)).rows.map(r=>r.id).sort(),
      ['result-B','result-B-only'].sort());
    const all=resultsPageQuery(page,admin);
    assert.equal((await query(all.rowsSQL,all.rowsArgs)).rows.length,5);
  }finally{await db.close();}
});

test('Teacher selector includes owned exams with no submissions, excludes foreign titles',async()=>{
  const {db,query}=await fixture();
  try{
    const a=teacherOwnedExamNamesQuery(teacherA);
    const titles=(await query(a.sql,a.args)).rows.map(x=>x.name).sort();
    assert.deepEqual(titles,['Chưa có bài làm','Cùng tên','Đề cũ'].sort());
    const b=teacherOwnedExamNamesQuery(teacherB);
    const bTitles=(await query(b.sql,b.args)).rows.map(x=>x.name);
    assert.ok(bTitles.includes('Đề riêng B'));
    assert.ok(!bTitles.includes('Chưa có bài làm'));
    assert.deepEqual(a.args,['account-A','profile-A']);
    assert.throws(()=>teacherOwnedExamNamesQuery(admin),/Verified teacher/);
    assert.throws(()=>resultsPageQuery(parseManagementPage('https://app.test'),{id:'student',role:'student'}),/Teacher login required/);
  }finally{await db.close();}
});

test('Editing query teacher, class, school and title cannot widen teacher ownership',async()=>{
  const {db,query}=await fixture();
  try{
    for(const suffix of [
      '?teacher=account-B&exam=C%C3%B9ng%20t%C3%AAn&class=12A&unit=School%20X',
      '?teacher=account-B&search=Student&exam=C%C3%B9ng%20t%C3%AAn'
    ]){
      const page=parseManagementPage('https://app.test/api/results-page'+suffix);
      const q=resultsPageQuery(page,teacherA);
      assert.deepEqual((await query(q.rowsSQL,q.rowsArgs)).rows.map(x=>x.id),['result-A']);
      assert.ok(!q.countArgs.includes('account-B'));
      assert.match(q.countSQL,/ec\.id=r\.exam_id AND ec\.creator_id IN \(\?,\?\)/);
    }
  }finally{await db.close();}
});

test('Separate tenant databases with the same IDs remain isolated by verified creator',async()=>{
  const {db,query}=await fixture({sameExamIdOwnedByB:true});
  try{
    const q=resultsPageQuery(parseManagementPage('https://tenant-b/api/results-page'),teacherA);
    assert.deepEqual((await query(q.rowsSQL,q.rowsArgs)).rows.map(x=>x.id),['result-legacy']);
    const x=teacherOwnedExamNamesQuery(teacherA);
    assert.ok(!(await query(x.sql,x.args)).rows.map(r=>r.name).includes('Cùng tên'));
  }finally{await db.close();}
});

test('Cloudflare and Express share strict gates and frontend has no unlocked-name fallback',()=>{
  const cloudPage=readFileSync('functions/api/results-page.ts','utf8');
  const express=readFileSync('server.ts','utf8');
  const cloudResults=readFileSync('functions/api/results.ts','utf8');
  const cloudExams=readFileSync('functions/api/exams.ts','utf8');
  const markup=readFileSync('public/components/tab-ranking.html','utf8');
  const ui=readFileSync('src/main.js','utf8');
  assert.match(cloudPage,/teacherOwnedExamNamesQuery\(verified\)/);
  assert.match(express,/teacherOwnedExamNamesQuery\(verified\)/);
  assert.match(cloudResults,/if \(isTeacher\) \{[\s\S]*?SELECT id FROM exam_configs WHERE id = \? AND creator_id IN \(\?, \?\)/);
  assert.match(express,/if \(isTeacher\) \{[\s\S]*?SELECT id FROM exam_configs WHERE id = \? AND creator_id IN \(\?, \?\)/);
  const expResults=express.slice(express.indexOf('app.get("/api/results"'));
  const from=expResults.indexOf('// Never widen the exam-result list by classroom membership');
  const teacherList=expResults.slice(from,expResults.indexOf('if (isStudent) {',from));
  assert.doesNotMatch(teacherList,/assignedClassNames|WHERE .*student_class/);
  assert.match(teacherList,/WHERE r\.exam_id IN \(\$\{placeholders\}\)/);
  assert.match(teacherList,/SELECT \$\{fallbackColumns\} FROM results r WHERE r\.exam_id IN/);
  assert.match(cloudExams,/if \(isTeacher && !isExamOwner\(user,row\)\)/);
  assert.match(express,/if \(isTeacher && !isExamOwner\(user,row\)\)/);
  assert.match(markup,/id="ranking-shared-results-control"/);
  assert.match(ui,/if \(isTeacherLoggedIn && !isAdminLoggedIn\) \{[\s\S]*?rankingFacetCache\.exams/);
  assert.match(ui,/if \(isTeacher\) filteredResults = \[\];/);
  const options=ui.slice(ui.indexOf('function populateRankingExamFilter()'),ui.indexOf('let rankingUnitSelectionInitialized'));
  assert.doesNotMatch(options,/isUnlocked|unlockedExamIds/);
  assert.match(ui,/window\.loadSharedResultsByCode = async function\(\) \{[\s\S]*?if \(isTeacherLoggedIn && !isAdminLoggedIn\)/);
});
