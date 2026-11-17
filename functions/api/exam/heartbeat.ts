import { verifyJWT, verifyAuthSession, getDynamicSecret, getDatabase, hashToken } from './utils';
import { EXAM_DISCONNECT_GRACE_MS, EXAM_HEARTBEAT_INTERVAL_MS } from '../../../src/exam-connection-lifecycle.js';

interface Env {
  NEON_DATABASE_URL?: string;
  DATABASE_URL?: string;
  DB?: any;
  JWT_SECRET?: string;
}
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};
const reply = (status: number, data: any) =>
  new Response(JSON.stringify(data), { status, headers });

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers });

/**
 * Each heartbeat renews the server-side lease for exactly one ACTIVE school
 * exam, and only while the previous lease is still fresh. A stale lease can
 * never be revived by a delayed request from a disconnected tab.
 */
export const onRequestPost: PagesFunction<Env> = async context => {
  try {
    const db = getDatabase(context);
    const secret = await getDynamicSecret(db, context.env.JWT_SECRET);
    const bearer = context.request.headers.get('authorization') || '';
    if (!bearer.startsWith('Bearer ')) {
      return reply(401, { code: 'EXAM_HEARTBEAT_LOGIN_REQUIRED', error: 'Vui lòng đăng nhập lại.' });
    }
    const user: any = await verifyAuthSession(bearer.slice(7), secret, db);
    const userId = String(user?.user_id || user?.id || '').trim();
    if (!userId) return reply(403, { code: 'EXAM_HEARTBEAT_FORBIDDEN', error: 'Không thể xác minh học sinh.' });

    const input: any = await context.request.json().catch(() => ({}));
    const token = String(input?.token || '');
    if (!token || token.length > 15000) return reply(400, { error: 'Thiếu mã phiên thi hợp lệ.' });
    const claims: any = await verifyJWT(token, secret);
    const sessionId = String(claims?.gradingSessionId || '').trim();
    const examId = String(claims?.examConfig?.id || '').trim();
    if (claims?.purpose !== 'exam_active' || claims?.contestParticipantId ||
        !sessionId || !examId || String(claims.studentUserId || '') !== userId) {
      return reply(403, { code: 'EXAM_HEARTBEAT_FORBIDDEN', error: 'Phiên thi không thuộc tài khoản đăng nhập.' });
    }

    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const cutoff = new Date(nowMs - EXAM_DISCONNECT_GRACE_MS).toISOString();
    const tokenHash = await hashToken('exam-session:' + sessionId);
    // Heartbeat serves the current reserved result, not an unfinished
    // session lock. Missing old attempts can never block a fresh start.
    const refreshed: any = await db.prepare(`
      UPDATE results AS current_attempt SET last_seen_at = ?::timestamptz
      WHERE current_attempt.submission_token_hash = ?
        AND current_attempt.exam_id = ? AND current_attempt.user_id = ?
        AND current_attempt.grading_status = 'IN_PROGRESS'
        AND current_attempt.last_seen_at > ?::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM results newer
          WHERE newer.exam_id = current_attempt.exam_id
            AND newer.user_id = current_attempt.user_id
            AND newer.attempt_no > current_attempt.attempt_no
        )
      RETURNING current_attempt.id
    `).bind(now, tokenHash, examId, userId, cutoff).first();

    if (!refreshed?.session_id) {
      return reply(409, {
        code: 'EXAM_SESSION_CLOSED',
        error: 'Phiên thi đã gián đoạn quá 90 giây hoặc đã kết thúc. Hãy chọn đề để tạo lượt mới nếu còn lượt.'
      });
    }
    return reply(200, { alive: true, serverNowMs: nowMs,
      heartbeatEveryMs: EXAM_HEARTBEAT_INTERVAL_MS, disconnectAfterMs: EXAM_DISCONNECT_GRACE_MS });
  } catch (err) {
    console.error('Exam heartbeat unavailable:', err);
    return reply(503, { code: 'EXAM_HEARTBEAT_UNAVAILABLE', error: 'Mất kết nối máy chủ. Hệ thống sẽ kiểm tra lại khi có mạng.' });
  }
};
