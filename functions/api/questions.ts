import {QUESTION_CREATOR_JOIN_SQL,QUESTION_CREATOR_NAME_SQL} from '../../src/question-creator-identity.js';
import { verifyAuthSession, getDynamicSecret, getDatabase, checkIsTeacherOrAdmin, checkIsAdmin } from './exam/utils';
import { requiredQuestionLesson, questionLessonDeleteScope, requireQuestionLessonConfirmation, questionLessonCountQuery, questionLessonDeleteQuery, QuestionLessonDeleteError, canDeleteQuestionsByLesson } from '../../src/question-lesson-delete-policy';

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

// Helper parse JSON fields
function mapQuestionRead(q: any) {
  let options = q.options;
  if (typeof options === 'string') {
    try { options = JSON.parse(options); } catch { options = {}; }
  }
  return {
    id: q.id,
    type: q.type,
    level: q.level,
    lesson: q.lesson,
    content: q.content,
    options: options || {},
    answer: q.answer,
    image: q.image || '',
    creatorId: q.creator_id,
    creator_id: q.creator_id,
    creator_name: q.creator_name || '',
    creatorName: q.creator_name || '',
    created_at: q.created_at,
    updated_at: q.updated_at
  };
}

// GET /api/questions - Lấy danh sách câu hỏi cho Giáo viên / Admin quản lý
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  const { request, env } = context;
  const url = new URL(request.url);
  const teacherIdParam = url.searchParams.get('teacherId') || url.searchParams.get('teacher_id');
  const countOnly = url.searchParams.get('count') === 'true';
  const metaOnly = url.searchParams.get('metaOnly') === 'true' || url.searchParams.get('metadata') === 'true';

  // BẢO MẬT: Nếu là yêu cầu lấy metadata (chỉ type, level, lesson) để đếm số lượng câu hỏi khả dụng cho học sinh làm bài
  if (metaOnly && teacherIdParam) {
    try {
      const { results } = await db.prepare("SELECT type, level, lesson FROM questions WHERE creator_id = ?").bind(teacherIdParam).all();
      return new Response(JSON.stringify({ data: results || [], error: null }), { status: 200, headers: corsHeaders });
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message || "Lỗi truy vấn metadata", data: [] }), { status: 500, headers: corsHeaders });
    }
  }

  const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
  const authHeader = request.headers.get('Authorization');
  let user: any = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    user = await verifyAuthSession(token, SECRET, db);
  }

  // Bảo mật nghiêm ngặt: Học sinh không được phép tải toàn bộ ngân hàng câu hỏi (có đáp án)
  const isAdmin = user && user.role === 'admin';
  const isTeacher = user && user.target_audience === 'Giáo viên';

  if (!isAdmin && !isTeacher) {
    return new Response(JSON.stringify({ error: "Không có quyền truy cập ngân hàng câu hỏi", data: [] }), { status: 403, headers: corsHeaders });
  }

  try {
    let targetTeacherId = user.id;
    if (isAdmin && teacherIdParam) {
      targetTeacherId = teacherIdParam;
    }

    if (countOnly) {
      let countSql = "SELECT COUNT(*) as total FROM questions";
      const params: any[] = [];
      if (!isAdmin) {
        countSql += " WHERE creator_id = ?";
        params.push(targetTeacherId);
      } else if (teacherIdParam) {
        countSql += " WHERE creator_id = ?";
        params.push(teacherIdParam);
      }
      const { results } = await db.prepare(countSql).bind(...params).all();
      const count = results && results.length > 0 ? (results[0] as any).total : 0;
      return new Response(JSON.stringify({ count, error: null }), { status: 200, headers: corsHeaders });
    }

    const limitParam = url.searchParams.get('limit');
    const offsetParam = url.searchParams.get('offset');
    const pageParam = url.searchParams.get('page');

    let limit = -1; // Mặc định không giới hạn số lượng dòng trừ khi có tham số limit
    if (limitParam !== null) {
      if (limitParam === 'all' || limitParam === '0' || limitParam === '-1') {
        limit = -1;
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

    let query = "SELECT q.*, "+QUESTION_CREATOR_NAME_SQL+" AS creator_name FROM questions q "+QUESTION_CREATOR_JOIN_SQL;
    const params: any[] = [];
    if (!isAdmin) {
      query += " WHERE q.creator_id = ?";
      params.push(targetTeacherId);
    } else if (teacherIdParam) {
      query += " WHERE creator_id = ?";
      params.push(teacherIdParam);
    }
    query += ` ORDER BY q.created_at DESC NULLS LAST, q.id DESC${paginationClause}`;

    const { results } = await db.prepare(query).bind(...params).all();
    const mapped = (results || []).map(mapQuestionRead);

    return new Response(JSON.stringify({ 
      data: mapped, 
      total: mapped.length,
      limit,
      offset,
      has_more: limit > 0 && mapped.length === limit,
      error: null 
    }), { status: 200, headers: corsHeaders });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || "Lỗi tải câu hỏi", data: [] }), { status: 500, headers: corsHeaders });
  }
};

// POST /api/questions - Lưu hoặc Cập nhật (Upsert) danh sách câu hỏi
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  const { request, env } = context;
  const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }
  const token = authHeader.substring(7);
  const user = await verifyAuthSession(token, SECRET, db);
  if (!user) {
    return new Response(JSON.stringify({ error: "Phiên đăng nhập không hợp lệ" }), { status: 401, headers: corsHeaders });
  }

  const isAdmin = user.role === 'admin';
  const isTeacher = user.target_audience === 'Giáo viên' || isAdmin;
  if (!isTeacher) {
    return new Response(JSON.stringify({ error: "Chỉ giáo viên mới có quyền cập nhật ngân hàng câu hỏi" }), { status: 403, headers: corsHeaders });
  }

  try {
    const body: any = await request.json();
    const questions: any[] = Array.isArray(body)
      ? body
      : Array.isArray(body?.questions)
        ? body.questions
        : (body && typeof body === 'object' && (body.id != null || body.content != null || body.type != null))
          ? [body]
          : [];
    const deletedIds: string[] = body.deletedIds || [];

    // 1. Xóa các câu hỏi được yêu cầu xóa
    if (deletedIds && deletedIds.length > 0) {
      for (const id of deletedIds) {
        if (!isAdmin) {
          await db.prepare("DELETE FROM questions WHERE id = ? AND creator_id = ?").bind(id, user.id).run();
        } else {
          await db.prepare("DELETE FROM questions WHERE id = ?").bind(id).run();
        }
      }
    }

    // 2. Thêm mới / Cập nhật (Upsert)
    if (questions && questions.length > 0) {
      const upsertSql = `
        INSERT INTO questions (id, type, level, lesson, content, options, answer, image, creator_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          level = excluded.level,
          lesson = excluded.lesson,
          content = excluded.content,
          options = excluded.options,
          answer = excluded.answer,
          image = excluded.image
        WHERE questions.creator_id = excluded.creator_id
      `;

      for (const q of questions) {
        const qId = q.id || crypto.randomUUID();
        const creatorId = isAdmin ? (q.creatorId || user.id) : user.id;
        if (!isAdmin && q.id) {
          const record = await db.prepare("SELECT creator_id FROM questions WHERE id = ?").bind(q.id).first();
          if (record && String(record.creator_id) !== String(user.id)) {
            return new Response(JSON.stringify({error:'Không có quyền sửa câu hỏi của tài khoản khác'}), {status:403,headers:corsHeaders});
          }
        }
        const safeOptions = typeof q.options === 'object' ? JSON.stringify(q.options) : (q.options || '{}');

        await db.prepare(upsertSql).bind(
          qId,
          q.type || 'trac_nghiem',
          q.level || 'NB',
          q.lesson || '',
          q.content || '',
          safeOptions,
          q.answer || '',
          q.image || null,
          creatorId
        ).run();
      }
    }

    return new Response(JSON.stringify({ success: true, count: questions.length, error: null }), { status: 200, headers: corsHeaders });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || "Lỗi lưu câu hỏi", success: false }), { status: 500, headers: corsHeaders });
  }
};

// Scoped lesson deletion: preview count and final DELETE are separate authenticated requests.
// Admin deletes all creators in the exact lesson; teachers only delete their own.
export const onRequestPostDeleteLesson: PagesFunction<Env> = async (context) => {
  const db=getDatabase(context),{request,env}=context;
  const respond=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});
  try {
    const auth=request.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) return respond({error:'Vui lòng đăng nhập'},401);
    const user=await verifyAuthSession(auth.slice(7),await getDynamicSecret(db,env.JWT_SECRET),db);
    if (!user) return respond({error:'Phiên đăng nhập không hợp lệ'},401);
    if (!checkIsTeacherOrAdmin(user) || !canDeleteQuestionsByLesson(user)) return respond({error:'Không có quyền xóa ngân hàng câu hỏi'},403);
    const body:any=await request.json();
    const scope=questionLessonDeleteScope(requiredQuestionLesson(body?.lesson),user.id,checkIsAdmin(user));
    const countQuery=questionLessonCountQuery(scope);
    const before:any=await db.prepare(countQuery.sql).bind(...countQuery.params).first();
    const count=Number(before?.total||0);
    if(body?.action==='preview')return respond({lesson:scope.lesson,count,scope:scope.scope});
    if(body?.action!=='delete')return respond({error:'Thao tác không hợp lệ'},400);
    const expected=requireQuestionLessonConfirmation(body?.confirmation,body?.expectedCount);
    if(count!==expected)return respond({error:'Danh sách câu hỏi đã thay đổi. Vui lòng kiểm tra lại trước khi xóa.',code:'LESSON_CHANGED',count},409);
    const command=questionLessonDeleteQuery(scope,expected);
    const deleted=await db.prepare(command.sql).bind(...command.params).run();
    const changes=Number(deleted?.meta?.changes||0);
    if(changes!==expected)return respond({error:changes>0?'Có thay đổi đồng thời: đã xóa một phần. Hãy tải lại danh sách và kiểm tra ngay.':'Danh sách đã thay đổi, chưa xóa câu hỏi nào. Vui lòng thử lại.',code:changes>0?'PARTIAL_DELETE':'LESSON_CHANGED',deletedCount:changes},409);
    return respond({success:true,lesson:scope.lesson,deletedCount:changes});
  }catch(err:any){
    if(err instanceof QuestionLessonDeleteError)return respond({error:err.message,code:err.code},err.status);
    console.error('Lesson deletion error',err?.message||err);
    return respond({error:'Không thể xóa câu hỏi theo bài. Dữ liệu chưa được xác nhận đã xóa.'},500);
  }
};

// DELETE /api/questions - Xóa câu hỏi
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  const { request, env } = context;
  const url = new URL(request.url);
  let ids: string[] = [];
  const idParam = url.searchParams.get('id');

  if (idParam) {
    ids = [idParam];
  } else {
    try {
      const body: any = await request.json();
      if (Array.isArray(body?.ids)) ids = body.ids;
      else if (body?.id) ids = [body.id];
    } catch {}
  }

  if (ids.length === 0) {
    return new Response(JSON.stringify({ error: "Thiếu ID câu hỏi cần xóa" }), { status: 400, headers: corsHeaders });
  }

  const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }
  const token = authHeader.substring(7);
  const user = await verifyAuthSession(token, SECRET, db);
  if (!user) {
    return new Response(JSON.stringify({ error: "Phiên đăng nhập không hợp lệ" }), { status: 401, headers: corsHeaders });
  }

  const isAdmin = user.role === 'admin';

  try {
    for (const id of ids) {
      if (isAdmin) {
        await db.prepare("DELETE FROM questions WHERE id = ?").bind(id).run();
      } else {
        await db.prepare("DELETE FROM questions WHERE id = ? AND creator_id = ?").bind(id, user.id).run();
      }
    }
    return new Response(JSON.stringify({ success: true, message: `Đã xóa ${ids.length} câu hỏi`, error: null }), { status: 200, headers: corsHeaders });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || "Lỗi xóa câu hỏi" }), { status: 500, headers: corsHeaders });
  }
};
