import test from 'node:test';
import assert from 'node:assert/strict';
import { projectStudentResultRow, projectStudentAttemptDetails, studentExamVisibility } from '../src/student-result-visibility.ts';

test('Visibility flags fail closed and honor 0/1, booleans and strings', () => {
  for (const flag of [undefined,null,0,false,'false','0','off','',2]) {
    assert.deepEqual(studentExamVisibility({exam_show_score:flag,exam_show_details:flag}),{can_view_score:false,can_view_details:false});
  }
  assert.deepEqual(studentExamVisibility({exam_show_score:'1',exam_show_details:true}),{can_view_score:true,can_view_details:true});
});
test('Hidden marks do not leak score, correct count, grading key, internal feedback or nested answer',()=>{
  const row={id:'r1',exam_id:'ex1',exam_name:'Practice',score:9,correct_count:9,total_questions:10,time_taken:60,created_at:'2026-10-24',exam_show_score:0,exam_show_details:1};
  const list=projectStudentResultRow(row);
  assert.equal(list.score,null);assert.equal(list.correct_count,null);
  assert.equal(list.can_view_score,false);assert.equal(list.can_view_details,true);
  const details=projectStudentAttemptDetails(JSON.stringify([{
    question:{type:'4-1',content:'Q?',options:{A:'First',B:'Second',answerImage:'PRIVATE_IMAGE'},answer:'A',correctAnswer:'A',aiGradingKey:'PRIVATE_KEY',image:'https://example.org/x.png'},
    userAnswer:'B',correctAnswer:'A',isCorrect:false,score:0,aiFeedback:'PRIVATE_FEEDBACK'
  }]),false);
  const data=JSON.stringify(details);
  for(const forbidden of ['PRIVATE_KEY','PRIVATE_IMAGE','PRIVATE_FEEDBACK','isCorrect','"score":','"answer":'])assert.ok(!data.includes(forbidden),forbidden);
  assert.equal(details[0].question.options.A,'First');
  assert.equal(details[0].userAnswer,'B');
  assert.equal(details[0].correctAnswer,'A');
});
test('Score visible returns the authorized answer but no embedded keys or grading feedback',()=>{
  const details=projectStudentAttemptDetails([{question:{type:'SQ',content:'Q',answer:'SECRET'},userAnswer:'test',correctAnswer:'SECRET',score:1,isCorrect:true,aiFeedback:'SECRET_NOTE'}],true);
  assert.equal(details[0].score,1);assert.equal(details[0].isCorrect,true);
  assert.equal(details[0].correctAnswer,'SECRET');
  assert.ok(!JSON.stringify(details).includes('SECRET_NOTE'));
});
