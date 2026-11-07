import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync('src/main.js','utf8');
function section(start,end){
 const a=app.indexOf(start); assert.ok(a>=0,'missing '+start);
 const b=app.indexOf(end,a+start.length); assert.ok(b>a,'missing '+end);
 return app.slice(a,b);
}

test('shared question loader supports an explicit teacher scope',()=>{
 const fetch=section('async function fetchAllQuestionsChunked(onProgress, teacherId = null)','window.fetchAllQuestionsChunked');
 assert.match(fetch,/teacherQuery/);
 assert.match(fetch,/count=true' \+ teacherQuery/);
 assert.match(fetch,/offset=' \+ offset \+ teacherQuery/);

 const load=section('async function loadQuestions(force = false, onProgress = null, teacherId = null)','async function ensureExamConfigQuestionPoolLoaded');
 assert.match(load,/questionBankScopeKey\(teacherId\)/);
 assert.match(load,/questionBankLoadedScope === requestedScope/);
 assert.match(load,/fetchAllQuestionsChunked\(onProgress, teacherId\)/);
 assert.match(load,/questionBankLoadedScope = requestedScope/);
});

test('Nạp đề uses same loading progress and downloads full owner question bank',()=>{
 const load=section('window.loadExamConfigById = async function loadExamConfigById','window.openExportDocxModal');
 assert.match(load,/showLoadingProgress\('Đang tải Ngân hàng Câu hỏi'/);
 assert.ok(!load.includes('showExamConfigLoadProgress('));
 assert.match(load,/const ownerTeacherId = String\(draft\.creatorId/);
 assert.match(load,/loadQuestions\(true,[\s\S]*ownerTeacherId\)/);
 assert.match(load,/Đang tải toàn bộ ngân hàng câu hỏi của giáo viên/);
 assert.match(load,/verifyExamConfigQuestionPool\(draft, questions\)/);
});

test('editor is not opened until the shared question progress has completed',()=>{
 const load=section('window.loadExamConfigById = async function loadExamConfigById','window.openExportDocxModal');
 const progressAwait=load.indexOf("const loadResult = await showLoadingProgress");
 const component=load.indexOf("await ensureTabComponent('exam-editor')");
 const apply=load.indexOf('applyExamConfig(payload.resJson.data)');
 const switchAt=load.indexOf("switchTab('exam-editor')");
 assert.ok(progressAwait>=0);
 assert.ok(component>progressAwait);
 assert.ok(apply>component);
 assert.ok(switchAt>apply);
});

test('question tab and exam loading share loadQuestions and real progress counts',()=>{
 const sw=section("if (tabName === 'questions' || tabName === 'exam-editor')","if (tabName === 'ranking' && currentUser");
 assert.match(sw,/showLoadingProgress\('Đang tải Ngân hàng Câu hỏi'/);
 assert.match(sw,/loadQuestions\(false,/);
 assert.match(sw,/loadedCount/);
 assert.match(sw,/totalCount/);
});

test('question bank cache is isolated by teacher scope',()=>{
 assert.ok(app.includes("return targetId ? ('teacher:' + targetId) : 'admin:all'"));
 assert.ok(app.includes("questionsLoadPromiseScope !== requestedScope"));
 assert.ok(app.includes("questionBankLoadedScope = '';"));
});
