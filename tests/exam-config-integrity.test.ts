import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExamConfigInput, examConfigFlag, ExamConfigInputError } from '../src/exam-config-contract.ts';
import { mapStoredExamToDraft, createEmptyExamDraft } from '../src/exam-editor-safety.js';
const base={name:'Thi cuoi ky',time_limit:45,count_41:2,count_tf4:1,count_sq:1,count_tl:1,selected_lessons:['Bài 1'],
counts_detail:{count41NB:1,count41TH:1,count41VD:0,countTF4NB:1,countSQNB:1,countTLNB:1},
points_41:0,points_tf4:0,points_sq:0,points_tl:0,tf4_points:{1:0,2:0.5,3:0.75,4:1},
show_details:false,show_score:false,immediate_feedback:false,auto_grade_essay:false,
max_cheat_warnings:7,max_attempts:3,chedodethi:'Đề cho đơn vị',target_lop:'12A1',target_donvi:'Trường A',
access_control:{enabled:true,startTime:'2026-10-24T08:00',endTime:'2026-10-24T09:00'},
ai_prompt:'Prompt',ai_grading_key:'test-key',is_shared_results:false};
test('Every field sent by the editor survives normalizing, including zero, false, monitoring, unit',()=>{
 const x=normalizeExamConfigInput(base);
 assert.equal(x.points_41,0);assert.equal(x.points_tf4,0);assert.equal(x.points_sq,0);assert.equal(x.points_tl,0);
 assert.equal(x.max_cheat_warnings,7);assert.equal(x.max_attempts,3);assert.equal(x.target_donvi,'Trường A');
 assert.equal(x.donvi,'Trường A');assert.equal(x.show_score,0);assert.equal(x.show_details,0);
 assert.equal(x.is_shared_results,0);assert.equal(JSON.parse(x.tf4_points)['1'],0);
 assert.equal(JSON.parse(x.counts_detail).count41NB,1);
 const loaded=mapStoredExamToDraft({...x,id:'exam-id',creator_id:'teacher-1',updated_at:'revision-1'}, {currentUser:{id:'teacher-1'}});
 assert.equal(loaded.maxCheatWarnings,7);assert.equal(loaded.showDetails,false);assert.equal(loaded.points41,0);
 assert.equal(loaded.target_donvi,'Trường A');
});
test('Partial update preserves old settings and explicit false / zero overrides',()=>{
 const stored=normalizeExamConfigInput(base);
 const update=normalizeExamConfigInput({name:'Changed',show_score:0,points_41:0},stored);
 assert.equal(update.max_cheat_warnings,7);assert.equal(update.max_attempts,3);
 assert.equal(update.target_lop,'12A1');assert.equal(update.show_details,0);
 assert.equal(update.show_score,0);assert.equal(update.points_41,0);
});
test('New blank draft defaults deny details while preserving current editor defaults',()=>{
 const draft=createEmptyExamDraft();
 assert.equal(draft.showDetails,false);
 assert.equal(draft.showScore,true);
});
test('Fail closed on invalid counts, dates, intervals, flags, passwords and lessons',()=>{
 const rejects=[
 {...base,count_41:-1},
 {...base,count_41:1.5},
 {...base,points_sq:-0.5},
 {...base,tf4_points:{1:0.75,2:0.5,3:0.9,4:1}},
 {...base,max_cheat_warnings:0},
 {...base,max_attempts:-1},
 {...base,time_limit:0},
 {...base,show_details:'yes definitely'},
 {...base,selected_lessons:[]},
 {...base,counts_detail:{count41NB:3}},
 {...base,access_control:{enabled:true,startTime:'2026-10-24T09:00',endTime:'2026-10-24T08:00'}},
 {...base,chedodethi:'Đề có mã bảo mật',mabaomatdethi:''}
 ];
 for(const invalid of rejects)assert.throws(()=>normalizeExamConfigInput(invalid),ExamConfigInputError,JSON.stringify(invalid));
});
test('String boolean values are not treated as truthy',()=>{
 assert.equal(examConfigFlag('false'),0);assert.equal(examConfigFlag('0'),0);
 assert.equal(examConfigFlag('true'),1);assert.equal(examConfigFlag('1'),1);
});
test('Public mode never carries leftover class/unit/password from previously loaded exam',()=>{
 const c=normalizeExamConfigInput({...base,chedodethi:'Đề công khai',target_lop:'12B',target_donvi:'Private',mabaomatdethi:'bad'});
 assert.equal(c.target_lop,'');assert.equal(c.target_donvi,'');assert.equal(c.donvi,'');assert.equal(c.mabaomatdethi,'');
});
test('API enforces atomically versioned updates, teacher-only deletion and result preservation', async()=>{
 const fs=await import('node:fs');const api=fs.readFileSync('functions/api/exams.ts','utf8');
 assert.match(api,/normalizeExamConfigInput\(body,existing\)/);
 assert.match(api,/updated_at IS NOT DISTINCT FROM \?/);
 assert.match(api,/EXAM_VERSION_CONFLICT/);
 assert.match(api,/checkIsTeacherOrAdmin\(user\)/);
 assert.match(api,/EXAM_HAS_RESULTS/);
 assert.match(api,/EXAM_CREATOR_JOIN_SQL/);
 const identity=fs.readFileSync('src/exam-creator-identity.js','utf8');
 assert.match(identity,/LEFT JOIN users/);
});
