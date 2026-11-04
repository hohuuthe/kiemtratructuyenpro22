import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { sortExamConfigs, nextExamConfigSort, DEFAULT_EXAM_CONFIG_SORT, EXAM_CONFIG_SORT_COLUMNS } from '../src/exam-config-sorting.js';

const exams=[
 {id:'e-old',name:'Đề 10',creator_id:'teacher-a',created_at:'2026-10-01T10:00:00Z',time_limit:30,attempt_count:12,count_41:8,chedodethi:'Đề công khai'},
 {id:'e-new',name:'Đề 2',creator_id:'teacher-b',created_at:'2026-10-25T10:00:00Z',time_limit:45,attempt_count:2,count_41:20,chedodethi:'Đề cho đơn vị',target_donvi:'Trường B'},
 {id:'e-unknown',name:'Đề 3',creator_id:'teacher-b',created_at:null,time_limit:10,attempt_count:null,count_41:1},
 {id:'e-middle',name:'Đề 1',creator_id:'teacher-a',created_at:'2026-10-24 20:00:00',time_limit:20,attempt_count:0,count_41:12},
 {id:'e-tie',name:'Đề 4',creator_id:'teacher-b',created_at:'2026-10-25T10:00:00+00:00',time_limit:45,attempt_count:'2',count_41:20}
];
const ids=rows=>rows.map(r=>r.id);
test('newest creation time is default; unknown timestamps always come last',()=>{
 assert.deepEqual(ids(sortExamConfigs(exams)),['e-new','e-tie','e-middle','e-old','e-unknown']);
 assert.deepEqual(ids(sortExamConfigs(exams,{key:'createdAt',direction:'asc'})),['e-old','e-middle','e-new','e-tie','e-unknown']);
});
test('number, numeric string and missing counts are not sorted lexicographically',()=>{
 assert.deepEqual(ids(sortExamConfigs(exams,{key:'attempts',direction:'desc'})),['e-old','e-new','e-tie','e-middle','e-unknown']);
 assert.deepEqual(ids(sortExamConfigs(exams,{key:'attempts',direction:'asc'})),['e-middle','e-new','e-tie','e-old','e-unknown']);
});
test('Vietnamese text uses numeric collation and stable creation time ties',()=>{
 assert.deepEqual(ids(sortExamConfigs(exams,{key:'name',direction:'asc'})),['e-middle','e-new','e-unknown','e-tie','e-old']);
 assert.deepEqual(ids(sortExamConfigs(exams,{key:'duration',direction:'desc'})),['e-new','e-tie','e-old','e-middle','e-unknown']);
 assert.deepEqual(ids(sortExamConfigs(exams,{key:'questions',direction:'desc'})),['e-new','e-tie','e-middle','e-old','e-unknown']);
});
test('sorting is read-only, stable across refresh and filtered before pagination',()=>{
 const copy=JSON.stringify(exams);
 const sorted=sortExamConfigs(exams);
 assert.equal(JSON.stringify(exams),copy);
 assert.deepEqual(ids(sortExamConfigs(exams)),ids(sorted));
 const filtered=exams.filter(x=>x.creator_id==='teacher-b');
 assert.deepEqual(ids(sortExamConfigs(filtered).slice(0,2)),['e-new','e-tie']);
});
test('all ten data columns can be toggled; unsupported sort fields reset safely',()=>{
 assert.equal(Object.keys(EXAM_CONFIG_SORT_COLUMNS).length,10);
 assert.deepEqual(nextExamConfigSort(DEFAULT_EXAM_CONFIG_SORT,'createdAt'),{key:'createdAt',direction:'asc'});
 assert.deepEqual(nextExamConfigSort({key:'name',direction:'asc'},'name'),{key:'name',direction:'desc'});
 assert.deepEqual(nextExamConfigSort(null,'attempts'),{key:'attempts',direction:'desc'});
 assert.deepEqual(nextExamConfigSort(null,'action'),DEFAULT_EXAM_CONFIG_SORT);
});
test('headers retain twelve columns and all exam actions, sort before pagination',()=>{
 const html=readFileSync('public/components/tab-exams.html','utf8');
 const js=readFileSync('src/main.js','utf8');
 assert.equal((html.match(/<th\b/g)||[]).length,12);
 assert.equal((html.match(/data-exam-sort="/g)||[]).length,10);
 assert.ok(html.includes('Thời gian tạo'));
 const renderer=js.slice(js.indexOf('window.renderExamConfigsTable = function renderExamConfigsTable()'),js.indexOf('function renderExamConfigsPaginationControls('));
 assert.ok(renderer.indexOf('sortExamConfigs(')<renderer.indexOf('list.slice(startIdx'));
 for(const fn of ['loadExamConfigById(','openExportDocxModal(','deleteExamConfig(','deleteExamResultsByExamId('])assert.ok(renderer.includes(fn),fn);
 assert.match(renderer,/renderExamConfigsPaginationControls\(list\.length/);
 assert.match(js,/window\.examConfigSort = \{\.\.\.DEFAULT_EXAM_CONFIG_SORT\}/);
});


test('exam list API returns newest created exams first before pagination for all pickers',()=>{
 const api=readFileSync('functions/api/exams.ts','utf8');
 assert.match(api,/ORDER BY ec\.created_at DESC NULLS LAST, ec\.id DESC\$\{paginationClause\}/);
 const orderAt=api.indexOf('ORDER BY ec.created_at DESC NULLS LAST, ec.id DESC');
 const queryAt=api.indexOf('const { results } = await db.prepare(query)');
 assert.ok(orderAt>=0&&queryAt>orderAt,'sorting must be applied in SQL before the list query executes');
 assert.doesNotMatch(api,/ORDER BY ec\.name ASC, ec\.id ASC/);
});
