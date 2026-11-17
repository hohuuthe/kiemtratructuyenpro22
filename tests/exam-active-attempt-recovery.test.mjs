import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main=readFileSync('src/main.js','utf8');
const start=readFileSync('functions/api/exam/start.ts','utf8');
const grade=readFileSync('functions/api/exam/grade.ts','utf8');
const save=readFileSync('functions/api/exam/save.ts','utf8');
const recover=readFileSync('functions/api/exam/recover.ts','utf8');
const resume=readFileSync('functions/api/exam/resume.ts','utf8');
const helper=readFileSync('functions/api/exam/school-result-lifecycle.ts','utf8');

test('Previous school exam is never looked up before selecting or generating a new exam',()=>{
  assert.doesNotMatch(main,/offerExistingExamAttemptChoice/);
  assert.doesNotMatch(main,/\/api\/exam\/recover/);
  assert.doesNotMatch(main,/exam-choice-resume|exam-choice-replace/);
});
test('School browser tokens are never stored for later recovery',()=>{
  assert.match(main,/if \(meta.entryTab !== 'contest'\) \{/);
  assert.match(main,/clearStoredActiveExamResume\(\)/);
  assert.match(main,/School PRESTART is memory-only/);
});
test('School recovery endpoint is retired and no longer reads prior locks',()=>{
  assert.match(recover,/EXAM_RECOVERY_RETIRED/);
  assert.match(recover,/status:410/);
  assert.doesNotMatch(recover,/_exam_active_attempts/);
  assert.match(resume,/EXAM_RECOVERY_RETIRED/);
  assert.match(resume,/contestParticipantId/);
});
test('School start does not check or claim an unfinished active session',()=>{
  const schoolPart=start.slice(start.indexOf('let schoolReserved = false'),start.indexOf('// Public contests keep'));
  assert.match(schoolPart,/claimSchoolResultAtStart/);
  assert.match(schoolPart,/findSchoolResultBySession/);
  assert.doesNotMatch(schoolPart,/_exam_active_attempts/);
  assert.doesNotMatch(start,/oldSchoolAttemptSessionId|replaceSessionId/);
});
test('School result is reserved on start and consumes quota including unsubmitted attempts',()=>{
  assert.match(helper,/grading_status = 'ABANDONED'/);
  assert.match(helper,/IN_PROGRESS/);
  assert.match(helper,/MAX\(attempt_no\)/);
  assert.match(helper,/uq_results_school_attempt_no/);
});
test('School result is updated, not inserted twice, on authoritative grading',()=>{
  assert.match(grade,/UPDATE results AS reserved SET/);
  assert.match(grade,/reserved.grading_status = 'IN_PROGRESS'/);
  assert.match(grade,/EXAM_RESULT_NOT_ACTIVE/);
  assert.match(grade,/isSchoolResultProvisional/);
});
test('Old abandoned attempts cannot save or submit to newer attempt',()=>{
  assert.match(grade,/newer.attempt_no > reserved.attempt_no/);
  assert.match(save,/newer.attempt_no > reserved.attempt_no/);
  assert.match(grade,/EXAM_ATTEMPT_CLOSED/);
});
test('No recursive exam start on conflict',()=>{
  const i=main.indexOf("startResult.code === 'EXAM_ATTEMPT_ALREADY_ACTIVE'");
  const j=main.indexOf('if (!response.ok || !startResult.token',i);
  assert.ok(i>=0 && j>i);
  assert.doesNotMatch(main.slice(i,j),/window\.startExam\(\)/);
});
test('Empty exam UI cannot show 1/0 or 00:00 while loading questions',()=>{
  const i=main.indexOf('window.startExamUI = function');
  assert.ok(i>0);
  assert.match(main.slice(i,i+1000),/currentExam\.questions\.length === 0/);
  assert.match(main.slice(i,i+1000),/window\.resetExam\(\)/);
});
test('Public contest participant lifecycle remains separately protected',()=>{
  assert.match(start,/if \(contestParticipantId && examId\)/);
  assert.match(resume,/contestParticipantId/);
});

test('School Start ignores all stale prior-session processing and replacement state',()=>{
  const startBlock = main.slice(main.indexOf('window.startExam = async function startExam'), main.indexOf('function generateExamQuestions()'));
  assert.match(startBlock,/if \(window\.__contestTicket && window\.__EXAM_RESUME_BLOCK_NEW__\)/);
  assert.doesNotMatch(startBlock,/if \(window\.__EXAM_RESUME_BLOCK_NEW__\)/);
  assert.doesNotMatch(startBlock,/__pendingExamReplacement/);
  assert.doesNotMatch(startBlock,/\/api\/exam\/resume|\/api\/exam\/recover/);
  assert.match(startBlock,/\/api\/exam\/generate/);
  assert.match(startBlock,/\/api\/exam\/start/);
});
test('School READY fullscreen displays confirmation rather than an empty exam shell',()=>{
  const startBlock = main.slice(main.indexOf('window.startExam = async function startExam'), main.indexOf('function generateExamQuestions()'));
  assert.match(startBlock,/awaitingSchoolStart: !window\.__contestTicket/);
  assert.match(startBlock,/currentExam\.questions = startResult\.questions;[\s\S]*?startExamUI\(true\)/);
  const fullscreen = main.slice(main.indexOf('window.enterExamFullscreen = function'),main.indexOf('window.showFullscreenEnforcer = function'));
  assert.match(fullscreen,/options\?\.awaitingSchoolStart === true[\s\S]*?document\.body/);
  assert.match(fullscreen,/document\.getElementById\('exam-interface'\)/);
  const examUI = main.slice(main.indexOf('window.startExamUI = function'),main.indexOf('function clearStoredActiveExamResume()'));
  assert.match(examUI,/currentExam\.questions\.length === 0/);
  assert.match(examUI,/window\.resetExam\(\)/);
});
