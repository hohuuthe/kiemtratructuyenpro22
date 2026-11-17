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
 assert.match(start,/claimContestStart/);
 assert.doesNotMatch(start,/_exam_active_attempts/);
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
test('Contest attempt is counted atomically with server clock, without old-session locks',()=>{
 const start=source('functions/api/exam/start.ts');
 const claims=source('functions/api/exam/contest-start-claims.ts');
 assert.match(start,/claimContestStart\(db/);
 assert.match(claims,/WITH quota AS MATERIALIZED/);
 assert.match(claims,/INSERT INTO _contest_start_claims/);
 assert.match(claims,/UPDATE _exam_grade_sessions AS session/);
 assert.match(claims,/CONSTRAINT uq_contest_start_claim_slot UNIQUE/);
 assert.doesNotMatch(start,/_exam_active_attempts|INSERT INTO contest_attempts/);
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
 assert.doesNotMatch(main,/tryResumeActiveExam|isResumedContest/);
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

test('Contest tab uses only the current start without previous-session recovery',()=>{
 const main=source('src/main.js');
 const resume=source('functions/api/exam/resume.ts');
 const ui=source('src/contest-mode-ui.js');
 assert.match(resume,/EXAM_RECOVERY_RETIRED/);
 assert.match(resume,/status:410/);
 assert.doesNotMatch(resume,/_exam_grade_sessions|contest_attempts/);
 assert.doesNotMatch(main,/tryResumeActiveExam|\/api\/exam\/resume/);
 assert.match(main,/tabName !== activeExamOwnerTab && isExamInProgress/);
 assert.match(main,/window\.__contestOnExamStarted\?\.\(\)/);
 assert.match(main,/window\.__contestCanShowExam\?\.\(\)/);
 assert.match(ui,/relocateExamWidgets\(true\)/);
 assert.match(ui,/relocateExamWidgets\(false\)/);
});
test('Contest registration uses isolated component and starts only after ready exam configuration',()=>{
 const school=source('public/components/tab-exam.html');
 const contest=source('public/components/tab-contest.html');
 const ui=source('src/contest-mode-ui.js');
 assert.doesNotMatch(school,/id="contest-exam-picker"/);
 assert.match(contest,/id="contest-exam-picker"/);
 assert.match(contest,/id="contest-registration-form"/);
 assert.match(ui,/await window\.onStudentExamNameChange\?\.\(\)/);
 assert.match(ui,/window\.__contestTicket=enrollment\.data\.ticket/);
 assert.match(ui,/await window\.startExam\?\.\(startButton\)/);
 assert.match(ui,/exam-start-ready-confirm/);
});

test('Saving the default landing tab unlocks the save button on both success and failure',()=>{
 const ui=source('src/contest-mode-ui.js');
 const begin=ui.indexOf('window.saveApplicationMode=async function()');
 const end=ui.indexOf('async function runContestEntry()',begin);
 assert.ok(begin>=0 && end>begin);
 const save=ui.slice(begin,end);
 assert.match(save,/finally\s*\{[\s\S]*?button\.disabled=false/);
 assert.match(save,/body\?\.data\?\.success!==true/);
 assert.match(save,/method:'PUT'/);
 assert.match(save,/'Authorization':'Bearer '\+token/);
});

test('Contest registration is hidden on confirmed results, including delayed component hydration',()=>{
 const ui=source('src/contest-mode-ui.js');
 const main=source('src/main.js');
 assert.match(ui,/const shouldHide=ownsVisibleExam \|\|/);
 assert.match(ui,/tab\?\.contains\(result\)/);
 assert.match(ui,/window\.__contestShowEntry\?\.\(\)/);
 assert.match(ui,/window\.__contestOnExamSubmitted=function\(\)/);
 assert.match(ui,/findEl\('contest-registration-form'\)\?\.reset\(\)/);
 assert.match(ui,/window\.__contestTicket=null/);
 assert.match(ui,/window\.__contestShowEntry\?\.\(\);[\s\S]*?const entryPromise=runContestEntry\(\);[\s\S]*?try\{/);
 assert.match(main,/if \(window\.__activeStudentExamTab === 'contest'\) \{\s*window\.__contestOnExamSubmitted\?\.\(\);/);
 assert.match(main,/document\.getElementById\('exam-results'\)\?\.classList\.remove\('hidden'\)/);
});

test('Contest results display authenticated identity and server-trusted aggregates without answer hints',()=>{
 const grade=source('functions/api/exam/grade.ts');
 const main=source('src/main.js');
 const projection=source('src/exam-public-contest-projection.ts');
 assert.match(grade,/contestTypeStatsFromTrustedDetails\(detailedResults\)/);
 assert.match(grade,/contestTypeStatsFromTrustedDetails\(storedDetails\)/);
 assert.match(grade,/contestStudentName: authenticatedStudentName/);
 assert.match(grade,/contestStudentUnit: authenticatedDonvi/);
 assert.match(main,/result\.contestStudentName \|\| name/);
 assert.match(main,/result\.contestStudentUnit \|\| ''/);
 assert.match(main,/result\.statsByType && typeof result\.statsByType === 'object'/);
 assert.match(main,/const showDetails = window\.__activeStudentExamTab === 'contest'/);
 assert.match(projection,/'score','maxscore','earnedscore'/);
 const safe=stripContestAnswerHints({
   question:{type:'4-1',content:'Nội dung hợp lệ',answer:'B',isCorrect:true},
   score:1,maxScore:1,isCorrect:true,correctAnswer:'B',userAnswer:'B'
 });
 assert.equal(safe.score,undefined);
 assert.equal(safe.maxScore,undefined);
 assert.equal(safe.isCorrect,undefined);
 assert.equal(safe.correctAnswer,undefined);
 assert.equal(safe.question.answer,undefined);
 assert.equal(safe.userAnswer,'B');
});

test('School exam results retain their historical display and scoring behavior',()=>{
 const main=source('src/main.js');
 const grade=source('functions/api/exam/grade.ts');
 assert.match(main,/window\.__activeStudentExamTab === 'contest'\s*\? \(result\.statsByType/);
 assert.match(main,/: statsByType,/);
 assert.match(grade,/if \(showDetails && !isContest\) return detail/);
});

test('Contest participant result is not mixed into school ranking caches',()=>{
 const main=source('src/main.js');
 const start=main.indexOf('const submitResult = {',main.indexOf('const statsByType = {'));
 const end=main.indexOf('// Trả về giao diện sau khi chấm xong',start);
 assert.ok(start>0 && end>start);
 const region=main.slice(start,end);
 assert.match(region,/if \(window\.__activeStudentExamTab !== 'contest'\)/);
 assert.match(region,/window\.results\.unshift\(submitResult\)/);
 assert.match(region,/results\.unshift\(submitResult\)/);
});

test('Contest READY stages DOM before fullscreen and never moves an active fullscreen node',()=>{
 const ui=source('src/contest-mode-ui.js');
 const main=source('src/main.js');
 const prepare=ui.indexOf('window.__contestPrepareForReady=function()');
 const launch=ui.indexOf('window.__contestOnExamStarted=function()');
 assert.ok(prepare>=0 && launch>prepare);
 assert.match(ui,/window\.__contestPrepareForReady\(\)/);
 assert.match(ui,/window\.__contestBeforeFullscreen=function\(\)/);
 assert.match(ui,/document\.fullscreenElement && \(document\.fullscreenElement\.contains\(element\)/);
 const readyClick=main.indexOf("readyButton.addEventListener('click'");
 const beforeFullscreen=main.indexOf('window.__contestBeforeFullscreen?.()',readyClick);
 const requestFullscreen=main.indexOf('window.enterExamFullscreen({',readyClick);
 const activateServer=main.indexOf("fetchExamStartResponse(fetch, '/api/exam/start'",readyClick);
 assert.ok(readyClick>0 && beforeFullscreen>readyClick && requestFullscreen>beforeFullscreen && activateServer>requestFullscreen);
  assert.match(main.slice(requestFullscreen,activateServer), /awaitingSchoolStart: !isPublicContestStart/);
 assert.match(main,/window\.__contestAfterStartRejected\?\.\(\)/);
 assert.match(main,/window\.__contestOnReadyCancelled\?\.\(\)/);
});

test('Monitoring is not armed during READY or the initial mobile fullscreen transition',()=>{
 const main=source('src/main.js');
 const handler=main.slice(main.indexOf('window.handleCheatDetection = function'),main.indexOf('window.enterExamFullscreen = function'));
 assert.match(handler,/currentExam\.monitoringArmed !== true/);
 assert.match(main,/currentExam\.monitoringArmed = false/);
 assert.match(main,/currentExam\.monitoringArmed = true/);
 assert.match(main,/currentExam\.fullscreenWasEstablished === true/);
 assert.match(main,/currentExam\.monitoringWaitingForVisibility/);
});

test('Same-device attempts remain tenant and browser-tab scoped without legacy global resume fallback',()=>{
 const main=source('src/main.js');
 assert.doesNotMatch(main,/localStorage\.getItem\('currentExamToken'\)/);
 assert.doesNotMatch(main,/localStorage\.setItem\('currentExamToken'/);
 assert.doesNotMatch(main,/meta\.writerId !== getExamWriterId\(\)/);
 assert.doesNotMatch(main,/localStorage\.setItem\(window\.tenantStorageKey\('currentExamToken'\)/);
 assert.match(main,/writerId: getExamWriterId\(\)/);
 assert.match(main,/if \(currentExam\?\.startTime && currentExam\?\.questions\?\.length/);
});

test("Switching from school results to contest removes the previous student's private score",()=>{
 const main=source('src/main.js');
 const before=main.indexOf("if (tabName === 'contest' && isShowingResults &&");
 const cleaned=main.indexOf("resetExam();",before);
 const school=main.indexOf("if (tabName === 'exam')",before);
 assert.ok(before>0 && cleaned>before && school>cleaned);
 assert.match(main.slice(before,cleaned+20),/window\.__activeStudentExamTab !== 'contest'/);
});

test('Finishing a contest clears guest identity and restores only authenticated school profile',()=>{
 const ui=source('src/contest-mode-ui.js');
 assert.match(ui,/const profile=window\.currentUser/);
 assert.match(ui,/guest_data_1:profile \? String\(profile\.full_name\|\|''\)/);
 assert.match(ui,/guest_data_lop:profile \? String\(profile\.lop\|\|''\)/);
 assert.match(ui,/guest_data_donvi:profile \? String\(profile\.donvi\|\|profile\.address\|\|''\)/);
 assert.match(ui,/for\(const \[id,value\] of Object\.entries\(restore\)\)/);
});

test('Contest always starts fresh and no former resume DOM path remains',()=>{
 const ui=source('src/contest-mode-ui.js');
 const main=source('src/main.js');
 assert.doesNotMatch(ui,/__contestOnExamResumed/);
 assert.doesNotMatch(main,/resumeButton\.addEventListener|tryResumeActiveExam/);
 assert.match(ui,/__contestPrepareForReady/);
 assert.match(ui,/__contestOnExamStarted/);
 assert.match(main,/currentExam\.questions = startResult\.questions/);
});
test('Mobile registration keeps the start action visible with independently scrollable fields',()=>{
 const html=source('public/components/tab-contest.html');
 const css=source('src/style.css');
 assert.match(html,/id="contest-registration-form"/);
 assert.match(html,/class="contest-registration-scroll"/);
 assert.match(html,/class="contest-submit-dock"/);
 const scrollAt=html.indexOf('class="contest-registration-scroll"');
 const consentAt=html.indexOf('name="dong_y"');
 const dockAt=html.indexOf('class="contest-submit-dock"');
 const submitAt=html.indexOf('id="contest-register-submit"');
 assert.ok(scrollAt>=0 && consentAt>scrollAt && dockAt>consentAt && submitAt>dockAt);
 assert.match(css,/@media \(max-width: 767px\)/);
 assert.match(css,/#contest-registration-form \.contest-registration-scroll \{[\s\S]*?overflow-y:auto/);
 assert.match(css,/#contest-registration-form \.contest-submit-dock \{[\s\S]*?flex:0 0 auto/);
 assert.match(css,/max-height:calc\(100dvh - 150px\)/);
 assert.match(css,/font-size:16px; line-height:1\.35/);
 assert.match(html,/name="ho_ten" required/);
 assert.match(html,/name="don_vi" required/);
 assert.match(html,/name="so_dien_thoai" required/);
 assert.match(html,/name="ma_de_thi" required/);
 assert.match(html,/name="dong_y" type="checkbox" required/);
});


test('Mobile contest entry binds submit before loading and fetches public choices concurrently',()=>{
  const ui=source('src/contest-mode-ui.js');
  const submit=ui.indexOf("form.addEventListener('submit',async event=>");
  const list=ui.indexOf('await reloadPublishedContests();');
  assert.ok(submit>0 && list>submit,'Submit handler must be active before first network fetch settles');
  const boot=ui.slice(ui.indexOf('async function initializeContestMode()'));
  const entry=boot.indexOf('const entryPromise=runContestEntry();');
  const settings=boot.indexOf("await fetchJson('/api/bootstrap')");
  const join=boot.indexOf('await entryPromise;');
  assert.ok(entry>0 && settings>entry && join>settings,'Published list must load concurrently with default settings');
  const mobile=source('src/contest-mobile-performance.css');
  assert.match(ui,/import '\.\/contest-mobile-performance\.css'/);
  assert.match(mobile,/#contest-registration-form \.contest-registration-scroll/);
  assert.match(mobile,/overscroll-behavior-y: auto/);
  assert.match(mobile,/max-height: 600px/);
});


test('Signed-in school students use server-owned identity and read-only registration',()=>{
 const register=source('functions/api/contest/register.ts');
 assert.match(register,/verifyAuthSession\(authorization\.slice\(7\),secret,db\)/);
 assert.match(register,/verifiedProfile \? \{\.\.\.body,\.\.\.verifiedProfile\} : body/);
 assert.match(register,/contest-school-account:v1:/);
 assert.match(register,/contest-school-candidate:v1:/);
 assert.match(register,/SELECT full_name, donvi, lop, phone_number, address FROM users WHERE id = \?/);
 assert.match(register,/if \(value == null\) return null/);
 const ui=source('src/contest-mode-ui.js');
 assert.match(ui,/input\.readOnly=Boolean\(profile\)/);
 assert.match(ui,/await syncSchoolProfile\(true\)/);
 assert.match(ui,/Authorization:'Bearer '\+token/);
 assert.match(ui,/token!==contestAuthToken\(\)/);
 const html=source('public/components/tab-contest.html');
 assert.match(html,/id="contest-student-class-row"/);
 assert.match(html,/id="contest-verified-profile-note"/);
});
test('Student and guest registration validation keep separate phone requirements',async()=>{
 const {validate,isSchoolStudent}=await import('../functions/api/contest/register.ts');
 assert.equal(isSchoolStudent({role:'user',target_audience:'Học sinh'}),true);
 assert.equal(isSchoolStudent({role:'student',target_audience:'Học sinh'}),true);
 assert.equal(isSchoolStudent({role:'admin',target_audience:'Quản trị viên'}),false);
 assert.equal(isSchoolStudent({role:'teacher',target_audience:'Giáo viên'}),false);
 assert.equal(isSchoolStudent({role:'user',target_audience:'Khách'}),false);
 const data={ho_ten:'Học sinh A',don_vi:'Trường A',ma_de_thi:'contest1',dong_y:true,so_dien_thoai:''};
 assert.equal(validate(data,true).phone,'');
 assert.throws(()=>validate(data,false),/Thông tin dự thi không hợp lệ/);
});


test('Incomplete verified school profiles never require filling locked fields',async()=>{
 const {validate}=await import('../functions/api/contest/register.ts');
 const payload={ho_ten:'',don_vi:'',so_dien_thoai:'',dia_chi:'',so_cccd:'',
   ma_de_thi:'contest1',dong_y:true};
 assert.equal(validate(payload,true).name,'');
 assert.equal(validate(payload,true).unit,'');
 assert.equal(validate(payload,true).phone,'');
 assert.throws(()=>validate(payload,false),/Thông tin dự thi không hợp lệ/);
 const register=source('functions/api/contest/register.ts');
 assert.doesNotMatch(register,/Hồ sơ học sinh chưa có họ tên hoặc đơn vị/);
 assert.match(register,/row\?\.full_name \|\| user\.full_name \|\| user\.username/);
 const ui=source('src/contest-mode-ui.js');
 assert.match(ui,/input\.required=!profile && \['ho_ten','don_vi','so_dien_thoai'\]/);
 assert.match(ui,/profileMode==='verified' && !String\(values\.lop\|\|''\)\.trim\(\) \? 'Chưa cập nhật đơn vị'/);
 assert.match(ui,/window\.__contestRefreshProfile=\(\)=>syncSchoolProfile\(true\)/);
});
