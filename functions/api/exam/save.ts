import { verifyAuthSession, verifyJWT, getDynamicSecret, getDatabase } from './utils';
import {
  EXAM_SESSION_PURPOSE_ACTIVE,
  resolveAuthoritativeExamTiming,
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
    const answers = body?.studentAnswers;
    const revision = Math.max(0, Math.floor(Number(body?.revision) || 0));
    if (!token || !Array.isArray(answers)) {
      return new Response(JSON.stringify({ error: 'Thiếu dữ liệu lưu tạm bài làm.' }), { status: 400, headers: corsHeaders });
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
        return new Response(JSON.stringify({ error: 'Tài khoản lưu bài không khớp phiên thi.' }), { status: 403, headers: corsHeaders });
      }
    }

    const gradingSessionId = String(decoded.gradingSessionId || '').trim();
    const session: any = await db.prepare(
      'SELECT question_ids, expires_at, started_at, deadline_at FROM _exam_grade_sessions WHERE session_id = ?'
    ).bind(gradingSessionId).first();
    if (!session) {
      return new Response(JSON.stringify({ error: 'Phiên thi không tồn tại.' }), { status: 409, headers: corsHeaders });
    }

    const nowMs = Date.now();
    const timing = resolveAuthoritativeExamTiming(decoded, session, nowMs);
    if (!timing.valid) {
      return new Response(JSON.stringify({ error: 'Mốc thời gian phiên thi không hợp lệ.' }), { status: 409, headers: corsHeaders });
    }
    if (timing.expired) {
      return new Response(JSON.stringify({
        code: 'EXAM_DEADLINE_REACHED',
        error: 'Bài thi đã hết giờ; hệ thống không nhận thay đổi đáp án mới.'
      }), { status: 409, headers: corsHeaders });
    }

    let questionIds: string[] = [];
    try { questionIds = JSON.parse(String(session.question_ids || '[]')).map((id: any) => String(id)); } catch {}
    if (!questionIds.length || answers.length !== questionIds.length) {
      return new Response(JSON.stringify({ error: 'Số lượng câu trả lời lưu tạm không khớp phiên thi.' }), { status: 400, headers: corsHeaders });
    }

    const answersJson = JSON.stringify(answers);
    if (answersJson.length > 3_000_000) {
      return new Response(JSON.stringify({ error: 'Dữ liệu bài làm lưu tạm vượt giới hạn an toàn.' }), { status: 413, headers: corsHeaders });
    }

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS _exam_answer_drafts (
        session_id TEXT PRIMARY KEY,
        answers_json TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        saved_at TEXT NOT NULL
      )
    `).run();

    const savedAt = new Date(nowMs).toISOString();
    await db.prepare(`
      INSERT INTO _exam_answer_drafts (session_id, answers_json, revision, saved_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (session_id) DO UPDATE SET
        answers_json = excluded.answers_json,
        revision = excluded.revision,
        saved_at = excluded.saved_at
      WHERE excluded.revision > _exam_answer_drafts.revision
    `).bind(gradingSessionId, answersJson, revision, savedAt).run();

    const persistedDraft: any = await db.prepare(
      'SELECT revision, saved_at FROM _exam_answer_drafts WHERE session_id = ?'
    ).bind(gradingSessionId).first();
    const persistedRevision = Math.max(0, Number(persistedDraft?.revision) || 0);
    const persistedSavedAt = persistedDraft?.saved_at || null;
    const accepted = persistedRevision === revision;

    return new Response(JSON.stringify({
      saved: accepted,
      accepted,
      requestedRevision: revision,
      revision: persistedRevision,
      savedAt: persistedSavedAt,
      remainingSeconds: remainingExamSecondsFromDeadline(timing.deadlineAtMs, nowMs)
    }), { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error('POST /api/exam/save error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Không thể lưu tạm bài làm.' }), { status: 500, headers: corsHeaders });
  }
};
