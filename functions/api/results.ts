import { verifyJWT, getDynamicSecret, getDatabase } from './exam/utils';

interface Env {
  NEON_DATABASE_URL?: string;
  DATABASE_URL?: string;
  DB?: any;
  JWT_SECRET?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json'
};

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};

// Helper parse details JSON
function parseResultRow(row: any, includeDetails = false) {
  let details = [];
  if (includeDetails && row.details) {
    if (typeof row.details === 'string') {
      try {
        details = JSON.parse(row.details);
      } catch {
        details = [];
      }
    } else {
      details = row.details;
    }
  }

  const lop = row.lop || row.user_lop || '';
  const donVi = row.don_vi || row.donvi || row.user_don_vi || row.student_class || '';

  return {
    id: row.id,
    user_id: row.user_id || '',
    userId: row.user_id || '',
    student_name: row.student_name,
    student_class: row.student_class,
    lop: lop,
    don_vi: donVi,
    donvi: donVi,
    score: row.score,
    correct_count: row.correct_count,
    total_questions: row.total_questions,
    time_taken: row.time_taken,
    exam_name: row.exam_name,
    exam_id: row.exam_id,
    created_at: row.created_at,
    loai_thi_sinh: row.loai_thi_sinh,
    cheat_warning_count: Number(row.cheat_warning_count) || 0,
    cheatWarningCount: Number(row.cheat_warning_count) || 0,
    ai_grading_summary: row.ai_grading_summary || null,
    ...(includeDetails ? { details } : {})
  };
}

// GET /api/results - Tải danh sách kết quả hoặc chi tiết 1 bài thi
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  const { request, env } = context;
  const url = new URL(request.url);
  const idParam = url.searchParams.get('id');
  const examIdParam = url.searchParams.get('examId') || url.searchParams.get('exam_id');
  const countOnly = url.searchParams.get('count') === 'true';
  const includeDetails = url.searchParams.get('includeDetails') === 'true' || !!idParam;
  const limitParamRaw = url.searchParams.get('limit');
  const offsetParamRaw = url.searchParams.get('offset');
  const pageParamRaw = url.searchParams.get('page');

  let limit = -1;
  if (limitParamRaw !== null) {
    if (limitParamRaw === 'all' || limitParamRaw === '0' || limitParamRaw === '-1') {
      limit = -1;
    } else {
      const parsed = parseInt(limitParamRaw, 10);
      if (!isNaN(parsed) && parsed > 0) limit = parsed;
    }
  }

  let offset = 0;
  if (offsetParamRaw !== null) {
    const parsed = parseInt(offsetParamRaw, 10);
    if (!isNaN(parsed) && parsed >= 0) offset = parsed;
  } else if (pageParamRaw !== null) {
    const page = parseInt(pageParamRaw, 10);
    if (!isNaN(page) && page > 0) offset = (page - 1) * (limit > 0 ? limit : 1000);
  }

  const paginationClause = limit > 0 ? ` LIMIT ${limit} OFFSET ${offset}` : '';

  function makePaginatedResponse(rawResults: any[], incDetails: boolean) {
    const data = (rawResults || []).map((r: any) => parseResultRow(r, incDetails));
    return new Response(JSON.stringify({
      data,
      total: data.length,
      limit,
      offset,
      has_more: limit > 0 && data.length === limit,
      error: null
    }), { status: 200, headers: corsHeaders });
  }

  const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
  const authHeader = request.headers.get('Authorization');
  let user: any = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    user = await verifyJWT(token, SECRET);
  }

  const roleLower = String(user?.role || '').toLowerCase();
  const audienceLower = String(user?.target_audience || '').toLowerCase();
  const isAdmin = user && (roleLower === 'admin' || audienceLower === 'quản trị viên' || audienceLower === 'admin');
  const isTeacher = user && !isAdmin && (roleLower === 'teacher' || roleLower === 'giáo viên' || audienceLower === 'giáo viên');
  const isStudent = user && !isAdmin && !isTeacher;

  try {
    try {
      await db.prepare("ALTER TABLE results ADD COLUMN cheat_warning_count INTEGER DEFAULT 0").run();
    } catch (e) {}
    try {
      await db.prepare("ALTER TABLE results ADD COLUMN ai_grading_summary TEXT").run();
    } catch (e) {}
    try {
      await db.prepare("ALTER TABLE results ADD COLUMN user_id TEXT").run();
    } catch (e) {}
    try {
      await db.prepare("ALTER TABLE results ADD COLUMN lop TEXT").run();
    } catch (e) {}
    try {
      await db.prepare("ALTER TABLE results ADD COLUMN don_vi TEXT").run();
    } catch (e) {}
    try {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          full_name TEXT,
          phone_number TEXT,
          gender TEXT,
          dob TEXT,
          address TEXT,
          donvi TEXT,
          lop TEXT,
          occupation TEXT,
          target_audience TEXT DEFAULT 'Học sinh',
          payment_status TEXT DEFAULT 'Chưa thanh toán',
          payment_method TEXT,
          is_active INTEGER DEFAULT 1,
          expiry_date TEXT,
          created_at TEXT
        )
      `).run();
    } catch (e) {}
    try {
      await db.prepare("ALTER TABLE users ADD COLUMN lop TEXT").run();
    } catch (e) {}

    // 1. Lấy chi tiết một bài nộp theo ID (cho modal xem chi tiết / chấm điểm)
    if (idParam) {
      let results: any[] = [];
      try {
        const res = await db.prepare(`
          SELECT 
            r.id, r.user_id, r.student_name, r.student_class, r.exam_name, r.exam_id, r.score, r.time_taken, 
            r.correct_count, r.total_questions, r.details, r.loai_thi_sinh, r.cheat_warning_count, 
            r.ai_grading_summary, r.created_at,
            COALESCE(u.lop, u2.lop, '') as lop,
            COALESCE(u.donvi, u.address, u2.donvi, u2.address, r.student_class, '') as don_vi
          FROM results r
          LEFT JOIN users u ON (r.user_id = u.id OR (r.user_id IS NULL AND (r.student_name = u.full_name OR r.student_name = u.id)))
          LEFT JOIN accounts a ON (r.user_id = a.id OR r.user_id = a.user_id OR (r.user_id IS NULL AND r.student_name = a.username))
          LEFT JOIN users u2 ON (a.user_id = u2.id)
          WHERE r.id = ?
        `).bind(idParam).all();
        results = res.results || [];
      } catch (err) {
        const res = await db.prepare(`SELECT * FROM results WHERE id = ?`).bind(idParam).all();
        results = res.results || [];
      }

      if (!results || results.length === 0) {
        return new Response(JSON.stringify({ data: null, error: "Không tìm thấy kết quả bài thi" }), { status: 404, headers: corsHeaders });
      }

      const row: any = results[0];

      if (isTeacher) {
        const { results: examRows } = await db.prepare(
          "SELECT id FROM exam_configs WHERE id = ? AND creator_id = ?"
        ).bind(row.exam_id, user.id).all();
        if (!examRows || examRows.length === 0) {
          return new Response(JSON.stringify({ data: null, error: "Bạn không có quyền xem chi tiết kết quả này" }), { status: 403, headers: corsHeaders });
        }
      } else if (isStudent) {
        const isOwner = (row.user_id && (row.user_id === user.id || row.user_id === user.user_id)) || (!row.user_id && row.student_name === user.full_name);
        if (!isOwner) {
          return new Response(JSON.stringify({ data: null, error: "Bạn chỉ có thể xem chi tiết bài thi của chính mình" }), { status: 403, headers: corsHeaders });
        }
      } else if (!user) {
        const { results: sharedCheck } = await db.prepare(
          "SELECT id FROM exam_configs WHERE id = ? AND (is_shared_results = 1 OR is_shared_results = 'true' OR is_shared_results = true)"
        ).bind(row.exam_id).all();
        if (!sharedCheck || sharedCheck.length === 0) {
          return new Response(JSON.stringify({ data: null, error: "Kết quả này không được công khai" }), { status: 403, headers: corsHeaders });
        }
      }

      return new Response(JSON.stringify({ data: parseResultRow(row, true), error: null }), { status: 200, headers: corsHeaders });
    }

    // 2. Chỉ đếm số lượng kết quả
    if (countOnly) {
      if (isAdmin) {
        const { results: countRows } = await db.prepare("SELECT COUNT(*) as cnt FROM results").all();
        const count = countRows && countRows.length > 0 ? Number((countRows[0] as any).cnt) || 0 : 0;
        return new Response(JSON.stringify({ count, error: null }), { status: 200, headers: corsHeaders });
      }

      if (isTeacher) {
        const { results: myExams } = await db.prepare("SELECT id FROM exam_configs WHERE creator_id = ?").bind(user.id).all();
        const examIds = (myExams || []).map((e: any) => String(e.id)).filter(Boolean);
        if (examIds.length === 0) {
          return new Response(JSON.stringify({ count: 0, error: null }), { status: 200, headers: corsHeaders });
        }
        const placeholders = examIds.map(() => '?').join(',');
        const { results: countRows } = await db.prepare(`SELECT COUNT(*) as cnt FROM results WHERE exam_id IN (${placeholders})`).bind(...examIds).all();
        const count = countRows && countRows.length > 0 ? Number((countRows[0] as any).cnt) || 0 : 0;
        return new Response(JSON.stringify({ count, error: null }), { status: 200, headers: corsHeaders });
      }

      if (isStudent) {
        const studentUserId = user.user_id || user.id;
        const studentAccountId = user.id;
        const { results: countRows } = await db.prepare(
          "SELECT COUNT(*) as cnt FROM results WHERE user_id = ? OR user_id = ? OR (user_id IS NULL AND student_name = ?)"
        ).bind(studentAccountId, studentUserId, user.full_name).all();
        const count = countRows && countRows.length > 0 ? Number((countRows[0] as any).cnt) || 0 : 0;
        return new Response(JSON.stringify({ count, error: null }), { status: 200, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ count: 0, error: null }), { status: 200, headers: corsHeaders });
    }

    const columns = includeDetails
      ? "r.id, r.user_id, r.student_name, r.student_class, r.score, r.correct_count, r.total_questions, r.time_taken, r.exam_name, r.exam_id, r.created_at, r.loai_thi_sinh, r.cheat_warning_count, r.ai_grading_summary, COALESCE(u.lop, u2.lop, '') as lop, COALESCE(u.donvi, u.address, u2.donvi, u2.address, r.student_class, '') as don_vi, r.details"
      : "r.id, r.user_id, r.student_name, r.student_class, r.score, r.correct_count, r.total_questions, r.time_taken, r.exam_name, r.exam_id, r.created_at, r.loai_thi_sinh, r.cheat_warning_count, r.ai_grading_summary, COALESCE(u.lop, u2.lop, '') as lop, COALESCE(u.donvi, u.address, u2.donvi, u2.address, r.student_class, '') as don_vi";

    // 3. Tải danh sách kết quả theo mã chia sẻ đề thi (?examId=xxx)
    if (examIdParam) {
      if (!isAdmin && !isTeacher) {
        const { results: sharedExam } = await db.prepare(
          "SELECT id FROM exam_configs WHERE id = ? AND (is_shared_results = 1 OR is_shared_results = 'true' OR is_shared_results = true)"
        ).bind(examIdParam).all();
        if (!sharedExam || sharedExam.length === 0) {
          return new Response(JSON.stringify({ data: [], error: "Đề thi này không mở chia sẻ kết quả" }), { status: 403, headers: corsHeaders });
        }
      }

      let results: any[] = [];
      try {
        const res = await db.prepare(`
          SELECT ${columns} 
          FROM results r
          LEFT JOIN users u ON (r.user_id = u.id OR (r.user_id IS NULL AND (r.student_name = u.full_name OR r.student_name = u.id)))
          LEFT JOIN accounts a ON (r.user_id = a.id OR r.user_id = a.user_id OR (r.user_id IS NULL AND r.student_name = a.username))
          LEFT JOIN users u2 ON (a.user_id = u2.id)
          WHERE r.exam_id = ? 
          ORDER BY r.created_at DESC, r.id DESC 
          ${paginationClause}
        `).bind(examIdParam).all();
        results = res.results || [];
      } catch (err) {
        const res = await db.prepare(`SELECT * FROM results WHERE exam_id = ? ORDER BY created_at DESC, id DESC ${paginationClause}`).bind(examIdParam).all();
        results = res.results || [];
      }

      return makePaginatedResponse(results, includeDetails);
    }

    // 4. Tải danh sách kết quả tổng quát theo quyền người dùng
    if (isAdmin) {
      let results: any[] = [];
      try {
        const res = await db.prepare(`
          SELECT ${columns} 
          FROM results r
          LEFT JOIN users u ON (r.user_id = u.id OR (r.user_id IS NULL AND (r.student_name = u.full_name OR r.student_name = u.id)))
          LEFT JOIN accounts a ON (r.user_id = a.id OR r.user_id = a.user_id OR (r.user_id IS NULL AND r.student_name = a.username))
          LEFT JOIN users u2 ON (a.user_id = u2.id)
          ORDER BY r.created_at DESC, r.id DESC 
          ${paginationClause}
        `).all();
        results = res.results || [];
      } catch (err) {
        const res = await db.prepare(`SELECT * FROM results ORDER BY created_at DESC, id DESC ${paginationClause}`).all();
        results = res.results || [];
      }

      return makePaginatedResponse(results, includeDetails);
    }

    if (isTeacher) {
      const { results: myExams } = await db.prepare("SELECT id FROM exam_configs WHERE creator_id = ?").bind(user.id).all();
      const examIds = (myExams || []).map((e: any) => String(e.id)).filter(Boolean);
      if (examIds.length === 0) {
        return makePaginatedResponse([], includeDetails);
      }

      const placeholders = examIds.map(() => '?').join(',');
      let results: any[] = [];
      try {
        const res = await db.prepare(`
          SELECT ${columns} 
          FROM results r
          LEFT JOIN users u ON (r.user_id = u.id OR (r.user_id IS NULL AND (r.student_name = u.full_name OR r.student_name = u.id)))
          LEFT JOIN accounts a ON (r.user_id = a.id OR r.user_id = a.user_id OR (r.user_id IS NULL AND r.student_name = a.username))
          LEFT JOIN users u2 ON (a.user_id = u2.id)
          WHERE r.exam_id IN (${placeholders}) 
          ORDER BY r.created_at DESC, r.id DESC 
          ${paginationClause}
        `).bind(...examIds).all();
        results = res.results || [];
      } catch (err) {
        const res = await db.prepare(`SELECT * FROM results WHERE exam_id IN (${placeholders}) ORDER BY created_at DESC, id DESC ${paginationClause}`).bind(...examIds).all();
        results = res.results || [];
      }

      return makePaginatedResponse(results, includeDetails);
    }

    if (isStudent) {
      const studentUserId = user.user_id || user.id;
      const studentAccountId = user.id;
      let results: any[] = [];
      try {
        const res = await db.prepare(`
          SELECT ${columns} 
          FROM results r
          LEFT JOIN users u ON (r.user_id = u.id OR (r.user_id IS NULL AND (r.student_name = u.full_name OR r.student_name = u.id)))
          LEFT JOIN accounts a ON (r.user_id = a.id OR r.user_id = a.user_id OR (r.user_id IS NULL AND r.student_name = a.username))
          LEFT JOIN users u2 ON (a.user_id = u2.id)
          WHERE (r.user_id = ? OR r.user_id = ? OR (r.user_id IS NULL AND r.student_name = ?)) 
          ORDER BY r.created_at DESC, r.id DESC 
          ${paginationClause}
        `).bind(studentAccountId, studentUserId, user.full_name).all();
        results = res.results || [];
      } catch (err) {
        const res = await db.prepare(
          `SELECT * FROM results WHERE (user_id = ? OR user_id = ? OR (user_id IS NULL AND student_name = ?)) ORDER BY created_at DESC, id DESC ${paginationClause}`
        ).bind(studentAccountId, studentUserId, user.full_name).all();
        results = res.results || [];
      }

      return makePaginatedResponse(results, includeDetails);
    }

    return makePaginatedResponse([], includeDetails);

    // Khách vãng lai không đăng nhập: Không trả về toàn bộ kết quả bảng điểm nếu không truyền examId chia sẻ
    return new Response(JSON.stringify({ data: [], error: null }), { status: 200, headers: corsHeaders });

  } catch (e: any) {
    console.error("GET /api/results error:", e);
    return new Response(JSON.stringify({ data: [], error: e.message || 'Lỗi server' }), { status: 500, headers: corsHeaders });
  }
};

// PUT /api/results - Cập nhật điểm, chi tiết chấm thi của bài nộp
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  const { request, env } = context;
  const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
  const authHeader = request.headers.get('Authorization');
  let user: any = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    user = await verifyJWT(token, SECRET);
  }

  const roleLower = String(user?.role || '').toLowerCase();
  const audienceLower = String(user?.target_audience || '').toLowerCase();
  const isAdmin = user && (roleLower === 'admin' || audienceLower === 'quản trị viên' || audienceLower === 'admin');
  const isTeacher = user && !isAdmin && (roleLower === 'teacher' || roleLower === 'giáo viên' || audienceLower === 'giáo viên');

  if (!isAdmin && !isTeacher) {
    return new Response(JSON.stringify({ error: "Chỉ giáo viên hoặc admin mới có quyền chỉnh sửa/chấm lại điểm" }), { status: 403, headers: corsHeaders });
  }

  try {
    const body: any = await request.json();
    const { id, score, correct_count, details } = body;

    if (!id) {
      return new Response(JSON.stringify({ error: "Thiếu ID bài thi cần cập nhật" }), { status: 400, headers: corsHeaders });
    }

    // Kiểm tra quyền sở hữu bài thi nếu là giáo viên
    if (isTeacher && !isAdmin) {
      const { results: checkRows } = await db.prepare(
        "SELECT r.id FROM results r JOIN exam_configs e ON (r.exam_id = e.id OR r.exam_name = e.name) WHERE r.id = ? AND e.creator_id = ?"
      ).bind(id, user.id).all();

      if (!checkRows || checkRows.length === 0) {
        return new Response(JSON.stringify({ error: "Bạn không có quyền cập nhật điểm cho bài thi này" }), { status: 403, headers: corsHeaders });
      }
    }

    const safeDetails = typeof details === 'object' ? JSON.stringify(details) : (details || '[]');
    await db.prepare(
      "UPDATE results SET score = ?, correct_count = ?, details = ? WHERE id = ?"
    ).bind(Number(score) || 0, Number(correct_count) || 0, safeDetails, id).run();

    return new Response(JSON.stringify({ success: true, message: "Đã cập nhật điểm thành công", error: null }), { status: 200, headers: corsHeaders });
  } catch (e: any) {
    console.error("PUT /api/results error:", e);
    return new Response(JSON.stringify({ error: e.message || 'Lỗi server', success: false }), { status: 500, headers: corsHeaders });
  }
};

// DELETE /api/results - Xóa kết quả bài thi
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  const { request, env } = context;
  const url = new URL(request.url);
  const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
  const authHeader = request.headers.get('Authorization');
  let user: any = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    user = await verifyJWT(token, SECRET);
  }

  const roleLower = String(user?.role || '').toLowerCase();
  const audienceLower = String(user?.target_audience || '').toLowerCase();
  const isAdmin = user && (roleLower === 'admin' || audienceLower === 'quản trị viên' || audienceLower === 'admin');
  const isTeacher = user && !isAdmin && (roleLower === 'teacher' || roleLower === 'giáo viên' || audienceLower === 'giáo viên');

  if (!isAdmin && !isTeacher) {
    return new Response(JSON.stringify({ error: "Chỉ giáo viên hoặc admin mới có quyền xóa kết quả thi" }), { status: 403, headers: corsHeaders });
  }

  try {
    let ids: string[] = [];
    const idParam = url.searchParams.get('id');
    const clearAll = url.searchParams.get('clearAll') === 'true';

    if (clearAll) {
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Chỉ quản trị viên mới có quyền xóa toàn bộ kết quả" }), { status: 403, headers: corsHeaders });
      }
      await db.prepare("DELETE FROM results").run();
      return new Response(JSON.stringify({ success: true, message: "Đã xóa toàn bộ kết quả", error: null }), { status: 200, headers: corsHeaders });
    }

    if (idParam) {
      ids = [idParam];
    } else {
      const body: any = await request.json().catch(() => ({}));
      if (Array.isArray(body?.ids)) ids = body.ids;
      else if (body?.id) ids = [body.id];
    }

    if (ids.length === 0) {
      return new Response(JSON.stringify({ error: "Thiếu ID kết quả cần xóa" }), { status: 400, headers: corsHeaders });
    }

    for (const id of ids) {
      if (isAdmin) {
        await db.prepare("DELETE FROM results WHERE id = ?").bind(id).run();
      } else {
        // Giáo viên chỉ xóa kết quả của đề do mình tạo
        const { results: checkRows } = await db.prepare(
          "SELECT r.id FROM results r JOIN exam_configs e ON (r.exam_id = e.id OR r.exam_name = e.name) WHERE r.id = ? AND e.creator_id = ?"
        ).bind(id, user.id).all();
        if (checkRows && checkRows.length > 0) {
          await db.prepare("DELETE FROM results WHERE id = ?").bind(id).run();
        }
      }
    }

    return new Response(JSON.stringify({ success: true, message: `Đã xóa ${ids.length} kết quả`, error: null }), { status: 200, headers: corsHeaders });
  } catch (e: any) {
    console.error("DELETE /api/results error:", e);
    return new Response(JSON.stringify({ error: e.message || 'Lỗi server' }), { status: 500, headers: corsHeaders });
  }
};
