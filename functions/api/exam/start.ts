import { verifyAuthSession, verifyJWT, getDynamicSecret, getDatabase } from './utils';

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
  const secret = await getDynamicSecret(db, context.env.JWT_SECRET);

  try {
    const body: any = await context.request.json();
    const token = String(body?.token || '').trim();
    if (!token) {
      return new Response(JSON.stringify({ error: 'Thiếu mã phiên thi.' }), {
        status: 400, headers: corsHeaders
      });
    }

    const decoded: any = await verifyJWT(token, secret);
    if (!decoded?.gradingSessionId || !Array.isArray(decoded?.questionIds)) {
      return new Response(JSON.stringify({ error: 'Phiên thi không hợp lệ hoặc thiếu snapshot chấm điểm.' }), {
        status: 403, headers: corsHeaders
      });
    }

    const signedStudentUserId = decoded.studentUserId ? String(decoded.studentUserId) : '';
    if (signedStudentUserId) {
      const authHeader = context.request.headers.get('authorization') || '';
      if (!authHeader.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Phiên đăng nhập không hợp lệ.' }), {
          status: 401, headers: corsHeaders
        });
      }
      const user: any = await verifyAuthSession(authHeader.slice(7), secret, db);
      const requestUserId = String(user?.user_id || user?.id || '');
      if (!requestUserId || requestUserId !== signedStudentUserId) {
        return new Response(JSON.stringify({ error: 'Tài khoản bắt đầu bài thi không khớp phiên đã phát.' }), {
          status: 403, headers: corsHeaders
        });
      }
    }

    const sessionId = String(decoded.gradingSessionId);
    const session: any = await db.prepare(
      'SELECT session_id, question_ids, started_at, expires_at FROM _exam_grade_sessions WHERE session_id = ?'
    ).bind(sessionId).first();

    if (!session) {
      return new Response(JSON.stringify({ error: 'Phiên chấm điểm không tồn tại hoặc đã bị thu hồi.' }), {
        status: 409, headers: corsHeaders
      });
    }
    if (session.expires_at && new Date(String(session.expires_at)).getTime() < Date.now()) {
      return new Response(JSON.stringify({ error: 'Phiên thi đã hết hạn trước khi bắt đầu.' }), {
        status: 409, headers: corsHeaders
      });
    }

    const frozenIds = JSON.parse(String(session.question_ids || '[]')).map((id: any) => String(id));
    const issuedIds = decoded.questionIds.map((id: any) => String(id));
    if (JSON.stringify(frozenIds) !== JSON.stringify(issuedIds)) {
      return new Response(JSON.stringify({ error: 'Snapshot câu hỏi không khớp phiên thi.' }), {
        status: 409, headers: corsHeaders
      });
    }

    let startedAt = session.started_at ? String(session.started_at) : '';
    if (!startedAt) {
      const candidate = new Date().toISOString();
      await db.prepare(
        'UPDATE _exam_grade_sessions SET started_at = ? WHERE session_id = ? AND (started_at IS NULL OR started_at = \'\')'
      ).bind(candidate, sessionId).run();

      const refreshed: any = await db.prepare(
        'SELECT started_at FROM _exam_grade_sessions WHERE session_id = ?'
      ).bind(sessionId).first();
      startedAt = String(refreshed?.started_at || candidate);
    }

    return new Response(JSON.stringify({
      ok: true,
      startedAt,
      timeLimitSeconds: Math.max(1, Math.floor(Number(decoded.timeLimitSeconds) || 1))
    }), { status: 200, headers: corsHeaders });
  } catch (err: any) {
    console.error('POST /api/exam/start failed:', err);
    return new Response(JSON.stringify({
      error: err?.message || 'Không thể xác lập thời điểm bắt đầu bài thi.'
    }), { status: 500, headers: corsHeaders });
  }
};
