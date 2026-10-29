import test from 'node:test';import assert from 'node:assert/strict';
import {parseManagementPage,accountsPageQuery,resultsPageQuery,resolveTeacherManagementScope} from '../src/management-page-queries.js';
import {readFileSync} from 'node:fs';
test('page requests are bounded and do not trust role or tenant query params',()=>{
 const p=parseManagementPage('https://host/api/accounts-page?page=2&limit=9000&tenant=evil');
 assert.equal(p.limit,100);assert.equal(p.page,2);
 assert.throws(()=>parseManagementPage('https://host/api/results-page?page=-1'));
 assert.throws(()=>parseManagementPage('https://host/api/results-page?limit=all'));
});
test('accounts search and filters are evaluated in SQL before pagination',()=>{
 const q=accountsPageQuery(parseManagementPage('https://h/api/accounts-page?page=3&limit=50&search=An&unit=THPT'));
 assert.match(q.rowsSQL,/WHERE/);assert.match(q.rowsSQL,/ILIKE/);assert.match(q.rowsSQL,/ORDER BY/);
 assert.match(q.rowsSQL,/LIMIT \? OFFSET \?/);assert.deepEqual(q.rowsArgs.slice(-2),[50,100]);
 assert.equal(q.countArgs.length,q.rowsArgs.length-2);
});
test('results are scoped to server-verified teacher IDs before paging',()=>{
 const p=parseManagementPage('https://h/api/results-page?page=1&limit=50');
 const q=resultsPageQuery(p,{id:'teacher1',user_id:'profile1',role:'teacher'});
 assert.match(q.rowsSQL,/EXISTS \(SELECT 1 FROM exam_configs/);
 assert.deepEqual(q.rowsArgs.slice(0,2),['teacher1','profile1']);
 assert.doesNotMatch(q.rowsSQL,/r\.details/);
 assert.deepEqual(q.rowsArgs.slice(-2),[50,0]);
 const admin=resultsPageQuery(p,{id:'admin',role:'admin'});
 assert.doesNotMatch(admin.rowsSQL,/creator_id IN/);
});
test('Cloudflare and Express expose the same paginated routes',()=>{
 const server=readFileSync('server.ts','utf8'),main=readFileSync('src/main.js','utf8');
 for(const route of ['accounts-page','results-page']){
  assert.match(server,new RegExp('/api/'+route));
  assert.match(main,new RegExp('/api/'+route));
  assert.match(readFileSync('functions/api/'+route+'.ts','utf8'),/parseManagementPage/);
 }
 assert.match(main,/resultsLoaded=false;void loadAllResults\(\)/);
});

test('teacher assignments are verified against profile school and scoped into query',async()=>{
 const actor={id:'teacherA',user_id:'profileA',role:'teacher'};
 const seen=[];
 const verified=await resolveTeacherManagementScope(actor,async(sql,args)=>{
   seen.push([sql,args]);
   if(sql.includes('FROM users'))return [{donvi:'School A'}];
   return [{class_name:'12A',donvi:'School A'},{class_name:'12B',donvi:'Other School'}];
 });
 assert.deepEqual(verified.assignedScopes,[{className:'12A',unit:'School A'}]);
 const q=resultsPageQuery(parseManagementPage('https://h/api/results-page'),verified);
 assert.match(q.rowsSQL,/class_name|r\.lop/);
 assert.ok(q.rowsArgs.includes('12A'));
 assert.ok(!q.rowsArgs.includes('12B'));
 assert.equal(seen.length,2);
});

test('school filter never substitutes student class as institution',()=>{
 const q=resultsPageQuery(parseManagementPage('https://h/api/results-page?unit=School%20A'),{id:'admin',role:'admin'});
 assert.match(q.rowsSQL,/COALESCE\(r\.don_vi/);
 assert.doesNotMatch(q.rowsSQL,/COALESCE\(NULLIF\(r\.don_vi,' '\),r\.student_class/);
 assert.deepEqual(q.countArgs,['School A']);
});
