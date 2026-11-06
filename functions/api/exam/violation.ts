import { verifyAuthSession, verifyJWT, getDynamicSecret, getDatabase } from './utils';
import { EXAM_SESSION_PURPOSE_ACTIVE, resolveAuthoritativeExamTiming } from '../../../src/exam-time-authority.js';

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
    const eventId = String(body?.eventId || '').trim();
    const reason = String(body?.reason || '').trim().slice(0, 120);
    if (!token || !eventId || eventId.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(eventId)) {
      return new Response(JSON.stringify({ error: 'Sự kiện vi phạm không hợp lệ.' }), { status: 400, headers: corsHeaders });
    }

    const decoded: any = await verifyJWT(token, SECRET);
    if (!decoded || decoded.purpose !== EXAM_SESSION_PURPOSE_ACTIVE) {
      return new Response(JSON.stringify({ error: 'Phiên thi chưa được kích hoạt hoặc không hợp lệ.' }), { status: 403, headers: corsHeaders });
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
        return new Response(JSON.stringify({ error: 'Tài khoản ghi nhận vi phạm không khớp phiên thi.' }), { status: 403, headers: corsHeaders });
      }
    }

    const gradingSessionId = String(decoded.gradingSessionId || '').trim();
    if (!gradingSessionId) {
      return new Response(JSON.stringify({ error: 'Phiên thi thiếu mã chấm điểm.' }), { status: 409, headers: corsHeaders });
    }

    const session: any = await db.prepare(
      'SELECT started_at, deadline_at, expires_at FROM _exam_grade_sessions WHERE session_id = ?'
    ).bind(gradingSessionId).first();
    if (!session) {
      return new Response(JSON.stringify({ error: 'Phiên thi không tồn tại.' }), { status: 409, headers: corsHeaders });
    }
    const nowMs = Date.now();
    const timing = resolveAuthoritativeExamTiming(decoded, session, nowMs);
    if (!timing.valid || timing.expired) {
      return new Response(JSON.stringify({
        code: timing.expired ? 'EXAM_DEADLINE_REACHED' : 'EXAM_TIMING_INVALID',
        error: timing.expired ? 'Bài thi đã hết giờ.' : 'Mốc thời gian phiên thi không hợp lệ.'
      }), { status: 409, headers: corsHeaders });
    }

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS _exam_violation_events (
        event_key TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL
      )
    `).run();
    try {
      await db.prepare('CREATE INDEX IF NOT EXISTS idx_exam_violation_session ON _exam_violation_events(session_id)').run();
    } catch {}

    const eventKey = gradingSessionId + ':' + eventId;
    await db.prepare(`
      INSERT INTO _exam_violation_events (event_key, session_id, event_id, reason, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (event_key) DO NOTHING
    `).bind(eventKey, gradingSessionId, eventId, reason, new Date(nowMs).toISOString()).run();

    const countRow: any = await db.prepare(
      'SELECT COUNT(*) AS count FROM _exam_violation_events WHERE session_id = ?'
    ).bind(gradingSessionId).first();

    return new Response(JSON.stringify({
      recorded: true,
      cheatWarningCount: Math.max(0, Number(countRow?.count) || 0)
    }), { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error('POST /api/exam/violation error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Không thể ghi nhận sự kiện vi phạm.' }), { status: 500, headers: corsHeaders });
  }
};
