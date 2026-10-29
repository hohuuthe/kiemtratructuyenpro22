import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canDeleteRankingResult,buildRankingResultsDeletion,RankingResultDeleteError} from '../src/ranking-result-delete-policy.js';

const teacher={id:'account-a',user_id:'profile-a',role:'teacher',target_audience:'Giáo viên'};
test('teacher deletion is based on verified exam creator ID, not loaded title maps',()=>{
 assert.equal(canDeleteRankingResult({examCreatorId:'account-a'},teacher,false,true),true);
 assert.equal(canDeleteRankingResult({examCreatorId:'profile-a'},teacher,false,true),true);
 assert.equal(canDeleteRankingResult({examCreatorId:'account-b'},teacher,false,true),false);
 assert.equal(canDeleteRankingResult({examName:'Same exam'},teacher,false,true),false);
 assert.equal(canDeleteRankingResult({examCreatorId:'account-b'},{id:'admin'},true,false),true);
 assert.equal(canDeleteRankingResult({examCreatorId:'account-a'},{id:'student'},false,false),false);
});
test('deletion SQL is scoped and requires ALL requested rows to be authorized',()=>{
 const q=buildRankingResultsDeletion(['result-a','result-b'],teacher);
 assert.equal(q.count,2);
 assert.match(q.sql,/DELETE FROM results/);
 assert.match(q.sql,/EXISTS \(SELECT 1 FROM exam_configs/);
 assert.match(q.sql,/COUNT\(DISTINCT r.id\)/);
 assert.deepEqual(q.params.slice(-1),[2]);
 assert.ok(q.params.includes('account-a')&&q.params.includes('profile-a'));
 assert.equal(q.params.filter(x=>x==='result-a').length,2);
});
test('admin can delete results, but students and oversized requests are denied',()=>{
 const admin=buildRankingResultsDeletion(['a'],{id:'admin',role:'admin'});
 assert.equal(admin.admin,true);
 assert.doesNotMatch(admin.sql,/exam_configs/);
 assert.throws(()=>buildRankingResultsDeletion(['a'],{id:'student',role:'student'}),RankingResultDeleteError);
 assert.throws(()=>buildRankingResultsDeletion(Array(201).fill('a'),teacher),RankingResultDeleteError);
});
test('review uses fixed font sizes and consistent delete checker',()=>{
 const main=readFileSync('src/main.js','utf8');
 const css=readFileSync('src/style.css','utf8');
 assert.match(main,/renderExamDetailQuestion\(d.question, i, 16\)/);
 assert.match(main,/renderExamDetailOptions\(d.question, d.userAnswer, d.correctAnswer, 15\)/);
 assert.match(css,/\.exam-detail-review \.exam-detail-question\.responsive-q-text/);
 assert.match(css,/font-size:16px!important/);
 assert.match(css,/font-size:15px!important/);
 assert.match(main,/canDeleteRankingResult\(r,currentUser,isAdmin,isTeacher\)/);
});
