import test from 'node:test';
import assert from 'node:assert/strict';
import {
  liveExamVisibility, assertGradingQuestionSources, boundStudentIdentity,
  publicExamSubmission, projectExamSubmissionDetails
} from '../src/exam-grading-safety.js';
import {readFileSync} from 'node:fs';

const trusted={id:'account-A',user_id:'student-A',full_name:'Verified Student',lop:'12A',donvi:'School A'};
const question={id:'q1',type:'TL',content:'Prompt',answer:'SENSITIVE',options:{
  A:'A',answerImage:'SENSITIVE_IMAGE',privateHint:'SENSITIVE_HINT'
}};
const details=[{question,userAnswer:'Submitted',correctAnswer:'SENSITIVE_KEY',score:1,
  aiFeedback:'PRIVATE_FEEDBACK',gradingStatus:'completed',needsGrading:false}];
test('live visibility rejects missing, false and disabled values',()=>{
  assert.deepEqual(liveExamVisibility({show_score:0,show_details:'0'}),{showScore:false,showDetails:false});
  assert.deepEqual(liveExamVisibility({show_score:1,show_details:1}),{showScore:true,showDetails:true});
  assert.deepEqual(liveExamVisibility({}),{showScore:false,showDetails:false});
});
test('grade refuses missing original question and absent objective answer key',()=>{
  assert.throws(()=>assertGradingQuestionSources(['q1'],{}),/EXAM_QUESTION_SOURCES_UNAVAILABLE/);
  assert.throws(()=>assertGradingQuestionSources(['q1'],{q1:{type:'4-1'}}),/EXAM_ANSWER_KEY_UNAVAILABLE/);
  assert.doesNotThrow(()=>assertGradingQuestionSources(['q1'],{q1:{type:'TL',answer:''}}));
});
test('never trust studentInfo.userId over authenticated account identity',()=>{
  assert.equal(boundStudentIdentity({userId:'victim',name:'Fake'},trusted).userId,'student-A');
  assert.equal(boundStudentIdentity({userId:'victim',name:'Guest'},null).userId,null);
});
test('hidden exam does not return points, answer or question grading snapshot',()=>{
  const p=publicExamSubmission({id:'r1',score:10,grading_status:'completed',
    correct_count:1,details:JSON.stringify(details)},{showScore:false,showDetails:false});
  assert.equal(p.score,null);
  assert.equal(p.correctCount,null);
  assert.deepEqual(p.detailedResults,[]);
  assert.equal(p.rawEarnedScore,null);
});
test('allowed details remove source answer keys nested in question',()=>{
  const p=projectExamSubmissionDetails(details,{showScore:true,showDetails:true});
  assert.equal(p.length,1);
  assert.equal(p[0].question.answer,undefined);
  assert.equal(p[0].question.options.answerImage,undefined);
  assert.equal(p[0].question.options.privateHint,undefined);
  assert.equal(p[0].correctAnswer,'SENSITIVE_KEY');
});
test('pending results cannot disclose provisional scores',()=>{
  const p=publicExamSubmission({id:'r2',score:null,grading_status:'retry_pending',
    details:JSON.stringify(details)},{showScore:true,showDetails:true});
  assert.equal(p.score,null);
  assert.equal(p.provisionalScore,null);
  assert.equal(p.rawEarnedScore,null);
});
test('both submission backends have source guards and signed user identity checks',()=>{
  for(const file of ['functions/api/exam/grade.ts','server.ts']){
    const code=readFileSync(file,'utf8');
    assert.match(code,/assertGradingQuestionSources\(questionIds,trueQuestionsMap\)/);
    assert.match(code,/signedStudentId/);
    assert.match(code,/boundStudentIdentity\(studentInfo/);
    assert.match(code,/publicExamSubmission\(/);
  }
});
test('results endpoint disallows unrelated teachers by exact exam ID',()=>{
  const code=readFileSync('functions/api/results.ts','utf8');
  assert.match(code,/const ownExam/);
  assert.match(code,/Đề thi không thuộc quyền của giáo viên/);
  assert.match(code,/const stored = Array.isArray\(original.details\)/);
});

test('admin must retain access while guest detail/roster is blocked in both runtimes',()=>{
  const pages=readFileSync('functions/api/results.ts','utf8');
  const express=readFileSync('server.ts','utf8');
  assert.match(pages,/\}\s*else if \(!isAdmin\)\s*\{/);
  assert.match(pages,/Danh sách kết quả chi tiết yêu cầu quyền giáo viên/);
  assert.match(express,/Chỉ giáo viên hoặc quản trị viên được xem danh sách bài thi/);
});
test('manual overrides keep original stored question and invalidate AI lease',()=>{
  for(const path of ['functions/api/results.ts','server.ts']){
    const code=readFileSync(path,'utf8');
    assert.match(code,/grading_lease_token = NULL, grading_lease_until = NULL/);
    assert.match(code,/SELECT details FROM results WHERE id = \?/);
    assert.match(code,/d\.gradingStatus='completed'/);
  }
});
