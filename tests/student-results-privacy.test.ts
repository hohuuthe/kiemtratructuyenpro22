import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {signAuthSession, verifyAuthSession} from '../functions/api/exam/utils.ts';
import {queryOwnResultHistory} from '../functions/api/results/me.ts';

const secret='student-privacy-contract-test-secret-2026-abcdefghijklmnop';
const accounts:Record<string,any>={
 a:{id:'account-a',user_id:'student-a',username:'a',password:'pbkdf2:abc',role:'user',target_audience:'Học sinh',full_name:'Duplicate Name',is_active:1,profile_active:1},
 b:{id:'account-b',user_id:'student-b',username:'b',password:'pbkdf2:def',role:'user',target_audience:'Học sinh',full_name:'Duplicate Name',is_active:1,profile_active:1},
 t:{id:'teacher-t',user_id:'teacher-profile',username:'t',password:'pbkdf2:ghi',role:'teacher',target_audience:'Giáo viên',is_active:1,profile_active:1}
};
const configs:Record<string,any>={
 'shared-exam':{show_score:1,show_details:1},
 'private-exam':{show_score:1,show_details:1}
};
const records=[
 {id:'a1',user_id:'student-a',exam_id:'shared-exam',exam_name:'Đề trùng tên',score:9,correct_count:9,total_questions:10,time_taken:120,created_at:'2026-10-24',cheat_warning_count:2,details:'[{"userAnswer":"A"}]'},
 {id:'a2',user_id:'account-a',exam_id:'private-exam',exam_name:'Đề riêng',score:7,correct_count:7,total_questions:10,time_taken:180,created_at:'2026-10-23',cheat_warning_count:0,details:'[]'},
 {id:'b1',user_id:'student-b',exam_id:'shared-exam',exam_name:'Đề trùng tên',score:3,correct_count:3,total_questions:10,time_taken:200,created_at:'2026-10-24',cheat_warning_count:0,details:'[{"userAnswer":"D"}]'}
];
function database(){
 return {
  connectionUrl:'fixture-student-results',
  prepare(sql:string){
   let bound:any[]=[];
   return {
    bind(...values:any[]){bound=values;return this},
    async first(){
     if(sql.includes('information_schema.columns') && sql.includes("column_name='is_vip'")) return {ok:1};
     if(sql.includes('FROM accounts a'))return Object.values(accounts).find(x=>x.id===bound[0])||null;
     if(sql.includes('COUNT(*)'))return {total:records.filter(x=>bound.includes(x.user_id)).length};
     if(sql.includes('FROM results r')){
       const [requested,...ids]=bound;
       const row=records.find(x=>x.id===requested&&ids.includes(x.user_id));
       return row?{...row,exam_show_score:configs[row.exam_id]?.show_score,exam_show_details:configs[row.exam_id]?.show_details}:null;
     }
     throw Error('Unexpected SQL: '+sql);
    },
    async all(){
     if(sql.includes('FROM results r') && sql.includes('LEFT JOIN exam_configs')){
      if(sql.includes('AND r.exam_id = ?')){
       const requestedExam=bound.at(-1),ids=bound.slice(0,-1);
       return {results:records.filter(x=>ids.includes(x.user_id)&&x.exam_id===requestedExam).sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(row=>({...row,exam_show_score:configs[row.exam_id]?.show_score,exam_show_details:configs[row.exam_id]?.show_details}))};
      }
      const ids=bound.slice(0,-2),limit=bound.at(-2),offset=bound.at(-1);
      return {results:records.filter(x=>ids.includes(x.user_id)).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(offset,offset+limit).map(row=>({...row,exam_show_score:configs[row.exam_id]?.show_score,exam_show_details:configs[row.exam_id]?.show_details}))};
     }
     throw Error('Unexpected SQL: '+sql);
    },
    async run(){return {success:true}}
   };
  }
 };
}
async function call(account: 'a'|'b'|'t'|null,url:string) {
 const db=database();
 if (!account) return new Response(JSON.stringify({error:'Not signed in'}),{status:401});
 const token=await signAuthSession(accounts[account],{id:accounts[account].id},secret,'fixture-student-results');
 const verified=await verifyAuthSession(token,secret,db);
 assert.ok(verified,'Test must use a real verified current account session');
 if (verified.role==='teacher')return new Response(JSON.stringify({error:'Forbidden'}),{status:403});
 return queryOwnResultHistory(db,verified,new URL(url));
}
test('Separate students with same name and same exam never see each other',async()=>{
 const a=await call('a','http://localhost/api/results/me?limit=30');
 const b=await call('b','http://localhost/api/results/me?limit=30');
 assert.equal(a.status,200);
 assert.equal(b.status,200);
 const ja=await a.json(),jb=await b.json();
 assert.deepEqual(ja.data.map((x:any)=>x.id).sort(),['a1','a2']);
 assert.deepEqual(jb.data.map((x:any)=>x.id),['b1']);
 assert.ok(ja.data.every((x:any)=>!('details' in x)));
 assert.match(a.headers.get('cache-control')||'',/no-store/);
});
test('Detail by another student result ID is rejected at SQL level',async()=>{
 const bad=await call('a','http://localhost/api/results/me?id=b1');
 assert.equal(bad.status,404);
 assert.ok(!(JSON.stringify(await bad.json())).includes('userAnswer'));
 const own=await call('a','http://localhost/api/results/me?id=a1');
 assert.equal(own.status,200);
 assert.equal((await own.json()).data.details[0].userAnswer,'A');
});
test('Caller-supplied identity, unauthenticated, teacher, and oversized queries fail closed',async()=>{
 for(const query of ['userId=student-b','student_id=student-b','studentName=Duplicate%20Name','limit=all','limit=101','limit=-1','offset=-3']){
  const response=await call('a','http://localhost/api/results/me?'+query);
  assert.equal(response.status,400,query);
 }
 assert.equal((await call(null,'http://localhost/api/results/me')).status,401);
 assert.equal((await call('t','http://localhost/api/results/me')).status,403);
});
test('Legacy results endpoint denies students before shared-exam routing',()=>{
 const legacy=readFileSync('functions/api/results.ts','utf8');
 const guard=legacy.indexOf("if (isStudent) {\n      return new Response(JSON.stringify({ error: 'Sử dụng API kết quả cá nhân.' })");
 const shared=legacy.indexOf('if (examIdParam) {');
 assert.ok(guard>0&&guard<shared,'Student legacy guard must precede shared-exam route');
});
test('Student view does not fetch bulk results and clears cross-login data',()=>{
 const src=readFileSync('src/main.js','utf8');
 const html=readFileSync('public/components/tab-ranking.html','utf8');
 const loadData=src.slice(src.indexOf('async function loadData(){'),src.indexOf('let publicTeachersLoaded=false'));
 assert.ok(loadData.includes("fetch('/api/bootstrap',{cache:'no-store'})"));
 assert.ok(!loadData.includes("fetch('/api/results"));
 assert.ok(!loadData.includes("fetch('/api/accounts"));
 assert.ok(src.includes("fetch('/api/results/me?limit=30&offset='"));
 assert.ok(src.includes("resetMyStudentResults();"));
 assert.ok(src.includes('visible = isTeacher || isAdmin || Boolean(currentUser)'));
 assert.ok(html.includes('ranking-student-panel'));
 assert.ok(html.includes('ranking-admin-panel'));
});

test('Attempt history by exam ID is student-scoped, score-sorted and includes violation count only for own attempts',async()=>{
 const own=await call('a','http://localhost/api/results/me?examId=shared-exam');
 assert.equal(own.status,200);
 const payload=await own.json();
 assert.deepEqual(payload.data.map((x:any)=>x.id),['a1']);
 assert.equal(payload.data[0].cheat_warning_count,2);
 assert.ok(payload.data.every((x:any)=>x.exam_id==='shared-exam'));
 const other=await call('b','http://localhost/api/results/me?examId=shared-exam');
 const otherPayload=await other.json();
 assert.deepEqual(otherPayload.data.map((x:any)=>x.id),['b1']);
});
