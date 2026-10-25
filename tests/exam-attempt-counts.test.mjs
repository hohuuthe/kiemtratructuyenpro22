import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {getExamAttemptCount, parseExamAttemptCount} from '../src/exam-attempt-counts-ui.js';
import {formatExamCreatedAtVN} from '../src/exam-created-at-vn.js';

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
test('Main table renderer creates twelve cells including creation date and attempt count before actions', () => {
  const code=readFileSync('src/main.js','utf8');
  const start=code.indexOf('window.renderExamConfigsTable = function renderExamConfigsTable()');
  const end=code.indexOf('function renderExamConfigsPaginationControls(',start);
  assert.ok(start>=0 && end>start);
  const renderer=code.slice(start,end);
  const tbody={innerHTML:''};
  const context={
    window:{
      allExamConfigsList:[
        {id:'exam-A',name:'Duplicate title',creator_id:'teacher',count_41:12,time_limit:30,attempt_count:'3',created_at:'2026-10-24T17:30:05.000Z'},
        {id:'exam-B',name:'Duplicate title',creator_id:'teacher',count_41:5,time_limit:20,attempt_count:0,created_at:'2026-10-24 16:59:59'},
        {id:'exam-C',name:'Orphan count',creator_id:'teacher',count_41:1,time_limit:20,updated_at:'2026-10-25T05:00:00Z'}
      ],
      examConfigPageSize:30,
      examConfigCurrentPage:1
    },
    document:{getElementById(id){
      if(id==='exam-configs-table-body')return tbody;
      if(id==='search-exam-config-table')return {value:''};
      return null;
    }},
    updateExamManagementFilters(){},
    examManagementSelection(){return {creatorId:'',school:'',className:''};},
    matchesExamManagement(){return true;},
    renderExamConfigsPaginationControls(){},
    lastExamManagementFilterKey:'',
    accounts:[],
    accountsMap:{teacher:'Teacher'},
    currentUser:{id:'teacher'},
    isAdminLoggedIn:false,
    parseExamAttemptCount,
    formatExamCreatedAtVN,
    escapeHTML(value){return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');}
  };
  runInNewContext(renderer,context);
  context.window.renderExamConfigsTable();
  const rows=[...tbody.innerHTML.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(m=>m[1]);
  assert.equal(rows.length,3);
  for(const [i,row] of rows.entries()){
    const cells=[...row.matchAll(/<td\b[^>]*>[\s\S]*?<\/td>/g)].map(m=>m[0]);
    assert.equal(cells.length,12,'data row '+(i+1)+' must align with 12 headers');
    assert.match(cells[4],/class="exam-config-created-cell text-center"/);
    assert.match(cells[10],/class="exam-attempt-count-cell/);
    assert.match(cells[11],/class="exam-config-row-actions"/);
    assert.match(cells[10],/data-exam-id="exam-/);
  }
  const createdCell=row=>[...row.matchAll(/<td\b[^>]*>[\s\S]*?<\/td>/g)][4][0];
  assert.match(createdCell(rows[0]),/datetime="2026-10-24T17:30:05\.000Z"/);
  assert.match(createdCell(rows[0]),/exam-config-created-hour">00:30:05<\/span>/);
  assert.match(createdCell(rows[0]),/exam-config-created-date">25\/10\/2026<\/span>/);
  assert.match(createdCell(rows[1]),/exam-config-created-hour">23:59:59<\/span>/);
  assert.match(createdCell(rows[1]),/exam-config-created-date">24\/10\/2026<\/span>/);
  assert.match(createdCell(rows[2]),/class="exam-config-created-missing"/);
  assert.doesNotMatch(createdCell(rows[2]),/<time\b/,'never substitute an update timestamp for creation');
  const countCell=row=>[...row.matchAll(/<td\b[^>]*>[\s\S]*?<\/td>/g)][10][0];
  assert.match(countCell(rows[0]),/>\s*3\s*<\/td>/);
  assert.match(countCell(rows[1]),/>\s*0\s*<\/td>/,'a real zero must be visible');
  assert.match(countCell(rows[2]),/>\s*—\s*<\/td>/,'missing count is unknown, not 0');
  context.window.allExamConfigsList=[];
  context.window.renderExamConfigsTable();
  assert.match(tbody.innerHTML,/colspan="12"/);
  assert.doesNotMatch(tbody.innerHTML,/colspan="11"/);
});

test('The count helper must never inject cells asynchronously',()=>{
  const helper=readFileSync('src/exam-attempt-counts-ui.js','utf8');
  const index=readFileSync('index.html','utf8');
  const main=readFileSync('src/main.js','utf8');
  assert.doesNotMatch(helper,/MutationObserver|insertBefore|requestAnimationFrame/);
  assert.doesNotMatch(index,/src="\/src\/exam-attempt-counts-ui\.js"/);
  assert.match(main,/import \{ parseExamAttemptCount \} from '\.\/exam-attempt-counts-ui\.js';/);
  assert.match(main,/const attemptCount = parseExamAttemptCount\(item\.attempt_count\);/);
  assert.match(main,/cache: 'no-store'/);
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
  assert.ok(index.includes('src="/src/main.js"'));
  assert.ok(!index.includes('src="/src/exam-attempt-counts-ui.js"'));
});

test('PostgreSQL attempts: retakes, duplicate titles, missing IDs, deletion and isolated tenant',async()=>{
  const {PGlite}=await import('@electric-sql/pglite');
  const a=new PGlite(),b=new PGlite();
  const setup=async db=>{
    await db.exec('CREATE TABLE exam_configs(id TEXT PRIMARY KEY,name TEXT,creator_id TEXT); CREATE TABLE results(id TEXT PRIMARY KEY,exam_id TEXT,exam_name TEXT,user_id TEXT);');
    await db.query("INSERT INTO exam_configs(id,name,creator_id) VALUES ('A','Trùng tên','owner'),('B','Trùng tên','other'),('C','Chưa làm','owner')");
  };
  try {
    await setup(a); await setup(b);
    await a.query("INSERT INTO results(id,exam_id,exam_name,user_id) VALUES ('r1','A','Trùng tên','student'),('r2','A','Trùng tên','student'),('r3','B','Trùng tên','student'),('r4',NULL,'Trùng tên','student')");
    await b.query("INSERT INTO results(id,exam_id,exam_name,user_id) VALUES ('r5','A','Trùng tên','student')");
    const adminSql="SELECT ec.id,(SELECT COUNT(*) FROM results r WHERE r.exam_id = ec.id) AS attempt_count FROM exam_configs ec ORDER BY ec.id";
    const teacherSql="SELECT ec.id,CASE WHEN ec.creator_id IN ($1, $2) THEN (SELECT COUNT(*) FROM results r WHERE r.exam_id = ec.id) ELSE NULL END AS attempt_count FROM exam_configs ec ORDER BY ec.id";
    const rows=(await a.query(adminSql)).rows;
    assert.deepEqual(rows.map(row=>[row.id,Number(row.attempt_count)]),[['A',2],['B',1],['C',0]]);
    assert.deepEqual((await a.query(teacherSql,['owner','owner-profile'])).rows.map(row=>[row.id,row.attempt_count===null?null:Number(row.attempt_count)]),
      [['A',2],['B',null],['C',0]]);
    assert.equal(Number((await b.query(adminSql)).rows[0].attempt_count),1);
    await a.query("DELETE FROM results WHERE id='r2'");
    assert.equal(Number((await a.query(adminSql)).rows[0].attempt_count),1);
  } finally {
    await a.close();await b.close();
  }
});
