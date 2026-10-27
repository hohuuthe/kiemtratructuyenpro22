/**
 * Shared, server-only submission policy used by Pages and Express.
 * A signed exam token identifies the exam; live database settings govern
 * which results/answer keys may be sent back to students.
 */
export function examSettingEnabled(value) {
  return value === true || value === 1 ||
    (typeof value === 'string' && ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase()));
}
export function liveExamVisibility(exam) {
  return {
    showScore: examSettingEnabled(exam?.show_score ?? exam?.showScore),
    showDetails: examSettingEnabled(exam?.show_details ?? exam?.showDetails)
  };
}
/** Refuse to record invented zero scores when question data is missing. */
export function assertGradingQuestionSources(questionIds, questionMap) {
  if (!Array.isArray(questionIds) || !questionIds.length || !questionMap) {
    throw new Error('EXAM_QUESTION_SOURCES_UNAVAILABLE');
  }
  for (const id of questionIds) {
    const question = questionMap[id] ?? questionMap[String(id)];
    if (!question || !['4-1', 'TF4', 'SQ', 'TL'].includes(question.type)) {
      throw new Error('EXAM_QUESTION_SOURCES_UNAVAILABLE');
    }
    if (question.type !== 'TL' &&
        (question.answer === undefined || question.answer === null ||
         String(question.answer).trim() === '')) {
      throw new Error('EXAM_ANSWER_KEY_UNAVAILABLE');
    }
  }
}
/** No client-supplied student ID can be attached to another account's result. */
export function boundStudentIdentity(studentInfo, authenticatedUser) {
  const user = authenticatedUser || null;
  return {
    userId: user ? String(user.user_id || user.id) : null,
    name: user ? String(user.full_name || user.username || studentInfo?.name || '') :
      String(studentInfo?.name || ''),
    lop: user ? String(user.lop || '') : String(studentInfo?.lop || ''),
    donvi: user ? String(user.donvi || '') :
      String(studentInfo?.donvi || studentInfo?.unit || '')
  };
}
function parseDetails(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function safeQuestion(question) {
  const q = question && typeof question === 'object' ? question : {};
  const safe = {};
  for (const key of ['id','type','level','lesson','content','image',
    'optionImages','option_images','images','shuffledOptions','shuffled_options']) {
    if (q[key] !== undefined) safe[key] = q[key];
  }
  if (q.options !== undefined) {
    const opts = q.options;
    if (Array.isArray(opts)) safe.options = opts.slice(0, 4);
    else if (opts && typeof opts === 'object') {
      const visible = {};
      for (const key of ['A','B','C','D','a','b','c','d',
        'optA','optB','optC','optD','optionA','optionB','optionC','optionD',
        'opt_a','opt_b','opt_c','opt_d','0','1','2','3','4']) {
        if (Object.prototype.hasOwnProperty.call(opts,key)) visible[key] = opts[key];
      }
      safe.options = visible;
    }
  }
  return safe;
}
export function projectExamSubmissionDetails(raw, visibility) {
  if (!visibility.showDetails) return [];
  return parseDetails(raw).map(entry => {
    if (!entry || typeof entry !== 'object') return {question:{},userAnswer:null};
    const q = safeQuestion(entry.question);
    const item = { question:q, userAnswer: entry.userAnswer ?? null };
    if (entry.correctAnswer !== undefined && entry.correctAnswer !== null) {
      item.correctAnswer = entry.correctAnswer;
    }
    if (entry.gradingStatus) item.gradingStatus = entry.gradingStatus;
    if (visibility.showScore) {
      if (entry.score !== null && entry.score !== undefined &&
          Number.isFinite(Number(entry.score))) item.score = Number(entry.score);
      if (typeof entry.isCorrect === 'boolean') item.isCorrect = entry.isCorrect;
      if (entry.correctStatements !== undefined) item.correctStatements = entry.correctStatements;
      if (typeof entry.aiFeedback === 'string') item.aiFeedback = entry.aiFeedback;
    }
    return item;
  });
}
/**
 * A delayed/replayed submission must use the same live visibility as a new one.
 * A pending result can never disclose a provisional numeric total.
 */
export function publicExamSubmission(row, visibility, extra = {}) {
  const completed = row?.grading_status === 'completed';
  const finalScore = completed && visibility.showScore &&
    row.score !== null && row.score !== undefined && Number.isFinite(Number(row.score))
    ? Number(row.score) : null;
  const totalMaxScore = Number(extra.totalMaxScore || 0);
  return {
    resultId: row?.id,
    gradingStatus: row?.grading_status || 'completed',
    nextRetryAt: row?.grading_retry_at || null,
    score: finalScore,
    provisionalScore: null,
    rawEarnedScore: finalScore,
    scale10Score: finalScore !== null && totalMaxScore > 0
      ? Number(Math.max(0,Math.min(10,finalScore/totalMaxScore*10)).toFixed(2))
      : null,
    totalMaxScore: totalMaxScore > 0 ? totalMaxScore : null,
    correctCount: visibility.showScore ? (row?.correct_count ?? null) : null,
    timeTaken: row?.time_taken ?? null,
    cheatWarningCount: row?.cheat_warning_count ?? null,
    detailedResults: projectExamSubmissionDetails(row?.details,visibility),
    alreadySubmitted: extra.alreadySubmitted === true
  };
}
