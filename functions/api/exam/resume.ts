import { verifyAuthSession, verifyJWT, getDynamicSecret, getDatabase, hashToken } from './utils';
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
    if (!token) {
      return new Response(JSON.stringify({ error: 'Thiếu mã phiên thi cần khôi phục.' }), { status: 400, headers: corsHeaders });
    }

    const decoded: any = await verifyJWT(token, SECRET);
    if (!decoded || decoded.purpose !== EXAM_SESSION_PURPOSE_ACTIVE) {
      return new Response(JSON.stringify({ code: 'EXAM_RESUME_INVALID', error: 'Không có phiên thi đang hoạt động hợp lệ để khôi phục.' }), { status: 403, headers: corsHeaders });
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
        return new Response(JSON.stringify({ code: 'EXAM_RESUME_OWNER_MISMATCH', error: 'Tài khoản hiện tại không khớp phiên thi cần khôi phục.' }), { status: 403, headers: corsHeaders });
      }
    }

    const tokenHash = await hashToken(token);
    try {
      const submitted: any = await db.prepare(
        'SELECT status, result_id FROM _submitted_exam_tokens WHERE token_hash = ?'
      ).bind(tokenHash).first();
      if (submitted?.result_id) {
        return new Response(JSON.stringify({
          alreadySubmitted: true,
          resultId: String(submitted.result_id)
        }), { status: 200, headers: corsHeaders });
      }
      if (submitted?.status === 'processing') {
        return new Response(JSON.stringify({
          code: 'EXAM_SUBMISSION_PROCESSING',
          error: 'Bài thi đang được máy chủ xử lý nộp bài. Vui lòng không tạo phiên mới.'
        }), { status: 409, headers: corsHeaders });
      }
    } catch {
      // Bảng claim có thể chưa tồn tại ở hệ thống mới; tiếp tục kiểm tra session.
    }

    const gradingSessionId = String(decoded.gradingSessionId || '').trim();
    if (!gradingSessionId) {
      return new Response(JSON.stringify({ error: 'Phiên thi thiếu mã snapshot.' }), { status: 409, headers: corsHeaders });
    }

    const session: any = await db.prepare(
      'SELECT question_ids, question_snapshot, exam_config, expires_at, started_at, deadline_at FROM _exam_grade_sessions WHERE session_id = ?'
    ).bind(gradingSessionId).first();
    if (!session) {
      return new Response(JSON.stringify({ code: 'EXAM_RESUME_NOT_FOUND', error: 'Phiên thi không còn tồn tại hoặc đã hoàn tất.' }), { status: 409, headers: corsHeaders });
    }

    const nowMs = Date.now();
    const timing = resolveAuthoritativeExamTiming(decoded, session, nowMs);
    if (!timing.valid) {
      return new Response(JSON.stringify({ error: 'Mốc thời gian phiên thi không hợp lệ; không thể khôi phục.' }), { status: 409, headers: corsHeaders });
    }

    let questionIds: string[] = [];
    let frozenQuestions: any[] = [];
    try { questionIds = JSON.parse(String(session.question_ids || '[]')).map((id: any) => String(id)); } catch {}
    try { frozenQuestions = JSON.parse(String(session.question_snapshot || '[]')); } catch {}
    const issuedIds = Array.isArray(decoded.questionIds) ? decoded.questionIds.map((id: any) => String(id)) : [];

    if (!questionIds.length || JSON.stringify(questionIds) !== JSON.stringify(issuedIds) ||
        !Array.isArray(frozenQuestions) || frozenQuestions.length !== questionIds.length) {
      return new Response(JSON.stringify({ error: 'Snapshot câu hỏi không còn khớp phiên thi; không thể khôi phục an toàn.' }), { status: 409, headers: corsHeaders });
    }
    for (let i = 0; i < frozenQuestions.length; i++) {
      const id = String(frozenQuestions[i]?.id ?? frozenQuestions[i]?.questionId ?? '');
      if (!id || id !== questionIds[i]) {
        return new Response(JSON.stringify({ error: 'Thứ tự snapshot câu hỏi không hợp lệ; không thể khôi phục.' }), { status: 409, headers: corsHeaders });
      }
    }

    const immediateFeedback = Boolean(decoded.immediateFeedback);
    const questions = frozenQuestions.map((q: any) => {
      if (immediateFeedback) return { ...q };
      const { answer, ...withoutAnswer } = q || {};
      if (withoutAnswer?.options && typeof withoutAnswer.options === 'object') {
        const { answerImage, ...safeOptions } = withoutAnswer.options;
        withoutAnswer.options = safeOptions;
      }
      return withoutAnswer;
    });

    let answers: any[] = new Array(questionIds.length);
    let revision = 0;
    let savedAt = null;
    try {
      const draft: any = await db.prepare(
        'SELECT answers_json, revision, saved_at FROM _exam_answer_drafts WHERE session_id = ?'
      ).bind(gradingSessionId).first();
      if (draft?.answers_json) {
        const parsed = JSON.parse(String(draft.answers_json || '[]'));
        if (Array.isArray(parsed) && parsed.length === questionIds.length) answers = parsed;
        revision = Math.max(0, Number(draft.revision) || 0);
        savedAt = draft.saved_at || null;
      }
    } catch {}

    let cheatWarningCount = 0;
    try {
      const row: any = await db.prepare(
        'SELECT COUNT(*) AS count FROM _exam_violation_events WHERE session_id = ?'
      ).bind(gradingSessionId).first();
      cheatWarningCount = Math.max(0, Number(row?.count) || 0);
    } catch {}

    const responseNowMs = Date.now();
    return new Response(JSON.stringify({
      resumed: true,
      expired: timing.expired,
      token,
      questions,
      answers,
      autosaveRevision: revision,
      lastSavedAt: savedAt,
      startedAtMs: timing.startedAtMs,
      deadlineAtMs: timing.deadlineAtMs,
      serverNowMs: responseNowMs,
      remainingSeconds: remainingExamSecondsFromDeadline(timing.deadlineAtMs, responseNowMs),
      timeLimitSeconds: timing.limitSeconds,
      maxCheatWarnings: Math.max(1, Number(decoded.maxCheatWarnings) || 5),
      cheatWarningCount,
      immediateFeedback,
      examConfig: {
        ...(decoded.examConfig || {}),
        id: decoded?.examConfig?.id || '',
        name: decoded?.examConfig?.name || '',
        creatorId: decoded.teacherId || '',
        immediateFeedback,
        timeLimit: timing.limitSeconds / 60
      }
    }), { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error('POST /api/exam/resume error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Không thể khôi phục phiên thi.' }), { status: 500, headers: corsHeaders });
  }
};
