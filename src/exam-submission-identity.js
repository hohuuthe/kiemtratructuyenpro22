/**
 * Two valid signed exam tokens can represent the same authenticated student's
 * session after a safe recovery. They must share the same atomic grade claim.
 * Preserve token-scoped identity for anonymous and public contest candidates.
 */
export function examSubmissionClaimIdentity(token, claims = {}) {
  const userId = String(claims?.studentUserId || '').trim();
  const sessionId = String(claims?.gradingSessionId || '').trim();
  return userId && sessionId ? 'account-exam-session:' + sessionId : String(token || '');
}
