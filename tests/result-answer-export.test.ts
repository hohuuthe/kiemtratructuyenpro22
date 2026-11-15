import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  toResultAnswerRows, fetchResultAnswerRows, RESULT_ANSWER_HEADERS, safeExcelText
} from '../src/result-answer-export.js';
import { onRequestPost } from '../functions/api/results/export-answers.ts';
import { signAuthSession } from '../functions/api/exam/utils.ts';

const accountSecret = 'result-export-test-secret-hu8y2026-123456789abcdefghijk';
const account = {
  id:'teacher-a',user_id:'profile-a',username:'GV',password:'pbkdf2:hash',
  role:'teacher',target_audience:'Giáo viên',is_active:1,profile_active:1
};
const admin = {...account,id:'admin-a',user_id:'admin-a',role:'admin',target_audience:'Quản trị viên'};
const student = {...account,id:'student-a',user_id:'student-a',role:'user',target_audience:'Học sinh'};
const row = {id:'r1',examId:'e1',studentName:'HS A',lop:'10A1',donvi:'THPT',
  examName:'Đề số 1',timestamp:'2026-11-16T00:00:00Z'};
const details = [
  {question:{id:'q1',type:'4-1',content:'A+B',answer:'C'},userAnswer:'A',correctAnswer:'C',score:0,maxScore:1,isCorrect:false},
  {question:{id:'q2',type:'TF4',content:'Đánh giá 4 ý',answer:'A&C'},userAnswer:{A:true,B:false,C:false,D:false},correctAnswer:'A&C',score:0.5,maxScore:1,isCorrect:false},
  {question:{id:'q3',type:'SQ',content:'Tính 1+1?',answer:'2'},userAnswer:'2',correctAnswer:'2',score:1,maxScore:1,isCorrect:true},
  {question:{id:'q4',type:'TL',content:'Giải thích',answer:'Dùng lý luận',options:{answerImage:'https://example.org/solution.png'}},userAnswer:{text:'=HYPERLINK("bad")',image:'data:image/png;base64,AA=='},correctAnswer:'Dùng lý luận',score:1,maxScore:2,needsGrading:false}
];

test('Each attempt question becomes exactly one row with its original key and student answer', () => {
  const rows = toResultAnswerRows(row,{details,total_questions:4});
  assert.equal(rows.length,4);
  assert.equal(RESULT_ANSWER_HEADERS.length,18);
  assert.deepEqual(rows.map(x=>x[6]),[1,2,3,4]);
  assert.equal(rows[0][11],'C');
  assert.equal(rows[0][10],'A');
  assert.equal(rows[1][11],'A: Đúng; B: Sai; C: Đúng; D: Sai');
  assert.equal(rows[1][10],'A: Đúng; B: Sai; C: Sai; D: Sai');
  assert.equal(rows[2][13],'Đúng');
  assert.ok(rows[3][10].includes("'=HYPERLINK"));
  assert.ok(rows[3][10].includes('Ảnh đính kèm dạng dữ liệu'));
  assert.equal(rows[3][12],'https://example.org/solution.png');
});

test('Wrong total or unusable details fail closed without producing incomplete export',()=>{
  assert.throws(()=>toResultAnswerRows(row,{details:[],total_questions:4}),/thiếu dữ liệu/);
  assert.throws(()=>toResultAnswerRows(row,{details:[null],total_questions:1}),/không hợp lệ/);
  assert.throws(()=>toResultAnswerRows(row,{details,total_questions:5}),/thiếu dữ liệu/);
  assert.equal(safeExcelText('=1+1'),"'=1+1");
  assert.equal(safeExcelText('@SUM(A1:A2)'),"'@SUM(A1:A2)");
});

test('Paged answer export preserves row ordering, verifies all IDs and aborts identity changes',async()=>{
  const records=[{...row,id:'r1'},{...row,id:'r2'}];
  let calls=0;
  const fetchImpl = async (_url,opts)=>{
    calls++;
    const ids=JSON.parse(opts.body).ids;
    return {ok:true,json:async()=>({data:ids.map(id=>({id,exam_id:'e1',total_questions:4,details}))})};
  };
  const values=await fetchResultAnswerRows(records,{fetchImpl,authToken:'token',currentToken:()=> 'token',
    isSessionCurrent:()=>true,batchSize:1});
  assert.equal(calls,2);
  assert.equal(values.length,8);
  assert.equal(values[0][0],'r1');
  assert.equal(values[4][0],'r2');
  await assert.rejects(fetchResultAnswerRows(records,{fetchImpl,authToken:'token',
    currentToken:()=> 'different',isSessionCurrent:()=>true}),/Tài khoản đã thay đổi/);
  await assert.rejects(fetchResultAnswerRows(records,{fetchImpl:async()=>({ok:true,json:async()=>({data:[]})}),
    authToken:'token',currentToken:()=> 'token',isSessionCurrent:()=>true}),/không khớp/);
});

function mockDb(){
  return {
    connectionUrl:'test-export-teacher',
    prepare(sql){
      let args=[];
      return {
        bind(...v){args=v;return this},
        async first(){
          if(sql.includes("information_schema.columns"))return {ok:1};
          if(sql.includes('FROM accounts a')) {
            const id=args[0];
            return id==='teacher-a'?account:id==='admin-a'?admin:id==='student-a'?student:null;
          }
          return null;
        },
        async all(){
          if(!sql.includes('FROM results r')) throw Error('Unexpected SQL: '+sql);
          const all=[
            {id:'r1',exam_id:'e1',total_questions:4,details:JSON.stringify(details)},
            {id:'r2',exam_id:'e2',total_questions:4,details:JSON.stringify(details)}
          ];
          if(sql.includes('EXISTS (SELECT 1 FROM exam_configs')) {
            const ids=args.slice(0,-2);
            return {results:all.filter(x=>ids.includes(x.id)&&x.id==='r1')};
          }
          return {results:all.filter(x=>args.includes(x.id))};
        }
      }
    }
  };
}
async function invoke(who,ids){
  const token=who?await signAuthSession(who,{id:who.id},accountSecret,'test-export-teacher'):'';
  return onRequestPost({
    data:{},params:{},
    request:new Request('http://localhost/api/results/export-answers',{
      method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
      body:JSON.stringify({ids})
    }),
    // getDatabase() reads the mocked DB binding from env / context.
    env:{JWT_SECRET:accountSecret,DB:mockDb()}
  });
}

test('Answer key API denies anonymous and student users, checks owner per exam ID',async()=>{
  assert.equal((await invoke(null,['r1'])).status,401);
  assert.equal((await invoke(student,['r1'])).status,403);
  const authorized=await invoke(account,['r1']);
  assert.equal(authorized.status,200);
  const payload=await authorized.json();
  assert.equal(payload.data.length,1);
  assert.equal(payload.data[0].details.length,4);
  assert.equal((await invoke(account,['r2'])).status,403);
  assert.equal((await invoke(account,['r1','r2'])).status,403);
  assert.equal((await invoke(admin,['r1','r2'])).status,200);
  assert.equal((await invoke(account,['r1','r1'])).status,400);
  assert.equal((await invoke(account,Array(31).fill('r'))).status,400);
});
test('Ranking Excel and basic fallback both contain the added answer sheet',()=>{
  const main=readFileSync('src/main.js','utf8');
  const slice=main.slice(main.indexOf('async function exportRanking()'),main.indexOf('// ==================== DETAILED REPORT EXPORT'));
  assert.match(slice,/fetchResultAnswerRows\(sortedResults/);
  assert.match(slice,/workbook\.addWorksheet\('ChiTietDapAn'\)/);
  assert.match(slice,/XLSX\.utils\.book_append_sheet\(wb, wsAnswers, 'ChiTietDapAn'\)/);
  assert.match(slice,/return; \/\/ Never generate an incomplete or misleading answer workbook/);
});
