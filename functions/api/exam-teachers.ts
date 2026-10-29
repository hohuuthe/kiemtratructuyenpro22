import { getDatabase } from './exam/utils';

// Danh bạ chọn đề công khai: không lộ username, số điện thoại, trạng thái tài khoản
// hoặc thông tin quản trị; học sinh/khách chỉ tải khi mở tab Làm bài.
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store, max-age=0',
  'Vary': 'Host, X-Tenant-Slug'
};
export const onRequestGet: PagesFunction = async (context) => {
  try {
    const db = getDatabase(context);
    const { results } = await db.prepare(`
      SELECT DISTINCT ec.creator_id AS id,
        COALESCE(
          (SELECT NULLIF(TRIM(u.full_name), '') FROM users u WHERE u.id = ec.creator_id LIMIT 1),
          (SELECT NULLIF(TRIM(u.full_name), '') FROM accounts a
             LEFT JOIN users u ON u.id = a.user_id
             WHERE a.id = ec.creator_id LIMIT 1),
          'Giáo viên'
        ) AS full_name,
        COALESCE(
          (SELECT u.donvi FROM users u WHERE u.id = ec.creator_id LIMIT 1),
          (SELECT u.donvi FROM accounts a LEFT JOIN users u ON u.id = a.user_id
             WHERE a.id = ec.creator_id LIMIT 1),
          ''
        ) AS donvi,
        COALESCE(
          (SELECT a.role FROM accounts a WHERE a.id = ec.creator_id
             OR a.user_id = ec.creator_id LIMIT 1),
          'teacher'
        ) AS role
      FROM exam_configs ec
      WHERE ec.creator_id IS NOT NULL AND TRIM(ec.creator_id) <> ''
      ORDER BY full_name ASC
    `).all();
    const data = (results || []).map((row: any) => ({
      id: String(row.id),
      full_name: String(row.full_name || 'Giáo viên'),
      donvi: String(row.donvi || ''),
      role: row.role === 'admin' ? 'admin' : 'teacher',
      target_audience: row.role === 'admin' ? 'Quản trị viên' : 'Giáo viên',
      exam_count: 1
    }));
    return new Response(JSON.stringify({ data, error: null }), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ data: [], error: 'Không thể tải danh sách giáo viên.' }), { status: 503, headers });
  }
};
