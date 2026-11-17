import { verifyJWT, verifyAuthSession, getDynamicSecret, getDatabase } from './utils';
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

    await db.prepare('ALTER TABLE _exam_active_attempts ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW()').run();
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const cutoff = new Date(nowMs - EXAM_DISCONNECT_GRACE_MS).toISOString();
    const refreshed: any = await db.prepare(`
      UPDATE _exam_active_attempts AS active_lock
         SET last_seen_at = ?::timestamptz
       WHERE active_lock.attempt_key = ? AND active_lock.exam_id = ? AND active_lock.user_id = ? AND active_lock.session_id = ?
         AND COALESCE(active_lock.last_seen_at, active_lock.created_at::timestamptz) > ?::timestamptz
         AND active_lock.expires_at::timestamptz > ?::timestamptz
         AND NOT EXISTS (
           SELECT 1 FROM _exam_abandoned_attempts abandoned WHERE abandoned.session_id = active_lock.session_id
         )
         AND EXISTS (
           SELECT 1 FROM _exam_grade_sessions s
            WHERE s.session_id = active_lock.session_id AND s.exam_id = active_lock.exam_id
              AND s.started_at IS NOT NULL AND s.deadline_at IS NOT NULL
         )
       RETURNING session_id
    `).bind(now, examId + ':' + userId, examId, userId, sessionId, cutoff, now).first();

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
