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
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json'
};

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};

// GET /api/exams - Lấy danh sách cấu hình đề thi hoặc lấy chi tiết theo query ?id=xxx hoặc ?code=xxx
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  const { request, env } = context;
  const url = new URL(request.url);
  const idParam = url.searchParams.get('id');
  const codeParam = url.searchParams.get('code');
  const teacherIdParam = url.searchParams.get('teacherId');
  const forRanking = url.searchParams.get('forRanking') === 'true';
  const sharedOnly = url.searchParams.get('sharedOnly') === 'true';

  const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
  const authHeader = request.headers.get('Authorization');
  let user: any = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    user = await verifyJWT(token, SECRET);
    if (user && (user.id || user.user_id)) {
      try {
        const { results: uRows } = await db.prepare(
          "SELECT donvi, lop, target_audience FROM users WHERE id = ? OR id = ?"
        ).bind(user.user_id || user.id, user.id).all();
        if (uRows && uRows.length > 0) {
          const u: any = uRows[0];
          if (u.donvi) user.donvi = u.donvi;
          if (u.lop) user.lop = u.lop;
          if (u.target_audience) user.target_audience = u.target_audience;
        }
      } catch (e) {}
    }
  }

  const isAdmin = checkIsAdmin(user);
  const isTeacher = checkIsTeacherOrAdmin(user) && !isAdmin;

  const mapRowRead = (row: any) => {
    const mapped: any = {};
    for (const [key, val] of Object.entries(row)) {
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try { mapped[key] = JSON.parse(trimmed); } catch { mapped[key] = val; }
        } else { mapped[key] = val; }
      } else { mapped[key] = val; }
    }
    return mapped;
  };

  try {
    try {
      await db.prepare("ALTER TABLE exam_configs ADD COLUMN target_lop TEXT").run();
    } catch (e) {}
    try {
      await db.prepare("ALTER TABLE exam_configs ADD COLUMN lop TEXT").run();
    } catch (e) {}
    try {
      await db.prepare("ALTER TABLE exam_configs ADD COLUMN max_attempts INTEGER DEFAULT 0").run();
    } catch (e) {}
    try {
      await db.prepare("ALTER TABLE exam_configs ADD COLUMN keep_raw_score INTEGER DEFAULT 0").run();
    } catch (e) {}
    try {
      await db.prepare("ALTER TABLE exam_configs ADD COLUMN tieu_de_bai_thi TEXT").run();
    } catch (e) {}

    // 1. Lấy chi tiết một đề thi theo ID
    if (idParam) {
      const query = "SELECT * FROM exam_configs WHERE id = ?";
      const { results } = await db.prepare(query).bind(idParam).all();
      if (!results || results.length === 0) {
        return new Response(JSON.stringify({ data: null, error: "Không tìm thấy cấu hình đề thi" }), { status: 404, headers: corsHeaders });
      }
      const row: any = results[0];
      const mapped = {
        ...mapRowRead(row),
        target_lop: row.target_lop || row.lop || '',
        lop: row.target_lop || row.lop || '',
        is_shared_results: row.is_shared_results === 1 || row.is_shared_results === true || row.is_shared_results === 'true'
      };
      return new Response(JSON.stringify({ data: mapped, error: null }), { status: 200, headers: corsHeaders });
    }

    // 2. Tra cứu đề thi chia sẻ kết quả theo Code (Dành cho Học sinh / Khách tra cứu bảng điểm)
    if (codeParam) {
      const { results } = await db.prepare("SELECT * FROM exam_configs WHERE id = ?").bind(codeParam).all();
      if (!results || results.length === 0) {
        return new Response(JSON.stringify({ data: null, error: "Mã đề không tồn tại" }), { status: 404, headers: corsHeaders });
      }
      const row: any = results[0];
      const isShared = row.is_shared_results === 1 || row.is_shared_results === true || row.is_shared_results === 'true';
      if (!isShared && !isAdmin) {
        return new Response(JSON.stringify({ data: null, error: "Đề thi này không được phép chia sẻ kết quả" }), { status: 403, headers: corsHeaders });
      }
      const mapped = {
        ...mapRowRead(row),
        target_lop: row.target_lop || row.lop || '',
        lop: row.target_lop || row.lop || '',
        is_shared_results: isShared
      };
      return new Response(JSON.stringify({ data: mapped, error: null }), { status: 200, headers: corsHeaders });
    }

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

    // 3. Lấy danh sách đề thi theo quyền hạn (Lấy đầy đủ các cột bao gồm counts_detail, access_control)
    let query = "SELECT ec.*, u.donvi AS teacher_donvi FROM exam_configs ec LEFT JOIN users u ON ec.creator_id = u.id";
    const params: any[] = [];

    if (teacherIdParam) {
      query += " WHERE ec.creator_id = ?";
      params.push(teacherIdParam);
    } else if (sharedOnly) {
      query += " WHERE ec.is_shared_results = 1 OR ec.is_shared_results = 'true' OR ec.is_shared_results = true";
    } else if (isTeacher && !forRanking) {
      query += " WHERE ec.creator_id = ?";
      params.push(user.id);
    }

    query += ` ORDER BY ec.name ASC, ec.id ASC${paginationClause}`;
    const { results } = await db.prepare(query).bind(...params).all();
    const mappedResults = (results || []).map(mapRowRead).map((row: any) => ({
      ...row,
      teacher_donvi: row.teacher_donvi || '',
      target_lop: row.target_lop || row.lop || '',
      lop: row.target_lop || row.lop || '',
      time: row.time_limit,
      timeLimit: row.time_limit,
      count41: row.count_41,
      countTF4: row.count_tf4,
      countSQ: row.count_sq,
      countTL: row.count_tl,
      num_trac_nghiem: row.count_41,
      num_dung_sai: row.count_tf4,
      num_tra_loi_ngan: row.count_sq,
      num_tuluan: row.count_tl,
      is_shared_results: row.is_shared_results === 1 || row.is_shared_results === true || row.is_shared_results === 'true',
      isSharedResults: row.is_shared_results === 1 || row.is_shared_results === true || row.is_shared_results === 'true'
    }));

    let filteredResults = mappedResults;
    if (!isAdmin && !isTeacher) {
      filteredResults = mappedResults.filter((row: any) => {
        if (row.chedodethi === 'Đề cho đơn vị' || row.chedodethi === 'Đề thi cho đơn vị') {
          const teacherDonvi = String(row.teacher_donvi || '').trim().toLowerCase();
          let allowedUnits: string[] = [];
          if (row.access_control) {
            try {
              const ac = typeof row.access_control === 'string' ? JSON.parse(row.access_control || '{}') : row.access_control;
              if (ac && ac.allowedUnits) {
                allowedUnits = Array.isArray(ac.allowedUnits)
                  ? ac.allowedUnits.map((u: any) => String(u).trim().toLowerCase())
                  : [String(ac.allowedUnits).trim().toLowerCase()];
              }
            } catch(e) {}
          }

          let isSameDonVi = false;
          if (!teacherDonvi && allowedUnits.length === 0) {
            isSameDonVi = true;
          } else if (user) {
            const userDonvi = String(user.donvi || user.address || '').trim().toLowerCase();
            if (teacherDonvi && userDonvi && (userDonvi === teacherDonvi || userDonvi.includes(teacherDonvi) || teacherDonvi.includes(userDonvi))) {
              isSameDonVi = true;
            } else if (allowedUnits.some((au: string) => au && (au === userDonvi || userDonvi.includes(au) || au.includes(userDonvi)))) {
              isSameDonVi = true;
            }
          }

          if (!isSameDonVi) {
            return false;
          }

          const targetLop = String(row.target_lop || row.lop || '').trim();
          if (!targetLop) {
            return true;
          }

          if (!user) return false;
          const normalizeLop = (s: string) => String(s || '').trim().toLowerCase().replace(/\s+/g, '');
          const userLop = normalizeLop(user.lop || '');
          const allowedLops = targetLop.split(',').map((s: string) => normalizeLop(s)).filter(Boolean);
          return allowedLops.includes(userLop);
        }
        return true;
      });
    }

    const allCreatorIds = [...new Set((mappedResults || []).map((row: any) => row.creator_id || row.creatorId).filter(Boolean))];
    return new Response(JSON.stringify({ 
      data: filteredResults, 
      allCreatorIds, 
      total: filteredResults.length,
      limit,
      offset,
      has_more: limit > 0 && mappedResults.length === limit,
      error: null 
    }), { status: 200, headers: corsHeaders });
  } catch (e: any) {
    console.warn("GET /api/exams fallback:", e.message || e);
    // Fail closed: never fabricate exams after a database error.
    return new Response(JSON.stringify({ data: null, error: 'Không thể tải danh sách đề thi từ cơ sở dữ liệu.' }), {
      status: 503, headers: corsHeaders
    });
  }
};

// POST /api/exams - Tạo mới hoặc Cập nhật cấu hình đề thi
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  const { request, env } = context;
  const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }
  const token = authHeader.substring(7);
  const user = await verifyJWT(token, SECRET);
  if (!user) {
    return new Response(JSON.stringify({ error: "Phiên đăng nhập không hợp lệ" }), { status: 401, headers: corsHeaders });
  }

  const isAdmin = checkIsAdmin(user);
  const isTeacher = checkIsTeacherOrAdmin(user);
  if (!isTeacher) {
    return new Response(JSON.stringify({ error: "Chỉ giáo viên hoặc admin mới có quyền lưu cấu hình đề thi" }), { status: 403, headers: corsHeaders });
  }

  try {
    const body: any = await request.json();
    const {
      id,
      name,
      creator_id,
      creatorId
    } = body;

    if (!name || !name.trim()) {
      return new Response(JSON.stringify({ error: "Tên đề thi không được để trống" }), { status: 400, headers: corsHeaders });
    }

    const assignedCreatorId = (isAdmin && (creator_id || creatorId)) ? (creator_id || creatorId) : user.id;
    // The server, not the client, controls ownership of new records.
    if (!assignedCreatorId) return new Response(JSON.stringify({error:'Không xác định được tài khoản tạo đề'}), {status:403,headers:corsHeaders});
    const timeLimitVal = Number(body.time_limit ?? body.timeLimit ?? body.time ?? 45) || 45;
    const count41Val = Number(body.count_41 ?? body.count41 ?? body.num_trac_nghiem ?? 0) || 0;
    const countTF4Val = Number(body.count_tf4 ?? body.countTF4 ?? body.num_dung_sai ?? 0) || 0;
    const countSQVal = Number(body.count_sq ?? body.countSQ ?? body.num_tra_loi_ngan ?? 0) || 0;
    const countTLVal = Number(body.count_tl ?? body.countTL ?? body.num_tuluan ?? 0) || 0;
    const points41Val = Number(body.points_41 ?? body.points41 ?? 1) || 1;
    const pointsTF4Val = Number(body.points_tf4 ?? body.pointsTF4 ?? 1) || 1;
    const pointsSQVal = Number(body.points_sq ?? body.pointsSQ ?? 1) || 1;
    const pointsTLVal = Number(body.points_tl ?? body.pointsTL ?? 1) || 1;

    const safeSelectedLessons = typeof body.selected_lessons === 'object' ? JSON.stringify(body.selected_lessons) : (typeof body.selectedLessons === 'object' ? JSON.stringify(body.selectedLessons) : (body.selected_lessons || body.selectedLessons || '[]'));
    const safeAccessControl = typeof body.access_control === 'object' ? JSON.stringify(body.access_control) : (typeof body.accessControl === 'object' ? JSON.stringify(body.accessControl) : (body.access_control || body.accessControl || null));
    const safeTf4Points = typeof body.tf4_points === 'object' ? JSON.stringify(body.tf4_points) : (typeof body.tf4Points === 'object' ? JSON.stringify(body.tf4Points) : (body.tf4_points || body.tf4Points || null));
    const safeCountsDetail = typeof body.counts_detail === 'object' ? JSON.stringify(body.counts_detail) : (typeof body.countsDetail === 'object' ? JSON.stringify(body.countsDetail) : (body.counts_detail || body.countsDetail || null));
    const safeIsShared = (body.is_shared_results || body.isSharedResults) ? 1 : 0;
    const safeImmediateFeedback = (body.immediate_feedback || body.immediateFeedback) ? 1 : 0;
    const safeShowScore = (body.show_score ?? body.showScore ?? 1) ? 1 : 0;
    const safeShowDetails = (body.show_details ?? body.showDetails ?? 1) ? 1 : 0;
    const safeSqCaseSensitive = (body.sq_case_sensitive || body.sqCaseSensitive) ? 1 : 0;
    const safeSqPunctuationSensitive = (body.sq_punctuation_sensitive || body.sqPunctuationSensitive) ? 1 : 0;
    const safeAutoGradeEssay = (body.auto_grade_essay ?? body.autoGradeEssay ?? 1) ? 1 : 0;
    const safeTf4ScoringMode = (body.tf4_scoring_mode ?? body.tf4ScoringMode ?? 0) ? 1 : 0;
    const maxAttemptsVal = Math.max(0, Number(body.max_attempts ?? body.maxAttempts ?? 0) || 0);
    const chedodethiVal = body.chedodethi || 'Đề công khai';
    const mabaomatdethiVal = body.mabaomatdethi || '';
    const targetLopVal = (body.target_lop ?? body.targetLop ?? body.lop ?? '').trim();
    const tgBdVal = body.tg_bd || null;
    const tgKtVal = body.tg_kt || null;
    const aiPromptVal = body.ai_prompt ?? body.aiPrompt ?? '';
    const aiGradingKeyVal = body.ai_grading_key ?? body.aiGradingKey ?? null;
    const tieuDeBaiThiVal = (body.tieu_de_bai_thi ?? body.tieuDeBaiThi ?? '').trim();
    const safeKeepRawScore = (body.keep_raw_score || body.keepRawScore) ? 1 : 0;
    const now = new Date().toISOString();

    // Kiểm tra xem đề đã tồn tại chưa (theo id hoặc theo name + creator_id)
    let existingRecord: any = null;
    if (id) {
      const { results } = await db.prepare("SELECT id, creator_id FROM exam_configs WHERE id = ?").bind(id).all();
      if (results && results.length > 0) existingRecord = results[0];
    } else {
      const { results } = await db.prepare("SELECT id, creator_id FROM exam_configs WHERE name = ? AND creator_id = ?").bind(name.trim(), assignedCreatorId).all();
      if (results && results.length > 0) existingRecord = results[0];
    }

    if (existingRecord) {
      // Kiểm tra quyền sửa
      if (!isAdmin && existingRecord.creator_id !== user.id) {
        return new Response(JSON.stringify({ error: "Bạn không có quyền chỉnh sửa đề thi của người khác" }), { status: 403, headers: corsHeaders });
      }

      const updateSql = `
        UPDATE exam_configs SET
          name = ?, time_limit = ?, count_41 = ?, count_tf4 = ?, count_sq = ?, count_tl = ?,
          points_41 = ?, points_tf4 = ?, points_sq = ?, points_tl = ?,
          selected_lessons = ?, tf4_scoring_mode = ?, tf4_points = ?, access_control = ?,
          immediate_feedback = ?, show_score = ?, show_details = ?,
          sq_case_sensitive = ?, sq_punctuation_sensitive = ?, auto_grade_essay = ?,
          counts_detail = ?, chedodethi = ?, mabaomatdethi = ?, target_lop = ?, lop = ?, tg_bd = ?, tg_kt = ?,
          ai_prompt = ?, ai_grading_key = ?, tieu_de_bai_thi = ?, is_shared_results = ?, max_attempts = ?, keep_raw_score = ?, updated_at = ?
        WHERE id = ?
      `;

      await db.prepare(updateSql).bind(
        name.trim(), timeLimitVal, count41Val, countTF4Val, countSQVal, countTLVal,
        points41Val, pointsTF4Val, pointsSQVal, pointsTLVal,
        safeSelectedLessons, safeTf4ScoringMode, safeTf4Points, safeAccessControl,
        safeImmediateFeedback, safeShowScore, safeShowDetails,
        safeSqCaseSensitive, safeSqPunctuationSensitive, safeAutoGradeEssay,
        safeCountsDetail, chedodethiVal, mabaomatdethiVal, targetLopVal, targetLopVal, tgBdVal, tgKtVal,
        aiPromptVal, aiGradingKeyVal, tieuDeBaiThiVal, safeIsShared, maxAttemptsVal, safeKeepRawScore, now, existingRecord.id
      ).run();

      return new Response(JSON.stringify({ success: true, type: 'updated', id: existingRecord.id, error: null }), { status: 200, headers: corsHeaders });
    } else {
      // Tạo mới
      const newId = crypto.randomUUID();
      const insertSql = `
        INSERT INTO exam_configs (
          id, name, creator_id, time_limit, count_41, count_tf4, count_sq, count_tl,
          points_41, points_tf4, points_sq, points_tl,
          selected_lessons, tf4_scoring_mode, tf4_points, access_control,
          immediate_feedback, show_score, show_details,
          sq_case_sensitive, sq_punctuation_sensitive, auto_grade_essay,
          counts_detail, chedodethi, mabaomatdethi, target_lop, lop, tg_bd, tg_kt,
          ai_prompt, is_shared_results, ai_grading_key, max_attempts, keep_raw_score, tieu_de_bai_thi, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await db.prepare(insertSql).bind(
        newId, name.trim(), assignedCreatorId, timeLimitVal, count41Val, countTF4Val, countSQVal, countTLVal,
        points41Val, pointsTF4Val, pointsSQVal, pointsTLVal,
        safeSelectedLessons, safeTf4ScoringMode, safeTf4Points, safeAccessControl,
        safeImmediateFeedback, safeShowScore, safeShowDetails,
        safeSqCaseSensitive, safeSqPunctuationSensitive, safeAutoGradeEssay,
        safeCountsDetail, chedodethiVal, mabaomatdethiVal, targetLopVal, targetLopVal, tgBdVal, tgKtVal,
        aiPromptVal, safeIsShared, aiGradingKeyVal, maxAttemptsVal, safeKeepRawScore, tieuDeBaiThiVal, now, now
      ).run();

      return new Response(JSON.stringify({ success: true, type: 'inserted', id: newId, error: null }), { status: 200, headers: corsHeaders });
    }
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || "Lỗi lưu đề thi", success: false }), { status: 500, headers: corsHeaders });
  }
};

// DELETE /api/exams - Xóa cấu hình đề thi theo query ?id=xxx hoặc body { id }
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  const { request, env } = context;
  const url = new URL(request.url);
  let id = url.searchParams.get('id');

  if (!id) {
    try {
      const body: any = await request.json();
      id = body?.id;
    } catch {}
  }

  if (!id) {
    return new Response(JSON.stringify({ error: "Thiếu ID đề thi cần xóa" }), { status: 400, headers: corsHeaders });
  }

  const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }
  const token = authHeader.substring(7);
  const user = await verifyJWT(token, SECRET);
  if (!user) {
    return new Response(JSON.stringify({ error: "Phiên đăng nhập không hợp lệ" }), { status: 401, headers: corsHeaders });
  }

  const isAdmin = user.role === 'admin';

  try {
    let checkSql = "SELECT id, creator_id FROM exam_configs WHERE id = ?";
    const { results } = await db.prepare(checkSql).bind(id).all();
    if (!results || results.length === 0) {
      return new Response(JSON.stringify({ error: "Không tìm thấy đề thi" }), { status: 404, headers: corsHeaders });
    }

    const exam: any = results[0];
    if (!isAdmin && exam.creator_id !== user.id) {
      return new Response(JSON.stringify({ error: "Bạn không có quyền xóa đề thi này" }), { status: 403, headers: corsHeaders });
    }

    await db.prepare("DELETE FROM exam_configs WHERE id = ?").bind(id).run();
    return new Response(JSON.stringify({ success: true, message: "Đã xóa đề thi thành công", error: null }), { status: 200, headers: corsHeaders });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || "Lỗi xóa đề thi" }), { status: 500, headers: corsHeaders });
  }
};
