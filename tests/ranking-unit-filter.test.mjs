import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {buildRankingUnitOptions} from '../src/ranking-unit-filter.js';
test('Teacher can change among authorized results units; first is default',()=>{
 const inputs={results:[{donvi:'Trường B'},{donvi:'Trường A'},{donvi:'Trường B'}],users:[{donvi:'Trường bí mật'}],isTeacher:true,teacherUnit:'Trường B'};
 const first=buildRankingUnitOptions(inputs);
 assert.deepEqual(first.options.map(o=>o.value),['Trường A','Trường B']);
 assert.equal(first.selectedValue,'Trường A');
 assert.equal(buildRankingUnitOptions({...inputs,previousValue:'Trường B'}).selectedValue,'Trường B');
 assert.equal(buildRankingUnitOptions({...inputs,previousValue:'Trường cũ'}).selectedValue,'Trường A');
});
test('Admin still has all units; teacher empty state is safe',()=>{
 const admin=buildRankingUnitOptions({results:[{donvi:'A'}],users:[{donvi:'B'}]});
 assert.deepEqual(admin.options.map(o=>o.value),['','A','B']);
 const empty=buildRankingUnitOptions({isTeacher:true,teacherUnit:'Trường nhà',resultsReady:true});
 assert.equal(empty.selectedValue,'Trường nhà');
});
test('Unit change resets class and checkboxes and filter is applied before reading',()=>{
 const src=readFileSync('src/main.js','utf8');
 const html=readFileSync('public/components/tab-ranking.html','utf8');
 assert.ok(html.includes('id="ranking-unit-filter" onchange="onRankingUnitChange()"'));
 assert.match(src,/window.onRankingUnitChange = function onRankingUnitChange\(\)[\s\S]*?classroom.value = ''/);
 const ranking=src.slice(src.indexOf('function renderRanking() {'));
 assert.ok(ranking.indexOf('populateRankingUnitFilter();') < ranking.indexOf("const unitFilter ="));
 assert.ok(src.includes('resetRankingUnitFilterSession();'));
});
