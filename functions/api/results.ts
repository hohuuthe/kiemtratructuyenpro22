import {buildRankingResultsDeletion,RankingResultDeleteError} from '../../src/ranking-result-delete-policy.js';
import { verifyAuthSession, getDynamicSecret, getDatabase } from './exam/utils';
import { processExamResultsDeletion } from '../../src/exam-results-delete-service';
import { listExamResultsDeletionTargets } from '../../src/exam-results-targets-service';
import { ExamResultsDeletionError } from '../../src/exam-results-delete-policy';
import { clampScore, roundScore } from '../../src/exam-grading-core.js';

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
  'Content-Type': 'application/json',
  'Cache-Control': 'private, no-store'
};

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { status: 204, headers: corsHeaders });
};

// Helper parse details JSON
function parseResultRow(row: any, includeDetails = false, hidePendingScore = false) {
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

  const gradingStatus = String(row.grading_status || 'FINAL').trim().toUpperCase() || 'FINAL';
  const scoreFinalized = gradingStatus !== 'PENDING' && gradingStatus !== 'REVIEW_REQUIRED';
  const exposeScore = !hidePendingScore || scoreFinalized;

  return {
    id: row.id,
    user_id: row.user_id || '',
    userId: row.user_id || '',
    student_name: row.student_name,
    student_class: row.student_class,
    lop: lop,
    don_vi: donVi,
    donvi: donVi,
    score: exposeScore ? row.score : null,
    correct_count: exposeScore ? row.correct_count : null,
    total_questions: row.total_questions,
    time_taken: row.time_taken,
    exam_name: row.exam_name,
    exam_id: row.exam_id,
    ...(Object.prototype.hasOwnProperty.call(row, 'exam_creator_id')
      ? { exam_creator_id: row.exam_creator_id || '' } : {}),
    created_at: row.created_at,
    loai_thi_sinh: row.loai_thi_sinh,
    cheat_warning_count: Number(row.cheat_warning_count) || 0,
    cheatWarningCount: Number(row.cheat_warning_count) || 0,
    ai_grading_summary: row.ai_grading_summary || null,
    grading_status: gradingStatus,
    score_finalized: scoreFinalized,
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

  function makePaginatedResponse(rawResults: any[], incDetails: boolean, hidePendingScore = false) {
    const data = (rawResults || []).map((r: any) => parseResultRow(r, incDetails, hidePendingScore));
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
    user = await verifyAuthSession(token, SECRET, db);
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
      await db.prepare("ALTER TABLE results ADD COLUMN IF NOT EXISTS grading_status TEXT DEFAULT 'FINAL'").run();
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

    // Student requests are confined to the private, authenticated endpoint.
    // Never serve shared-exam rosters or legacy lists to logged-in students.
    if (isStudent) {
      return new Response(JSON.stringify({ error: 'Sử dụng API kết quả cá nhân.' }), {
        status: 403, headers: { ...corsHeaders, 'Cache-Control': 'no-store' }
      });
    }

    // 1. Lấy chi tiết một bài nộp theo ID (cho modal xem chi tiết / chấm điểm)
    // Detailed attempts are private: students use /api/results/me and teachers/admin
    // use this endpoint with verified authorization. Public sharing is summary-only.
    if (idParam && !user) {
      return new Response(JSON.stringify({
        data: null,
        error: "Chi tiết bài làm không được công khai. Vui lòng đăng nhập bằng tài khoản có quyền."
      }), { status: 403, headers: corsHeaders });
    }
    if (idParam) {
      let results: any[] = [];
      try {
        const res = await db.prepare(`
          SELECT 
            r.id, r.user_id, r.student_name, r.student_class, r.exam_name, r.exam_id, r.score, r.time_taken, 
            r.correct_count, r.total_questions, r.details, r.loai_thi_sinh, r.cheat_warning_count, 
            r.ai_grading_summary, r.grading_status, r.created_at,
            COALESCE(u.lop, u2.lop, '') as lop,
            COALESCE(u.donvi, u.address, u2.donvi, u2.address, r.student_class, '') as don_vi
          FROM results r
          LEFT JOIN users u ON r.user_id = u.id
          LEFT JOIN accounts a ON (r.user_id = a.id OR r.user_id = a.user_id)
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
          "SELECT id FROM exam_configs WHERE id = ? AND creator_id IN (?, ?)"
        ).bind(row.exam_id, user.id, user.user_id || user.id).all();
        if (!examRows || examRows.length === 0) {
          return new Response(JSON.stringify({ data: null, error: "Bạn không có quyền xem chi tiết kết quả này" }), { status: 403, headers: corsHeaders });
        }
      } else if (isStudent) {
        const isOwner = !!row.user_id && (String(row.user_id) === String(user.id) || String(row.user_id) === String(user.user_id));
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
        const { results: myExams } = await db.prepare("SELECT id FROM exam_configs WHERE creator_id IN (?, ?)").bind(user.id, user.user_id || user.id).all();
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
          "SELECT COUNT(*) as cnt FROM results WHERE user_id = ? OR user_id = ?"
        ).bind(studentAccountId, studentUserId).all();
        const count = countRows && countRows.length > 0 ? Number((countRows[0] as any).cnt) || 0 : 0;
        return new Response(JSON.stringify({ count, error: null }), { status: 200, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ count: 0, error: null }), { status: 200, headers: corsHeaders });
    }

    const columns = includeDetails
      ? "r.id, r.user_id, r.student_name, r.student_class, r.score, r.correct_count, r.total_questions, r.time_taken, r.exam_name, r.exam_id, r.created_at, r.loai_thi_sinh, r.cheat_warning_count, r.ai_grading_summary, r.grading_status, COALESCE(u.lop, u2.lop, '') as lop, COALESCE(u.donvi, u.address, u2.donvi, u2.address, r.student_class, '') as don_vi, r.details"
      : "r.id, r.user_id, r.student_name, r.student_class, r.score, r.correct_count, r.total_questions, r.time_taken, r.exam_name, r.exam_id, r.created_at, r.loai_thi_sinh, r.cheat_warning_count, r.ai_grading_summary, r.grading_status, COALESCE(u.lop, u2.lop, '') as lop, COALESCE(u.donvi, u.address, u2.donvi, u2.address, r.student_class, '') as don_vi";

    // 3. Tải danh sách kết quả theo mã chia sẻ đề thi (?examId=xxx)
    if (examIdParam && !user && includeDetails) {
      return new Response(JSON.stringify({
        data: [],
        error: "Kết quả chia sẻ công khai chỉ cung cấp thông tin tổng quan, không cung cấp chi tiết bài làm."
      }), { status: 403, headers: corsHeaders });
    }
    if (examIdParam) {
      if (isTeacher) {
        // A shared result code does not grant access to another teacher's
        // submissions. Verify immutable creator ID before reading any rows.
        const { results: ownExams } = await db.prepare(
          "SELECT id FROM exam_configs WHERE id = ? AND creator_id IN (?, ?)"
        ).bind(examIdParam, user.id, user.user_id || user.id).all();
        if (!ownExams?.length)
          return new Response(JSON.stringify({data:[],error:'Không có quyền xem đề thi này'}),
            {status:403,headers:corsHeaders});
      }
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
          LEFT JOIN users u ON r.user_id = u.id
          LEFT JOIN accounts a ON (r.user_id = a.id OR r.user_id = a.user_id)
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

      return makePaginatedResponse(results, includeDetails, !user);
    }

    // 4. Tải danh sách kết quả tổng quát theo quyền người dùng
    if (isAdmin) {
      let results: any[] = [];
      try {
        const res = await db.prepare(`
          SELECT ${columns}, (SELECT e.creator_id FROM exam_configs e WHERE e.id = r.exam_id LIMIT 1) AS exam_creator_id 
          FROM results r
          LEFT JOIN users u ON r.user_id = u.id
          LEFT JOIN accounts a ON (r.user_id = a.id OR r.user_id = a.user_id)
          LEFT JOIN users u2 ON (a.user_id = u2.id)
          ORDER BY r.created_at DESC, r.id DESC 
          ${paginationClause}
        `).all();
        results = res.results || [];
      } catch (err) {
        const res = await db.prepare(`SELECT r.*, (SELECT e.creator_id FROM exam_configs e WHERE e.id = r.exam_id LIMIT 1) AS exam_creator_id FROM results r ORDER BY r.created_at DESC, r.id DESC ${paginationClause}`).all();
        results = res.results || [];
      }

      return makePaginatedResponse(results, includeDetails);
    }

    if (isTeacher) {
      const { results: myExams } = await db.prepare("SELECT id FROM exam_configs WHERE creator_id IN (?, ?)").bind(user.id, user.user_id || user.id).all();
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
          LEFT JOIN users u ON r.user_id = u.id
          LEFT JOIN accounts a ON (r.user_id = a.id OR r.user_id = a.user_id)
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
          LEFT JOIN users u ON r.user_id = u.id
          LEFT JOIN accounts a ON (r.user_id = a.id OR r.user_id = a.user_id)
          LEFT JOIN users u2 ON (a.user_id = u2.id)
          WHERE (r.user_id = ? OR r.user_id = ?) 
          ORDER BY r.created_at DESC, r.id DESC 
          ${paginationClause}
        `).bind(studentAccountId, studentUserId).all();
        results = res.results || [];
      } catch (err) {
        const res = await db.prepare(
          `SELECT * FROM results WHERE (user_id = ? OR user_id = ?) ORDER BY created_at DESC, id DESC ${paginationClause}`
        ).bind(studentAccountId, studentUserId).all();
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

// PUT /api/results - Cập nhật điểm tự luận; server giữ toàn quyền tính tổng điểm
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  const { request, env } = context;
  const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
  const authHeader = request.headers.get('Authorization');
  let user: any = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    user = await verifyAuthSession(authHeader.substring(7), SECRET, db);
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
    const id = String(body?.id || '').trim();
    if (!id) {
      return new Response(JSON.stringify({ error: "Thiếu ID bài thi cần cập nhật" }), { status: 400, headers: corsHeaders });
    }

    const stored: any = await db.prepare(`
      SELECT r.id, r.details, r.exam_id, e.creator_id, e.points_tl
      FROM results r
      LEFT JOIN exam_configs e ON r.exam_id = e.id
      WHERE r.id = ?
      LIMIT 1
    `).bind(id).first();
    if (!stored) {
      return new Response(JSON.stringify({ error: "Không tìm thấy bài thi cần cập nhật" }), { status: 404, headers: corsHeaders });
    }

    if (isTeacher && !isAdmin) {
      const identities = new Set([String(user.id || ''), String(user.user_id || '')].filter(Boolean));
      if (!identities.has(String(stored.creator_id || ''))) {
        return new Response(JSON.stringify({ error: "Bạn không có quyền cập nhật điểm cho bài thi này" }), { status: 403, headers: corsHeaders });
      }
    }

    let storedDetails: any[] = [];
    try {
      storedDetails = Array.isArray(stored.details) ? stored.details : JSON.parse(String(stored.details || '[]'));
    } catch {
      return new Response(JSON.stringify({ error: "Chi tiết bài thi trong CSDL bị lỗi cấu trúc; không được phép ghi đè." }), { status: 409, headers: corsHeaders });
    }
    if (!Array.isArray(storedDetails) || storedDetails.length === 0) {
      return new Response(JSON.stringify({ error: "Bài thi không có chi tiết chấm điểm hợp lệ." }), { status: 409, headers: corsHeaders });
    }

    const incomingDetails = Array.isArray(body?.details) ? body.details : [];
    if (incomingDetails.length !== storedDetails.length) {
      return new Response(JSON.stringify({ error: "Số lượng chi tiết câu hỏi không khớp bài làm gốc." }), { status: 400, headers: corsHeaders });
    }

    const updatedDetails = storedDetails.map((storedDetail: any, index: number) => {
      const type = String(storedDetail?.question?.type || '').toUpperCase();
      if (type !== 'TL') return storedDetail; // Objective scores are immutable here.

      const incoming = incomingDetails[index] || {};
      const storedQuestionId = String(
        storedDetail?.question?.id ?? storedDetail?.questionId ?? ''
      ).trim();
      const incomingQuestionId = String(
        incoming?.question?.id ?? incoming?.questionId ?? ''
      ).trim();
      if (!storedQuestionId || !incomingQuestionId || storedQuestionId !== incomingQuestionId) {
        throw new Error(`Câu tự luận tại vị trí ${index + 1} không khớp ID bài làm gốc; từ chối cập nhật điểm.`);
      }

      const rawMaxScore = Number(storedDetail.maxScore ?? stored.points_tl ?? 0);
      if (!Number.isFinite(rawMaxScore) || rawMaxScore < 0) {
        throw new Error('Không xác định được điểm tối đa của câu tự luận.');
      }
      // Normalize REAL-backed maximum score before validating an exact 4-decimal teacher score.
      const maxScore = roundScore(rawMaxScore, 4);
      const requestedScore = Number(incoming.score);
      if (!Number.isFinite(requestedScore) || requestedScore < 0 || requestedScore > maxScore ||
          Math.abs(requestedScore * 10000 - Math.round(requestedScore * 10000)) > 1e-7) {
        throw new Error(`Điểm tự luận tại vị trí ${index + 1} không hợp lệ, vượt thang điểm hoặc có quá 4 chữ số thập phân.`);
      }
      const score = roundScore(requestedScore, 4);
      const next = {
        ...storedDetail,
        score,
        maxScore,
        isCorrect: maxScore > 0 && score >= maxScore - 0.000001,
        needsGrading: false,
        gradingStatus: 'completed_manual'
      };
      if (typeof incoming.aiFeedback === 'string') next.aiFeedback = incoming.aiFeedback.slice(0, 20000);
      return next;
    });

    const canonicalScore = roundScore(
      updatedDetails.reduce((sum: number, d: any) => sum + (Number(d.score) || 0), 0),
      4
    );
    const canonicalCorrectCount = updatedDetails.filter((d: any) =>
      String(d?.question?.type || '').toUpperCase() !== 'TL' && d?.isCorrect === true
    ).length;

    for (const sql of [
      "ALTER TABLE results ADD COLUMN IF NOT EXISTS grading_status TEXT DEFAULT 'FINAL'",
      "ALTER TABLE results ADD COLUMN IF NOT EXISTS score_finalized_at TEXT"
    ]) {
      try { await db.prepare(sql).run(); } catch {}
    }
    await db.prepare(
      "UPDATE results SET score = ?, correct_count = ?, details = ?, grading_status = 'FINAL', score_finalized_at = ? WHERE id = ?"
    ).bind(canonicalScore, canonicalCorrectCount, JSON.stringify(updatedDetails), new Date().toISOString(), id).run();

    return new Response(JSON.stringify({
      success: true,
      score: canonicalScore,
      correct_count: canonicalCorrectCount,
      details: updatedDetails,
      message: "Đã cập nhật điểm thành công",
      error: null
    }), { status: 200, headers: corsHeaders });
  } catch (e: any) {
    console.error("PUT /api/results error:", e);
    return new Response(JSON.stringify({ error: e.message || 'Lỗi server', success: false }), { status: 500, headers: corsHeaders });
  }
};

// DELETE /api/results — atomic, role-scoped deletion by exact result IDs
export const onRequestDelete: PagesFunction<Env> = async context => {
  const headers={...corsHeaders,'Cache-Control':'no-store'};
  const reply=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers});
  try {
    const bearer=context.request.headers.get('Authorization')||'';
    if(!bearer.startsWith('Bearer '))return reply({error:'Phiên đăng nhập không hợp lệ'},401);
    const db=getDatabase(context);
    const user=await verifyAuthSession(bearer.slice(7),await getDynamicSecret(db,context.env.JWT_SECRET),db);
    if(!user)return reply({error:'Phiên đăng nhập không hợp lệ'},401);
    const url=new URL(context.request.url);
    if(url.searchParams.get('clearAll')==='true'){
      if(String(user.role||'').toLowerCase()!=='admin')return reply({error:'Chỉ quản trị viên có quyền xóa toàn bộ'},403);
      await db.prepare('DELETE FROM results').run();
      return reply({success:true,error:null});
    }
    const body:any=await context.request.json().catch(()=>({}));
    const ids=url.searchParams.get('id')?[url.searchParams.get('id')]:
      Array.isArray(body.ids)?body.ids:body.id?[body.id]:[];
    const operation=buildRankingResultsDeletion(ids,user);
    const response=await db.prepare(operation.sql).bind(...operation.params).run();
    const deleted=Number(response?.meta?.changes||0);
    if(deleted!==operation.count)return reply({error:'Không thể xác nhận quyền sở hữu hoặc dữ liệu đã thay đổi. Không xóa kết quả.',code:'RESULT_SCOPE_CHANGED'},409);
    return reply({success:true,deletedCount:deleted,error:null});
  }catch(e:any){
    if(e instanceof RankingResultDeleteError)return reply({error:e.message,code:e.code},e.status);
    console.error('DELETE results error',e);
    return reply({error:'Không thể xóa kết quả. Vui lòng kiểm tra lại.'},500);
  }
};

/**
 * POST /api/results/delete-by-exam
 * {action:'preview',examId} OR
 * {action:'delete',examId,confirmation:'1234',expectedCount}.
 *
 * Unlike general result deletion, this route never accepts clearAll or a
 * result-name selector; every statement is scoped to one verified exam ID.
 */
export const onRequestPostDeleteByExam: PagesFunction<Env> = async (context) => {
  const headers = { ...corsHeaders, 'Cache-Control': 'no-store' };
  const reply = (body: any, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });

  try {
    const { request, env } = context;
    const bearer = request.headers.get('Authorization') || '';
    if (!bearer.startsWith('Bearer ') || !bearer.slice(7).trim()) {
      return reply({ error: 'Vui lòng đăng nhập trước khi xóa kết quả.', code: 'AUTH_REQUIRED' }, 401);
    }
    const body = await request.json().catch(() => null);
    const db = getDatabase(context);
    const secret = await getDynamicSecret(db, env.JWT_SECRET);
    const user = await verifyAuthSession(bearer.slice(7), secret, db);
    if (!user) return reply({ error: 'Phiên đăng nhập không hợp lệ hoặc đã bị thu hồi.', code: 'AUTH_REQUIRED' }, 401);

    const adapter = {
      first: async (sql: string, params: unknown[]) => db.prepare(sql).bind(...params).first(),
      run: async (sql: string, params: unknown[]) => {
        const result = await db.prepare(sql).bind(...params).run();
        return { changes: Number(result?.meta?.changes) };
      }
    };
    return reply(await processExamResultsDeletion(adapter, user, body));
  } catch (err: any) {
    if (err instanceof ExamResultsDeletionError) {
      return reply({ error: err.message, code: err.code }, err.status);
    }
    console.error('POST /api/results/delete-by-exam failed:', err);
    return reply({ error: 'Không thể xử lý xóa kết quả đề thi. Dữ liệu cần được kiểm tra lại.', code: 'DELETE_FAILED' }, 500);
  }
};

export const onRequestPostExamDeletionTargets: PagesFunction<Env> = async context => {
  const headers = { ...corsHeaders, 'Cache-Control': 'no-store' };
  const reply = (body: any, status = 200) => new Response(JSON.stringify(body), {status,headers});
  try {
    const bearer = context.request.headers.get('Authorization') || '';
    if (!bearer.startsWith('Bearer ') || !bearer.slice(7).trim())
      return reply({error:'Vui lòng đăng nhập.',code:'AUTH_REQUIRED'},401);
    const body = await context.request.json().catch(() => null) as any;
    const db = getDatabase(context);
    const secret = await getDynamicSecret(db, context.env.JWT_SECRET);
    const user = await verifyAuthSession(bearer.slice(7),secret,db);
    if (!user) return reply({error:'Phiên đăng nhập không hợp lệ.',code:'AUTH_REQUIRED'},401);
    const adapter = {
      all: async (sql:string,params:unknown[]) => (await db.prepare(sql).bind(...params).all()).results || [],
      first: async (sql:string,params:unknown[]) => db.prepare(sql).bind(...params).first()
    };
    return reply(await listExamResultsDeletionTargets(adapter,user,body?.examName));
  } catch(err:any) {
    if (err instanceof ExamResultsDeletionError) return reply({error:err.message,code:err.code},err.status);
    console.error('exam deletion targets failed',err);
    return reply({error:'Không thể xác minh các mã đề.',code:'TARGET_LOOKUP_FAILED'},503);
  }
};
