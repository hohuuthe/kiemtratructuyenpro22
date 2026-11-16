import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { examSubmissionClaimIdentity } from '../src/exam-submission-identity.js';

test('recovered and old signed tokens use one atomic submission identity', () => {
  const claims = { studentUserId:'student-1', gradingSessionId:'session-1' };
  assert.equal(examSubmissionClaimIdentity('old',claims),examSubmissionClaimIdentity('new',claims));
  assert.notEqual(examSubmissionClaimIdentity('old',claims),
    examSubmissionClaimIdentity('old',{...claims,gradingSessionId:'session-2'}));
});
test('anonymous and public contest token identities remain unchanged', () => {
  assert.equal(examSubmissionClaimIdentity('anonymous',{}),'anonymous');
  assert.equal(examSubmissionClaimIdentity('contest',{contestParticipantId:'p',gradingSessionId:'session'}),'contest');
});
test('recovery strictly checks exact user, tenant-scoped DB, exam and live writer lease', () => {
  const api=readFileSync('functions/api/exam/recover.ts','utf8');
  assert.match(api,/verifyAuthSession/);
  assert.match(api,/getDatabase\(context\)/);
  assert.match(api,/aa\.attempt_key = \? AND aa\.user_id = \? AND aa\.exam_id = \?/);
  assert.match(api,/gs\.exam_id = \?/);
  assert.match(api,/gs\.started_at IS NOT NULL AND gs\.deadline_at IS NOT NULL/);
  assert.match(api,/EXAM_RECOVER_WRITER_ACTIVE/);
  assert.match(api,/makeGradeSessionConfig\(frozen\)/);
  assert.doesNotMatch(api,/(?:UPDATE|DELETE) _exam_grade_sessions/i);
});
test('start 409 offers resume button without starting a new attempt', () => {
  const main=readFileSync('src/main.js','utf8');
  const region=main.slice(main.indexOf('window.startExam = async function startExam('),
    main.indexOf('function generateExamQuestions()',main.indexOf('window.startExam = async function startExam(')));
  assert.match(region,/error\?\.code === 'EXAM_ATTEMPT_ALREADY_ACTIVE'/);
  assert.match(region,/id="exam-recover-active-confirm"/);
  assert.match(region,/fetch\('\/api\/exam\/recover'/);
  assert.match(region,/await tryResumeActiveExam\(\)/);
});
test('grading and resume use same stable attempt identity; policy is frozen on generate', () => {
  for(const p of ['functions/api/exam/grade.ts','functions/api/exam/resume.ts']) {
    assert.match(readFileSync(p,'utf8'),/hashToken\(examSubmissionClaimIdentity\(token, decoded\)\)/);
  }
  const generate=readFileSync('functions/api/exam/generate.ts','utf8');
  assert.match(generate,/resumeImmediateFeedback: isImmediateFeedback/);
  assert.match(generate,/resumeMaxCheatWarnings: maxCheatWarningsFromDB/);
});
