/**
 * Reconstruct only the signed *authority* for an existing ACTIVE attempt.
 * The browser never chooses the session ID, answer key or deadline.
 * Return null for ambiguous/orphaned sessions (fail closed).
 */
export function buildActiveExamRecoveryPayload({
  session, examId, studentUserId, contestParticipantId,
  maxCheatWarnings = 5, nowMs = Date.now()
} = {}) {
  const expectedExamId = String(examId || '').trim();
  const studentId = String(studentUserId || '').trim();
  const participantId = String(contestParticipantId || '').trim();
  if (!session || !expectedExamId || (!studentId && !participantId) ||
      (studentId && participantId) || String(session.exam_id || '') !== expectedExamId) return null;

  const startedAtMs = Date.parse(String(session.started_at || ''));
  const deadlineAtMs = Date.parse(String(session.deadline_at || ''));
  const expiresAtMs = Date.parse(String(session.expires_at || ''));
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(deadlineAtMs) ||
      !Number.isFinite(expiresAtMs) || deadlineAtMs <= startedAtMs ||
      expiresAtMs <= Number(nowMs) || expiresAtMs < deadlineAtMs ||
      !String(session.session_id || '').trim()) return null;

  let questionIds, frozenConfig;
  try {
    questionIds = JSON.parse(String(session.question_ids || '[]'));
    frozenConfig = JSON.parse(String(session.exam_config || '{}'));
  } catch { return null; }
  if (!Array.isArray(questionIds) || questionIds.length === 0 ||
      questionIds.some(id => typeof id !== 'string' && typeof id !== 'number') ||
      !frozenConfig || typeof frozenConfig !== 'object' || Array.isArray(frozenConfig)) return null;
  if (frozenConfig.id && String(frozenConfig.id) !== expectedExamId) return null;

  // An exam JWT is readable by its holder. Never include rubric secrets.
  const { aiPrompt, ai_prompt, ...safeConfig } = frozenConfig;
  const feedback = participantId ? false : frozenConfig.immediateFeedback;
  const timeLimitSeconds = Math.max(1, Math.round((deadlineAtMs - startedAtMs) / 1000));
  return {
    purpose: 'exam_active',
    gradingSessionId: String(session.session_id),
    questionIds: questionIds.map(id => String(id)),
    studentUserId: studentId || null,
    contestParticipantId: participantId || null,
    teacherId: String(session.teacher_id || ''),
    examConfig: { ...safeConfig, id: expectedExamId },
    maxCheatWarnings: Math.max(1, Number(frozenConfig.maxCheatWarnings || maxCheatWarnings) || 5),
    // For older snapshots, fail closed instead of reading a changed live policy.
    immediateFeedback: feedback === true || feedback === 1 || feedback === 'true',
    startedAtMs, deadlineAtMs, timestamp: startedAtMs, timeLimitSeconds,
    exp: Math.floor(expiresAtMs / 1000)
  };
}

/**
 * Abandonment is only available when the old session is demonstrably NOT
 * recoverable/gradable. Never infer that from a browser timeout or refusal.
 * Existing snapshots and autosaved answers are preserved for audit.
 */
export function unrecoverableExamSnapshotReason(session, examId, nowMs = Date.now()) {
  if (!session) return 'missing_snapshot';
  if (String(session.exam_id || '') !== String(examId || '')) return null;
  const expires = Date.parse(String(session.expires_at || ''));
  if (Number.isFinite(expires) && expires <= nowMs) return 'expired_snapshot';
  // A missing or invalid timestamp alone can be a transient /start race;
  // never discard this session before the server's technical TTL.
  let ids, questions, config;
  try {
    ids = JSON.parse(String(session.question_ids || '[]'));
    questions = JSON.parse(String(session.question_snapshot || '[]'));
    config = JSON.parse(String(session.exam_config || '{}'));
  } catch { return 'corrupt_snapshot'; }
  // An ID mismatch might still be gradable by a legacy scorer, so do not
  // release the original lock on that evidence alone.
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  if (config.id && String(config.id) !== String(examId)) return null;
  if (!Array.isArray(ids) || ids.length === 0 || !Array.isArray(questions) ||
      questions.length !== ids.length || questions.some((q, i) =>
        !q || String(q.id ?? q.questionId ?? '') !== String(ids[i]))) {
    return 'corrupt_snapshot';
  }
  return null;
}

export function examAllowsFreshAttempt(maxAttempts, completedAttempts) {
  const limit = Number(maxAttempts);
  const used = Number(completedAttempts);
  if (!Number.isInteger(limit) || limit < 0 ||
      !Number.isInteger(used) || used < 0) return false;
  // 0 is the existing system's unlimited-attempt configuration. 1 is
  // explicitly single-attempt and must never allow an orphan reset.
  return limit === 0 || (limit > 1 && used < limit);
}

/** Auth roles are stored as either a student role or a generic "user" with
 * a verified student target audience. A teacher/admin role never qualifies. */
export function isAuthenticatedSchoolExamStudent(user) {
  if (!user || typeof user !== 'object') return false;
  const role = String(user.role || '').trim().toLocaleLowerCase('vi-VN');
  const audience = String(user.target_audience || '').trim().toLocaleLowerCase('vi-VN');
  return role === 'student' || role === 'học sinh' ||
    (role === 'user' && (audience === 'học sinh' || audience === 'student'));
}

/** Inspect both the active lock's snapshot and its frozen question order before
 * claiming that a previously-started exam can actually be restored. This check
 * is read-only: it never deletes answers, locks or consumed attempts. */
export function inspectActiveExamRecoveryState(session, examId, studentUserId, nowMs = Date.now()) {
  const bad = unrecoverableExamSnapshotReason(session, examId, nowMs);
  if (bad) return { canResume: false, reason: bad };
  if (!session || String(session.exam_id || '') !== String(examId || '')) {
    return { canResume: false, reason: 'snapshot_exam_mismatch' };
  }
  const payload = buildActiveExamRecoveryPayload({
    session, examId, studentUserId, nowMs
  });
  if (!payload) return { canResume: false, reason: 'snapshot_not_activatable' };
  let questions;
  try { questions = JSON.parse(String(session.question_snapshot || '[]')); }
  catch { return { canResume: false, reason: 'corrupt_snapshot' }; }
  if (!Array.isArray(questions) ||
      questions.length !== payload.questionIds.length ||
      questions.some((q, i) => String(q?.id ?? q?.questionId ?? '') !== payload.questionIds[i])) {
    return { canResume: false, reason: 'corrupt_snapshot' };
  }
  return { canResume: true, reason: null };
}
