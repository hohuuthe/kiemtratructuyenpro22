import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveRankingDeleteExamTargets} from '../src/ranking-delete-exam-targets.js';

const teacher={id:'account-A',user_id:'profile-A'};
const configs=[
  {id:'exam-A',name:'Trùng tên',creator_id:'profile-A'},
  {id:'exam-B',name:'Trùng tên',creator_id:'profile-B'},
  {id:'exam-C',name:'Khác',creator_id:'profile-A'},
  {id:'exam-D',name:'Trùng tên',creator_id:'account-A'}
];
test('Admin sees all exact IDs for a duplicate exam title',()=>{
  assert.deepEqual(resolveRankingDeleteExamTargets('Trùng tên',configs,teacher,true).map(e=>e.id),['exam-A','exam-B','exam-D']);
});
test('Teacher may only select owned exams, including historical profile creator',()=>{
  assert.deepEqual(resolveRankingDeleteExamTargets('Trùng tên',configs,teacher,false).map(e=>e.id),['exam-A','exam-D']);
  assert.deepEqual(resolveRankingDeleteExamTargets('Khác',configs,teacher,false).map(e=>e.id),['exam-C']);
});
test('No all-exams option, orphan or non-owned exam is ever a deletion target',()=>{
  for(const value of ['',null,undefined,' ', 'Other']){
    assert.deepEqual(resolveRankingDeleteExamTargets(value,configs,teacher,true),[]);
  }
  assert.deepEqual(resolveRankingDeleteExamTargets('Trùng tên',configs,null,true),[]);
  assert.deepEqual(resolveRankingDeleteExamTargets('Trùng tên',[{id:'',name:'Trùng tên'},{id:'exam-X',name:'Trùng tên'}],teacher,false),[]);
});
test('QL Ket qua UI uses the existing ID-scoped server preview + 1234 confirmation',()=>{
  const markup=readFileSync('public/components/tab-ranking.html','utf8');
  const code=readFileSync('src/main.js','utf8');
  assert.match(markup,/id="btn-delete-exam-ranking-results"/);
  assert.match(markup,/onclick="openRankingDeleteResultsByExam\(\)"/);
  assert.match(markup,/id="ranking-exam-filter"/);
  assert.match(code,/resolveRankingDeleteExamTargets\(selected, configs, currentUser, isAdminLoggedIn\)/);
  assert.match(code,/fetchAllExamsChunked\(\)/);
  assert.match(code,/targets\.length === 1/);
  assert.match(code,/ranking-delete-exam-id/);
  assert.match(code,/window\.deleteExamResultsByExamId\(encodeURIComponent\(id\)\)/);
  assert.match(code,/updateRankingDeleteExamButton\(\)/);
  assert.match(code,/expectedCount: count/);
  assert.match(code,/confirmation !== '1234'/);
  assert.match(code,/\/api\/results\/delete-by-exam/);
});
