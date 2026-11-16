import { hashToken } from './utils';

/**
 * Historical locks can outlive an old grading snapshot. Never manufacture a
 * score: archive the consumed attempt and release its lock in ONE SQL statement.
 * Only expired legacy sessions with no heartbeat row are eligible.
 * Modern sessions with a missing snapshot require manual investigation.
 */
export const EXPIRED_LEGACY_ORPHAN_SQL = `
WITH eligible AS (
  SELECT a.attempt_key, a.session_id, a.exam_id, a.user_id
  FROM _exam_active_attempts a
  WHERE a.attempt_key = ? AND a.session_id = ?
    AND a.expires_at::timestamptz < ?::timestamptz
    AND NOT EXISTS (
      SELECT 1 FROM _exam_grade_sessions g WHERE g.session_id = a.session_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM _exam_attempt_liveness l WHERE l.session_id = a.session_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM results r WHERE r.submission_token_hash = ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM _submitted_exam_tokens t
      WHERE t.token_hash = ? AND t.status IN ('processing', 'completed')
    )
    AND NOT EXISTS (
      SELECT 1 FROM results r
      WHERE r.exam_id = a.exam_id AND r.user_id = a.user_id
        AND r.created_at::timestamptz >= a.created_at::timestamptz
    )
  FOR UPDATE
), archived AS (
  INSERT INTO _exam_abandoned_attempts
    (session_id, exam_id, user_id, reason, abandoned_at)
  SELECT session_id, exam_id, user_id, 'orphan_snapshot_missing', ?
  FROM eligible
  ON CONFLICT (session_id) DO NOTHING
  RETURNING session_id
), released AS (
  DELETE FROM _exam_active_attempts a
  USING archived
  WHERE a.attempt_key = ? AND a.session_id = archived.session_id
  RETURNING a.session_id
)
SELECT session_id FROM released
`;

export async function reconcileExpiredLegacyOrphan(
  db: any, attemptKey: string, sessionId: string, now = new Date().toISOString()
): Promise<boolean> {
  if (!attemptKey || !sessionId) return false;
  // Older installations might not have the submission claims table yet.
  // Missing integrity tables must never be treated as permission to release.
  await db.prepare(`CREATE TABLE IF NOT EXISTS _submitted_exam_tokens (
    token_hash TEXT PRIMARY KEY, exam_id TEXT, student_name TEXT, user_id TEXT,
    submitted_at TEXT, status TEXT, result_id TEXT, claimed_at TEXT
  )`).run();
  const immutableHash = await hashToken('exam-session:' + sessionId);
  const row: any = await db.prepare(EXPIRED_LEGACY_ORPHAN_SQL).bind(
    attemptKey, sessionId, now, immutableHash, immutableHash, now, attemptKey
  ).first();
  return String(row?.session_id || '') === sessionId;
}
