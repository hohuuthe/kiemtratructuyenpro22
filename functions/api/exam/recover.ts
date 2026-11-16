import { verifyAuthSession, signJWT, getDynamicSecret, getDatabase } from './utils';
import { makeGradeSessionConfig } from './security';
import { examBoolean, EXAM_SESSION_PURPOSE_ACTIVE } from '../../../src/exam-time-authority.js';

interface Env {
  NEON_DATABASE_URL?: string;
  DATABASE_URL?: string;
  DB?: any;
  JWT_SECRET?: string;
}
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};
const json = (body: any, status: number) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: corsHeaders });

/**
 * Re-issue a token for an existing ACTIVE grading snapshot. This endpoint
 * requires an authenticated account and exact exam ownership; it never starts
 * a new attempt or changes the server's deadline.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  const { request, env } = context;
  try {
    const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ code:'EXAM_RECOVER_LOGIN_REQUIRED',
        error:'Vui lòng đăng nhập đúng tài khoản đã bắt đầu bài thi.' }, 401);
    }
    const user: any = await verifyAuthSession(authHeader.slice(7), SECRET, db);
    const userId = String(user?.user_id || user?.id || '').trim();
    if (!userId) return json({ code:'EXAM_RECOVER_UNAUTHORIZED', error:'Tài khoản không còn hợp lệ.' }, 403);

    const body: any = await request.json();
    const examId = String(body?.examId || '').trim();
    const writerId = String(body?.writerId || '').trim();
    if (!examId || examId.length > 160 || !/^[A-Za-z0-9_-]{8,120}$/.test(writerId)) {
      return json({ code:'EXAM_RECOVER_INVALID', error:'Thiếu mã đề thi hoặc mã tab hợp lệ.' }, 400);
    }

    // Tenant isolation is provided by getDatabase(context), AND the queried
    // attempt must match the live authenticated user and exact exam ID.
    const active: any = await db.prepare(`
      SELECT aa.session_id, aa.expires_at AS lock_expires_at,
             gs.exam_id, gs.teacher_id, gs.question_ids, gs.exam_config,
             gs.expires_at, gs.started_at, gs.deadline_at
      FROM _exam_active_attempts aa
      JOIN _exam_grade_sessions gs ON gs.session_id = aa.session_id
      WHERE aa.attempt_key = ? AND aa.user_id = ? AND aa.exam_id = ?
        AND gs.exam_id = ? AND gs.started_at IS NOT NULL AND gs.deadline_at IS NOT NULL
      LIMIT 1
    `).bind(examId + ':' + userId, userId, examId, examId).first();
    if (!active) {
      return json({ code:'EXAM_RECOVER_NOT_FOUND',
        error:'Không tìm thấy phiên thi chưa hoàn tất thuộc tài khoản và đề thi này.' }, 409);
    }
    const nowMs = Date.now();
    const startedAtMs = Date.parse(String(active.started_at || ''));
    const deadlineAtMs = Date.parse(String(active.deadline_at || ''));
    const snapshotExpiresMs = Date.parse(String(active.expires_at || ''));
    const lockExpiresMs = Date.parse(String(active.lock_expires_at || ''));
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(deadlineAtMs) ||
        !Number.isFinite(snapshotExpiresMs) || !Number.isFinite(lockExpiresMs) ||
        startedAtMs <= 0 || deadlineAtMs <= startedAtMs ||
        snapshotExpiresMs <= nowMs || lockExpiresMs <= nowMs) {
      return json({ code:'EXAM_RECOVER_EXPIRED',
        error:'Phiên thi đã hết thời hạn khôi phục; vui lòng liên hệ giáo viên để kiểm tra.' }, 409);
    }

    // Never steal a recently active writer lease from a different tab.
    const lease: any = await db.prepare(
      'SELECT writer_id, writer_seen_at FROM _exam_answer_drafts WHERE session_id = ?'
    ).bind(String(active.session_id)).first();
    const lastSeen = Date.parse(String(lease?.writer_seen_at || ''));
    if (lease?.writer_id && String(lease.writer_id) !== writerId &&
        Number.isFinite(lastSeen) && lastSeen > nowMs - 15_000) {
      return json({ code:'EXAM_RECOVER_WRITER_ACTIVE',
        error:'Phiên thi đang được lưu ở tab hoặc thiết bị khác. Vui lòng quay lại tab đó, hoặc đóng tab cũ rồi thử lại.' }, 409);
    }

    let questionIds: string[] = [];
    let frozen: any = {};
    try {
      const parsed = JSON.parse(String(active.question_ids || '[]'));
      if (Array.isArray(parsed)) questionIds = parsed.map((id: any) => String(id));
      frozen = JSON.parse(String(active.exam_config || '{}')) || {};
    } catch {}
    if (!questionIds.length || questionIds.some((id: string) => !id) ||
        questionIds.length !== new Set(questionIds).size ||
        !frozen || typeof frozen !== 'object' || Array.isArray(frozen)) {
      return json({ code:'EXAM_RECOVER_SNAPSHOT_INVALID',
        error:'Snapshot phiên thi không hợp lệ; hệ thống không tạo bài thi thay thế.' }, 409);
    }

    // Legacy sessions lack frozen UI settings. Only consult the current exam
    // when its revision still matches the revision frozen at exam generation.
    let legacy: any = null;
    if (frozen.resumeImmediateFeedback === undefined || frozen.resumeMaxCheatWarnings === undefined) {
      const row: any = await db.prepare(
        'SELECT immediate_feedback, max_cheat_warnings, updated_at FROM exam_configs WHERE id = ? LIMIT 1'
      ).bind(examId).first();
      if (row && String(row.updated_at || '') === String(frozen.examRevision || '')) legacy = row;
    }
    const immediateFeedback = frozen.resumeImmediateFeedback !== undefined
      ? examBoolean(frozen.resumeImmediateFeedback, false)
      : examBoolean(legacy?.immediate_feedback, false);
    const warnings = Number(frozen.resumeMaxCheatWarnings ?? legacy?.max_cheat_warnings);
    const maxCheatWarnings = Number.isFinite(warnings) && warnings > 0 ? Math.floor(warnings) : 5;
    const timeLimitSeconds = Math.max(1, Math.round((deadlineAtMs - startedAtMs) / 1000));
    const examConfig = {
      ...makeGradeSessionConfig(frozen),
      examRevision: String(frozen.examRevision || ''),
      id: examId
    };
    // AI prompts / private grading instructions stay inside the DB snapshot.
    const token = await signJWT({
      purpose: EXAM_SESSION_PURPOSE_ACTIVE,
      questionIds,
      gradingSessionId: String(active.session_id),
      studentUserId: userId,
      contestParticipantId: null,
      examConfig,
      maxCheatWarnings,
      timeLimitSeconds,
      immediateFeedback,
      teacherId: String(active.teacher_id || ''),
      startedAtMs,
      deadlineAtMs,
      timestamp: startedAtMs,
      exp: Math.floor(snapshotExpiresMs / 1000)
    }, SECRET);
    return json({ token, recovered:true }, 200);
  } catch (error) {
    console.error('POST /api/exam/recover failed:', error);
    return json({ code:'EXAM_RECOVER_UNAVAILABLE',
      error:'Chưa thể xác minh phiên thi cũ an toàn. Vui lòng thử lại.' }, 503);
  }
};
