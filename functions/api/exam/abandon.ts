import { verifyAuthSession, getDynamicSecret, getDatabase, hashToken } from './utils';
import { examAllowsFreshAttempt, unrecoverableExamSnapshotReason } from '../../../src/exam-active-attempt-recovery.js';

interface Env { NEON_DATABASE_URL?: string; DATABASE_URL?: string; JWT_SECRET?: string; DB?: any }
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Cache-Control':'no-store' };
const reply = (status:number, body:any) => new Response(JSON.stringify(body), { status, headers });

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { status:204, headers });

/**
 * Only a proven unusable old session may be abandoned, and only on a
 * multiple-attempt school exam. A timeout, broken browser or another active
 * writer is NOT proof. No old answers/snapshots are deleted.
 *
 * PostgreSQL one-statement CTE atomically revokes the attempt and releases
 * its lock; another tab cannot race this acknowledgement.
 */
export const onRequestPost: PagesFunction<Env> = async context => {
  const db = getDatabase(context);
  try {
    const secret = await getDynamicSecret(db, context.env.JWT_SECRET);
    const authorization = context.request.headers.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) return reply(401, {code:'EXAM_ABANDON_AUTH_REQUIRED',error:'Vui lòng đăng nhập để kiểm tra quyền tạo lượt thi mới.'});
    const user:any = await verifyAuthSession(authorization.slice(7), secret, db);
    const userId = String(user?.user_id || user?.id || '').trim();
    if (!userId || String(user?.role || '').toLowerCase() !== 'student') {
      return reply(403,{code:'EXAM_ABANDON_FORBIDDEN',error:'Tài khoản không có quyền thao tác phiên thi này.'});
    }
    const data:any = await context.request.json().catch(() => ({}));
    const examId = String(data?.examId || '').trim();
    if (!examId || examId.length > 200 || data?.confirm !== true) {
      return reply(400,{code:'EXAM_ABANDON_CONFIRM_REQUIRED',error:'Cần chọn đúng đề thi và xác nhận tạo lượt mới.'});
    }
    const exam:any = await db.prepare('SELECT id, max_attempts, chedodethi FROM exam_configs WHERE id = ? LIMIT 1').bind(examId).first();
    if (!exam || String(exam.id) !== examId || String(exam.chedodethi || '') === 'Cuộc thi trực tuyến') {
      return reply(403,{code:'EXAM_ABANDON_EXAM_UNAVAILABLE',error:'Đề thi không tồn tại hoặc không hỗ trợ bỏ phiên theo cơ chế này.'});
    }
    const maxAttempts = Number(exam.max_attempts);
    if (!Number.isInteger(maxAttempts) || maxAttempts === 1 || maxAttempts < 0) {
      return reply(403,{code:'EXAM_ABANDON_SINGLE_ATTEMPT',error:'Đề thi chỉ cho phép một lượt hoặc cấu hình số lượt không hợp lệ.'});
    }
    // The final /exam/start still enforces the complete legacy-aware quota.
    // Do not bypass that check with this endpoint.
    const row:any = await db.prepare('SELECT COUNT(*) AS count FROM results WHERE exam_id = ? AND user_id = ?')
      .bind(examId,userId).first();
    const completed = Number(row?.count);
    if (!examAllowsFreshAttempt(maxAttempts, completed)) {
      return reply(403,{code:'EXAM_ABANDON_ATTEMPT_LIMIT',error:'Không còn lượt thi được phép theo cấu hình đề.'});
    }

    const key = examId + ':' + userId;
    const old:any = await db.prepare(
      'SELECT attempt_key, session_id, exam_id, user_id FROM _exam_active_attempts WHERE attempt_key = ?'
    ).bind(key).first();
    if (!old) return reply(200,{abandoned:false,canCreateNew:true,alreadyReleased:true});
    if (String(old.exam_id) !== examId || String(old.user_id) !== userId) {
      return reply(409,{code:'EXAM_ABANDON_SCOPE_MISMATCH',error:'Phiên thi không thuộc đúng tài khoản hoặc đề đã chọn.'});
    }
    const session:any = await db.prepare(
      'SELECT session_id, exam_id, question_ids, question_snapshot, exam_config, started_at, deadline_at, expires_at FROM _exam_grade_sessions WHERE session_id = ?'
    ).bind(String(old.session_id)).first();
    const reason = unrecoverableExamSnapshotReason(session,examId,Date.now());
    if (!reason) return reply(409,{code:'EXAM_ABANDON_RECOVERABLE',
      error:'Phiên cũ vẫn có dữ liệu hợp lệ. Hãy khôi phục và hoàn tất phiên đó; không thể bỏ phiên đang hoạt động.'});

    // Never release a lock when an existing submission is processing or
    // a result has already been persisted. Reconcile submission first.
    await db.prepare(`CREATE TABLE IF NOT EXISTS _submitted_exam_tokens (
      token_hash TEXT PRIMARY KEY, exam_id TEXT, student_name TEXT, user_id TEXT,
      submitted_at TEXT, status TEXT, result_id TEXT, claimed_at TEXT
    )`).run();
    // Existing deployments may have added these fields after initial creation.
    for (const column of ['status','result_id']) {
      await db.prepare('ALTER TABLE _submitted_exam_tokens ADD COLUMN IF NOT EXISTS ' + column + ' TEXT').run();
    }
    const processing:any = await db.prepare(
      'SELECT 1 AS pending FROM _submitted_exam_tokens WHERE token_hash = ? AND (status = ? OR status = ?) LIMIT 1'
    ).bind(await hashToken('exam-session:' + String(old.session_id)), 'processing', 'completed').first();
    if (processing?.pending) return reply(409,{code:'EXAM_ABANDON_SUBMISSION_EXISTS',
      error:'Máy chủ đã nhận yêu cầu nộp bài hoặc đang chấm. Không được bỏ phiên để tránh tạo kết quả trùng.'});

    // Preserve the original snapshot and autosave for audit. Revocation is
    // checked in /exam/grade, /exam/save and /exam/resume before accepting
    // an old token. Unique session_id makes the action idempotent.
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS _exam_abandoned_attempts (
        session_id TEXT PRIMARY KEY,
        exam_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        abandoned_at TEXT NOT NULL
      )
    `).run();
    const result:any = await db.prepare(`
      WITH released AS (
        DELETE FROM _exam_active_attempts
        WHERE attempt_key = ? AND session_id = ? AND exam_id = ? AND user_id = ?
        RETURNING session_id
      )
      INSERT INTO _exam_abandoned_attempts
        (session_id,exam_id,user_id,reason,abandoned_at)
      SELECT session_id, ?, ?, ?, ?
      FROM released
      WHERE TRUE
      ON CONFLICT (session_id) DO UPDATE
        SET reason = excluded.reason
      RETURNING session_id
    `).bind(key,String(old.session_id),examId,userId,
      examId,userId,reason,new Date().toISOString()).run();
    if (Number(result?.meta?.changes || 0) !== 1) {
      return reply(409,{code:'EXAM_ABANDON_RACE',error:'Trạng thái phiên vừa thay đổi. Vui lòng kiểm tra lại trước khi tạo lượt mới.'});
    }
    return reply(200,{abandoned:true,canCreateNew:true});
  } catch (error) {
    console.error('Cannot safely abandon irrecoverable exam:',error);
    return reply(503,{code:'EXAM_ABANDON_UNAVAILABLE',
      error:'Chưa thể xác minh hoặc giải phóng phiên thi an toàn. Bài làm cũ vẫn được giữ để đối soát.'});
  }
};
