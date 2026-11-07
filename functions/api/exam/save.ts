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

function normalizeDraftImage(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(raw) && raw.length <= 900000) {
    return raw;
  }
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:' && !url.username && !url.password && raw.length <= 2048) return url.href;
  } catch {}
  throw new Error('EXAM_DRAFT_IMAGE_INVALID');
}

function sanitizeDraftAnswers(answers: any[]): any[] {
  return answers.map((answer: any) => {
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return answer;
    const copy = { ...answer };
    if (Object.prototype.hasOwnProperty.call(copy, 'image')) {
      copy.image = normalizeDraftImage(copy.image);
    }
    if (Object.prototype.hasOwnProperty.call(copy, 'text')) {
      copy.text = String(copy.text ?? '').slice(0, 200000);
    }
    return copy;
  });
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
    const answers = body?.studentAnswers;
    const parsedRevision = Number(body?.revision ?? 0);
    if (!Number.isFinite(parsedRevision) || parsedRevision < 0 || parsedRevision > 10_000_000) {
      return new Response(JSON.stringify({ error: 'Số phiên bản lưu tạm không hợp lệ.' }), { status: 400, headers: corsHeaders });
    }
    const revision = Math.floor(parsedRevision);
    const writerId = String(body?.writerId || '').trim();
    if (!token || !Array.isArray(answers)) {
      return new Response(JSON.stringify({ error: 'Thiếu dữ liệu lưu tạm bài làm.' }), { status: 400, headers: corsHeaders });
    }

    if (!/^[A-Za-z0-9_-]{8,120}$/.test(writerId)) {
      return new Response(JSON.stringify({ error: 'Thiếu mã tab lưu bài hợp lệ.' }), { status: 400, headers: corsHeaders });
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

    let safeAnswers: any[] = [];
    try {
      safeAnswers = sanitizeDraftAnswers(answers);
    } catch (draftImageError: any) {
      if (String(draftImageError?.message || '') === 'EXAM_DRAFT_IMAGE_INVALID') {
        return new Response(JSON.stringify({
          code: 'EXAM_DRAFT_IMAGE_INVALID',
          error: 'Ảnh bài làm lưu tạm không đúng định dạng an toàn; hệ thống chưa ghi đè bản lưu trước đó.'
        }), { status: 400, headers: corsHeaders });
      }
      throw draftImageError;
    }

    const answersJson = JSON.stringify(safeAnswers);
    if (answersJson.length > 3_000_000) {
      return new Response(JSON.stringify({ error: 'Dữ liệu bài làm lưu tạm vượt giới hạn an toàn.' }), { status: 413, headers: corsHeaders });
    }

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS _exam_answer_drafts (
        session_id TEXT PRIMARY KEY,
        answers_json TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0,
        saved_at TEXT NOT NULL,
        writer_id TEXT,
        writer_seen_at TEXT
      )
    `).run();
    for (const sql of [
      'ALTER TABLE _exam_answer_drafts ADD COLUMN IF NOT EXISTS writer_id TEXT',
      'ALTER TABLE _exam_answer_drafts ADD COLUMN IF NOT EXISTS writer_seen_at TEXT'
    ]) await db.prepare(sql).run();

    const savedAt = new Date(nowMs).toISOString();
    const leaseCutoff = new Date(nowMs - 15_000).toISOString();
    await db.prepare(`
      INSERT INTO _exam_answer_drafts (session_id, answers_json, revision, saved_at, writer_id, writer_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (session_id) DO UPDATE SET
        answers_json = excluded.answers_json,
        revision = excluded.revision,
        saved_at = excluded.saved_at,
        writer_id = excluded.writer_id,
        writer_seen_at = excluded.writer_seen_at
      WHERE excluded.revision > _exam_answer_drafts.revision
        AND (
          _exam_answer_drafts.writer_id IS NULL OR
          _exam_answer_drafts.writer_id = excluded.writer_id OR
          _exam_answer_drafts.writer_seen_at IS NULL OR
          _exam_answer_drafts.writer_seen_at < ?
        )
    `).bind(gradingSessionId, answersJson, revision, savedAt, writerId, savedAt, leaseCutoff).run();

    const persistedDraft: any = await db.prepare(
      'SELECT answers_json, revision, saved_at, writer_id, writer_seen_at FROM _exam_answer_drafts WHERE session_id = ?'
    ).bind(gradingSessionId).first();
    const persistedRevision = Math.max(0, Number(persistedDraft?.revision) || 0);
    const persistedSavedAt = persistedDraft?.saved_at || null;
    const persistedAnswersJson = String(persistedDraft?.answers_json || '');
    // Cùng revision nhưng payload khác có thể xảy ra khi hai tab cùng gửi revision N.
    // Chỉ xác nhận "accepted" khi CHÍNH request này là bản đã persist (revision +
    // payload + saved_at đều trùng), tuyệt đối không báo lưu thành công nhầm tab.
    const persistedWriterId = String(persistedDraft?.writer_id || '');
    const persistedWriterSeenAt = Date.parse(String(persistedDraft?.writer_seen_at || ''));
    const accepted = persistedRevision === revision &&
      persistedAnswersJson === answersJson &&
      persistedSavedAt === savedAt &&
      persistedWriterId === writerId;

    if (!accepted && persistedWriterId && persistedWriterId !== writerId &&
        Number.isFinite(persistedWriterSeenAt) && persistedWriterSeenAt >= Date.parse(leaseCutoff)) {
      return new Response(JSON.stringify({
        code: 'EXAM_WRITER_CONFLICT',
        error: 'Bài thi đang được lưu từ một tab khác. Tab này không được phép ghi đè đáp án.',
        revision: persistedRevision,
        savedAt: persistedSavedAt,
        retryAfterSeconds: Math.max(1, Math.ceil((persistedWriterSeenAt + 15_000 - nowMs) / 1000))
      }), { status: 409, headers: corsHeaders });
    }

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
