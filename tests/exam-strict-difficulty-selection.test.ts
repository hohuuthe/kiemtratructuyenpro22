import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectQuestionsStrictByDifficulty, orderSelectedExamQuestionsByType, ExamQuestionSelectionError } from '../src/exam-question-selector';

const identityShuffle = (items:any[]) => [...items];
const q = (id:string, level:string, type='4-1') => ({id, level, type});

test('selects exactly configured NB TH VD counts', () => {
  const pool=[
    q('nb1','NB'),q('nb2','NB'),q('nb3','NB'),
    q('th1','TH'),q('th2','TH'),
    q('vd1','VD'),q('vd2','VD')
  ];
  const selected=selectQuestionsStrictByDifficulty(pool,'4-1','Trắc nghiệm',5,2,2,1,identityShuffle);
  assert.equal(selected.length,5);
  assert.equal(selected.filter(x=>x.level==='NB').length,2);
  assert.equal(selected.filter(x=>x.level==='TH').length,2);
  assert.equal(selected.filter(x=>x.level==='VD').length,1);
});

test('never compensates missing VD with surplus NB or TH', () => {
  const pool=[
    q('nb1','NB'),q('nb2','NB'),q('nb3','NB'),q('nb4','NB'),
    q('th1','TH'),q('th2','TH'),q('th3','TH'),
    q('vd1','VD')
  ];
  assert.throws(
    () => selectQuestionsStrictByDifficulty(pool,'4-1','Trắc nghiệm',5,2,1,2,identityShuffle),
    (error:any) => {
      assert.ok(error instanceof ExamQuestionSelectionError);
      assert.match(error.message,/Vận dụng/);
      assert.match(error.message,/cần 2 câu/);
      assert.match(error.message,/chỉ có 1 câu/);
      assert.match(error.message,/không lấy câu ở mức độ khác để bù/i);
      return true;
    }
  );
});

test('rejects mismatch between detailed difficulty total and type total', () => {
  const pool=[q('1','NB'),q('2','TH'),q('3','VD')];
  assert.throws(
    () => selectQuestionsStrictByDifficulty(pool,'4-1','Trắc nghiệm',3,1,1,0,identityShuffle),
    /không khớp tổng số câu/
  );
});

test('legacy config with no difficulty breakdown still selects by total only', () => {
  const pool=[q('1','NB'),q('2','TH'),q('3','VD')];
  const selected=selectQuestionsStrictByDifficulty(pool,'4-1','Trắc nghiệm',2,0,0,0,identityShuffle);
  assert.deepEqual(selected.map(x=>x.id),['1','2']);
});

test('only matching question type can satisfy the configured type', () => {
  const pool=[q('1','NB','TF4'),q('2','TH','TF4'),q('3','VD','4-1')];
  assert.throws(
    () => selectQuestionsStrictByDifficulty(pool,'4-1','Trắc nghiệm',2,1,0,1,identityShuffle),
    /chỉ có 1 câu hợp lệ/
  );
});


test('mixed four-type exam groups questions without losing or duplicating IDs', () => {
  const selected=[
    q('tf-a','NB','TF4'),q('essay-a','VD','TL'),q('mc-a','TH','4-1'),
    q('short-a','TH','SQ'),q('mc-b','NB','4-1'),q('tf-b','VD','TF4'),
    q('essay-b','NB','TL'),q('short-b','NB','SQ')
  ];
  // Deliberately invert the order inside each group to prove shuffling still works.
  const result=orderSelectedExamQuestionsByType(selected, items=>[...items].reverse());
  assert.deepEqual(result.map(item=>item.type),['4-1','4-1','TF4','TF4','SQ','SQ','TL','TL']);
  assert.deepEqual(result.map(item=>item.id),['mc-b','mc-a','tf-b','tf-a','short-b','short-a','essay-b','essay-a']);
  assert.deepEqual([...result.map(item=>item.id)].sort(),selected.map(item=>item.id).sort());
  assert.deepEqual(selected.map(item=>item.id),['tf-a','essay-a','mc-a','short-a','mc-b','tf-b','essay-b','short-b'],'input remains immutable');
});

test('grouped exam omits missing categories and preserves one-type papers', () => {
  const selected=[q('essay-1','NB','TL'),q('tf-1','NB','TF4'),q('essay-2','TH','TL')];
  assert.deepEqual(orderSelectedExamQuestionsByType(selected,identityShuffle).map(item=>item.id),['tf-1','essay-1','essay-2']);
  assert.deepEqual(orderSelectedExamQuestionsByType([q('a','NB','SQ')],identityShuffle).map(item=>item.id),['a']);
  assert.deepEqual(orderSelectedExamQuestionsByType([],identityShuffle),[]);
});

test('unsupported question type cannot silently disappear from the frozen exam', () => {
  assert.throws(
    () => orderSelectedExamQuestionsByType([q('x','NB','unknown')],identityShuffle),
    ExamQuestionSelectionError
  );
});

test('generation uses grouped order before freezing signed IDs and grading snapshot', () => {
  const source=readFileSync('functions/api/exam/generate.ts','utf8');
  const ordered=source.indexOf('selectedQuestions = orderSelectedExamQuestionsByType(selectedQuestions, shuffle)');
  const ids=source.indexOf('const questionIds: any[] = selectedQuestions.map');
  const snapshot=source.indexOf('JSON.stringify(selectedQuestions)');
  assert.ok(ordered>=0 && ids>ordered && snapshot>ids);
  assert.doesNotMatch(source,/selectedQuestions = shuffle\(selectedQuestions\)/);
  const start=readFileSync('functions/api/exam/start.ts','utf8');
  const resume=readFileSync('functions/api/exam/resume.ts','utf8');
  assert.match(start,/const clientQuestions = frozenQuestions\.map/);
  assert.match(resume,/const questions = frozenQuestions\.map/);
});
