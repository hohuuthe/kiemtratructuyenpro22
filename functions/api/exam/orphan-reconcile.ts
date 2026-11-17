import { hashToken } from './utils';

/**
 * Historical locks can outlive an old grading snapshot. Never manufacture a
 * score: archive the consumed attempt and release its lock in ONE SQL statement.
 * Only expired legacy sessions with no heartbeat row are eligible.
 * Modern sessions with a missing snapshot require manual investigation.
 */
export const FAILED_ATTEMPT_CLEANUP_AUDIT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS _exam_failed_attempt_cleanup_audit (
    session_id TEXT PRIMARY KEY,
    attempt_key TEXT NOT NULL,
    exam_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    lock_data JSONB NOT NULL,
    draft_data JSONB,
    reason TEXT NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

// An incomplete snapshot is a SERVER DATA FAILURE, not a consumed exam:
// preserve a forensic audit copy and remove only its stale active lock and
// unusable draft atomically. Do not insert into _exam_abandoned_attempts;
// that table counts genuinely consumed attempts toward a student's quota.
export const EXPIRED_LEGACY_ORPHAN_SQL = `
WITH eligible AS (
  SELECT a.attempt_key,a.session_id,a.exam_id,a.user_id,
         a.created_at,a.expires_at,
         d.answers_json,d.revision,d.saved_at,d.writer_id,d.writer_seen_at
  FROM _exam_active_attempts a
  LEFT JOIN _exam_answer_drafts d ON d.session_id=a.session_id
  WHERE a.attempt_key=? AND a.session_id=?
    AND a.user_id NOT LIKE 'contest:%'
    AND (
      a.expires_at::timestamptz < ?::timestamptz
      OR (
        a.created_at::timestamptz < ?::timestamptz
        AND (d.saved_at IS NULL OR d.saved_at::timestamptz < ?::timestamptz)
      )
    )
    AND NOT EXISTS (SELECT 1 FROM _exam_grade_sessions gs WHERE gs.session_id=a.session_id)
    AND NOT EXISTS (SELECT 1 FROM _exam_attempt_liveness l WHERE l.session_id=a.session_id)
    AND NOT EXISTS (SELECT 1 FROM results r WHERE r.submission_token_hash=?)
    AND NOT EXISTS (
      SELECT 1 FROM _submitted_exam_tokens t
      WHERE t.token_hash=? AND t.status IN ('processing','completed')
    )
    AND NOT EXISTS (
      SELECT 1 FROM results r WHERE r.exam_id=a.exam_id AND r.user_id=a.user_id
        AND r.created_at::timestamptz >= a.created_at::timestamptz
    )
  FOR UPDATE OF a
), archived AS (
  INSERT INTO _exam_failed_attempt_cleanup_audit
    (session_id,attempt_key,exam_id,user_id,lock_data,draft_data,reason,archived_at)
  SELECT e.session_id,e.attempt_key,e.exam_id,e.user_id,
    jsonb_build_object('attempt_key',e.attempt_key,'session_id',e.session_id,
      'exam_id',e.exam_id,'user_id',e.user_id,'created_at',e.created_at,
      'expires_at',e.expires_at),
    CASE WHEN e.answers_json IS NULL THEN NULL ELSE
      jsonb_build_object('answers_json',e.answers_json,'revision',e.revision,
        'saved_at',e.saved_at,'writer_id',e.writer_id,'writer_seen_at',e.writer_seen_at)
    END,
    'invalid_missing_frozen_exam_snapshot',now()
  FROM eligible e
  ON CONFLICT(session_id) DO NOTHING
  RETURNING session_id
), released AS (
  DELETE FROM _exam_active_attempts a
  USING archived b WHERE a.session_id=b.session_id AND a.attempt_key=?
  RETURNING a.session_id
), removed_drafts AS (
  DELETE FROM _exam_answer_drafts d
  USING released r WHERE d.session_id=r.session_id
  RETURNING d.session_id
)
SELECT session_id FROM released
`;

/**
 * A legacy result may have been committed even when lock cleanup failed.
 * In that case the scored result ALREADY consumes the attempt: release its
 * exact obsolete lock, never create a second abandoned-attempt record.
 */
export const EXPIRED_SUBMITTED_ORPHAN_SQL = `
WITH eligible AS (
  SELECT a.attempt_key, a.session_id
  FROM _exam_active_attempts a
  WHERE a.attempt_key = ? AND a.session_id = ?
    AND a.expires_at::timestamptz < ?::timestamptz
    AND NOT EXISTS (
      SELECT 1 FROM _exam_grade_sessions g WHERE g.session_id = a.session_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM _exam_attempt_liveness l WHERE l.session_id = a.session_id
    )
    AND EXISTS (
      SELECT 1 FROM results r
      WHERE r.submission_token_hash = ?
        AND r.exam_id = a.exam_id AND r.user_id = a.user_id
    )
  FOR UPDATE
), released AS (
  DELETE FROM _exam_active_attempts a
  USING eligible e
  WHERE a.attempt_key = e.attempt_key AND a.session_id = e.session_id
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
  await db.prepare(FAILED_ATTEMPT_CLEANUP_AUDIT_SCHEMA).run();
  const immutableHash = await hashToken('exam-session:' + sessionId);
  const submitted: any = await db.prepare(EXPIRED_SUBMITTED_ORPHAN_SQL).bind(
    attemptKey, sessionId, now, immutableHash
  ).first();
  if (String(submitted?.session_id || '') === sessionId) return true;
  const staleCutoff = new Date(Date.parse(now) - 90_000).toISOString();
  const row: any = await db.prepare(EXPIRED_LEGACY_ORPHAN_SQL).bind(
    attemptKey, sessionId, now, staleCutoff, staleCutoff,
    immutableHash, immutableHash, attemptKey
  ).first();
  return String(row?.session_id || '') === sessionId;
}
