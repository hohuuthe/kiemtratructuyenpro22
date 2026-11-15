/** Public-contest-only projection: never send marking metadata in a question DTO.
 * The full snapshot stays untouched on the trusted server for deterministic grading.
 */
const CONTEST_PRIVATE_QUESTION_FIELDS = new Set([
  'answer','answerkey','correctanswer','correctanswers','correctstatements',
  'iscorrect','correct','solution','explanation','aifeedback','rubric',
  'gradingguide','gradingrubric','markingscheme','answerimage','answerimages',
  'correctoption','correctoptions','feedbackcorrect','feedbackincorrect',
  // A per-question numeric mark is an answer oracle, even without the key.
  // Aggregate contest scores and category counts are returned separately.
  'score','maxscore','earnedscore','pointsearned','mark','marks'
]);
export function stripContestAnswerHints(input: any, depth = 0): any {
  if (depth > 16) throw new Error('CONTEST_QUESTION_STRUCTURE_TOO_DEEP');
  if (input === null || typeof input !== 'object') return input;
  if (Array.isArray(input)) return input.map(x => stripContestAnswerHints(x, depth + 1));
  const output: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    const canonical = key.replace(/[_-]/g, '').toLowerCase();
    if (CONTEST_PRIVATE_QUESTION_FIELDS.has(canonical)) continue;
    output[key] = stripContestAnswerHints(value, depth + 1);
  }
  return output;
}
