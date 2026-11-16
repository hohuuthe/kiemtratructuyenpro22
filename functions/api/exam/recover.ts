import { getDatabase, getDynamicSecret, signJWT, verifyAuthSession } from './utils';
import { buildActiveExamRecoveryPayload } from '../../../src/exam-active-attempt-recovery.js';

interface Env {
  NEON_DATABASE_URL?: string;
  DATABASE_URL?: string;
  JWT_SECRET?: string;
  DB?: any;
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

function reply(status: number, body: any): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers });

/**
 * Recover only the already-started school attempt of the authenticated student.
 * No arbitrary sessionId or userId is accepted from the caller. The unique
 * active-attempt DB lock is the sole pointer to the existing frozen snapshot.
 * The endpoint never creates a new attempt or resets its authoritative clock.
 */
export const onRequestPost: PagesFunction<Env> = async context => {
  const db = getDatabase(context);
  try {
    const secret = await getDynamicSecret(db, context.env.JWT_SECRET);
    const authorization = context.request.headers.get('authorization') || '';
    if (!authorization.startsWith('Bearer ')) {
      return reply(401, { code: 'EXAM_RECOVERY_LOGIN_REQUIRED', error: 'Vui lòng đăng nhập để xác minh phiên thi đang làm.' });
    }
    const user: any = await verifyAuthSession(authorization.slice(7), secret, db);
    const userId = String(user?.user_id || user?.id || '').trim();
    if (!userId || !['student','học sinh'].includes(String(user?.role || '').trim().toLocaleLowerCase('vi-VN'))) {
      return reply(403, { code: 'EXAM_RECOVERY_FORBIDDEN', error: 'Không thể xác minh quyền khôi phục bài làm của học sinh.' });
    }

    const body: any = await context.request.json().catch(() => ({}));
    const examId = String(body?.examId || '').trim();
    if (!examId || examId.length > 200) {
      return reply(400, { code: 'EXAM_RECOVERY_EXAM_REQUIRED', error: 'Thiếu mã đề thi hợp lệ.' });
    }

    // Preflight is read-only: the browser must be offered a choice BEFORE
    // /exam/generate issues any replacement PRESTART token. Only this account's
    // exact exam key may be inspected. Final quota/access checks remain in start.
    if (body?.mode === 'inspect') {
      const attemptKey = examId + ':' + userId;
      let active: any = null;
      try {
        active = await db.prepare(
          'SELECT session_id FROM _exam_active_attempts WHERE attempt_key = ? AND exam_id = ? AND user_id = ?'
        ).bind(attemptKey, examId, userId).first();
      } catch (inspectError) {
        console.error('Cannot inspect active attempt:', inspectError);
        return reply(503,{ code:'EXAM_INSPECT_UNAVAILABLE', error:'Không thể kiểm tra phiên thi cũ. Chưa tạo phiên mới để tránh trùng lượt.' });
      }
      if (!active?.session_id) return reply(200,{ active:false });
      const exam: any = await db.prepare(
        'SELECT max_attempts, chedodethi FROM exam_configs WHERE id = ?'
      ).bind(examId).first();
      if (!exam) return reply(409,{code:'EXAM_INSPECT_EXAM_MISSING',error:'Đề thi không còn tồn tại.'});
      await db.prepare(`CREATE TABLE IF NOT EXISTS _exam_abandoned_attempts (
        session_id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, user_id TEXT NOT NULL,
        reason TEXT NOT NULL, abandoned_at TEXT NOT NULL
      )`).run();
      const completed: any = await db.prepare(
        'SELECT COUNT(*) AS count FROM results WHERE exam_id = ? AND user_id = ?'
      ).bind(examId,userId).first();
      const abandoned: any = await db.prepare(
        'SELECT COUNT(*) AS count FROM _exam_abandoned_attempts WHERE exam_id = ? AND user_id = ?'
      ).bind(examId,userId).first();
      const quota = Number(exam.max_attempts);
      const used = Number(completed?.count || 0) + Number(abandoned?.count || 0);
      // One ACTIVE attempt will become a consumed attempt if replaced.
      const canCreateNew = String(exam.chedodethi || '') !== 'Cuộc thi trực tuyến' &&
        Number.isInteger(quota) && (quota === 0 || (quota > 1 && used + 1 < quota));
      return reply(200,{
        active:true, sessionId:String(active.session_id), canCreateNew,
        // Display hints only. The replacement operation recomputes counts
        // including unlinked legacy results before committing the change.
        maxAttempts:quota, usedAttempts:used, minimumConsumedOnReplace:used+1
      });
    }

    // Fail closed if the lock or its exact snapshot cannot be queried.
    const active: any = await db.prepare(
      'SELECT exam_id, user_id, session_id, expires_at FROM _exam_active_attempts WHERE attempt_key = ?'
    ).bind(examId + ':' + userId).first();
    if (!active || String(active.exam_id) !== examId || String(active.user_id) !== userId) {
      return reply(404, { code: 'EXAM_RECOVERY_NOT_FOUND', error: 'Không tìm thấy phiên đang làm hợp lệ của đề thi này.' });
    }
    // The active-lock TTL is a concurrency guard, not the authoritative
    // lifetime of the grading snapshot. An old lock can expire early after
    // deployment or a worker crash while the snapshot is still recoverable.
    const session: any = await db.prepare(
      'SELECT session_id, exam_id, teacher_id, question_ids, question_snapshot, exam_config, started_at, deadline_at, expires_at FROM _exam_grade_sessions WHERE session_id = ?'
    ).bind(String(active.session_id)).first();
    if (!session || String(session.session_id) !== String(active.session_id)) {
      return reply(409, { code: 'EXAM_RECOVERY_ORPHAN', error: 'Khóa phiên thi không khớp dữ liệu bài làm. Không mở phiên mới để tránh mất bài.' });
    }
    // Respect the autosave writer lease: a second live tab/device must not
    // silently take over and race the original writer's in-flight answers.
    const requestedWriterId = String(body?.writerId || '').trim();
    if (!/^[A-Za-z0-9_-]{8,120}$/.test(requestedWriterId)) {
      return reply(400, { code: 'EXAM_RECOVERY_WRITER_REQUIRED', error: 'Không xác minh được tab đang khôi phục bài thi.' });
    }
    try {
      const draft: any = await db.prepare(
        'SELECT writer_id, writer_seen_at FROM _exam_answer_drafts WHERE session_id = ?'
      ).bind(String(session.session_id)).first();
      const holder = String(draft?.writer_id || '').trim();
      const seenAt = Date.parse(String(draft?.writer_seen_at || ''));
      if (holder && holder !== requestedWriterId && Number.isFinite(seenAt) &&
          seenAt > Date.now() - 15_000) {
        return reply(409, {
          code: 'EXAM_RECOVERY_WRITER_BUSY',
          error: 'Phiên thi đang được lưu từ tab hoặc thiết bị khác. Vui lòng quay lại phiên đang làm hoặc thử sau khi phiên đó ngừng hoạt động.'
        });
      }
    } catch (leaseError) {
      // Older installations might not yet have the autosave lease columns.
      // The existing /exam/save compare-and-set guard remains authoritative.
      console.warn('Recovery draft writer lease not available:', leaseError);
    }

    const tokenPayload = buildActiveExamRecoveryPayload({ session, examId, studentUserId: userId });
    if (!tokenPayload) {
      return reply(409, { code: 'EXAM_RECOVERY_UNSAFE', error: 'Dữ liệu phiên đang làm chưa đủ điều kiện khôi phục an toàn.' });
    }

    // The questions remain only in /exam/resume; do not expose snapshot keys here.
    try {
      const questions = JSON.parse(String(session.question_snapshot || '[]'));
      if (!Array.isArray(questions) || questions.length !== tokenPayload.questionIds.length ||
          questions.some((question: any, index: number) =>
            String(question?.id ?? question?.questionId ?? '') !== tokenPayload.questionIds[index])) {
        return reply(409, { code: 'EXAM_RECOVERY_SNAPSHOT_MISMATCH', error: 'Bản đề gốc không khớp. Vui lòng báo giáo viên kiểm tra.' });
      }
    } catch {
      return reply(409, { code: 'EXAM_RECOVERY_SNAPSHOT_INVALID', error: 'Không thể xác minh bản đề gốc của phiên làm bài.' });
    }
    const token = await signJWT(tokenPayload, secret);
    return reply(200, { recovered: true, token });
  } catch (error) {
    console.error('Cannot recover already-active exam session:', error);
    return reply(503, { code: 'EXAM_RECOVERY_UNAVAILABLE', error: 'Không thể kiểm tra phiên thi cũ lúc này. Bài làm được giữ nguyên; vui lòng thử lại.' });
  }
};
