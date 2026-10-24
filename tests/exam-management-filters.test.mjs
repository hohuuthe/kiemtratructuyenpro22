import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {
  examManagementCreatorId,examManagementSchool,examManagementClassTokens,
  matchesExamManagement,examManagementFilterChoices
} from '../src/exam-management-filters.js';

const sample=[
 {id:'examA',name:'Kiểm tra giữa kỳ',creator_id:'t1',chedodethi:'Đề cho đơn vị',target_donvi:'Trường A',target_lop:'10A1, 10A2'},
 {id:'examB',name:'Kiểm tra giữa kỳ',creator_id:'t2',chedodethi:'Đề cho đơn vị',target_donvi:'Trường B',target_lop:'10A10'},
 {id:'examC',name:'Đề công khai',creator_id:'t1',chedodethi:'Đề công khai'},
 {id:'examD',name:'Đề giới hạn',creator_id:'t2',chedodethi:'Đề cho đơn vị',target_donvi:'Trường B',target_lop:'["11B1","11B2"]'},
 {id:'examE',name:'Đề khác',creator_id:'t2',chedodethi:'Đề cho đơn vị',target_donvi:'Trường A',target_lop:'10A1; 12A1'},
 {id:'examF',name:'Không đơn vị',creator_id:'t3',chedodethi:'Đề công khai'}
];
const accounts=[
 {id:'t1',username:'giaovien1',full_name:'Cô Lan',donvi:'Trường A'},
 {id:'t2',username:'giaovien2',full_name:'Cô Lan',donvi:'Trường B'},
 {id:'t3',username:'giaovien3',full_name:'Thầy Minh',donvi:''}
];
test('Use exact creator account ID, not duplicate exam title or teacher name',()=>{
 assert.equal(examManagementCreatorId(sample[0]),'t1');
 assert.equal(examManagementCreatorId({creatorId:'t2'}),'t2');
 assert.deepEqual(sample.filter(x=>matchesExamManagement(x,{creatorId:'t1'})).map(x=>x.id),['examA','examC']);
 assert.deepEqual(sample.filter(x=>matchesExamManagement(x,{creatorId:'t2'})).map(x=>x.id),['examB','examD','examE']);
 assert.equal(matchesExamManagement(sample[0],{creatorId:'t'}),false);
});
test('Class values are exact tokens, including JSON list; no 10A1/10A10 false positives',()=>{
 assert.deepEqual(examManagementClassTokens(sample[0]),['10A1','10A2']);
 assert.deepEqual(examManagementClassTokens(sample[3]),['11B1','11B2']);
 assert.deepEqual(examManagementClassTokens(sample[4]),['10A1','12A1']);
 assert.equal(matchesExamManagement(sample[0],{className:'10a1'}),true);
 assert.equal(matchesExamManagement(sample[1],{className:'10A1'}),false);
 assert.deepEqual(sample.filter(e=>matchesExamManagement(e,{className:'10A1'})).map(e=>e.id),['examA','examE']);
 assert.equal(sample.filter(e=>matchesExamManagement(e,{})).length,sample.length);
});
test('Unit uses configured school; public exam falls back to its creator school',()=>{
 assert.equal(examManagementSchool(sample[0],accounts),'Trường A');
 assert.equal(examManagementSchool(sample[1],accounts),'Trường B');
 assert.equal(examManagementSchool(sample[2],accounts),'Trường A');
 assert.equal(examManagementSchool(sample[5],accounts),'');
 assert.deepEqual(sample.filter(e=>matchesExamManagement(e,{school:'Trường A',schoolAccounts:accounts})).map(e=>e.id),['examA','examC','examE']);
 assert.deepEqual(sample.filter(e=>matchesExamManagement(e,{school:'Trường B',schoolAccounts:accounts,className:'11B1'})).map(e=>e.id),['examD']);
});
test('Dependent options are scoped by teacher then school; non-admin has no creator/unit choices',()=>{
 const all=examManagementFilterChoices(sample,accounts,{isAdmin:true});
 assert.deepEqual(all.creators.map(x=>x.value),['t1','t2','t3']);
 assert.equal(new Set(all.creators.map(x=>x.label)).size,3,'Different accounts with identical names must be distinguishable');
 assert.deepEqual(all.schools.map(x=>x.value),['Trường A','Trường B']);
 assert.deepEqual(all.classes.map(x=>x.value),['10A1','10A2','10A10','11B1','11B2','12A1']);
 const teacher=examManagementFilterChoices(sample,accounts,{isAdmin:true,creatorId:'t1'});
 assert.deepEqual(teacher.schools.map(x=>x.value),['Trường A']);
 assert.deepEqual(teacher.classes.map(x=>x.value),['10A1','10A2']);
 const narrowed=examManagementFilterChoices(sample,accounts,{isAdmin:true,creatorId:'t2',school:'Trường A'});
 assert.deepEqual(narrowed.classes.map(x=>x.value),['10A1','12A1']);
 const normal=examManagementFilterChoices([sample[0]],accounts,{isAdmin:false});
 assert.deepEqual(normal.creators,[]);
 assert.deepEqual(normal.schools,[]);
 assert.deepEqual(normal.classes.map(x=>x.value),['10A1','10A2']);
});
test('Admin-only inputs are hidden+disabled before login; class filter is visible to teachers',()=>{
 const html=readFileSync('public/components/tab-exams.html','utf8');
 const js=readFileSync('src/main.js','utf8');
 for(const id of ['exam-config-creator-filter','exam-config-school-filter']){
   assert.match(html,new RegExp('id="'+id+'-wrap"[^>]*hidden'));
   assert.match(html,new RegExp('id="'+id+'"[^>]*disabled'));
   assert.match(js,new RegExp("'"+id+"-wrap'"));
 }
 assert.match(html,/id="exam-config-class-filter"/);
 assert.match(html,/onchange="onExamConfigClassFilterChange\(\)"/);
 assert.match(js,/syncAdminTeacherFilterVisibility\(\)/);
 assert.match(js,/creator\.disabled=!isAdmin/);
 assert.match(js,/school\.disabled=!isAdmin/);
 assert.match(js,/classroom\.disabled=!canView/);
});
test('Management list, pagination, search and dependent filters use one read-only pipeline',()=>{
 const src=readFileSync('src/main.js','utf8');
 const s=src.slice(src.indexOf('window.renderExamConfigsTable = function renderExamConfigsTable()'),src.indexOf('function renderExamConfigsPaginationControls('));
 assert.match(s,/updateExamManagementFilters\(\)/);
 assert.match(s,/matchesExamManagement\(ex,/);
 assert.match(s,/lastExamManagementFilterKey/);
 assert.match(s,/renderExamConfigsPaginationControls\(list\.length/);
 for(const p of ['loadExamConfigById(','openExportDocxModal(','deleteExamConfig('])assert.ok(s.includes(p));
 assert.match(src,/window\.onExamConfigCreatorFilterChange=function\(\)/);
 assert.match(src,/window\.onExamConfigSchoolFilterChange=function\(\)/);
 assert.match(src,/window\.onExamConfigClassFilterChange=function\(\)/);
 assert.match(src,/lastExamManagementFilterKey = ''/);
 const api=readFileSync('functions/api/exams.ts','utf8');
 assert.match(api,/else if \(isTeacher\) \{\s*query \+= " WHERE ec\.creator_id = \?"/);
});
