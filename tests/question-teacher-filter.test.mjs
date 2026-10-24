import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {questionCreatorId,matchesQuestionTeacher,questionTeacherOptions} from '../src/question-teacher-filter.js';

const questions=[
 {id:'a1',creatorId:'teacher-a',lesson:'Bài 1',type:'4-1'},
 {id:'a2',creator_id:'teacher-a',lesson:'Bài 2',type:'SQ'},
 {id:'b1',creatorId:'teacher-b',lesson:'Bài 1',type:'4-1'},
 {id:'b2',creatorId:'teacher-b',lesson:'Bài 2',type:'TF4'},
 {id:'z1',creatorId:'teacher-abc',lesson:'Bài 2',type:'SQ'},
 {id:'n1',lesson:'Bài 1',type:'SQ'}
];
const accounts=[
 {id:'teacher-a',username:'gva',full_name:'Nguyễn Văn A'},
 {id:'teacher-b',username:'gvb',full_name:'Nguyễn Văn A'}
];
test('Match exact creator account ID, not teacher name or prefix',()=>{
 assert.equal(questionCreatorId({creatorId:'teacher-a',creator_id:'ignored'}),'teacher-a');
 assert.equal(questionCreatorId({creator_id:'teacher-a'}),'teacher-a');
 assert.equal(questionCreatorId({}), '');
 assert.deepEqual(questions.filter(q=>matchesQuestionTeacher(q,'teacher-a')).map(q=>q.id),['a1','a2']);
 assert.deepEqual(questions.filter(q=>matchesQuestionTeacher(q,'teacher-b')).map(q=>q.id),['b1','b2']);
 assert.deepEqual(questions.filter(q=>matchesQuestionTeacher(q,'teacher-abc')).map(q=>q.id),['z1']);
 assert.equal(questions.filter(q=>matchesQuestionTeacher(q,'')).length,questions.length);
 assert.equal(questions.filter(q=>matchesQuestionTeacher(q,'nonexistent')).length,0);
});
test('Admin dropdown lists only unique creators of available questions and resolves duplicate names safely',()=>{
 const opts=questionTeacherOptions(questions,accounts,{id:'admin-1'},true);
 assert.deepEqual(opts.map(o=>o.id).sort(),['teacher-a','teacher-b','teacher-abc']);
 assert.match(opts.find(o=>o.id==='teacher-a').label,/gva/);
 assert.match(opts.find(o=>o.id==='teacher-b').label,/gvb/);
 assert.match(opts.find(o=>o.id==='teacher-abc').label,/teacher-abc/);
 assert.equal(new Set(opts.map(o=>o.label)).size,opts.length);
 assert.equal(questionTeacherOptions(questions,accounts,{id:'teacher-a'},false).length,0);
});
test('Display names can contain HTML but will only become DOM option text',()=>{
 const opts=questionTeacherOptions([{creatorId:'teacher-x'}],[{id:'teacher-x',full_name:'<img src=x onerror=alert(1)>'}],{id:'admin'},true);
 assert.equal(opts[0].label,'<img src=x onerror=alert(1)>');
 const src=readFileSync('src/main.js','utf8');
 assert.match(src,/select\.add\(new Option\(entry\.label, entry\.id\)\)/);
 assert.match(src,/escapeHTML\(accountsMap\[questionCreatorId\(q\)\]/);
});
test('UI uses the teacher filter in all dependent bank operations and resets selection on change',()=>{
 const src=readFileSync('src/main.js','utf8');
 const html=readFileSync('public/components/tab-questions.html','utf8');
 assert.match(html,/id="question-teacher-filter"/);
 assert.match(html,/onchange="onQuestionTeacherFilterChange\(\)"/);
 assert.match(src,/function updateQuestionTeacherFilter\(\)/);
 assert.match(src,/function getSelectedQuestionTeacherId\(\)/);
 assert.match(src,/window\.onQuestionTeacherFilterChange = function\(\) \{\s*selectedQuestionIds\.clear\(\)/);
 assert.match(src,/let lastQuestionsTeacherFilter = ''/);
 assert.match(src,/function updateLessonFilter\(\) \{[\s\S]{0,250}matchesQuestionTeacher\(q, selectedTeacher\)/);
 assert.match(src,/function updateQuestionStats\(\) \{[\s\S]{0,420}matchesQuestionTeacher\(q, selectedTeacher\)/);
 assert.match(src,/function renderQuestionsList\(\) \{[\s\S]{0,1300}matchesQuestionTeacher\(q, teacherFilter\)/);
 assert.match(src,/window\.selectAllQuestions = function selectAllQuestions\(\) \{[\s\S]{0,620}matchesQuestionTeacher\(q, teacherFilter\)/);
 assert.match(src,/isAdminLoggedIn \? \(document\.getElementById\('question-teacher-filter'\)\?\.value \|\| ''\) : ''/);
 assert.match(src,/teacherFiltered = isAdminLoggedIn && !!getSelectedQuestionTeacherId\(\)/);
 assert.match(src,/if \(isAdminLoggedIn && getSelectedQuestionTeacherId\(\)\) return showToast/);
 assert.match(src,/select\.disabled = !isAdminLoggedIn/);
 assert.match(src,/accountsMap = \{\}/);
});
test('Server remains the source of authorization: teacher questions are server-scoped',()=>{
 const cf=readFileSync('functions/api/questions.ts','utf8');
 const node=readFileSync('server.ts','utf8');
 assert.match(cf,/if \(!isAdmin\) \{\s*query \+= " WHERE creator_id = \?"/);
 assert.match(node,/WHERE creator_id = \?/);
 assert.doesNotMatch(readFileSync('src/question-teacher-filter.js','utf8'),/fetch\(|delete\s+from/i);
});
