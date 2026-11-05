import { verifyAuthSession, getDynamicSecret, checkIsAdmin, checkIsTeacherOrAdmin, getDatabase } from './exam/utils';

interface Env {
  NEON_DATABASE_URL?: string;
  DATABASE_URL?: string;
  DB?: any;
  JWT_SECRET?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const db = getDatabase(context);
  const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }
  const user: any = await verifyAuthSession(authHeader.slice(7), SECRET, db);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Phiên đăng nhập không hợp lệ' }), { status: 401, headers: corsHeaders });
  }

  const isAdmin = checkIsAdmin(user);
  const isTeacher = checkIsTeacherOrAdmin(user) && !isAdmin;
  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');
  const pageParam = url.searchParams.get('page');
  const requestedSnapshot = String(url.searchParams.get('snapshot') || '').trim();

  let limit = -1;
  if (limitParam !== null && !['all','0','-1'].includes(limitParam)) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) limit = Math.min(parsed, 5000);
  }
  let offset = 0;
  if (offsetParam !== null) {
    const parsed = parseInt(offsetParam, 10);
    if (!isNaN(parsed) && parsed >= 0) offset = parsed;
  } else if (pageParam !== null) {
    const page = parseInt(pageParam, 10);
    if (!isNaN(page) && page > 0) offset = (page - 1) * (limit > 0 ? limit : 1000);
  }

  const projection = `
    SELECT users.*,
      COALESCE((SELECT a.id FROM accounts a WHERE a.user_id = users.id OR a.id = users.id ORDER BY (CASE WHEN a.user_id = users.id THEN 0 ELSE 1 END), a.created_at DESC, a.id DESC LIMIT 1), NULL) AS account_id,
      COALESCE((SELECT a.username FROM accounts a WHERE a.user_id = users.id OR a.id = users.id ORDER BY (CASE WHEN a.user_id = users.id THEN 0 ELSE 1 END), a.created_at DESC, a.id DESC LIMIT 1), NULL) AS account_username,
      COALESCE((SELECT a.role FROM accounts a WHERE a.user_id = users.id OR a.id = users.id ORDER BY (CASE WHEN a.user_id = users.id THEN 0 ELSE 1 END), a.created_at DESC, a.id DESC LIMIT 1), NULL) AS account_role,
      COALESCE((SELECT a.is_active FROM accounts a WHERE a.user_id = users.id OR a.id = users.id ORDER BY (CASE WHEN a.user_id = users.id THEN 0 ELSE 1 END), a.created_at DESC, a.id DESC LIMIT 1), NULL) AS account_is_active
    FROM users
  `;

  try {
    let rows: any[] = [];
    let total = 0;
    let snapshot = '';

    if (isAdmin) {
      const meta: any = await db.prepare(`
        SELECT COUNT(*)::int AS total,
               MD5(COALESCE(STRING_AGG(id, '|' ORDER BY created_at DESC, id DESC), '')) AS snapshot
        FROM users
      `).first();
      total = Number(meta?.total || 0);
      snapshot = String(meta?.snapshot || '');
      if (requestedSnapshot && requestedSnapshot !== snapshot) {
        return new Response(JSON.stringify({
          error: 'Phạm vi dữ liệu đã thay đổi trong khi đang phân trang. Cần tải lại từ trang đầu.',
          code: 'PAGINATION_SCOPE_CHANGED', snapshot, total
        }), { status: 409, headers: corsHeaders });
      }
      const paginationClause = limit > 0 ? ` LIMIT ${limit} OFFSET ${offset}` : '';
      const res: any = await db.prepare(projection + ` ORDER BY users.created_at DESC, users.id DESC${paginationClause}`).all();
      rows = res.results || [];
    } else if (isTeacher) {
      const selfId = String(user.user_id || user.id || '');
      const accountId = String(user.id || selfId);
      const self: any = await db.prepare(
        projection + ' WHERE users.id = ? OR users.id = ? ORDER BY CASE WHEN users.id = ? THEN 0 ELSE 1 END, users.id DESC LIMIT 1'
      ).bind(selfId, accountId, selfId).first();
      if (!self) {
        return new Response(JSON.stringify({ error: 'Không tìm thấy hồ sơ giáo viên liên kết với tài khoản.' }), { status: 409, headers: corsHeaders });
      }

      const studentWhere = `
        WHERE LOWER(TRIM(COALESCE(users.target_audience,''))) IN ('học sinh','student')
          AND EXISTS (
            SELECT 1 FROM teacher_classes tc
            WHERE (tc.teacher_id = ? OR tc.teacher_id = ?)
              AND LOWER(TRIM(tc.class_name)) = LOWER(TRIM(COALESCE(users.lop,'')))
              AND LOWER(TRIM(COALESCE(tc.donvi,''))) = LOWER(TRIM(COALESCE(users.donvi,'')))
          )`;
      const meta: any = await db.prepare(`
        SELECT COUNT(*)::int AS student_total,
               MD5(COALESCE(STRING_AGG(users.id, '|' ORDER BY users.created_at DESC, users.id DESC), '')) AS student_snapshot
        FROM users
        ${studentWhere}
      `).bind(selfId, accountId).first();
      const studentTotal = Number(meta?.student_total || 0);
      total = studentTotal + 1;
      snapshot = String(self.id) + ':' + String(meta?.student_snapshot || '');

      if (requestedSnapshot && requestedSnapshot !== snapshot) {
        return new Response(JSON.stringify({
          error: 'Phạm vi dữ liệu giáo viên đã thay đổi trong khi đang phân trang. Cần tải lại từ trang đầu.',
          code: 'PAGINATION_SCOPE_CHANGED', snapshot, total
        }), { status: 409, headers: corsHeaders });
      }

      if (limit < 0) {
        const studentRes: any = await db.prepare(projection + studentWhere + ' ORDER BY users.created_at DESC, users.id DESC')
          .bind(selfId, accountId).all();
        rows = [self, ...((studentRes.results || []) as any[]).filter((u: any) => String(u.id) !== String(self.id))];
      } else if (offset === 0) {
        const studentLimit = Math.max(0, limit - 1);
        let students: any[] = [];
        if (studentLimit > 0) {
          const studentRes: any = await db.prepare(
            projection + studentWhere + ` ORDER BY users.created_at DESC, users.id DESC LIMIT ${studentLimit} OFFSET 0`
          ).bind(selfId, accountId).all();
          students = studentRes.results || [];
        }
        rows = [self, ...students.filter((u: any) => String(u.id) !== String(self.id))];
      } else {
        const studentOffset = Math.max(0, offset - 1);
        const studentRes: any = await db.prepare(
          projection + studentWhere + ` ORDER BY users.created_at DESC, users.id DESC LIMIT ${limit} OFFSET ${studentOffset}`
        ).bind(selfId, accountId).all();
        rows = studentRes.results || [];
      }

      const ids = new Set([String(user.user_id || user.id || ''), String(user.id || '')]);
      const tcRes: any = await db.prepare(
        'SELECT id, teacher_id, teacher_name, class_name, donvi, role, subject, created_at FROM teacher_classes WHERE teacher_id = ? OR teacher_id = ? ORDER BY class_name ASC, donvi ASC, id ASC'
      ).bind(user.user_id || user.id, user.id).all();
      const ownAssignments = tcRes.results || [];
      for (const row of rows) row.assigned_classes = ids.has(String(row.id)) ? ownAssignments : [];
    } else {
      const selfId = String(user.user_id || user.id || '');
      const accountId = String(user.id || selfId);
      const self: any = await db.prepare(
        projection + ' WHERE users.id = ? OR users.id = ? ORDER BY CASE WHEN users.id = ? THEN 0 ELSE 1 END, users.id DESC LIMIT 1'
      ).bind(selfId, accountId, selfId).first();
      rows = self ? [self] : [];
      total = rows.length;
      snapshot = rows.length ? String(rows[0].id) : '';
      return new Response(JSON.stringify({
        data: rows, total, limit, offset: 0, has_more: false, snapshot,
        role_scope: 'student', error: null
      }), { status: 200, headers: corsHeaders });
    }

    if (isAdmin) {
      try {
        const tcRes: any = await db.prepare(
          'SELECT id, teacher_id, teacher_name, class_name, donvi, role, subject, created_at FROM teacher_classes ORDER BY class_name ASC, donvi ASC, id ASC'
        ).all();
        const map: Record<string, any[]> = {};
        for (const tc of (tcRes.results || [])) {
          const id = String(tc.teacher_id || '');
          if (!map[id]) map[id] = [];
          map[id].push(tc);
        }
        for (const row of rows) row.assigned_classes = map[String(row.id)] || [];
      } catch {
        for (const row of rows) row.assigned_classes = [];
      }
    }

    const unique = new Set(rows.map((row: any) => String(row?.id || '')));
    if (unique.size !== rows.length || unique.has('')) {
      return new Response(JSON.stringify({
        error: 'Phân trang hồ sơ phát hiện bản ghi trùng hoặc thiếu ID.',
        code: 'PAGINATION_PAGE_INVALID'
      }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({
      data: rows,
      total,
      limit,
      offset,
      has_more: limit > 0 ? offset + rows.length < total : false,
      snapshot,
      role_scope: isAdmin ? 'admin' : 'teacher',
      error: null
    }), { status: 200, headers: corsHeaders });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Lỗi server' }), { status: 500, headers: corsHeaders });
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const db = getDatabase(context);
  const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }
  const token = authHeader.substring(7);
  const user: any = await verifyAuthSession(token, SECRET, db);
  if (!user || user.role !== 'admin') {
    return new Response(JSON.stringify({ error: "Chỉ Quản trị viên mới được thêm hồ sơ người dùng" }), { status: 403, headers: corsHeaders });
  }

  try {
    const body: any = await request.json();
    let { id, full_name, phone_number, gender, dob, address, donvi, lop, occupation, target_audience, payment_status, payment_method, is_vip, is_active, expiry_date } = body;
    if (!full_name || !full_name.trim()) {
      return new Response(JSON.stringify({ error: "Vui lòng nhập Họ và tên người dùng!" }), { status: 400, headers: corsHeaders });
    }

    if (!id || !id.trim()) {
      id = crypto.randomUUID();
    } else {
      id = id.trim();
    }

    const activeVal = is_active !== false && is_active !== 0 && is_active !== 'false' ? 1 : 0;
    const isTeacherProfile = String(target_audience || '').trim().toLocaleLowerCase('vi') === 'giáo viên';
    const vipVal = isTeacherProfile && (is_vip === true || is_vip === 1 || is_vip === '1' || is_vip === 'true') ? 1 : 0;
    const sql = "INSERT INTO users (id, full_name, phone_number, gender, dob, address, donvi, lop, occupation, target_audience, payment_status, payment_method, is_vip, is_active, expiry_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    const params = [
      id,
      full_name.trim(),
      phone_number || '',
      gender || '',
      dob || null,
      address || '',
      donvi || '',
      lop || '',
      occupation || '',
      target_audience || 'Học sinh',
      payment_status || 'Chưa thanh toán',
      payment_method || '',
      vipVal,
      activeVal,
      expiry_date || null,
      new Date().toISOString()
    ];

    await db.prepare(sql).bind(...params).run();
    return new Response(JSON.stringify({ data: { id, full_name }, error: null }), { status: 201, headers: corsHeaders });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Lỗi server' }), { status: 500, headers: corsHeaders });
  }
};
