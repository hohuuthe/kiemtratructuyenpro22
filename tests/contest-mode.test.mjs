import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeExamConfigInput, ExamConfigInputError} from '../src/exam-config-contract.ts';

const source = p => readFileSync(p,'utf8');
const fixture = {
  name:'Thi cong khai 2026',
  chedodethi:'Cuộc thi trực tuyến',
  contest_status:'draft',
  time_limit:30,
  count_41:2,count_tf4:0,count_sq:0,count_tl:0,
  selected_lessons:['Chuyên đề 1'],
  counts_detail:{count41NB:1,count41TH:1,count41VD:0},
  points_41:1,points_tf4:1,points_sq:1,points_tl:1,
  access_control:{enabled:false},tf4_points:{1:0.25,2:0.5,3:0.75,4:1},
  max_attempts:1
};
test('Contest draft preserves configuration, removes irrelevant unit scope',()=>{
 const c=normalizeExamConfigInput({...fixture,target_lop:'12A1',target_donvi:'Truong A'});
 assert.equal(c.chedodethi,'Cuộc thi trực tuyến');
 assert.equal(c.contest_status,'draft');
 assert.equal(c.max_attempts,1);
 assert.equal(c.target_lop,'');
 assert.equal(c.target_donvi,'');
});
test('Published contests can be normalized, invalid states fail closed',()=>{
 assert.equal(normalizeExamConfigInput({...fixture,contest_status:'published'}).contest_status,'published');
 assert.throws(()=>normalizeExamConfigInput({...fixture,contest_status:'public'}),ExamConfigInputError);
 assert.equal(normalizeExamConfigInput({...fixture,chedodethi:'Đề công khai',contest_status:'published'}).contest_status,'draft');
});
test('Tenant schema uses Vietnamese ASCII columns and defaults to school',()=>{
 const sql=source('migrations/20261115_contest_mode.sql');
 assert.match(sql,/application_mode TEXT NOT NULL DEFAULT 'school'/);
 const m=sql.match(/CREATE TABLE IF NOT EXISTS public.contest_participants\s*\(([\s\S]*?)\);/);
 assert.ok(m);
 const names=m[1].split('\n').map(x=>x.trim().split(/\s+/)[0]).filter(x=>x&&!x.startsWith('--'));
 for(const n of names)assert.match(n,/^[a-z][a-z0-9_]*$/,n);
 assert.deepEqual(names.slice(0,3),['ma_nguoi_du_thi','ho_ten','don_vi']);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
});
test('Contest mode does not modify scoring engine and never trusts client teacherId',()=>{
 const generate=source('functions/api/exam/generate.ts');
 assert.match(generate,/verifyContestTicket/);
 assert.match(generate,/teacherId = String\(contest.creator_id\)/);
 const grade=source('functions/api/exam/grade.ts');
 assert.match(grade,/ma_nguoi_du_thi/);
 assert.match(grade,/authenticatedStudentName = String\(candidate.ho_ten\)/);
 const start=source('functions/api/exam/start.ts');
 assert.match(start,/signedAttemptUserId/);
 assert.match(start,/contest_attempts/);
});
test('Public selector excludes private scoring and identity data',()=>{
 const select=source('functions/api/contest/exams.ts');
 assert.match(select,/contest_status = 'published'/);
 assert.doesNotMatch(select,/SELECT \*/);
 const register=source('functions/api/contest/register.ts');
 assert.match(register,/AES-GCM/);
 assert.match(register,/HMAC/);
 assert.match(register,/CONTEST_TICKET_PURPOSE/);
 assert.match(register,/consumeSecurityAttempt/);
 assert.match(register,/dong_y !== true/);
});
test('Responsive public form keeps old school form and hides teacher choice',()=>{
 const html=source('public/components/tab-exam.html');
 assert.match(html,/id="contest-registration-form"/);
 assert.match(html,/id="exam-form"/);
 assert.match(html,/grid-cols-1 sm:grid-cols-2/);
 const js=source('src/contest-mode-ui.js');
 assert.match(js,/window.onStudentExamNameChange/);
 assert.match(js,/window.startExam/);
 assert.match(js,/body\[data-application-mode="contest"\]/);
});
