import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EXAM_ATTEMPT_LIMIT_CODE,makeExamAttemptLimitError,readExamAttemptLimitRejection,countCachedStudentExamAttempts} from '../src/student-exam-attempt-limit.js';

test('structured exhausted attempt message includes complete counters',()=>{
 const response=makeExamAttemptLimitError(3,3);
 assert.equal(response.code,EXAM_ATTEMPT_LIMIT_CODE);
 assert.equal(response.attempts_used,3);
 assert.equal(response.max_attempts,3);
 assert.equal(response.remaining_attempts,0);
 assert.match(response.error,/3\/3/);
});
test('403 exhausted response is distinguished from other access denials',()=>{
 const body=makeExamAttemptLimitError(2,2);
 assert.deepEqual(readExamAttemptLimitRejection(403,body),{code:EXAM_ATTEMPT_LIMIT_CODE,attemptsUsed:2,maxAttempts:2});
 assert.equal(readExamAttemptLimitRejection(403,{error:'Mật mã không đúng'}),null);
 assert.equal(readExamAttemptLimitRejection(503,{error:'CSDL không hoạt động'}),null);
 assert.equal(readExamAttemptLimitRejection(403,{error:'Lớp học không phù hợp'}),null);
});
test('cached counts never count another signed-in student by matching full name',()=>{
 const rows=[{id:'a',exam_id:'exam',user_id:'alice',student_name:'Trùng Tên'},
 {id:'b',exam_id:'exam',user_id:'bob',student_name:'Trùng Tên'},
 {id:'c',exam_id:'different',user_id:'alice',student_name:'Trùng Tên'}];
 assert.equal(countCachedStudentExamAttempts(rows,{examId:'exam',examName:'Bài thi',studentName:'Trùng Tên',userIds:['alice']}),1);
 assert.equal(countCachedStudentExamAttempts(rows,{examId:'exam',examName:'Bài thi',studentName:'Trùng Tên',userIds:['bob']}),1);
});
test('both API runtimes reject exhausted attempts with structured code and do not silently permit count query failures',()=>{
 for(const file of ['server.ts','functions/api/exam/generate.ts']){
  const code=readFileSync(file,'utf8');
  assert.match(code,/makeExamAttemptLimitError\(attemptCount,\s*maxAttemptsVal\)/);
  assert.match(code,/EXAM_ATTEMPT_CHECK_UNAVAILABLE/);
  assert.match(code,/503/);
 }
});
test('UI dialog does not enter fullscreen until server accepts and always releases busy state',()=>{
 const code=readFileSync('src/main.js','utf8');
 const start=code.indexOf('window.startExam = async function startExam(btn)');
 const end=code.indexOf('function generateExamQuestions()',start);
 assert.ok(start>0&&end>start);
 const flow=code.slice(start,end);
 assert.doesNotMatch(flow,/enterExamFullscreen/);
 assert.match(flow,/readExamAttemptLimitRejection\(response.status,parsedError\)/);
 assert.match(flow,/showStudentAttemptLimitDialog/);
 assert.match(flow,/AbortController/);
 assert.match(flow,/requestTimeout/);
 assert.match(flow,/window\._studentExamStartPending=false/);
 assert.match(flow,/examStartedSuccessfully/);
 assert.match(flow,/examForm/);
 assert.doesNotMatch(flow,/if\s*\(localAttempts\s*>=\s*maxAttemptsVal\)/);
 assert.match(code,/id="exam-attempt-limit-close"/);
});
