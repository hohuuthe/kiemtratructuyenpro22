import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requiredQuestionLesson,requireQuestionLessonConfirmation,questionLessonDeleteScope,questionLessonCountQuery,questionLessonDeleteQuery} from '../src/question-lesson-delete-policy.ts';
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
test('Cloudflare, Node and UI enforce a consistent contract',()=>{
 const cf=readFileSync('functions/api/questions.ts','utf8');
 const node=readFileSync('server.ts','utf8');
 const ui=readFileSync('src/main.js','utf8');
 const html=readFileSync('public/components/tab-questions.html','utf8');
 const route=readFileSync('functions/api/questions/delete-by-lesson.ts','utf8');
 assert.match(cf,/verifyAuthSession/);
 assert.match(cf,/checkIsTeacherOrAdmin\(user\)/);
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
