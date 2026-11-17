import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { examFlagEnabled } from '../src/exam-grading-core.js';

const main = readFileSync('src/main.js', 'utf8');
const grade = readFileSync('functions/api/exam/grade.ts', 'utf8');

function postSubmitViewSource() {
  const start = main.indexOf('function showResults(result, detailedResults)');
  const end = main.indexOf('window.resetExam =', start);
  assert.ok(start >= 0 && end > start, 'Student post-submit result renderer is required');
  return main.slice(start, end);
}

test('student result statistics require both published server permission and enabled exam setting', () => {
  const view = postSubmitViewSource();
  assert.match(view, /const showScore = result\.canViewScore === true &&\s*examFlagEnabled\(examConfig\.showScore \?\? examConfig\.show_score, false\)/);
  assert.match(view, /\$\{showScore \? statsDetailedHtml : ''\}/);
  assert.match(view, /\$\{showScore && result\.totalTF4Statements > 0 \?/);
  assert.match(main, /canViewScore: result\.canViewScore === true/);
  assert.equal(examFlagEnabled(false, true), false);
  assert.equal(examFlagEnabled(0, true), false);
  assert.equal(examFlagEnabled('0', true), false);
  assert.equal(examFlagEnabled('false', true), false);
  assert.equal(examFlagEnabled(true, false), true);
});

test('student may still view their answer details according to the independent showDetails policy', () => {
  const view = postSubmitViewSource();
  assert.match(view, /const showDetails = window\.__activeStudentExamTab === 'contest'/);
  assert.match(view, /\$\{showDetails \? detailsSection :/);
  assert.match(view, /\$\{showScore \? statsDetailedHtml : ''\}/);
  assert.match(view, /Làm bài mới/);
});

test('server redacts unpublished scores from initial submission and both idempotent replay paths', () => {
  assert.match(grade, /const shouldShowScore = examFlagEnabled\(examConfig\.showScore \?\? examConfig\.show_score, true\)/);
  assert.match(grade, /canViewScore: shouldShowScore/);
  assert.match(grade, /score: shouldShowScore \? finalScore : null/);
  assert.match(grade, /correctCount: shouldShowScore \? correctCount : null/);
  assert.match(grade, /totalMaxScore: shouldShowScore \? roundScore\(totalMaxScore, 4\) : null/);
  assert.match(grade, /statsByType: shouldShowScore \? contestTypeStatsFromTrustedDetails\(detailedResults\) : \{\}/);
  assert.match(grade, /canViewScore: replayShowScore/);
  assert.match(grade, /canViewScore: showScoreOnReplay/);
  assert.match(grade, /score: replayShowScore \? Number\(stored\.score\) \|\| 0 : null/);
  assert.match(grade, /score: showScoreOnReplay \? Number\(stored\.score\) \|\| 0 : null/);
  assert.match(grade, /if \(!showScore\) delete safeD\.score/);
  assert.match(grade, /sanitizeGradingDetailForClient\(d, shouldShowDetails, Boolean\(contestParticipantId\), shouldShowScore\)/);
});
