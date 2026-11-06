/**
 * Student-only exam result history. No arbitrary student identifier is ever
 * accepted from the browser. Every row is scoped in SQL to the two identifiers
 * proven to belong to the verified live account (account id + linked user id).
 *
 * The list intentionally excludes details/questions/answers; those are fetched
 * one-at-a-time only when the owner opens a specific attempt.
 */
import { verifyAuthSession, getDynamicSecret, getDatabase, checkIsTeacherOrAdmin } from '../exam/utils';
import { projectStudentAttemptDetails, projectStudentResultRow, studentExamVisibility } from '../../../src/student-result-visibility';

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
      // Read visibility from the live exam config by exact ID, never by a duplicated name.
      const sql = 'SELECT r.id, r.exam_id, r.exam_name, r.score, r.correct_count, r.total_questions, ' +
        'r.time_taken, r.created_at, r.cheat_warning_count, r.details, ec.show_score AS exam_show_score, ' +
        'ec.show_details AS exam_show_details FROM results r ' +
        'LEFT JOIN exam_configs ec ON ec.id = r.exam_id ' +
        'WHERE r.id = ? AND r.' + scope + ' LIMIT 1';
      const row: any = await db.prepare(sql).bind(id, ...ids).first();
      if (!row) return reply({ error: 'Không tìm thấy bài làm của tài khoản này.' }, 404);
      const permission = studentExamVisibility(row);
      if (!permission.can_view_details) {
        return reply({ error: 'Đề thi không cho phép học sinh xem chi tiết bài làm.', code: 'EXAM_DETAILS_DISABLED' }, 403);
      }
      return reply({
        data: {
          ...projectStudentResultRow(row),
          student_feedback_scope: 'owned-detail',
          details: projectStudentAttemptDetails(row.details, permission.can_view_score)
        }, error: null
      });
    }

    const examId = url.searchParams.get('examId');
    if (examId !== null) {
      const requestedExamId = examId.trim();
      if (!requestedExamId || requestedExamId.length > 160) {
        return reply({ error: 'Mã đề thi không hợp lệ.' }, 400);
      }
      const response: any = await db.prepare(
        'SELECT r.id, r.exam_id, r.exam_name, r.score, r.correct_count, r.total_questions, ' +
        'r.time_taken, r.created_at, r.cheat_warning_count, ec.show_score AS exam_show_score, ' +
        'ec.show_details AS exam_show_details FROM results r ' +
        'LEFT JOIN exam_configs ec ON ec.id = r.exam_id WHERE r.' + scope +
        ' AND r.exam_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT 100'
      ).bind(...ids, requestedExamId).all();
      const projected = (Array.isArray(response?.results) ? response.results : []).map(projectStudentResultRow);
      projected.sort((a: any, b: any) => {
        const aScore = a.can_view_score === true && Number.isFinite(Number(a.score)) ? Number(a.score) : null;
        const bScore = b.can_view_score === true && Number.isFinite(Number(b.score)) ? Number(b.score) : null;
        if (aScore !== null || bScore !== null) {
          const byScore = (bScore ?? -Infinity) - (aScore ?? -Infinity);
          if (byScore) return byScore;
        }
        const aTime = Date.parse(String(a.created_at || '')) || 0;
        const bTime = Date.parse(String(b.created_at || '')) || 0;
        return bTime - aTime || String(b.id || '').localeCompare(String(a.id || ''));
      });
      return reply({ data: projected, total: projected.length, exam_id: requestedExamId, error: null });
    }

    const grouped = url.searchParams.get('grouped') === '1';

    // Main student result screen is grouped by immutable exam ID. Pagination is
    // therefore by exam, never by individual attempt. Individual attempts are
    // fetched only through the examId branch above after the student clicks.
    if (grouped) {
      const limitRaw = Number(url.searchParams.get('limit') || 30);
      const offsetRaw = Number(url.searchParams.get('offset') || 0);
      if (!Number.isSafeInteger(limitRaw) || limitRaw < 1 || limitRaw > 100 ||
          !Number.isSafeInteger(offsetRaw) || offsetRaw < 0 || offsetRaw > 1000000) {
        return reply({ error: 'Tham số phân trang không hợp lệ.' }, 400);
      }

      const groupKey = "COALESCE(NULLIF(TRIM(r.exam_id), ''), 'legacy-result:' || r.id)";
      const totalAttemptsRow: any = await db.prepare(
        'SELECT COUNT(*) AS total FROM results WHERE ' + scope
      ).bind(...ids).first();
      const totalExamsRow: any = await db.prepare(
        "SELECT COUNT(DISTINCT COALESCE(NULLIF(TRIM(exam_id), ''), 'legacy-result:' || id)) AS total FROM results WHERE " + scope
      ).bind(...ids).first();

      const groupedSql =
        'WITH ranked AS (' +
        ' SELECT r.id, r.exam_id, r.exam_name, r.score, r.correct_count, r.total_questions, ' +
        'r.time_taken, r.created_at, r.cheat_warning_count, ec.show_score AS exam_show_score, ' +
        'ec.show_details AS exam_show_details, ' +
        'COUNT(*) OVER (PARTITION BY ' + groupKey + ') AS attempt_count, ' +
        'MAX(r.created_at) OVER (PARTITION BY ' + groupKey + ') AS latest_created_at, ' +
        'ROW_NUMBER() OVER (PARTITION BY ' + groupKey +
        ' ORDER BY r.score DESC NULLS LAST, r.created_at DESC, r.id DESC) AS pick_rank ' +
        'FROM results r LEFT JOIN exam_configs ec ON ec.id = r.exam_id WHERE r.' + scope +
        ') SELECT * FROM ranked WHERE pick_rank = 1 ' +
        'ORDER BY latest_created_at DESC, id DESC LIMIT ? OFFSET ?';

      const response: any = await db.prepare(groupedSql).bind(...ids, limitRaw, offsetRaw).all();
      const rows = Array.isArray(response?.results) ? response.results : [];
      const projected = rows.map((row: any) => ({
        ...projectStudentResultRow({ ...row, created_at: row.latest_created_at || row.created_at }),
        attempt_count: Math.max(1, Math.floor(Number(row.attempt_count) || 1)),
        latest_created_at: row.latest_created_at || row.created_at,
        is_grouped: true
      }));
      const totalAttempts = Math.max(0, Number(totalAttemptsRow?.total) || 0);
      const totalExams = Math.max(0, Number(totalExamsRow?.total) || 0);
      return reply({
        data: projected,
        total: totalExams,
        total_exams: totalExams,
        total_attempts: totalAttempts,
        limit: limitRaw,
        offset: offsetRaw,
        has_more: offsetRaw + rows.length < totalExams,
        grouped: true,
        error: null
      });
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
      'SELECT r.id, r.exam_id, r.exam_name, r.score, r.correct_count, r.total_questions, ' +
      'r.time_taken, r.created_at, r.cheat_warning_count, ec.show_score AS exam_show_score, ' +
      'ec.show_details AS exam_show_details FROM results r ' +
      'LEFT JOIN exam_configs ec ON ec.id = r.exam_id WHERE r.' + scope +
      ' ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?'
    ).bind(...ids, limitRaw, offsetRaw).all();
    const rows = Array.isArray(response?.results) ? response.results : [];
    const total = Number(totalRow?.total) || 0;
    return reply({
      data: rows.map(projectStudentResultRow),
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
