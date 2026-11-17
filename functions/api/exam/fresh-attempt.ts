/**
 * Always starts a fresh, signed exam session. An old ACTIVE lock is never a
 * reason to block the next start or attempt to resume a browser session.
 *
 * The previous in-progress attempt is archived for audit, then atomically
 * superseded by the new lock. Its frozen question/answer snapshot MUST stay
 * in the database until its result is committed or manually reviewed.
 * A former grading claim never blocks admission to a new eligible attempt.
 * The old browser token is revoked, but the internal finalizer can finish it.
 */
export const FRESH_EXAM_ATTEMPT_CLAIM_SQL = `
WITH previous AS MATERIALIZED (
  SELECT a.* FROM _exam_active_attempts a
  WHERE a.attempt_key=? AND a.exam_id=? AND a.user_id=?
    AND a.session_id<>?
  FOR UPDATE
), committed_processing AS (
  UPDATE _submitted_exam_tokens t SET status='completed',result_id=r.id
  FROM previous p,results r
  WHERE t.token_hash=encode(sha256(convert_to('exam-session:'||p.session_id,'UTF8')),'hex')
    AND t.status='processing'
    AND r.submission_token_hash=t.token_hash
    AND r.exam_id=p.exam_id
    AND (t.result_id IS NULL OR r.id=t.result_id)
  RETURNING t.token_hash
), safe_previous AS MATERIALIZED (
  SELECT p.*,to_jsonb(gs) AS frozen,to_jsonb(d) AS draft,to_jsonb(ca) AS contest
  FROM previous p
  LEFT JOIN _exam_grade_sessions gs ON gs.session_id=p.session_id
  LEFT JOIN _exam_answer_drafts d ON d.session_id=p.session_id
  LEFT JOIN contest_attempts ca ON ca.ma_phien_thi=p.session_id
  -- Previous submitted/finalizing sessions must remain available for
  -- grading. A NEW attempt does not wait for an old grading claim: the
  -- immutable claim and snapshot are independent of the ACTIVE pointer.
), archived AS (
  INSERT INTO _exam_discarded_session_archive
    (session_id,kind,source_data,reason)
  SELECT p.session_id, item.kind,item.data,'superseded_by_new_exam_start'
  FROM safe_previous p
  CROSS JOIN LATERAL (VALUES
    ('fresh_lock',to_jsonb(p)),
    ('fresh_frozen',COALESCE(p.frozen,'{}'::jsonb)),
    ('fresh_draft',COALESCE(p.draft,'{}'::jsonb)),
    ('fresh_contest',COALESCE(p.contest,'{}'::jsonb))
  ) item(kind,data)
  ON CONFLICT (session_id,kind) DO UPDATE
    SET archived_at=_exam_discarded_session_archive.archived_at
  RETURNING session_id,kind
), audited AS (
  SELECT p.session_id FROM safe_previous p
  WHERE (SELECT COUNT(*) FROM archived ar WHERE ar.session_id=p.session_id
    AND ar.kind IN ('fresh_lock','fresh_frozen','fresh_draft','fresh_contest'))=4
), quota_admission AS (
  INSERT INTO _exam_attempt_quota_guard
    (attempt_key,used_attempts,last_session_id,updated_at)
  SELECT ?,?+1,?,now()::text
  WHERE ?>0 AND ?<?
  ON CONFLICT(attempt_key) DO UPDATE SET
    used_attempts=_exam_attempt_quota_guard.used_attempts+1,
    last_session_id=excluded.last_session_id,
    updated_at=excluded.updated_at
  WHERE _exam_attempt_quota_guard.used_attempts<? AND
    _exam_attempt_quota_guard.last_session_id<>excluded.last_session_id
  RETURNING attempt_key
), admission AS (
  SELECT 1 AS allowed WHERE ?=0
  UNION ALL
  SELECT 1 FROM quota_admission WHERE ?>0
), claimed AS (
  INSERT INTO _exam_active_attempts
    (attempt_key,exam_id,user_id,session_id,expires_at,created_at)
  SELECT ?,?,?,?,?,? FROM admission
  ON CONFLICT (attempt_key) DO UPDATE SET
    session_id=excluded.session_id,
    expires_at=excluded.expires_at,
    created_at=excluded.created_at
  WHERE _exam_active_attempts.session_id=excluded.session_id
     OR EXISTS(
       SELECT 1 FROM audited a
       WHERE a.session_id=_exam_active_attempts.session_id
     )
  RETURNING session_id
), retired_contest AS (
  UPDATE contest_attempts ca SET
    trang_thai=CASE WHEN EXISTS(
      SELECT 1 FROM results r WHERE r.ma_phien_thi=ca.ma_phien_thi
      AND r.ma_nguoi_du_thi=ca.ma_nguoi_du_thi AND r.exam_id=ca.ma_de_thi
    ) THEN 'DA_NOP' ELSE 'HUY' END,
    ma_ket_qua=COALESCE(ca.ma_ket_qua,(
      SELECT r.id FROM results r WHERE r.ma_phien_thi=ca.ma_phien_thi
      AND r.ma_nguoi_du_thi=ca.ma_nguoi_du_thi AND r.exam_id=ca.ma_de_thi
      ORDER BY r.created_at DESC LIMIT 1
    )),
    thoi_diem_nop=CASE WHEN EXISTS(
      SELECT 1 FROM results r WHERE r.ma_phien_thi=ca.ma_phien_thi
      AND r.ma_nguoi_du_thi=ca.ma_nguoi_du_thi AND r.exam_id=ca.ma_de_thi
    ) THEN COALESCE(ca.thoi_diem_nop,now()) ELSE ca.thoi_diem_nop END
  FROM audited a
  WHERE ca.ma_phien_thi=a.session_id AND ca.trang_thai='DANG_LAM'
    AND EXISTS(SELECT 1 FROM claimed)
  RETURNING ca.ma_phien_thi
), queued_for_grading AS (
  INSERT INTO _exam_attempt_liveness
    (session_id,exam_id,user_id,contest_participant_id,student_info_json,
     last_seen_at,deadline_at,leave_requested_at)
  SELECT p.session_id,p.exam_id,
    CASE WHEN p.user_id LIKE 'contest:%' THEN '' ELSE p.user_id END,
    CASE WHEN p.user_id LIKE 'contest:%' THEN substring(p.user_id FROM 9) ELSE '' END,
    '{}',COALESCE(gs.started_at,p.created_at),gs.deadline_at,now()::text
  FROM safe_previous p
  JOIN _exam_grade_sessions gs ON gs.session_id=p.session_id
  WHERE gs.started_at IS NOT NULL AND gs.deadline_at IS NOT NULL
    AND EXISTS(SELECT 1 FROM claimed)
  ON CONFLICT(session_id) DO UPDATE SET
    leave_requested_at=COALESCE(_exam_attempt_liveness.leave_requested_at,
      EXCLUDED.leave_requested_at),
    last_error='superseded_pending_auto_grade'
  WHERE _exam_attempt_liveness.finalized_at IS NULL
  RETURNING session_id
)
SELECT session_id,(SELECT COUNT(*) FROM retired_contest) AS contests_retired,
 (SELECT COUNT(*) FROM queued_for_grading) AS previous_pending_grade
FROM claimed
`;

export async function claimFreshExamAttempt(db:any,args:{
  attemptKey:string; examId:string; userId:string; sessionId:string;
  expiresAt:string; startedAt:string; maxAttempts:number; baselineUsed:number
}):Promise<boolean>{
  // Additive, compatible with existing Neon tenants.
  await db.prepare(`CREATE TABLE IF NOT EXISTS _exam_discarded_session_archive(
    session_id TEXT NOT NULL,kind TEXT NOT NULL,source_data JSONB NOT NULL,
    reason TEXT NOT NULL,archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(session_id,kind)
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS _submitted_exam_tokens(
    token_hash TEXT PRIMARY KEY,exam_id TEXT,student_name TEXT,user_id TEXT,
    submitted_at TEXT,status TEXT,result_id TEXT,claimed_at TEXT
  )`).run();
  await db.prepare('ALTER TABLE _submitted_exam_tokens ADD COLUMN IF NOT EXISTS status TEXT').run();
  await db.prepare('ALTER TABLE _submitted_exam_tokens ADD COLUMN IF NOT EXISTS claimed_at TEXT').run();
  await db.prepare('ALTER TABLE _submitted_exam_tokens ADD COLUMN IF NOT EXISTS result_id TEXT').run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS _exam_attempt_quota_guard (
    attempt_key TEXT PRIMARY KEY,
    used_attempts INTEGER NOT NULL,
    last_session_id TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  const max=Math.max(0,Math.floor(args.maxAttempts||0));
  const baseline=Math.max(0,Math.floor(args.baselineUsed||0));
  const result:any=await db.prepare(FRESH_EXAM_ATTEMPT_CLAIM_SQL).bind(
    args.attemptKey,args.examId,args.userId,args.sessionId,
    args.attemptKey,baseline,args.sessionId,max,baseline,max,max,max,max,
    args.attemptKey,args.examId,args.userId,args.sessionId,args.expiresAt,args.startedAt
  ).first();
  if (String(result?.session_id||'')===args.sessionId) return true;
  // The quota reservation may have succeeded while the ACTIVE swap failed.
  // Revert this exact unfinished reservation only; do not alter other sessions.
  if(max>0) await releaseUnusedExamQuotaSlot(db,args.sessionId);
  return false;
}

/** A failed-to-start attempt must not consume a quota reservation. */
export async function releaseUnusedExamQuotaSlot(db:any,sessionId:string) {
  if(!sessionId) return;
  await db.prepare(`
    UPDATE _exam_attempt_quota_guard q
    SET used_attempts=GREATEST(0,q.used_attempts-1),
        last_session_id='',updated_at=now()::text
    WHERE q.last_session_id=? AND q.used_attempts>0
      AND NOT EXISTS (
        SELECT 1 FROM _exam_grade_sessions gs
        WHERE gs.session_id=? AND gs.started_at IS NOT NULL
      )
  `).bind(sessionId,sessionId).run();
}
