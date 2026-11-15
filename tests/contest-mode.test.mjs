import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeExamConfigInput, ExamConfigInputError} from '../src/exam-config-contract.ts';
import {stripContestAnswerHints} from '../src/exam-public-contest-projection.ts';

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
 const school=source('public/components/tab-exam.html');
 const html=source('public/components/tab-contest.html');
 assert.match(school,/id="exam-form"/);
 assert.doesNotMatch(school,/id="contest-registration-form"/);
 assert.match(html,/id="contest-registration-form"/);
 assert.match(html,/grid-cols-1 sm:grid-cols-2/);
 const js=source('src/contest-mode-ui.js');
 assert.match(js,/window.onStudentExamNameChange/);
 assert.match(js,/window.startExam/);
 assert.match(js,/__contestOnExamStarted/);
});

test('Regression: editor sends contest_status and reloads published state from stored DB',()=>{
 const main=source('src/main.js');
 const helper=source('src/exam-editor-safety.js');
 const api=source('functions/api/exams.ts');
 assert.match(main,/contest_status:\s*draft\.chedodethi === 'Cuộc thi trực tuyến'/);
 assert.match(main,/contestStatusEl\.value = examConfig\.contestStatus/);
 assert.match(main,/examConfig\.contestStatus = examConfig\.chedodethi === 'Cuộc thi trực tuyến'/);
 assert.match(helper,/contestStatus:\s*'draft'/);
 assert.match(helper,/row\.contest_status === 'published'/);
 assert.match(api,/fields\.contest_status === 'published'/);
 assert.match(api,/Chỉ quản trị viên có quyền công bố/);
});
test('Compact registration removes redundant text while preserving mobile-safe controls',()=>{
 const contest=source('public/components/tab-contest.html');
 assert.doesNotMatch(contest,/CỔNG THAM GIA TRỰC TUYẾN/);
 assert.doesNotMatch(contest,/Không cần lựa chọn giáo viên/);
 assert.match(contest,/grid-cols-1 sm:grid-cols-2/);
 assert.match(contest,/sm:grid-cols-2/);
 assert.match(contest,/name="ma_de_thi"/);
});

test('Contest answer keys stay server-side, existing school Immediate Feedback unchanged',()=>{
 const generate=source('functions/api/exam/generate.ts');
 const start=source('functions/api/exam/start.ts');
 assert.match(generate,/!registeredContest && examFlagEnabled/);
 assert.match(start,/if \(immediateFeedback\)/);
});
test('Contest attempt is claimed BEFORE the server starts the clock',()=>{
 const start=source('functions/api/exam/start.ts');
 const reservation=start.indexOf('INSERT INTO contest_attempts');
 const ticking=start.indexOf('UPDATE _exam_grade_sessions SET started_at');
 assert.ok(reservation>0 && ticking>reservation,'contest reservation must precede clock activation');
 assert.match(start,/ON CONFLICT \(ma_phien_thi\) DO NOTHING/);
 assert.match(start,/attemptKey = examId \+ ':' \+ signedAttemptUserId/);
});
test('Registered results use server-owned identity, class and exam ID',()=>{
 const grade=source('functions/api/exam/grade.ts');
 assert.match(grade,/candidate\.ho_ten/);
 assert.match(grade,/contestParticipantId \? '' : \(authenticatedLop/);
 assert.match(grade,/contestParticipantId \? 'Cuộc thi trực tuyến'/);
 assert.match(grade,/AND ma_de_thi = \?/);
});
test('Participant identity and encryption keys stay stable across JWT rotations',()=>{
 const register=source('functions/api/contest/register.ts');
 assert.match(register,/contest_identity_key_v1/);
 assert.match(register,/getParticipantDataSecret\(db\)/);
 assert.match(register,/hmac\(participantSecret/);
 assert.match(register,/encryptPrivate\(participantSecret/);
});
test('Public exam detail and shared result code exclude unpublished contests',()=>{
 const exams=source('functions/api/exams.ts');
 assert.match(exams,/row\.chedodethi === 'Cuộc thi trực tuyến' && !isExamOwner\(user,row\)/);
 assert.match(exams,/Không có quyền tra cứu cấu hình cuộc thi qua mã chia sẻ/);
});

test('Public contest result rosters and official answers cannot leak by share flags',()=>{
 const results=source('functions/api/results.ts');
 const generate=source('functions/api/exam/generate.ts');
 assert.match(results,/publicExam\?\.chedodethi === 'Cuộc thi trực tuyến'/);
 assert.match(results,/chỉ được xem theo phiên cá nhân/);
 assert.match(generate,/gradeSessionConfig\.show_details = 0/);
 assert.match(generate,/!registeredContest && examFlagEnabled/);
});
test('Contest registration visibility follows verified READY dialog and cancellation restores form',()=>{
 const src=source('src/contest-mode-ui.js');
 assert.match(src,/exam-start-ready-confirm/);
 assert.match(src,/exam-start-ready-cancel/);
 assert.match(src,/findEl\('contest-registration'\)\?\.classList\.remove\('hidden'\)/);
});

test('Contest question projection removes nested marking hints while preserving renderable content',()=>{
 const question={
   id:'q1',content:'Kiem tra',answer:'A',answer_key:'B',options:{
     A:{text:'Phuong an A',isCorrect:true,feedbackCorrect:'yes'},
     B:{text:'Phuong an B',metadata:{answerKey:'B',explanation:'because',image:'/a.png'}}
   },
   nested:[{answerImage:'secret',content:'Noi dung'}]
 };
 const projected=stripContestAnswerHints(question);
 assert.equal(projected.content,'Kiem tra');
 assert.equal(projected.options.A.text,'Phuong an A');
 assert.equal(projected.options.B.metadata.image,'/a.png');
 assert.equal(projected.answer,undefined);
 assert.equal(projected.options.A.isCorrect,undefined);
 assert.equal(projected.options.B.metadata.answerKey,undefined);
 assert.equal(projected.nested[0].answerImage,undefined);
 assert.equal(question.options.A.isCorrect,true,'Server-side snapshot must not be mutated');
 let deeplyNested={answer:'x'};
 for(let i=0;i<20;i++)deeplyNested={child:deeplyNested};
 assert.throws(()=>stripContestAnswerHints(deeplyNested),/CONTEST_QUESTION_STRUCTURE_TOO_DEEP/);
 const start=source('functions/api/exam/start.ts');
 assert.match(start,/stripContestAnswerHints\(withoutAnswer\)/);
});
test('Shared family telephone does not merge different named contestants',()=>{
 const register=source('functions/api/contest/register.ts');
 assert.match(register,/contest-person-composite:v2:/);
 assert.match(register,/v\.name\.toLocaleLowerCase\('vi-VN'\)/);
 assert.match(register,/v\.unit\.toLocaleLowerCase\('vi-VN'\)/);
 assert.doesNotMatch(register,/Số điện thoại này đã được dùng với hồ sơ dự thi khác/);
});
test('Prestart crash recovery reclaims reservation only if earlier clock never started',()=>{
 const start=source('functions/api/exam/start.ts');
 assert.match(start,/gs\.started_at IS NOT NULL/);
 assert.match(start,/AND gs\.expires_at > \?/);
});

test('All score submission and idempotent replay paths redact nested marking data',()=>{
 const grade=source('functions/api/exam/grade.ts');
 assert.match(grade,/isContest \? stripContestAnswerHints\(safeD\) : safeD/);
 for(const tag of ['replayShowDetails','showDetailsOnReplay','shouldShowDetails']){
   assert.ok(grade.includes('sanitizeGradingDetailForClient(d, '+tag+', Boolean(contestParticipantId))'),
     'Missing contest projection in '+tag);
 }
 assert.match(grade,/if \(showDetails && !isContest\) return detail/);
});

test('Both tabs are always in guest navigation and have separate components',()=>{
 const index=source('index.html');
 const main=source('src/main.js');
 const ui=source('src/contest-mode-ui.js');
 const bootstrap=source('functions/api/bootstrap.ts');
 assert.match(index,/data-sidebar-tab="exam"/);
 assert.match(index,/data-sidebar-tab="contest"/);
 assert.match(index,/Ôn tập, kiểm tra/);
 assert.match(index,/Cuộc thi trực tuyến/);
 assert.match(index,/id="tab-contest"/);
 assert.match(main,/const components=\['modal-container','tab-exam','tab-contest'/);
 assert.match(main,/appSettings\.applicationMode === 'contest' \? 'contest' : 'exam'/);
 assert.match(main,/tab === 'exam' \|\| tab === 'contest'/);
 assert.match(main,/__activeStudentExamTab === 'contest'/);
 assert.match(main,/__contestOnExamStarted/);
 assert.match(main,/__contestOnExamReset/);
 assert.match(main,/isResumedContest = data\.isContestAttempt === true/);
 assert.match(ui,/relocateExamWidgets\(true\)/);
 assert.match(ui,/relocateExamWidgets\(false\)/);
 assert.doesNotMatch(ui,/body\[data-application-mode/);
 assert.match(bootstrap,/application_mode: applicationMode/);
});
test('Default choice changes landing only; contest APIs remain published-only for both defaults',()=>{
 const selector=source('functions/api/contest/exams.ts');
 const register=source('functions/api/contest/register.ts');
 const generate=source('functions/api/exam/generate.ts');
 const start=source('functions/api/exam/start.ts');
 const settings=source('public/components/tab-settings.html');
 assert.doesNotMatch(selector,/isContestEnabled/);
 assert.doesNotMatch(register,/isContestEnabled/);
 assert.doesNotMatch(generate,/isContestEnabled/);
 assert.doesNotMatch(start,/isContestEnabled/);
 assert.match(selector,/contest_status = 'published'/);
 assert.match(register,/publicContestExam\(db,v\.examId\)/);
 assert.match(generate,/verifyContestTicket\(db,SECRET/);
 assert.match(start,/publicContestExam\(db,examId\)/);
 assert.match(settings,/Giao diện mặc định khi mở ứng dụng/);
 assert.match(settings,/Cả hai chức năng/);
});
