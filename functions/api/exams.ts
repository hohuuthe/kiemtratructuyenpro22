import {EXAM_CREATOR_JOIN_SQL,EXAM_CREATOR_NAME_SQL} from '../../src/exam-creator-identity.js';
import { verifyAuthSession, getDynamicSecret, checkIsAdmin, checkIsTeacherOrAdmin, getDatabase } from './exam/utils';
import { isExamOwner, redactExamForPublic, examAccessChallenge, isProtectedExamForUser, protectedExamPreview } from './exam/security';
import { canManageExamConfig, examConfigGuardedDeleteStatement } from '../../src/exam-config-deletion-policy';
import { normalizeExamConfigInput, ExamConfigInputError } from '../../src/exam-config-contract';
import { validateStoredExamQuestionPool } from '../../src/exam-question-pool-validity';

interface Env {
  NEON_DATABASE_URL?: string;
  DATABASE_URL?: string;
  DB?: any;
  JWT_SECRET?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Exam-Access-Code',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
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
    user = await verifyAuthSession(token, SECRET, db);
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
    // Read-only hot path: do not run five ALTER TABLE statements for every
    // student selecting an exam. A zero-row projection checks legacy tenant schema
    // cheaply; only an older schema triggers the idempotent repair.
    try {
      await db.prepare(
        "SELECT target_lop, lop, max_attempts, keep_raw_score, tieu_de_bai_thi FROM exam_configs LIMIT 0"
      ).all();
    } catch {
      for (const ddl of [
        "ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS target_lop TEXT",
        "ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS lop TEXT",
        "ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 0",
        "ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS keep_raw_score INTEGER DEFAULT 0",
        "ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS tieu_de_bai_thi TEXT"
      ]) await db.prepare(ddl).run();
    }

    // 1. Lấy chi tiết một đề thi theo ID
    if (idParam) {
      const query = "SELECT * FROM exam_configs WHERE id = ?";
      const { results } = await db.prepare(query).bind(idParam).all();
      if (!results || results.length === 0) {
        return new Response(JSON.stringify({ data: null, error: "Không tìm thấy cấu hình đề thi" }), { status: 404, headers: corsHeaders });
      }
      const row: any = results[0];
      const accessCode = request.headers.get('X-Exam-Access-Code');
      const challenge = examAccessChallenge(user,row,accessCode);
      if (challenge) return new Response(JSON.stringify({data:null,...challenge}), {
        status:challenge.status,headers:corsHeaders
      });
      const ownsExam = isExamOwner(user, row);
      const mapped = {
        ...(ownsExam ? mapRowRead(row) : redactExamForPublic(mapRowRead(row))),
        target_lop: row.target_lop || row.lop || '',
        lop: row.target_lop || row.lop || '',
        is_shared_results: row.is_shared_results === 1 || row.is_shared_results === true || row.is_shared_results === 'true'
      };
      let questionPoolValidity: any = null;
      if (ownsExam && checkIsTeacherOrAdmin(user)) {
        try {
          questionPoolValidity = await validateStoredExamQuestionPool(db, mapRowRead(row), row.creator_id);
        } catch (validationError: any) {
          console.error('Cannot validate exam question pool:', validationError?.message || validationError);
          questionPoolValidity = {
            valid: false,
            code: 'EXAM_QUESTION_POOL_CHECK_UNAVAILABLE',
            examName: String(row.name || '').trim(),
            shortages: [],
            message: 'Không thể xác minh ngân hàng câu hỏi trực tiếp trên cơ sở dữ liệu. Đề chưa được coi là hợp lệ; vui lòng thử lại trước khi sử dụng.'
          };
        }
      }
      return new Response(JSON.stringify({ data: mapped, question_pool_validity: questionPoolValidity, server_now_ms: Date.now(), error: null }), { status: 200, headers: corsHeaders });
    }

    // 2. Tra cứu đề thi chia sẻ kết quả theo Code (Dành cho Học sinh / Khách tra cứu bảng điểm)
    if (codeParam) {
      const { results } = await db.prepare("SELECT * FROM exam_configs WHERE id = ?").bind(codeParam).all();
      if (!results || results.length === 0) {
        return new Response(JSON.stringify({ data: null, error: "Mã đề không tồn tại" }), { status: 404, headers: corsHeaders });
      }
      const row: any = results[0];
      // Shared result codes are for students/guests, not a way for a logged-in
      // teacher to enumerate another teacher's exam titles.
      if (isTeacher && !isExamOwner(user,row))
        return new Response(JSON.stringify({data:null,error:'Giáo viên chỉ được truy cập đề thi do mình tạo'}),{status:403,headers:corsHeaders});
      const isShared = row.is_shared_results === 1 || row.is_shared_results === true || row.is_shared_results === 'true';
      if (!isShared && !isAdmin) {
        return new Response(JSON.stringify({ data: null, error: "Đề thi này không được phép chia sẻ kết quả" }), { status: 403, headers: corsHeaders });
      }
      const mapped = {
        ...(isExamOwner(user, row) ? mapRowRead(row) : redactExamForPublic(mapRowRead(row))),
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
    // Count persisted submissions by exact exam ID, never by a repeated title.
    // The teacher projection remains NULL for exams outside that teacher's ownership.
    const attemptCountProjection = isAdmin
      ? ", (SELECT COUNT(*) FROM results r WHERE r.exam_id = ec.id) AS attempt_count"
      : isTeacher
        ? ", CASE WHEN ec.creator_id IN (?, ?) THEN (SELECT COUNT(*) FROM results r WHERE r.exam_id = ec.id) ELSE NULL END AS attempt_count"
        : "";
    let query = "SELECT ec.*, creator_profile.donvi AS teacher_donvi, "+EXAM_CREATOR_NAME_SQL+" AS creator_name" + attemptCountProjection +
      " FROM exam_configs ec " + EXAM_CREATOR_JOIN_SQL;
    const params: any[] = isTeacher ? [user.id, user.user_id || user.id] : [];

    if (teacherIdParam && (isAdmin || !isTeacher)) {
      query += " WHERE ec.creator_id = ?";
      params.push(teacherIdParam);
    } else if (sharedOnly && !isTeacher) {
      query += " WHERE ec.is_shared_results = 1 OR ec.is_shared_results = 'true' OR ec.is_shared_results = true";
    } else if (isTeacher) {
      // Earlier exams may reference the teacher profile ID instead of account ID.
      query += " WHERE ec.creator_id IN (?, ?)";
      params.push(user.id, user.user_id || user.id);
    }

    // All exam pickers must receive the newest exam first. Sort before pagination so
    // page 1 always contains the most recently created exams; legacy NULL dates go last.
    query += ` ORDER BY ec.created_at DESC NULLS LAST, ec.id DESC${paginationClause}`;
    const { results } = await db.prepare(query).bind(...params).all();
    const mappedResults = (results || []).map(mapRowRead).map((row: any) => ({
      ...row,
      teacher_donvi: row.teacher_donvi || '',
      creator_name: row.creator_name || '',
      creatorName: row.creator_name || '',
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
          // Listing must use the same fail-closed exact unit rule as exam issuance.
          // Missing unit configuration never widens access.
          if (user) {
            const normalizeUnit = (value: any) => String(value || '').trim().toLocaleLowerCase('vi').replace(/\s+/g, ' ');
            const userDonvi = normalizeUnit(user.donvi || user.address || '');
            const configured = [...new Set([teacherDonvi, ...allowedUnits].map(normalizeUnit).filter(Boolean))];
            isSameDonVi = !!userDonvi && configured.includes(userDonvi);
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
      data: filteredResults.map((row: any) => isProtectedExamForUser(user,row) ? protectedExamPreview(row) : isExamOwner(user, row) ? row : redactExamForPublic(row)), 
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

// POST /api/exams - Create or update, with server-side authorization and validation.
// Every update is compare-and-swap by the exact ID and loaded revision.
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  const {request,env} = context;
  const respond = (obj:any,status=200) => new Response(JSON.stringify(obj),{status,headers:corsHeaders});
  try {
    const header=request.headers.get('Authorization');
    if (!header?.startsWith('Bearer ')) return respond({error:'Unauthorized'},401);
    const user=await verifyAuthSession(header.slice(7),await getDynamicSecret(db,env.JWT_SECRET),db);
    if (!user) return respond({error:'Phiên đăng nhập không hợp lệ'},401);
    if (!checkIsTeacherOrAdmin(user)) return respond({error:'Chỉ giáo viên hoặc quản trị viên được lưu đề thi'},403);
    const isAdmin=checkIsAdmin(user);
    // Existing Neon schemas may predate these persisted editor fields.
    // IF NOT EXISTS is idempotent and avoids dropping or rewriting old exam data.
    for (const ddl of [
      'ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS target_donvi TEXT',
      'ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS donvi TEXT',
      'ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS max_cheat_warnings INTEGER DEFAULT 5',
      'ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS keep_raw_score INTEGER DEFAULT 0',
      'ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS tieu_de_bai_thi TEXT',
      'ALTER TABLE exam_configs ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 0'
    ]) await db.prepare(ddl).run();
    const body:any=await request.json();
    if (!body || typeof body!=='object' || Array.isArray(body)) return respond({error:'Cấu hình không hợp lệ'},400);
    const id=body.id == null ? '' : String(body.id).trim();
    let existing:any=null;
    if (id) existing=await db.prepare('SELECT * FROM exam_configs WHERE id = ?').bind(id).first();
    if (id && !existing) return respond({error:'Đề thi cần cập nhật không tồn tại'},404);
    if (existing && !canManageExamConfig(user, existing.creator_id, isAdmin)) return respond({error:'Không có quyền sửa đề thi của người khác'},403);
    const owner=existing ? String(existing.creator_id) :
      (isAdmin && (body.creator_id||body.creatorId) ? String(body.creator_id||body.creatorId):String(user.id));
    if (!owner) return respond({error:'Không xác định được người tạo đề'},403);
    const fields=normalizeExamConfigInput(body,existing);

    // Fail-closed: mọi cấu hình mới/sửa phải đủ câu hỏi trên DB tại đúng thời điểm lưu.
    // Nhờ vậy một đề đang thiếu câu vẫn có thể được mở để sửa, nhưng chỉ được lưu
    // khi giáo viên đã giảm/thay đổi cơ cấu về mức ngân hàng hiện tại đáp ứng được.
    let proposedPoolValidity: any;
    try {
      proposedPoolValidity = await validateStoredExamQuestionPool(db, {...fields, name: fields.name}, owner);
    } catch (validationError: any) {
      console.error('Cannot validate proposed exam question pool:', validationError?.message || validationError);
      return respond({
        error:'Không thể xác minh ngân hàng câu hỏi trên cơ sở dữ liệu. Hệ thống chưa lưu đề để tránh tạo cấu hình không hợp lệ.',
        code:'EXAM_QUESTION_POOL_CHECK_UNAVAILABLE'
      },503);
    }
    if (!proposedPoolValidity.valid) {
      return respond({
        error: proposedPoolValidity.message,
        code: proposedPoolValidity.code || 'EXAM_QUESTION_POOL_INVALID',
        question_pool_validity: proposedPoolValidity
      },409);
    }

    if (!isAdmin && (fields.chedodethi==='Đề cho đơn vị'||fields.chedodethi==='Đề thi cho đơn vị')) {
      const identity:any=await db.prepare(
        'SELECT donvi FROM users WHERE id = ? OR id = ? LIMIT 1'
      ).bind(user.user_id||user.id,user.id).first();
      const school=String(identity?.donvi||'').trim();
      if (!school) return respond({error:'Tài khoản giáo viên chưa có đơn vị hợp lệ'},403);
      fields.target_donvi=school;
      fields.donvi=school;
    }
    // The exact teacher's assigned class set must be enforced at the API, not only in UI.
    if (!isAdmin && fields.chedodethi==='Đề cho đơn vị' && fields.target_lop) {
      const {results: assignments}=await db.prepare('SELECT class_name,donvi FROM teacher_classes WHERE teacher_id = ? OR teacher_id = ?')
        .bind(user.user_id||user.id,user.id).all();
      const normalize=(x:any)=>String(x||'').trim().toLowerCase().replace(/\s+/g,'');
      const allowed=new Set((assignments||[]).filter((a:any)=>normalize(a.donvi)===normalize(fields.target_donvi)).map((a:any)=>normalize(a.class_name)));
      const requested=fields.target_lop.split(/[,;\n]+/).map(normalize).filter(Boolean);
      if (requested.some((c:string)=>!allowed.has(c))) return respond({error:'Có lớp chưa được phân công cho giáo viên tại đơn vị này'},403);
    }
    const now=new Date().toISOString();
    const columns=Object.keys(fields);
    if (existing) {
      if (body.expected_updated_at===undefined || body.expected_updated_at===null ||
        String(body.expected_updated_at)!==String(existing.updated_at??'')) {
        return respond({error:'Đề thi đã được cập nhật trên thiết bị khác. Vui lòng nạp lại.',code:'EXAM_VERSION_CONFLICT'},409);
      }
      // UUID ensures a new revision even for two writes within a millisecond.
      const revision=now+'#'+crypto.randomUUID();
      const sql='UPDATE exam_configs SET '+columns.map(k=>k+' = ?').join(', ')+
        ', updated_at = ? WHERE id = ? AND updated_at IS NOT DISTINCT FROM ? AND creator_id = ?';
      const result=await db.prepare(sql).bind(...columns.map(k=>(fields as any)[k]),revision,id,existing.updated_at??null,owner).run();
      if (result.meta?.changes!==1) return respond({error:'Đề đã thay đổi đồng thời. Hãy nạp lại.',code:'EXAM_VERSION_CONFLICT'},409);
      return respond({success:true,type:'updated',id,updated_at:revision,error:null});
    }
    const dupe:any=await db.prepare('SELECT id FROM exam_configs WHERE creator_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1')
      .bind(owner,fields.name).first();
    if (dupe) return respond({error:'Tên đề đã tồn tại. Không ghi đè đề cũ.',code:'DUPLICATE_EXAM_NAME'},409);
    const newId=crypto.randomUUID();
    const sql='INSERT INTO exam_configs (id, creator_id, '+columns.join(', ')+', created_at, updated_at) VALUES ('+
      Array(columns.length+4).fill('?').join(', ')+')';
    try {
      await db.prepare(sql).bind(newId,owner,...columns.map(k=>(fields as any)[k]),now,now+'#'+crypto.randomUUID()).run();
    } catch(err:any) {
      if (String(err?.message||'').includes('unique')||String(err?.code||'')==='23505')
        return respond({error:'Tên đề thi đã tồn tại.',code:'DUPLICATE_EXAM_NAME'},409);
      throw err;
    }
    const stored:any=await db.prepare('SELECT updated_at FROM exam_configs WHERE id = ?').bind(newId).first();
    return respond({success:true,type:'inserted',id:newId,updated_at:stored?.updated_at,error:null});
  } catch (err:any) {
    if (err instanceof ExamConfigInputError) return respond({error:err.message,code:err.code},400);
    console.error('Exam config save rejected:',err?.message||err);
    return respond({error:'Không thể lưu cấu hình đề thi. Dữ liệu hiện tại được giữ nguyên.'},500);
  }
};

// DELETE /api/exams - Legacy-safe, scoped physical deletion (only when no submissions)
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  // Keep the response factory in DELETE scope: POST's local 'respond' is invisible here.
  const respond = (obj:any,status=200) => new Response(JSON.stringify(obj),{status,headers:corsHeaders});
  try {
    const {request,env}=context;
    const url=new URL(request.url);
    let id=url.searchParams.get('id');
    if (!id) {try {id=(await request.json() as any)?.id;} catch {}}
    if(typeof id!=='string'||!id.trim())return respond({error:'Thiếu ID đề thi cần xóa',code:'EXAM_ID_REQUIRED'},400);
    const authHeader=request.headers.get('Authorization');
    if(!authHeader?.startsWith('Bearer '))return respond({error:'Phiên đăng nhập không hợp lệ',code:'EXAM_AUTH_REQUIRED'},401);

    // Entire auth, tenant selection and DB operation is inside the JSON error boundary.
    const db=getDatabase(context);
    const user=await verifyAuthSession(authHeader.slice(7),await getDynamicSecret(db,env.JWT_SECRET),db);
    if(!user)return respond({error:'Phiên đăng nhập không hợp lệ',code:'EXAM_AUTH_REQUIRED'},401);
    const isAdmin=checkIsAdmin(user);
    if(!checkIsTeacherOrAdmin(user))return respond({error:'Tài khoản không có quyền xóa đề thi',code:'EXAM_DELETE_FORBIDDEN'},403);

    const exam:any=await db.prepare('SELECT id, creator_id FROM exam_configs WHERE id = ?').bind(id).first();
    if(!exam)return respond({error:'Đề thi không tồn tại hoặc đã bị xóa',code:'EXAM_NOT_FOUND'},404);
    if(!canManageExamConfig(user,exam.creator_id,isAdmin))
      return respond({error:'Không có quyền xóa đề thi của người khác',code:'EXAM_DELETE_FORBIDDEN'},403);

    const existingResults:any=await db.prepare('SELECT COUNT(*) AS total FROM results WHERE exam_id = ?').bind(id).first();
    if(Number(existingResults?.total||0)>0)
      return respond({error:'Đề thi đã có bài làm của học sinh nên không thể xóa vĩnh viễn. Cần giữ đề để bảo toàn lịch sử và quyền xem kết quả.',code:'EXAM_HAS_RESULTS'},409);

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS _exam_grade_sessions (
        session_id TEXT PRIMARY KEY, exam_id TEXT, teacher_id TEXT,
        question_ids TEXT NOT NULL, question_snapshot TEXT NOT NULL,
        exam_config TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        started_at TEXT, deadline_at TEXT
      )
    `).run();
    const liveSession:any=await db.prepare(
      'SELECT session_id FROM _exam_grade_sessions WHERE exam_id = ? AND expires_at >= ? LIMIT 1'
    ).bind(id,new Date().toISOString()).first();
    if(liveSession)
      return respond({error:'Đề thi đang có phiên READY/ACTIVE của học sinh nên chưa thể xóa. Hãy chờ phiên kết thúc hoặc thu hồi phiên một cách có kiểm soát.',code:'EXAM_HAS_LIVE_SESSION'},409);

    // The DELETE itself prevents any concurrent newly submitted result from becoming orphaned.
    const stmt=examConfigGuardedDeleteStatement(id,exam.creator_id);
    const deleted=await db.prepare(stmt.sql).bind(...stmt.params).run();
    if(Number(deleted.meta?.changes||0)!==1)
      return respond({error:'Đề thi đã thay đổi, đã có kết quả mới hoặc đã bị xóa. Vui lòng tải lại danh sách.',code:'EXAM_DELETE_CONFLICT'},409);
    return respond({success:true,message:'Đã xóa đề thi thành công',error:null},200);
  } catch (err:any) {
    console.error('DELETE /api/exams failed:',err?.message||err);
    return respond({error:'Máy chủ không thể xử lý yêu cầu xóa đề thi. Vui lòng thử lại hoặc liên hệ quản trị viên.',code:'EXAM_DELETE_FAILED'},500);
  }
};
