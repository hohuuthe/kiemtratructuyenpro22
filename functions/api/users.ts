import { verifyJWT, getDynamicSecret, checkIsAdmin, checkIsTeacherOrAdmin, getDatabase } from './exam/utils';

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
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }
  const token = authHeader.substring(7);
  const user: any = await verifyJWT(token, SECRET);
  
  const isAdmin = checkIsAdmin(user);
  const isTeacher = checkIsTeacherOrAdmin(user) && !isAdmin;
  if (!user || (!isAdmin && !isTeacher)) {
    return new Response(JSON.stringify({ error: "Bạn không có quyền truy cập danh sách hồ sơ người dùng" }), { status: 403, headers: corsHeaders });
  }

  let teacherDonvi = '';
  if (isTeacher) {
    try {
      const dbUser: any = await db.prepare("SELECT donvi FROM users WHERE id = ? OR id = ?").bind(user.user_id || user.id, user.id).first();
      if (dbUser && dbUser.donvi) {
        teacherDonvi = dbUser.donvi.trim();
      }
    } catch (e) {}
    if (!teacherDonvi && user.donvi) {
      teacherDonvi = user.donvi.trim();
    }
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get('limit');
  const offsetParam = url.searchParams.get('offset');
  const pageParam = url.searchParams.get('page');

  let limit = -1; // Mặc định không giới hạn số lượng dòng để tải toàn bộ dữ liệu CSDL
  if (limitParam !== null) {
    if (limitParam === 'all' || limitParam === '0' || limitParam === '-1') {
      limit = -1; // không giới hạn số lượng dòng
    } else {
      const parsed = parseInt(limitParam, 10);
      if (!isNaN(parsed) && parsed > 0) limit = parsed;
    }
  }

  let offset = 0;
  if (offsetParam !== null) {
    const parsed = parseInt(offsetParam, 10);
    if (!isNaN(parsed) && parsed >= 0) offset = parsed;
  } else if (pageParam !== null) {
    const page = parseInt(pageParam, 10);
    if (!isNaN(page) && page > 0) offset = (page - 1) * (limit > 0 ? limit : 1000);
  }

  const paginationClause = limit > 0 ? ` LIMIT ${limit} OFFSET ${offset}` : '';

  try {
    let sql = `
      SELECT users.*, 
             COALESCE(
               (SELECT accounts.id FROM accounts WHERE accounts.user_id = users.id OR accounts.id = users.id ORDER BY (CASE WHEN accounts.user_id = users.id THEN 0 ELSE 1 END), accounts.created_at DESC LIMIT 1),
               NULL
             ) AS account_id,
             COALESCE(
               (SELECT accounts.username FROM accounts WHERE accounts.user_id = users.id OR accounts.id = users.id ORDER BY (CASE WHEN accounts.user_id = users.id THEN 0 ELSE 1 END), accounts.created_at DESC LIMIT 1),
               NULL
             ) AS account_username,
             COALESCE(
               (SELECT accounts.role FROM accounts WHERE accounts.user_id = users.id OR accounts.id = users.id ORDER BY (CASE WHEN accounts.user_id = users.id THEN 0 ELSE 1 END), accounts.created_at DESC LIMIT 1),
               NULL
             ) AS account_role,
             COALESCE(
               (SELECT accounts.is_active FROM accounts WHERE accounts.user_id = users.id OR accounts.id = users.id ORDER BY (CASE WHEN accounts.user_id = users.id THEN 0 ELSE 1 END), accounts.created_at DESC LIMIT 1),
               NULL
             ) AS account_is_active
      FROM users 
    `;
    let queryResult;
    if (isTeacher) {
      if (teacherDonvi) {
        sql += ` WHERE TRIM(LOWER(users.donvi)) = TRIM(LOWER(?)) AND LOWER(users.target_audience) = 'học sinh' ORDER BY users.created_at DESC${paginationClause}`;
        queryResult = await db.prepare(sql).bind(teacherDonvi).all();
      } else {
        sql += ` WHERE LOWER(users.target_audience) = 'học sinh' ORDER BY users.created_at DESC${paginationClause}`;
        queryResult = await db.prepare(sql).all();
      }
    } else {
      sql += ` ORDER BY users.created_at DESC${paginationClause}`;
      queryResult = await db.prepare(sql).all();
    }
    const results = queryResult.results || [];

    // Đính kèm danh sách lớp phụ trách (assigned_classes) cho tài khoản giáo viên
    try {
      const tcRes: any = await db.prepare("SELECT id, teacher_id, teacher_name, class_name, donvi, role, subject, created_at FROM teacher_classes ORDER BY class_name ASC").all();
      const tcRows = tcRes.results || [];
      const tcMap: Record<string, any[]> = {};
      for (const tc of tcRows) {
        const tid = tc.teacher_id;
        if (!tcMap[tid]) tcMap[tid] = [];
        tcMap[tid].push(tc);
      }
      for (const u of results) {
        u.assigned_classes = tcMap[u.id] || [];
      }
    } catch (tcErr) {
      for (const u of results) {
        u.assigned_classes = [];
      }
    }

    return new Response(JSON.stringify({ 
      data: results, 
      total: results.length,
      limit,
      offset,
      has_more: limit > 0 && results.length === limit,
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
  const user: any = await verifyJWT(token, SECRET);
  if (!user || user.role !== 'admin') {
    return new Response(JSON.stringify({ error: "Chỉ Quản trị viên mới được thêm hồ sơ người dùng" }), { status: 403, headers: corsHeaders });
  }

  try {
    const body: any = await request.json();
    let { id, full_name, phone_number, gender, dob, address, donvi, lop, occupation, target_audience, payment_status, payment_method, is_active, expiry_date } = body;
    if (!full_name || !full_name.trim()) {
      return new Response(JSON.stringify({ error: "Vui lòng nhập Họ và tên người dùng!" }), { status: 400, headers: corsHeaders });
    }

    if (!id || !id.trim()) {
      id = crypto.randomUUID();
    } else {
      id = id.trim();
    }

    const activeVal = is_active !== false && is_active !== 0 && is_active !== 'false' ? 1 : 0;
    const sql = "INSERT INTO users (id, full_name, phone_number, gender, dob, address, donvi, lop, occupation, target_audience, payment_status, payment_method, is_active, expiry_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
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
