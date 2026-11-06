import { verifyAuthSession, verifyJWT, signJWT, getDynamicSecret, getDatabase } from './utils';
import {
  EXAM_SESSION_PURPOSE_PRESTART,
  EXAM_SESSION_PURPOSE_ACTIVE,
  evaluateExamAccessWindow,
  normalizeExamTimeLimitSeconds,
  remainingExamSecondsFromDeadline
} from '../../../src/exam-time-authority.js';

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
  'Content-Type': 'application/json'
};

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  const { request, env } = context;
  const SECRET = await getDynamicSecret(db, env.JWT_SECRET);

  try {
    const body: any = await request.json();
    const token = String(body?.token || '').trim();
    if (!token) {
      return new Response(JSON.stringify({ error: 'Thiếu mã phiên chuẩn bị thi.' }), { status: 400, headers: corsHeaders });
    }

    const decoded: any = await verifyJWT(token, SECRET);
    if (!decoded) {
      return new Response(JSON.stringify({ error: 'Phiên chuẩn bị thi không hợp lệ hoặc đã hết hạn.' }), { status: 403, headers: corsHeaders });
    }
    if (decoded.purpose && decoded.purpose !== EXAM_SESSION_PURPOSE_PRESTART) {
      return new Response(JSON.stringify({ error: 'Phiên này không ở trạng thái chờ bắt đầu.' }), { status: 409, headers: corsHeaders });
    }

    const gradingSessionId = String(decoded.gradingSessionId || '').trim();
    if (!gradingSessionId) {
      return new Response(JSON.stringify({ error: 'Phiên thi thiếu mã phiên chấm điểm.' }), { status: 409, headers: corsHeaders });
    }

    const authHeader = request.headers.get('authorization') || '';
    let verifiedUser: any = null;
    if (authHeader.startsWith('Bearer ')) {
      verifiedUser = await verifyAuthSession(authHeader.substring(7), SECRET, db);
    }
    const signedStudentUserId = String(decoded.studentUserId || '').trim();
    if (signedStudentUserId) {
      const verifiedUserId = String(verifiedUser?.user_id || verifiedUser?.id || '').trim();
      if (!verifiedUserId || verifiedUserId !== signedStudentUserId) {
        return new Response(JSON.stringify({ error: 'Tài khoản bắt đầu thi không khớp tài khoản đã nhận đề.' }), { status: 403, headers: corsHeaders });
      }
    }

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS _exam_grade_sessions (
        session_id TEXT PRIMARY KEY,
        exam_id TEXT,
        teacher_id TEXT,
        question_ids TEXT NOT NULL,
        question_snapshot TEXT NOT NULL,
        exam_config TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        started_at TEXT,
        deadline_at TEXT
      )
    `).run();
    for (const sql of [
      'ALTER TABLE _exam_grade_sessions ADD COLUMN IF NOT EXISTS started_at TEXT',
      'ALTER TABLE _exam_grade_sessions ADD COLUMN IF NOT EXISTS deadline_at TEXT'
    ]) {
      try { await db.prepare(sql).run(); } catch {}
    }

    const snapshot: any = await db.prepare(
      'SELECT session_id, exam_id, question_ids, expires_at, started_at, deadline_at FROM _exam_grade_sessions WHERE session_id = ?'
    ).bind(gradingSessionId).first();
    if (!snapshot) {
      return new Response(JSON.stringify({ error: 'Phiên thi không tồn tại hoặc đã được thu hồi.' }), { status: 409, headers: corsHeaders });
    }
    const nowMs = Date.now();
    if (snapshot.expires_at && new Date(String(snapshot.expires_at)).getTime() <= nowMs) {
      return new Response(JSON.stringify({ error: 'Phiên chuẩn bị thi đã hết hạn. Vui lòng tải lại đề.' }), { status: 409, headers: corsHeaders });
    }

    const issuedIds = Array.isArray(decoded.questionIds) ? decoded.questionIds.map((id: any) => String(id)) : [];
    let frozenIds: string[] = [];
    try { frozenIds = JSON.parse(String(snapshot.question_ids || '[]')).map((id: any) => String(id)); } catch {}
    if (!issuedIds.length || JSON.stringify(issuedIds) !== JSON.stringify(frozenIds)) {
      return new Response(JSON.stringify({ error: 'Danh sách câu hỏi của phiên chuẩn bị thi không khớp dữ liệu máy chủ.' }), { status: 409, headers: corsHeaders });
    }

    const examId = String(snapshot.exam_id || decoded?.examConfig?.id || '').trim();
    if (examId) {
      try {
        const examRow: any = await db.prepare('SELECT * FROM exam_configs WHERE id = ? LIMIT 1').bind(examId).first();
        if (examRow) {
          const access = evaluateExamAccessWindow(examRow, nowMs);
          if (!access.allowed) {
            const message = access.code === 'EXAM_NOT_STARTED'
              ? 'Chưa đến thời gian được phép bắt đầu làm bài.'
              : access.code === 'EXAM_WINDOW_CLOSED'
                ? 'Đã hết thời gian được phép bắt đầu làm bài.'
                : 'Cấu hình khung thời gian của đề thi không hợp lệ.';
            return new Response(JSON.stringify({ code: access.code, error: message }), { status: 403, headers: corsHeaders });
          }
        }
      } catch (error) {
        console.error('Cannot validate exam access window at start:', error);
        return new Response(JSON.stringify({ error: 'Không thể xác minh thời gian được phép bắt đầu bài thi.' }), { status: 503, headers: corsHeaders });
      }
    }

    const timeLimitSeconds = normalizeExamTimeLimitSeconds(decoded.timeLimitSeconds);
    const proposedStartedAtMs = nowMs;
    const proposedDeadlineAtMs = proposedStartedAtMs + timeLimitSeconds * 1000;
    const proposedStartedAt = new Date(proposedStartedAtMs).toISOString();
    const proposedDeadlineAt = new Date(proposedDeadlineAtMs).toISOString();
    const proposedActiveExpiresAtMs = proposedDeadlineAtMs + 60 * 60 * 1000;
    const proposedActiveExpiresAt = new Date(proposedActiveExpiresAtMs).toISOString();

    // Claim đầu tiên ghi đồng thời start + deadline + TTL kỹ thuật. Không tồn tại
    // trạng thái "đã bắt đầu nhưng TTL chưa cập nhật" nếu một lệnh DB phía sau lỗi.
    await db.prepare(
      'UPDATE _exam_grade_sessions SET started_at = ?, deadline_at = ?, expires_at = ? WHERE session_id = ? AND started_at IS NULL'
    ).bind(proposedStartedAt, proposedDeadlineAt, proposedActiveExpiresAt, gradingSessionId).run();

    let authoritative: any = await db.prepare(
      'SELECT started_at, deadline_at FROM _exam_grade_sessions WHERE session_id = ?'
    ).bind(gradingSessionId).first();

    // Tự sửa dữ liệu chuyển tiếp nếu bản ghi cũ hiếm gặp đã có started_at nhưng thiếu deadline.
    const existingStartedAtMs = new Date(String(authoritative?.started_at || '')).getTime();
    if (Number.isFinite(existingStartedAtMs) && existingStartedAtMs > 0 && !authoritative?.deadline_at) {
      const recoveredDeadlineAt = new Date(existingStartedAtMs + timeLimitSeconds * 1000).toISOString();
      await db.prepare(
        'UPDATE _exam_grade_sessions SET deadline_at = ? WHERE session_id = ? AND deadline_at IS NULL'
      ).bind(recoveredDeadlineAt, gradingSessionId).run();
      authoritative = await db.prepare(
        'SELECT started_at, deadline_at FROM _exam_grade_sessions WHERE session_id = ?'
      ).bind(gradingSessionId).first();
    }

    const startedAtMs = new Date(String(authoritative?.started_at || proposedStartedAt)).getTime();
    const deadlineAtMs = new Date(String(authoritative?.deadline_at || proposedDeadlineAt)).getTime();
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(deadlineAtMs) || deadlineAtMs <= startedAtMs) {
      return new Response(JSON.stringify({ error: 'Không thể thiết lập mốc thời gian thi an toàn.' }), { status: 503, headers: corsHeaders });
    }

    // TTL kỹ thuật của phiên hoạt động phải độc lập với thời gian học sinh đã chờ
    // ở hộp sẵn sàng. Luôn giữ snapshot/token sống đến ít nhất 1 giờ sau deadline
    // để cho phép retry nộp bản đã khóa, nhưng deadline làm bài vẫn không thay đổi.
    const activeExpiresAtMs = deadlineAtMs + 60 * 60 * 1000;
    const activeExpiresAt = new Date(activeExpiresAtMs).toISOString();
    // Với phiên chuyển tiếp/claim cạnh tranh, bảo đảm expires_at không ngắn hơn
    // deadline + 1 giờ. Phiên mới đã có giá trị này ngay trong atomic claim trên.
    try {
      await db.prepare(
        'UPDATE _exam_grade_sessions SET expires_at = ? WHERE session_id = ? AND expires_at < ?'
      ).bind(activeExpiresAt, gradingSessionId, activeExpiresAt).run();
    } catch (expiryUpdateError) {
      console.error('Cannot verify technical active-session TTL:', expiryUpdateError);
      return new Response(JSON.stringify({
        error: 'Không thể xác minh thời hạn kỹ thuật của phiên thi; bài thi chưa được mở.'
      }), { status: 503, headers: corsHeaders });
    }

    const activePayload = {
      ...decoded,
      purpose: EXAM_SESSION_PURPOSE_ACTIVE,
      startedAtMs,
      deadlineAtMs,
      timestamp: startedAtMs,
      timeLimitSeconds,
      exp: Math.floor(activeExpiresAtMs / 1000)
    };
    const activeToken = await signJWT(activePayload, SECRET);
    const responseNowMs = Date.now();

    return new Response(JSON.stringify({
      token: activeToken,
      startedAtMs,
      deadlineAtMs,
      serverNowMs: responseNowMs,
      timeLimitSeconds,
      remainingSeconds: remainingExamSecondsFromDeadline(deadlineAtMs, responseNowMs)
    }), { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error('POST /api/exam/start error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Không thể bắt đầu phiên thi.' }), { status: 500, headers: corsHeaders });
  }
};
