import test from 'node:test';
import assert from 'node:assert/strict';
import { selectQuestionsStrictByDifficulty, ExamQuestionSelectionError } from '../src/exam-question-selector';

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
