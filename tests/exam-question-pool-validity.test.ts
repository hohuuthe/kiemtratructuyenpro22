import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExamQuestionPool } from '../src/exam-question-pool-validity';

function q(id:string,type:string,level:string,lesson='Bài 1') {
  const options = type === '4-1' ? {A:'A',B:'B',C:'C',D:'D'} : {};
  const answer = type === '4-1' ? 'A' : type === 'TF4' ? {A:true,B:false,C:true,D:false} : type === 'SQ' ? 'đáp án' : 'hướng dẫn';
  return {id,type,level,lesson,content:'Câu '+id,options,answer,creator_id:'gv1'};
}

test('valid exam remains valid when DB pool satisfies exact totals and levels', () => {
  const config:any = {
    name:'Đề đủ',
    selected_lessons:['Bài 1'],
    count_41:3,count_tf4:0,count_sq:0,count_tl:0,
    counts_detail:{count41NB:1,count41TH:1,count41VD:1}
  };
  const result=validateExamQuestionPool(config,[q('1','4-1','NB'),q('2','4-1','TH'),q('3','4-1','VD')]);
  assert.equal(result.valid,true);
  assert.equal(result.shortages.length,0);
});

test('deleting one DB question makes stored exam invalid with explicit shortage', () => {
  const config:any = {
    name:'Đề bị thiếu',
    selected_lessons:['Bài 1'],
    count_41:3,count_tf4:0,count_sq:0,count_tl:0,
    counts_detail:{count41NB:1,count41TH:1,count41VD:1}
  };
  const result=validateExamQuestionPool(config,[q('1','4-1','NB'),q('2','4-1','TH')]);
  assert.equal(result.valid,false);
  assert.equal(result.code,'EXAM_QUESTION_POOL_INVALID');
  assert.ok(result.shortages.some(s=>s.type==='4-1'&&s.level==='TOTAL'&&s.missing===1));
  assert.ok(result.shortages.some(s=>s.type==='4-1'&&s.level==='VD'&&s.missing===1));
  assert.match(result.message,/không còn hợp lệ/i);
  assert.match(result.message,/xóa đề/i);
  assert.match(result.message,/chỉnh sửa/i);
});

test('reducing configuration to currently available DB pool restores validity', () => {
  const questions=[q('1','4-1','NB'),q('2','4-1','TH')];
  const before:any = {
    name:'Đề sửa',
    selected_lessons:['Bài 1'],
    count_41:3,count_tf4:0,count_sq:0,count_tl:0,
    counts_detail:{count41NB:1,count41TH:1,count41VD:1}
  };
  assert.equal(validateExamQuestionPool(before,questions).valid,false);
  const repaired:any={...before,count_41:2,counts_detail:{count41NB:1,count41TH:1,count41VD:0}};
  assert.equal(validateExamQuestionPool(repaired,questions).valid,true);
});

test('questions outside selected lessons never satisfy the exam', () => {
  const config:any={
    name:'Đề bài 1',selected_lessons:['Bài 1'],
    count_41:1,count_tf4:0,count_sq:0,count_tl:0,
    counts_detail:{count41NB:1,count41TH:0,count41VD:0}
  };
  const result=validateExamQuestionPool(config,[q('1','4-1','NB','Bài 2')]);
  assert.equal(result.valid,false);
  assert.equal(result.availableByType['4-1'],0);
});

test('invalid MCQ content is not counted as available', () => {
  const config:any={
    name:'Đề lỗi đáp án',selected_lessons:['Bài 1'],
    count_41:1,count_tf4:0,count_sq:0,count_tl:0,
    counts_detail:{count41NB:1,count41TH:0,count41VD:0}
  };
  const bad={...q('1','4-1','NB'),options:{A:'A',B:'B',C:'C'},answer:'A'};
  const result=validateExamQuestionPool(config,[bad]);
  assert.equal(result.valid,false);
  assert.equal(result.availableByType['4-1'],0);
});
