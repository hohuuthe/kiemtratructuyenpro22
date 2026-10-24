/**
 * Student-only exam result history. No arbitrary student identifier is ever
 * accepted from the browser. Every row is scoped in SQL to the two identifiers
 * proven to belong to the verified live account (account id + linked user id).
 *
 * The list intentionally excludes details/questions/answers; those are fetched
 * one-at-a-time only when the owner opens a specific attempt.
 */
import { verifyAuthSession, getDynamicSecret, getDatabase, checkIsTeacherOrAdmin } from '../exam/utils';

interface Env {
  NEON_DATABASE_URL?: string;
  DATABASE_URL?: string;
  DB?: any;
  JWT_SECRET?: string;
}

const privateHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store, max-age=0',
  'Pragma': 'no-cache',
  'Vary': 'Authorization'
};

const reply = (data: any, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: privateHeaders });

export async function queryOwnResultHistory(db: any, user: any, url: URL) {
    // Fail closed on all caller-supplied identity fields, including aliases.
    for (const key of ['userId','user_id','studentId','student_id','accountId','account_id','studentName','student_name']) {
      if (url.searchParams.has(key)) {
        return reply({ error: 'Không được phép chỉ định danh tính học sinh.' }, 400);
      }
    }

    const ids = [...new Set([user.id, user.user_id].map(value => String(value || '').trim()).filter(Boolean))];
    if (!ids.length) return reply({ error: 'Không xác định được ID tài khoản đã xác thực.' }, 403);
    const scope = 'user_id IN (' + ids.map(() => '?').join(',') + ')';
    const id = url.searchParams.get('id');
    if (id !== null) {
      if (!id.trim()) return reply({ error: 'Thiếu mã bài làm.' }, 400);
      const sql = 'SELECT id, exam_id, exam_name, score, correct_count, total_questions, time_taken, created_at, details ' +
        'FROM results WHERE id = ? AND ' + scope + ' LIMIT 1';
      const row: any = await db.prepare(sql).bind(id, ...ids).first();
      if (!row) return reply({ error: 'Không tìm thấy bài làm của tài khoản này.' }, 404);
      let details: any[] = [];
      try {
        const parsed = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
        details = Array.isArray(parsed) ? parsed : [];
      } catch { details = []; }
      return reply({ data: {
        id: row.id, exam_id: row.exam_id, exam_name: row.exam_name,
        score: row.score, correct_count: row.correct_count,
        total_questions: row.total_questions, time_taken: row.time_taken,
        created_at: row.created_at, details
      }, error: null });
    }

    // Small, bounded pages prevent large database dumps to student browsers.
    const limitRaw = Number(url.searchParams.get('limit') || 30);
    const offsetRaw = Number(url.searchParams.get('offset') || 0);
    if (!Number.isSafeInteger(limitRaw) || limitRaw < 1 || limitRaw > 100 ||
        !Number.isSafeInteger(offsetRaw) || offsetRaw < 0 || offsetRaw > 1000000) {
      return reply({ error: 'Tham số phân trang không hợp lệ.' }, 400);
    }
    const totalRow: any = await db.prepare(
      'SELECT COUNT(*) AS total FROM results WHERE ' + scope
    ).bind(...ids).first();
    const response: any = await db.prepare(
      'SELECT id, exam_id, exam_name, score, correct_count, total_questions, time_taken, created_at ' +
      'FROM results WHERE ' + scope + ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?'
    ).bind(...ids, limitRaw, offsetRaw).all();
    const rows = Array.isArray(response?.results) ? response.results : [];
    const total = Number(totalRow?.total) || 0;
    return reply({
      data: rows.map((row: any) => ({
        id: row.id, exam_id: row.exam_id, exam_name: row.exam_name,
        score: row.score, correct_count: row.correct_count,
        total_questions: row.total_questions, time_taken: row.time_taken,
        created_at: row.created_at
      })),
      total, limit: limitRaw, offset: offsetRaw,
      has_more: offsetRaw + rows.length < total, error: null
    });
  }

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const { request, env } = context;
    const header = request.headers.get('Authorization') || '';
    if (!header.startsWith('Bearer ') || !header.substring(7).trim()) {
      return reply({ error: 'Vui lòng đăng nhập để xem kết quả của mình.' }, 401);
    }

    const db = getDatabase(context);
    const secret = await getDynamicSecret(db, env.JWT_SECRET);
    const user = await verifyAuthSession(header.substring(7), secret, db);
    if (!user) return reply({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' }, 401);
    if (checkIsTeacherOrAdmin(user) ||
        !['học sinh', 'student'].includes(String(user.target_audience || '').toLowerCase().trim())) {
      return reply({ error: 'Chỉ tài khoản học sinh mới có thể truy cập kết quả cá nhân.' }, 403);
    }

    return await queryOwnResultHistory(db, user, new URL(request.url));
  } catch (error) {
    console.error('[results/me] Student history query failed');
    return reply({ error: 'Không thể tải kết quả cá nhân. Vui lòng thử lại.' }, 503);
  }
};
