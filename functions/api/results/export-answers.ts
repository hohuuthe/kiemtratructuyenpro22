import { verifyAuthSession, getDynamicSecret, getDatabase, checkIsAdmin, checkIsTeacherOrAdmin } from '../exam/utils';

// The exported answer key is privileged information. Never expose it through
// the public result list, student history or a share code.
export const MAX_EXPORT_ANSWER_BATCH = 30;
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store, max-age=0',
  'Vary': 'Authorization, Host, X-Tenant-Slug'
};
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers });

export async function readAuthorizedAnswerBatch(db: any, actor: any, ids: string[]) {
  if (!actor || !checkIsTeacherOrAdmin(actor))
    throw new Error('FORBIDDEN');
    const admin = checkIsAdmin(actor);
    const placeholders = ids.map(() => '?').join(',');
    // Authorize by immutable exam ID + creator ID, not by student name,
    // displayed class, shared code or caller-supplied teacher ID.
    const teacherGuard = admin ? '' :
      ' AND EXISTS (SELECT 1 FROM exam_configs ec WHERE ec.id = r.exam_id AND ec.creator_id IN (?, ?))';
    const sql = 'SELECT r.id, r.exam_id, r.total_questions, r.details FROM results r WHERE r.id IN (' +
      placeholders + ')' + teacherGuard;
    const args = admin ? ids : [...ids, String(actor.id), String(actor.user_id || actor.id)];
    const { results: raw } = await db.prepare(sql).bind(...args).all();
    const found = new Map((raw || []).map((r: any) => [String(r.id), r]));

    // Do not allow partial exports or reveal which identifiers belonged to
    // another teacher (IDOR protection).
    if (found.size !== ids.length || ids.some((id: string) => !found.has(id)))
      throw new Error('FORBIDDEN');

    const data: any[] = [];
    for (const id of ids) {
      const row: any = found.get(id);
      let details: any;
      try {
        details = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
      } catch {
        throw new Error('INVALID_DETAILS');
      }
      if (details != null && !Array.isArray(details))
        throw new Error('INVALID_DETAILS');
      data.push({
        id,
        exam_id: String(row.exam_id || ''),
        total_questions: Number(row.total_questions) || 0,
        details: details || [],
        details_missing: details == null
      });
    }
  return data;
}

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { status: 204, headers: { ...headers, Allow: 'POST, OPTIONS' } });

export const onRequestPost: PagesFunction = async (context: any) => {
  const db = getDatabase(context);
  if (!db) return reply({ error: 'Không thể kết nối cơ sở dữ liệu.' }, 503);
  const auth = context.request.headers.get('Authorization') || '';
  if (!/^Bearer \S+$/.test(auth)) return reply({ error: 'Yêu cầu đăng nhập.' }, 401);

  try {
    const secret = await getDynamicSecret(db, context.env?.JWT_SECRET);
    const actor: any = await verifyAuthSession(auth.slice(7), secret, db);
    if (!actor || !checkIsTeacherOrAdmin(actor))
      return reply({ error: 'Không có quyền xuất đáp án bài làm.' }, 403);

    const payload: any = await context.request.json().catch(() => null);
    const ids = payload?.ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_EXPORT_ANSWER_BATCH ||
        ids.some((id: unknown) => typeof id !== 'string' || !id.trim() || id.length > 160) ||
        new Set(ids).size !== ids.length) {
      return reply({ error: 'Danh sách mã kết quả xuất không hợp lệ.' }, 400);
    }

    try {
      const data = await readAuthorizedAnswerBatch(db, actor, ids);
      return reply({ data, error: null });
    } catch (error: any) {
      if (error?.message === 'FORBIDDEN') return reply({ error: 'Không có quyền xem kết quả.' }, 403);
      return reply({ error: 'Một số kết quả không tồn tại hoặc dữ liệu chi tiết không hợp lệ.' }, 409);
    }
  } catch {
    // Deliberately omit private answer data from logs and errors.
    return reply({ error: 'Không thể tải đáp án để xuất Excel.' }, 503);
  }
};
