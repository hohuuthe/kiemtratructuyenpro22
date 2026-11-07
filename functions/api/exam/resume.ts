import { verifyAuthSession, verifyJWT, signJWT, getDynamicSecret, getDatabase, hashToken } from './utils';
import {
  EXAM_SESSION_PURPOSE_ACTIVE,
  EXAM_SESSION_PURPOSE_PRESTART,
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

function resumeFlag(value: any, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const normalized = String(value).trim().toLowerCase();
  if (['1','true','yes','on'].includes(normalized)) return true;
  if (['0','false','no','off'].includes(normalized)) return false;
  return fallback;
}

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
    if (!decoded || ![EXAM_SESSION_PURPOSE_ACTIVE, EXAM_SESSION_PURPOSE_PRESTART].includes(decoded.purpose)) {
      return new Response(JSON.stringify({ code: 'EXAM_RESUME_INVALID', error: 'Không có phiên thi hợp lệ để khôi phục.' }), { status: 403, headers: corsHeaders });
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

    // Token PRESTART chỉ được nâng cấp để resume khi DB chứng minh /exam/start đã
    // thật sự claim started_at/deadline_at. Refresh ở màn hình READY không tự bắt đầu thi.
    if (decoded.purpose === EXAM_SESSION_PURPOSE_PRESTART &&
        (!session.started_at || !session.deadline_at)) {
      return new Response(JSON.stringify({
        code: 'EXAM_RESUME_NOT_STARTED',
        error: 'Phiên chuẩn bị chưa bắt đầu; không tự khởi động bài thi sau khi tải lại trang.'
      }), { status: 409, headers: corsHeaders });
    }

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

    let frozenExamConfig: any = {};
    try { frozenExamConfig = JSON.parse(String(session.exam_config || '{}')) || {}; } catch {}

    // Phiên mới có immediateFeedback ký trực tiếp trong token. Với phiên đang làm
    // từ bản cũ trước khi nâng cấp, fallback duy nhất sang cấu hình DB hiện tại để
    // không làm mất chức năng Immediate Feedback sau refresh.
    let liveExamConfig: any = null;
    const needsLegacyFeedback = decoded.immediateFeedback === undefined;
    const hasFrozenShowScore = frozenExamConfig.showScore !== undefined || frozenExamConfig.show_score !== undefined;
    if (needsLegacyFeedback || !hasFrozenShowScore) {
      const legacyExamId = String(session?.exam_id || decoded?.examConfig?.id || '').trim();
      if (legacyExamId) {
        try {
          liveExamConfig = await db.prepare(
            'SELECT immediate_feedback, show_score, show_details FROM exam_configs WHERE id = ? LIMIT 1'
          ).bind(legacyExamId).first();
        } catch {}
      }
    }

    const immediateFeedback = decoded.immediateFeedback !== undefined
      ? resumeFlag(decoded.immediateFeedback, false)
      : resumeFlag(liveExamConfig?.immediate_feedback, false);
    const showScore = hasFrozenShowScore
      ? resumeFlag(frozenExamConfig.showScore ?? frozenExamConfig.show_score, false)
      : resumeFlag(liveExamConfig?.show_score, false);
    const showDetails = (frozenExamConfig.showDetails !== undefined || frozenExamConfig.show_details !== undefined)
      ? resumeFlag(frozenExamConfig.showDetails ?? frozenExamConfig.show_details, false)
      : resumeFlag(liveExamConfig?.show_details, false);

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
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS _exam_answer_drafts (
          session_id TEXT PRIMARY KEY,
          answers_json TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 0,
          saved_at TEXT NOT NULL
        )
      `).run();

      let draft: any = await db.prepare(
        'SELECT answers_json, revision, saved_at FROM _exam_answer_drafts WHERE session_id = ?'
      ).bind(gradingSessionId).first();

      // Tự-heal race cực hiếm: start đã claim thời gian nhưng Worker chết trước
      // khi baseline draft được tạo. Chỉ tạo mảng trống, tuyệt đối không thêm đáp án.
      if (!draft) {
        const baselineSavedAt = session.started_at || new Date(timing.startedAtMs).toISOString();
        await db.prepare(`
          INSERT INTO _exam_answer_drafts (session_id, answers_json, revision, saved_at)
          VALUES (?, ?, 0, ?)
          ON CONFLICT (session_id) DO NOTHING
        `).bind(
          gradingSessionId,
          JSON.stringify(new Array(questionIds.length).fill(null)),
          baselineSavedAt
        ).run();
        draft = await db.prepare(
          'SELECT answers_json, revision, saved_at FROM _exam_answer_drafts WHERE session_id = ?'
        ).bind(gradingSessionId).first();
      }

      if (draft?.answers_json) {
        const parsed = JSON.parse(String(draft.answers_json || '[]'));
        if (Array.isArray(parsed) && parsed.length === questionIds.length) answers = parsed;
        revision = Math.max(0, Number(draft.revision) || 0);
        savedAt = draft.saved_at || null;
      }
    } catch (draftError) {
      console.error('Cannot restore/create resume draft:', draftError);
      return new Response(JSON.stringify({
        error: 'Không thể khôi phục bản lưu bài thi an toàn.'
      }), { status: 503, headers: corsHeaders });
    }

    let cheatWarningCount = 0;
    try {
      const row: any = await db.prepare(
        'SELECT COUNT(*) AS count FROM _exam_violation_events WHERE session_id = ?'
      ).bind(gradingSessionId).first();
      cheatWarningCount = Math.max(0, Number(row?.count) || 0);
    } catch (violationCountError) {
      console.error('Cannot restore authoritative violation count:', violationCountError);
      return new Response(JSON.stringify({
        code: 'EXAM_VIOLATION_COUNT_UNAVAILABLE',
        error: 'Không thể xác minh số lần vi phạm của phiên thi; hệ thống chưa khôi phục bài để tránh đặt lại sai bộ đếm.'
      }), { status: 503, headers: corsHeaders });
    }

    let resumeToken = token;
    if (decoded.purpose === EXAM_SESSION_PURPOSE_PRESTART) {
      const sessionExpMs = new Date(String(session.expires_at || '')).getTime();
      const expSeconds = Number.isFinite(sessionExpMs)
        ? Math.floor(sessionExpMs / 1000)
        : Math.floor((timing.deadlineAtMs + 60 * 60 * 1000) / 1000);
      resumeToken = await signJWT({
        ...decoded,
        purpose: EXAM_SESSION_PURPOSE_ACTIVE,
        startedAtMs: timing.startedAtMs,
        deadlineAtMs: timing.deadlineAtMs,
        timestamp: timing.startedAtMs,
        timeLimitSeconds: timing.limitSeconds,
        exp: expSeconds
      }, SECRET);
    }

    const responseNowMs = Date.now();
    return new Response(JSON.stringify({
      resumed: true,
      expired: timing.expired,
      token: resumeToken,
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
        ...frozenExamConfig,
        id: decoded?.examConfig?.id || frozenExamConfig?.id || '',
        name: decoded?.examConfig?.name || frozenExamConfig?.name || '',
        creatorId: decoded.teacherId || frozenExamConfig?.creator_id || '',
        immediateFeedback,
        showScore,
        showDetails,
        timeLimit: timing.limitSeconds / 60
      }
    }), { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error('POST /api/exam/resume error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Không thể khôi phục phiên thi.' }), { status: 500, headers: corsHeaders });
  }
};
