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
    // For older snapshots, fail closed instead of reading a changed live policy.\n    immediateFeedback: feedback === true || feedback === 1 || feedback === 'true',
    startedAtMs, deadlineAtMs, timestamp: startedAtMs, timeLimitSeconds,
    exp: Math.floor(expiresAtMs / 1000)
  };
}
