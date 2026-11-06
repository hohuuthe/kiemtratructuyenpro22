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
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const requestReceivedAtMs = Date.now();
  const db = getDatabase(context);
  const secret = await getDynamicSecret(db, context.env.JWT_SECRET);

  try {
    const body: any = await context.request.json();
    const token = String(body?.token || '').trim();
    const answers = body?.studentAnswers;
    const questionIds = Array.isArray(body?.questionIds)
      ? body.questionIds.map((id: any) => String(id ?? '').trim())
      : [];
    const sequence = Math.max(0, Math.floor(Number(body?.sequence) || 0));

    if (!token || !Array.isArray(answers) || !questionIds.length || sequence <= 0) {
      return new Response(JSON.stringify({ error: 'Checkpoint bài làm không hợp lệ.' }), {
        status: 400, headers: corsHeaders
      });
    }

    const decoded: any = await verifyJWT(token, secret);
    if (!decoded?.gradingSessionId || !Array.isArray(decoded?.questionIds)) {
      return new Response(JSON.stringify({ error: 'Phiên thi không hợp lệ hoặc đã hết hạn.' }), {
        status: 403, headers: corsHeaders
      });
    }

    const issuedIds = decoded.questionIds.map((id: any) => String(id ?? '').trim());
    if (answers.length !== issuedIds.length ||
        questionIds.length !== issuedIds.length ||
        issuedIds.some((id: string, index: number) => !id || questionIds[index] !== id)) {
      return new Response(JSON.stringify({
        error: 'Checkpoint không khớp chính xác câu hỏi của phiên thi.'
      }), { status: 409, headers: corsHeaders });
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
        return new Response(JSON.stringify({
          error: 'Tài khoản lưu bài không khớp tài khoản đã nhận phiên thi.'
        }), { status: 403, headers: corsHeaders });
      }
    }

    const sessionId = String(decoded.gradingSessionId);
    const session: any = await db.prepare(
      'SELECT question_ids, started_at, expires_at FROM _exam_grade_sessions WHERE session_id = ?'
    ).bind(sessionId).first();

    if (!session?.started_at) {
      return new Response(JSON.stringify({ error: 'Phiên thi chưa được máy chủ xác nhận bắt đầu.' }), {
        status: 409, headers: corsHeaders
      });
    }

    const frozenIds = JSON.parse(String(session.question_ids || '[]')).map((id: any) => String(id));
    if (JSON.stringify(frozenIds) !== JSON.stringify(issuedIds)) {
      return new Response(JSON.stringify({ error: 'Snapshot câu hỏi của phiên thi không khớp.' }), {
        status: 409, headers: corsHeaders
      });
    }

    const startedAtMs = Date.parse(String(session.started_at));
    const limitSeconds = Math.max(1, Math.floor(Number(decoded.timeLimitSeconds) || 1));
    if (!Number.isFinite(startedAtMs) ||
        requestReceivedAtMs > startedAtMs + limitSeconds * 1000) {
      return new Response(JSON.stringify({
        code: 'CHECKPOINT_AFTER_DEADLINE',
        error: 'Checkpoint đến máy chủ sau thời hạn nên không được ghi nhận.'
      }), { status: 409, headers: corsHeaders });
    }

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS _exam_answer_checkpoints (
        session_id TEXT PRIMARY KEY,
        user_id TEXT,
        question_ids TEXT NOT NULL,
        answers TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        saved_at TEXT NOT NULL
      )
    `).run();

    const savedAt = new Date(requestReceivedAtMs).toISOString();
    const write = await db.prepare(`
      INSERT INTO _exam_answer_checkpoints
        (session_id, user_id, question_ids, answers, sequence, saved_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (session_id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        question_ids = EXCLUDED.question_ids,
        answers = EXCLUDED.answers,
        sequence = EXCLUDED.sequence,
        saved_at = EXCLUDED.saved_at
      WHERE _exam_answer_checkpoints.sequence < EXCLUDED.sequence
    `).bind(
      sessionId,
      signedStudentUserId || null,
      JSON.stringify(issuedIds),
      JSON.stringify(answers),
      sequence,
      savedAt
    ).run();

    return new Response(JSON.stringify({
      ok: true,
      accepted: Number(write?.meta?.changes || 0) === 1,
      sequence,
      savedAt
    }), { status: 200, headers: corsHeaders });
  } catch (err: any) {
    console.error('POST /api/exam/checkpoint failed:', err);
    return new Response(JSON.stringify({
      error: err?.message || 'Không thể lưu checkpoint bài làm.'
    }), { status: 500, headers: corsHeaders });
  }
};
