import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {matchesRankingTeacher,rankingTeacherOptions} from '../src/ranking-teacher-filter.js';
test('Creator matching is by immutable account ID, not duplicate exam name',()=>{
 const results=[{exam_id:'id-1',exam_name:'Same',exam_creator_id:'a'},{exam_id:'id-2',exam_name:'Same',exam_creator_id:'b'},{exam_id:'orphan',exam_name:'Same'}];
 assert.deepEqual(results.filter(r=>matchesRankingTeacher(r,'a')).map(r=>r.exam_id),['id-1']);
 assert.deepEqual(results.filter(r=>matchesRankingTeacher(r,'b')).map(r=>r.exam_id),['id-2']);
 assert.equal(results.filter(r=>matchesRankingTeacher(r,'')).length,3);
 assert.deepEqual(rankingTeacherOptions(results,[{id:'a',full_name:'A'},{id:'b',full_name:'B'}],null,true).map(x=>x.id),['a','b']);
 assert.equal(rankingTeacherOptions(results,[],null,false).length,0);
});
test('Both filter controls are admin-only even before JS initialization',()=>{
 const questions=readFileSync('public/components/tab-questions.html','utf8');
 const ranking=readFileSync('public/components/tab-ranking.html','utf8');
 const js=readFileSync('src/main.js','utf8');
 for(const [html,id] of [[questions,'question-teacher-filter'],[ranking,'ranking-teacher-filter']]){
  assert.match(html,new RegExp('id="'+id+'-wrap"[^>]*hidden'));
  assert.match(html,new RegExp('id="'+id+'"[^>]*disabled'));
 }
 assert.match(js,/function syncAdminTeacherFilterVisibility\(\)/);
 assert.match(js,/wrap\.hidden = !admin/);
 assert.match(js,/select\.disabled = !admin/);
 assert.match(js,/if \(!isAdminLoggedIn\) \{syncAdminTeacherFilterVisibility\(\); return;\}/);
});
test('Ranked results and Excel obey admin teacher filter, exam creator from server',()=>{
 const ui=readFileSync('src/main.js','utf8');
 const cf=readFileSync('functions/api/results.ts','utf8');
 const node=readFileSync('server.ts','utf8');
 assert.match(ui,/examCreatorId: r\.exam_creator_id/);
 assert.ok((ui.match(/matchesRankingTeacher\(r,teacherFilter\)/g)||[]).length>=2);
 assert.match(ui,/lastRankingTeacherFilter/);
 assert.match(ui,/window\.onRankingTeacherChange/);
 assert.match(ui,/selectedRankingResults\.clear\(\)/);
 assert.match(cf,/e\.id = r\.exam_id/);
 assert.match(node,/e\.id = r\.exam_id/);
 assert.ok((cf.match(/AS exam_creator_id/g)||[]).length>=2);
 assert.ok((node.match(/AS exam_creator_id/g)||[]).length>=2);
});
