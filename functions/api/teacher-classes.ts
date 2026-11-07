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
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Content-Type': 'application/json'
};

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};

// GET /api/teacher-classes
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  const { request, env } = context;
  const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const token = authHeader.substring(7);
  const user: any = await verifyAuthSession(token, SECRET, db);
  if (!user) {
    return new Response(JSON.stringify({ error: "Phiên đăng nhập không hợp lệ" }), { status: 401, headers: corsHeaders });
  }

  const isAdmin = checkIsAdmin(user);
  const isTeacher = checkIsTeacherOrAdmin(user);
  if (!isAdmin && !isTeacher) {
    return new Response(JSON.stringify({ error: "Không có quyền truy cập thông tin phân công lớp" }), { status: 403, headers: corsHeaders });
  }

  const url = new URL(request.url);
  let teacherId = url.searchParams.get('teacher_id') || '';
  const donvi = url.searchParams.get('donvi') || '';
  const className = url.searchParams.get('class_name') || '';

  if (isTeacher && !isAdmin) {
    // Never trust a caller-supplied teacher_id for a teacher session.
    // A teacher may only inspect their own assignments.
    teacherId = user.user_id || user.id;
  }

  try {
    let sql = "SELECT * FROM teacher_classes WHERE 1=1";
    const params: any[] = [];

    if (teacherId) {
      sql += " AND teacher_id = ?";
      params.push(teacherId);
    }
    if (donvi) {
      sql += " AND LOWER(TRIM(donvi)) = LOWER(TRIM(?))";
      params.push(donvi);
    }
    if (className) {
      sql += " AND LOWER(TRIM(class_name)) = LOWER(TRIM(?))";
      params.push(className);
    }
    sql += " ORDER BY class_name ASC, teacher_name ASC";

    const stmt = params.length > 0 ? db.prepare(sql).bind(...params) : db.prepare(sql);
    const queryResult: any = await stmt.all();
    const rows = queryResult.results || [];

    let schoolClasses: string[] = [];
    if (donvi) {
      try {
        const clsRes: any = await db.prepare(
          "SELECT DISTINCT lop FROM users WHERE LOWER(TRIM(donvi)) = LOWER(TRIM(?)) AND lop IS NOT NULL AND TRIM(lop) != '' ORDER BY lop ASC"
        ).bind(donvi).all();
        schoolClasses = (clsRes.results || []).map((r: any) => String(r.lop || '').trim()).filter(Boolean);
      } catch (e) {}
    }

    return new Response(JSON.stringify({ data: rows, school_classes: schoolClasses, error: null }), { status: 200, headers: corsHeaders });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Lỗi server' }), { status: 500, headers: corsHeaders });
  }
};

// POST /api/teacher-classes
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  const { request, env } = context;
  const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const token = authHeader.substring(7);
  const user: any = await verifyAuthSession(token, SECRET, db);
  if (!user) {
    return new Response(JSON.stringify({ error: "Phiên đăng nhập không hợp lệ" }), { status: 401, headers: corsHeaders });
  }

  const isAdmin = checkIsAdmin(user);
  const isTeacher = checkIsTeacherOrAdmin(user);
  if (!isAdmin && !isTeacher) {
    return new Response(JSON.stringify({ error: "Chỉ Quản trị viên hoặc Giáo viên mới có quyền thao tác tính năng này" }), { status: 403, headers: corsHeaders });
  }

  try {
    const body: any = await request.json();
    let { teacher_id, teacher_name, donvi, classes, class_name, role, subject } = body || {};

    if (!teacher_id) {
      if (isTeacher && !isAdmin) {
        teacher_id = user.user_id || user.id;
      } else {
        return new Response(JSON.stringify({ error: "Thiếu mã giáo viên (teacher_id)" }), { status: 400, headers: corsHeaders });
      }
    }

    if (isTeacher && !isAdmin && (user.user_id || user.id) !== teacher_id) {
      return new Response(JSON.stringify({ error: "Bạn chỉ có thể quản lý lớp của chính mình" }), { status: 403, headers: corsHeaders });
    }

    if (!donvi || !donvi.trim()) {
      try {
        const uRes: any = await db.prepare("SELECT full_name, donvi FROM users WHERE id = ?").bind(teacher_id).first();
        if (uRes) {
          donvi = uRes.donvi || '';
          if (!teacher_name) teacher_name = uRes.full_name || '';
        }
      } catch (e) {}
    }

    const now = new Date().toISOString();

    if (Array.isArray(classes)) {
      // Validate and normalize the entire replacement set before mutating any row.
      const normalized = classes.map((item: any) => ({
        className: String(item?.class_name || item?.className || item?.lop || '').trim(),
        role: String(item?.role || 'bo_mon').trim(),
        subject: String(item?.subject || item?.mon_hoc || '').trim()
      })).filter((item: any) => item.className);
      if (normalized.length > 500) {
        return new Response(JSON.stringify({ error: "Mỗi giáo viên tối đa 500 phân công lớp." }), { status: 400, headers: corsHeaders });
      }

      // Use one SQL transaction so a mid-write failure never leaves a partial assignment set.
      const transaction = [
        "BEGIN",
        "DELETE FROM teacher_classes WHERE teacher_id = " + "'" + String(teacher_id).replace(/'/g, "''") + "'"
      ];
      for (const item of normalized) {
        const id = crypto.randomUUID();
        const q = (v: any) => "'" + String(v ?? '').replace(/'/g, "''") + "'";
        transaction.push(
          "INSERT INTO teacher_classes (id, teacher_id, teacher_name, class_name, donvi, role, subject, created_at) VALUES (" +
          [id, teacher_id, teacher_name || '', item.className, donvi || '', item.role, item.subject, now].map(q).join(",") +
          ") ON CONFLICT (teacher_id, class_name, donvi) DO UPDATE SET role = EXCLUDED.role, subject = EXCLUDED.subject, teacher_name = EXCLUDED.teacher_name"
        );
      }
      transaction.push("COMMIT");
      try {
        await db.exec(transaction.join(";"));
      } catch (error) {
        try { await db.exec("ROLLBACK"); } catch {}
        throw error;
      }

      return new Response(JSON.stringify({ success: true, count: normalized.length, error: null }), { status: 200, headers: corsHeaders });
    }

    if (!class_name || !String(class_name).trim()) {
      return new Response(JSON.stringify({ error: "Thiếu tên lớp cần phân công" }), { status: 400, headers: corsHeaders });
    }

    const singleClass = String(class_name).trim();
    const id = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO teacher_classes (id, teacher_id, teacher_name, class_name, donvi, role, subject, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (teacher_id, class_name, donvi) DO UPDATE SET role = EXCLUDED.role, subject = EXCLUDED.subject, teacher_name = EXCLUDED.teacher_name`
    ).bind(id, teacher_id, teacher_name || '', singleClass, donvi || '', role || 'bo_mon', subject || '', now).run();

    return new Response(JSON.stringify({ success: true, id, error: null }), { status: 200, headers: corsHeaders });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Lỗi server' }), { status: 500, headers: corsHeaders });
  }
};

// DELETE /api/teacher-classes
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  const { request, env } = context;
  const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }

  const token = authHeader.substring(7);
  const user: any = await verifyAuthSession(token, SECRET, db);
  if (!user) {
    return new Response(JSON.stringify({ error: "Phiên đăng nhập không hợp lệ" }), { status: 401, headers: corsHeaders });
  }

  const isAdmin = checkIsAdmin(user);
  const isTeacher = checkIsTeacherOrAdmin(user);
  if (!isAdmin && !isTeacher) {
    return new Response(JSON.stringify({ error: "Không có quyền gỡ phân công lớp" }), { status: 403, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const teacherId = url.searchParams.get('teacher_id');
  const className = url.searchParams.get('class_name');

  try {
    if (id) {
      if (isTeacher && !isAdmin) {
        const actorId = String(user.user_id || user.id || '');
        const row: any = await db.prepare("SELECT teacher_id FROM teacher_classes WHERE id = ? LIMIT 1").bind(id).first();
        if (!row) {
          return new Response(JSON.stringify({ error: "Không tìm thấy phân công lớp" }), { status: 404, headers: corsHeaders });
        }
        if (String(row.teacher_id || '') !== actorId && String(row.teacher_id || '') !== String(user.id || '')) {
          return new Response(JSON.stringify({ error: "Không có quyền thao tác trên phân công của giáo viên khác" }), { status: 403, headers: corsHeaders });
        }
      }
      const deleted: any = await db.prepare("DELETE FROM teacher_classes WHERE id = ?").bind(id).run();
      if (Number(deleted?.meta?.changes || 0) !== 1) {
        return new Response(JSON.stringify({ error: "Phân công lớp đã thay đổi hoặc không còn tồn tại" }), { status: 409, headers: corsHeaders });
      }
      return new Response(JSON.stringify({ success: true, error: null }), { status: 200, headers: corsHeaders });
    }

    if (teacherId && className) {
      if (isTeacher && !isAdmin && (user.user_id || user.id) !== teacherId) {
        return new Response(JSON.stringify({ error: "Không có quyền thao tác trên tài khoản khác" }), { status: 403, headers: corsHeaders });
      }
      await db.prepare("DELETE FROM teacher_classes WHERE teacher_id = ? AND class_name = ?").bind(teacherId, className).run();
      return new Response(JSON.stringify({ success: true, error: null }), { status: 200, headers: corsHeaders });
    }

    if (teacherId && !className) {
      if (isTeacher && !isAdmin && (user.user_id || user.id) !== teacherId) {
        return new Response(JSON.stringify({ error: "Không có quyền thao tác trên tài khoản khác" }), { status: 403, headers: corsHeaders });
      }
      await db.prepare("DELETE FROM teacher_classes WHERE teacher_id = ?").bind(teacherId).run();
      return new Response(JSON.stringify({ success: true, error: null }), { status: 200, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: "Thiếu thông tin để xóa (cần id hoặc teacher_id & class_name)" }), { status: 400, headers: corsHeaders });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Lỗi server' }), { status: 500, headers: corsHeaders });
  }
};
