/**
 * Always starts a fresh, signed exam session. An old ACTIVE lock is never a
 * reason to block the next start or attempt to resume a browser session.
 *
 * The previous in-progress attempt is archived (including frozen questions
 * and answers), then atomically superseded by the new lock. Its old token is
 * revoked by the exact-session lock/contest checks in save/grade/heartbeat.
 * Results previously committed remain authoritative for quota calculation.
 * Never supersede an attempt while its submission claim is processing.
 */
export const FRESH_EXAM_ATTEMPT_CLAIM_SQL = `
WITH previous AS MATERIALIZED (
  SELECT a.* FROM _exam_active_attempts a
  WHERE a.attempt_key=? AND a.exam_id=? AND a.user_id=?
    AND a.session_id<>?
  FOR UPDATE
), stale_processing AS (
  UPDATE _submitted_exam_tokens t SET status='superseded'
  FROM previous p
  WHERE t.token_hash=encode(sha256(convert_to('exam-session:'||p.session_id,'UTF8')),'hex')
    AND t.status='processing'
    AND NULLIF(t.claimed_at,'')::timestamptz < now()-interval '5 minutes'
    AND NOT EXISTS(
      SELECT 1 FROM results r
      WHERE r.submission_token_hash=t.token_hash
         OR (t.result_id IS NOT NULL AND r.id=t.result_id)
    )
    AND NOT EXISTS(
      SELECT 1 FROM _exam_attempt_liveness l
      WHERE l.session_id=p.session_id AND l.finalized_at IS NULL
        AND l.finalizing_at IS NOT NULL
        AND l.finalizing_at::timestamptz>now()-interval '5 minutes'
    )
  RETURNING t.token_hash,t.result_id,t.claimed_at,p.session_id
), safe_previous AS MATERIALIZED (
  SELECT p.*,to_jsonb(gs) AS frozen,to_jsonb(d) AS draft,to_jsonb(ca) AS contest
  FROM previous p
  LEFT JOIN _exam_grade_sessions gs ON gs.session_id=p.session_id
  LEFT JOIN _exam_answer_drafts d ON d.session_id=p.session_id
  LEFT JOIN contest_attempts ca ON ca.ma_phien_thi=p.session_id
  WHERE NOT EXISTS (
    SELECT 1 FROM _submitted_exam_tokens t
    WHERE t.token_hash=encode(sha256(convert_to('exam-session:'||p.session_id,'UTF8')),'hex')
      AND t.status='processing'
      AND NOT EXISTS(
        SELECT 1 FROM stale_processing sp WHERE sp.token_hash=t.token_hash
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM _exam_attempt_liveness l
    WHERE l.session_id=p.session_id AND l.finalized_at IS NULL
      AND l.finalizing_at IS NOT NULL
      AND l.finalizing_at::timestamptz>now()-interval '5 minutes'
  )
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
  UNION ALL
  SELECT sp.session_id,'fresh_stale_claim',
    jsonb_build_object('token_hash',sp.token_hash,'status_before','processing',
      'claimed_at',sp.claimed_at,'result_id',sp.result_id),
    'superseded_by_new_exam_start'
  FROM stale_processing sp
  ON CONFLICT (session_id,kind) DO UPDATE
    SET archived_at=_exam_discarded_session_archive.archived_at
  RETURNING session_id,kind
), audited AS (
  SELECT p.session_id FROM safe_previous p
  WHERE (SELECT COUNT(*) FROM archived ar WHERE ar.session_id=p.session_id
    AND ar.kind IN ('fresh_lock','fresh_frozen','fresh_draft','fresh_contest'))=4
), claimed AS (
  INSERT INTO _exam_active_attempts
    (attempt_key,exam_id,user_id,session_id,expires_at,created_at)
  VALUES (?,?,?,?,?,?)
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
), stopped_heartbeat AS (
  UPDATE _exam_attempt_liveness l
  SET finalized_at=COALESCE(l.finalized_at,now()::text),
      last_error='superseded_by_new_exam_start'
  FROM audited a WHERE l.session_id=a.session_id
    AND EXISTS(SELECT 1 FROM claimed)
  RETURNING l.session_id
), removed_frozen AS (
  DELETE FROM _exam_grade_sessions g USING audited a
  WHERE g.session_id=a.session_id
    AND EXISTS(SELECT 1 FROM claimed)
  RETURNING g.session_id
), removed_draft AS (
  DELETE FROM _exam_answer_drafts d USING audited a
  WHERE d.session_id=a.session_id
    AND EXISTS(SELECT 1 FROM claimed)
  RETURNING d.session_id
)
SELECT session_id,(SELECT COUNT(*) FROM retired_contest) AS contests_retired,
 (SELECT COUNT(*) FROM stopped_heartbeat) AS heartbeats_stopped,
 (SELECT COUNT(*) FROM removed_frozen) AS snapshots_removed,
 (SELECT COUNT(*) FROM removed_draft) AS drafts_removed
FROM claimed
`;

export async function claimFreshExamAttempt(db:any,args:{
  attemptKey:string; examId:string; userId:string; sessionId:string;
  expiresAt:string; startedAt:string
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
  const result:any=await db.prepare(FRESH_EXAM_ATTEMPT_CLAIM_SQL).bind(
    args.attemptKey,args.examId,args.userId,args.sessionId,
    args.attemptKey,args.examId,args.userId,args.sessionId,args.expiresAt,args.startedAt
  ).first();
  return String(result?.session_id||'')===args.sessionId;
}
