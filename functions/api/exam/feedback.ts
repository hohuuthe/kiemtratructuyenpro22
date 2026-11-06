import { verifyAuthSession, verifyJWT, getDynamicSecret, getDatabase } from './utils';
import {
  evaluateTF4,
  parseTF4CorrectAnswer,
  getTF4UserState,
  isShortAnswerCorrect,
  examFlagEnabled
} from '../../../src/exam-grading-core.js';

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
    const index = Math.floor(Number(body?.index));
    const questionId = String(body?.questionId || '').trim();
    const userAnswer = body?.userAnswer;
    const selectedOption = String(body?.selectedOption || '').trim().toUpperCase();

    if (!token || !Number.isInteger(index) || index < 0 || !questionId) {
      return new Response(JSON.stringify({ error: 'Yêu cầu kiểm tra đáp án không hợp lệ.' }), {
        status: 400, headers: corsHeaders
      });
    }

    const decoded: any = await verifyJWT(token, secret);
    if (!decoded?.gradingSessionId || !Array.isArray(decoded?.questionIds)) {
      return new Response(JSON.stringify({ error: 'Phiên thi không hợp lệ hoặc đã hết hạn.' }), {
        status: 403, headers: corsHeaders
      });
    }
    if (!examFlagEnabled(
      decoded?.examConfig?.immediateFeedback ?? decoded?.examConfig?.immediate_feedback,
      false
    )) {
      return new Response(JSON.stringify({ error: 'Đề thi không bật phản hồi tức thời.' }), {
        status: 403, headers: corsHeaders
      });
    }

    const issuedIds = decoded.questionIds.map((id: any) => String(id ?? '').trim());
    if (index >= issuedIds.length || issuedIds[index] !== questionId) {
      return new Response(JSON.stringify({ error: 'Câu hỏi không khớp vị trí trong phiên thi.' }), {
        status: 409, headers: corsHeaders
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
        return new Response(JSON.stringify({ error: 'Tài khoản không khớp phiên thi.' }), {
          status: 403, headers: corsHeaders
        });
      }
    }

    const session: any = await db.prepare(
      'SELECT question_ids, question_snapshot, exam_config, started_at FROM _exam_grade_sessions WHERE session_id = ?'
    ).bind(String(decoded.gradingSessionId)).first();
    if (!session?.started_at) {
      return new Response(JSON.stringify({ error: 'Phiên thi chưa bắt đầu hoặc đã được thu hồi.' }), {
        status: 409, headers: corsHeaders
      });
    }

    const startedAtMs = Date.parse(String(session.started_at));
    const limitSeconds = Math.max(1, Math.floor(Number(decoded.timeLimitSeconds) || 1));
    if (!Number.isFinite(startedAtMs) ||
        requestReceivedAtMs > startedAtMs + limitSeconds * 1000) {
      return new Response(JSON.stringify({ error: 'Đã hết thời gian làm bài.' }), {
        status: 409, headers: corsHeaders
      });
    }

    const frozenIds = JSON.parse(String(session.question_ids || '[]')).map((id: any) => String(id));
    if (JSON.stringify(frozenIds) !== JSON.stringify(issuedIds)) {
      return new Response(JSON.stringify({ error: 'Snapshot câu hỏi không khớp phiên thi.' }), {
        status: 409, headers: corsHeaders
      });
    }

    const snapshot = JSON.parse(String(session.question_snapshot || '[]'));
    if (!Array.isArray(snapshot) || snapshot.length !== issuedIds.length) {
      return new Response(JSON.stringify({ error: 'Snapshot chấm điểm không hợp lệ.' }), {
        status: 409, headers: corsHeaders
      });
    }
    const question: any = snapshot[index];
    if (!question || String(question.id) !== questionId) {
      return new Response(JSON.stringify({ error: 'Không tìm thấy câu hỏi trong snapshot.' }), {
        status: 409, headers: corsHeaders
      });
    }

    const type = String(question.type || '').trim().toUpperCase();
    if (type === '4-1') {
      const isCorrect = String(userAnswer ?? '').trim().toUpperCase() ===
        String(question.answer ?? '').trim().toUpperCase() &&
        String(userAnswer ?? '').trim() !== '';
      return new Response(JSON.stringify({
        ok: true,
        checked: true,
        allCorrect: isCorrect
      }), { status: 200, headers: corsHeaders });
    }

    if (type === 'TF4') {
      const tf = evaluateTF4(question.answer, userAnswer);
      if (!tf.validKey) {
        return new Response(JSON.stringify({ error: 'Khóa đáp án Đúng/Sai không hợp lệ.' }), {
          status: 409, headers: corsHeaders
        });
      }
      const expected = parseTF4CorrectAnswer(question.answer);
      const statementResults: Record<string, boolean> = {};
      for (const option of ['A', 'B', 'C', 'D']) {
        const state = getTF4UserState(userAnswer, option);
        if (state !== null && expected) statementResults[option] = state === expected[option];
      }
      return new Response(JSON.stringify({
        ok: true,
        checked: true,
        allCorrect: tf.allCorrect,
        answeredCount: tf.answeredCount,
        correctCount: tf.correctCount,
        selectedCorrect: selectedOption && Object.prototype.hasOwnProperty.call(statementResults, selectedOption)
          ? statementResults[selectedOption]
          : null,
        statementResults
      }), { status: 200, headers: corsHeaders });
    }

    if (type === 'SQ') {
      let config: any = {};
      try { config = JSON.parse(String(session.exam_config || '{}')); } catch {}
      const isCorrect = isShortAnswerCorrect(userAnswer, question.answer, {
        caseSensitive: examFlagEnabled(config.sqCaseSensitive ?? config.sq_case_sensitive, false),
        punctuationSensitive: examFlagEnabled(config.sqPunctuationSensitive ?? config.sq_punctuation_sensitive, false)
      });
      return new Response(JSON.stringify({
        ok: true,
        checked: true,
        allCorrect: isCorrect
      }), { status: 200, headers: corsHeaders });
    }

    return new Response(JSON.stringify({
      error: 'Loại câu hỏi này không hỗ trợ phản hồi đúng/sai tức thời.'
    }), { status: 400, headers: corsHeaders });
  } catch (err: any) {
    console.error('POST /api/exam/feedback failed:', err);
    return new Response(JSON.stringify({
      error: err?.message || 'Không thể kiểm tra đáp án tức thời.'
    }), { status: 500, headers: corsHeaders });
  }
};
