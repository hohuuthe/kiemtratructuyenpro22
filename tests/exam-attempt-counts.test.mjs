import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {getExamAttemptCount, syncExamAttemptCountCells} from '../src/exam-attempt-counts-ui.js';

test('Counts use immutable exam ID, not duplicated names or student identity', () => {
  const rows = [{id:'exam-A',name:'Kiểm tra',attempt_count:3},
    {id:'exam-B',name:'Kiểm tra',attempt_count:'2'},
    {id:'exam-C',name:'Khác',attempt_count:0}];
  assert.equal(getExamAttemptCount(rows,'exam-A'),3);
  assert.equal(getExamAttemptCount(rows,'exam-B'),2);
  assert.equal(getExamAttemptCount(rows,'exam-C'),0);
  assert.equal(getExamAttemptCount(rows,'exam-'),null);
  assert.equal(getExamAttemptCount(rows,'exam-UNKNOWN'),null);
});
test('Unavailable or malformed counts are never presented as zero', () => {
  for(const count of [undefined,null,-1,'-1','3.5','',NaN,Infinity,'999999999999999999999999','2e3']) {
    assert.equal(getExamAttemptCount([{id:'e',attempt_count:count}],'e'),null,String(count));
  }
  assert.equal(getExamAttemptCount([{id:'e',attempt_count:'0'}],'e'),0);
  assert.equal(getExamAttemptCount([{id:'e',attempt_count:'15'}],'e'),15);
});
test('Decorator preserves actions and empty-state colspan, updates without duplicate columns',()=>{
  const makeCell=()=>({textContent:'',title:'',className:'',attrs:{},
    setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];}});
  const idMarker={textContent:'exam-A',getAttribute:()=>null};
  const actionCell=makeCell();
  const row={lastElementChild:actionCell,ownerDocument:{createElement:()=>makeCell()},cells:[],
    querySelector(q){if(q==='.exam-config-id-value')return idMarker;
      if(q==='td.exam-attempt-count-cell')return this.cells[0]||null;return null;},
    insertBefore(cell,before){assert.equal(before,actionCell);this.cells.push(cell);}};
  const placeholder=makeCell();placeholder.setAttribute('colspan','10');
  const emptyRow={querySelector:q=>q==='td[colspan]'?placeholder:null};
  const root={querySelector:()=>({querySelectorAll:()=>[row,emptyRow]})};
  syncExamAttemptCountCells(root,[{id:'exam-A',attempt_count:3}]);
  assert.equal(row.cells.length,1);
  assert.equal(row.cells[0].textContent,'3');
  assert.equal(row.cells[0].attrs['data-exam-id'],'exam-A');
  assert.equal(placeholder.getAttribute('colspan'),'11');
  syncExamAttemptCountCells(root,[{id:'exam-A',attempt_count:4}]);
  assert.equal(row.cells.length,1);
  assert.equal(row.cells[0].textContent,'4');
  syncExamAttemptCountCells(root,[]);
  assert.equal(row.cells[0].textContent,'—');
});
test('Both API implementations count via exam_id and guard unauthorized counts',()=>{
  for(const path of ['functions/api/exams.ts','server.ts']){
    const code=readFileSync(path,'utf8');
    assert.match(code,/SELECT COUNT\(\*\) FROM results r WHERE r\.exam_id = ec\.id/);
    assert.match(code,/CASE WHEN ec\.creator_id IN \(\?, \?\)/);
    assert.match(code,/attemptCountProjection/);
    assert.match(code,/const params: any\[\] = isTeacher \? \[user\.id, user\.user_id \|\| user\.id\] : \[\];/);
  }
  assert.match(readFileSync('create_all_indexes.sql','utf8'),/idx_results_exam_id ON results\(exam_id\)/);
  const index=readFileSync('index.html','utf8');
  assert.ok(index.indexOf('/src/exam-attempt-counts-ui.js') < index.indexOf('/src/main.js'));
});
