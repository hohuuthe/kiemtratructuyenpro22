/**
 * Signed recovery tokens issued for an already ACTIVE student/contest attempt
 * must use the same atomic submission gate as the original signed token.
 * Anonymous legacy tokens without stable owner identity retain token semantics.
 */
export function examSubmissionClaimIdentity(token, claims = {}) {
  const sessionId = String(claims?.gradingSessionId || '').trim();
  const studentId = String(claims?.studentUserId || '').trim();
  const participantId = String(claims?.contestParticipantId || '').trim();
  if (sessionId && (studentId || participantId)) {
    return 'exam-session:' + sessionId;
  }
  return String(token || '');
}
