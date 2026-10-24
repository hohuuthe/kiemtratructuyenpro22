import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requiredQuestionLesson,requireQuestionLessonConfirmation,questionLessonDeleteScope,questionLessonCountQuery,questionLessonDeleteQuery,canDeleteQuestionsByLesson} from '../src/question-lesson-delete-policy.ts';
import {PGlite} from '@electric-sql/pglite';
import {convertSqliteToPostgres} from '../src/neon-adapter.ts';
test('Only administrators and teachers have scoped bulk-delete privileges',()=>{
 for(const u of [null,{}, {role:'khác',target_audience:'Khác'}, {role:'student',target_audience:'Học sinh'}, {role:'user',target_audience:'Học sinh'}]){
  assert.equal(canDeleteQuestionsByLesson(u),false);
 }
 for(const u of [{role:'admin'}, {role:'teacher'}, {role:'giáo viên'}, {role:'user',target_audience:'Giáo viên'}]){
  assert.equal(canDeleteQuestionsByLesson(u),true);
 }
});
test('Require exact selected lesson; never accept empty or all-lessons choice',()=>{
 for(const value of ['',null,undefined,123,'  '])assert.throws(()=>requiredQuestionLesson(value));
 assert.equal(requiredQuestionLesson('BÀI 2'),'BÀI 2');
 assert.equal(requiredQuestionLesson(' BÀI 2 '),' BÀI 2 ');
});
test('123 is required server-side, and expected count must be valid',()=>{
 for(const value of ['','12',' 123','123 ','0123',123,'456',null])assert.throws(()=>requireQuestionLessonConfirmation(value,2));
 assert.throws(()=>requireQuestionLessonConfirmation('123',0));
 assert.throws(()=>requireQuestionLessonConfirmation('123',-1));
 assert.equal(requireQuestionLessonConfirmation('123',2),2);
});
test('Teacher may only delete matching questions owned by their exact account ID',()=>{
 const scope=questionLessonDeleteScope('BÀI 1','teacher-a',false);
 assert.deepEqual(scope.params,['BÀI 1','teacher-a']);
 const q=questionLessonDeleteQuery(scope,4);
 assert.equal(q.sql,'DELETE FROM questions WHERE lesson = ? AND creator_id = ? AND (SELECT COUNT(*) FROM questions WHERE lesson = ? AND creator_id = ?) = ?');
 assert.deepEqual(q.params,['BÀI 1','teacher-a','BÀI 1','teacher-a',4]);
 const count=questionLessonCountQuery(scope);
 assert.deepEqual(count.params,['BÀI 1','teacher-a']);
});
test('Admin has explicit cross-owner scope, not implicit teacher scope',()=>{
 const scope=questionLessonDeleteScope('BÀI 3','admin-1',true);
 assert.deepEqual(scope.params,['BÀI 3']);
 assert.deepEqual(questionLessonDeleteQuery(scope,3).params,['BÀI 3','BÀI 3',3]);
});
test('Lesson-delete confirmation dialog fits its content on desktop and mobile',()=>{
 const ui=readFileSync('src/main.js','utf8');
 const start=ui.indexOf('const modalContent=\'<div class="p-4 space-y-3 text-sm">\'+');
 const end=ui.indexOf("document.getElementById('delete-lesson-name').textContent=lesson;",start);
 assert.ok(start>=0 && end>start,'Compact lesson dialog markup exists');
 const dialog=ui.slice(start,end);
 assert.match(dialog,/showModal\(modalContent,'compact'\)/);
 assert.match(dialog,/style\.width = 'min\(340px, calc\(100vw - 24px\)\)'/);
 assert.match(dialog,/id="delete-lesson-name"/);
 assert.match(dialog,/overflow-wrap:anywhere/,'Long lesson names must wrap');
 assert.match(dialog,/id="delete-lesson-count"/);
 assert.match(dialog,/id="delete-lesson-confirmation"/);
 assert.match(dialog,/id="delete-lesson-cancel"/);
 assert.match(dialog,/id="delete-lesson-submit"/);
 assert.match(dialog,/preview\.scope==='all'/,'Explicit admin scope remains visible');
 assert.match(dialog,/Không thể hoàn tác/);
 assert.doesNotMatch(dialog,/sm:p-6 space-y-4|w-full px-3 py-2 border rounded-lg/,'No unnecessarily wide input or generous padding');
});
test('Cloudflare, Node and UI enforce a consistent contract',()=>{
 const cf=readFileSync('functions/api/questions.ts','utf8');
 const node=readFileSync('server.ts','utf8');
 const ui=readFileSync('src/main.js','utf8');
 const html=readFileSync('public/components/tab-questions.html','utf8');
 const route=readFileSync('functions/api/questions/delete-by-lesson.ts','utf8');
 assert.match(cf,/verifyAuthSession/);
 assert.match(cf,/checkIsTeacherOrAdmin\(user\)/);
 assert.match(cf,/canDeleteQuestionsByLesson\(user\)/);
 assert.match(node,/canDeleteQuestionsByLesson\(user\)/);
 assert.match(cf,/questionLessonDeleteQuery\(scope,expected\)/);
 assert.match(node,/app\.post\("\/api\/questions\/delete-by-lesson"/);
 assert.match(node,/questionLessonDeleteQuery\(scope,expected\)/);
 assert.match(route,/onRequestPostDeleteLesson/);
 assert.match(html,/id="btn-delete-question-lesson"/);
 assert.match(ui,/window\.deleteQuestionsBySelectedLesson = async function/);
 assert.match(ui,/confirmation:code,expectedCount:preview\.count/);
 assert.match(ui,/if\(code!=='123'\)/);
 assert.match(ui,/await loadQuestions\(true\)/);
});

test('Real PostgreSQL prevents stale-count deletion and enforces teacher owner and exact lesson',async()=>{
 const db=new PGlite();
 const execute=(stmt)=>db.query(convertSqliteToPostgres(stmt.sql),stmt.params);
 try{
  await db.exec('CREATE TABLE questions (id TEXT PRIMARY KEY, lesson TEXT NOT NULL, creator_id TEXT NOT NULL)');
  await db.exec("INSERT INTO questions(id,lesson,creator_id) VALUES ('a1','BÀI 1','teacher-a'),('a2','BÀI 1','teacher-a'),('b1','BÀI 1','teacher-b'),('c1','BÀI 2','teacher-a')");
  const teacher=questionLessonDeleteScope('BÀI 1','teacher-a',false);
  const before=await execute(questionLessonCountQuery(teacher));
  assert.equal(Number(before.rows[0].total),2);
  const stale=await execute(questionLessonDeleteQuery(teacher,1));
  assert.equal(stale.affectedRows,0,'Mismatched expected count must not delete any rows');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM questions')).rows[0].n,4);
  const deleted=await execute(questionLessonDeleteQuery(teacher,2));
  assert.equal(deleted.affectedRows,2);
  assert.deepEqual((await db.query('SELECT id FROM questions ORDER BY id')).rows.map(x=>x.id),['b1','c1']);
  const admin=questionLessonDeleteScope('BÀI 1','admin-1',true);
  const adminDeleted=await execute(questionLessonDeleteQuery(admin,1));
  assert.equal(adminDeleted.affectedRows,1);
  assert.deepEqual((await db.query('SELECT id FROM questions')).rows.map(x=>x.id),['c1']);
 }finally{await db.close();}
});
