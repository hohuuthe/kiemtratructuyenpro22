import { verifyAuthSession, getDynamicSecret, getDatabase } from './exam/utils';

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

    let query = "SELECT * FROM questions";
    const params: any[] = [];
    if (!isAdmin) {
      query += " WHERE creator_id = ?";
      params.push(targetTeacherId);
    } else if (teacherIdParam) {
      query += " WHERE creator_id = ?";
      params.push(teacherIdParam);
    }
    query += ` ORDER BY lesson ASC, type ASC, id ASC${paginationClause}`;

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
  const db=getDatabase(context),{request,env}=context;
  const token=request.headers.get('Authorization')?.replace(/^Bearer /,'');
  const user=token?await verifyAuthSession(token,await getDynamicSecret(db,env.JWT_SECRET),db):null;
  const isAdmin=user?.role==='admin';
  if(!user||(!isAdmin&&user.role!=='teacher'))return new Response(JSON.stringify({error:'Staff authorization required'}),{status:403,headers:corsHeaders});
  try {
    const body:any=await request.json();
    const questions:any[]=Array.isArray(body)?body:Array.isArray(body.questions)?body.questions:body.content!==undefined?[body]:[];
    const deletedIds:string[]=Array.isArray(body.deletedIds)?[...new Set(body.deletedIds.map(String))]:[];
    if(questions.length>10000||deletedIds.length>10000||questions.some(q=>!q||typeof q.content!=='string'||!q.content.trim()))return new Response(JSON.stringify({error:'Invalid question batch'}),{status:400,headers:corsHeaders});
    const ids=[...new Set([...questions.filter(q=>q.id).map(q=>String(q.id)),...deletedIds])];
    const existing=ids.length?(await db.prepare('SELECT id,creator_id FROM questions WHERE id IN ('+ids.map(()=>'?').join(',')+')').bind(...ids).all()).results:[];
    if(!isAdmin&&existing.some((q:any)=>String(q.creator_id)!==String(user.id)))return new Response(JSON.stringify({error:'Cannot modify another teacher question'}),{status:403,headers:corsHeaders});
    const statements:any[]=[];
    for(const id of deletedIds)statements.push(db.prepare('DELETE FROM questions WHERE id=? AND (?=1 OR creator_id=?)').bind(id,isAdmin?1:0,user.id));
    for(const q of questions) {
      const id=String(q.id || crypto.randomUUID());
      const previous=existing.find((row:any)=>String(row.id)===id);
      const creator=isAdmin?String(previous?.creator_id || q.creatorId || q.creator_id || user.id):String(user.id);
      const options=typeof q.options==='object'?JSON.stringify(q.options):q.options || '{}';
      statements.push(db.prepare(`INSERT INTO questions(id,type,level,lesson,content,options,answer,image,creator_id)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,level=excluded.level,lesson=excluded.lesson,
        content=excluded.content,options=excluded.options,answer=excluded.answer,image=excluded.image
        WHERE questions.creator_id = excluded.creator_id AND (?=1 OR questions.creator_id=?)`).bind(id,q.type || '4-1',q.level || 'NB',q.lesson || '',q.content,options,String(q.answer ?? ''),q.image || null,creator,isAdmin?1:0,user.id));
    }
    const changes=statements.length?await db.batch(statements):[];
    const count=changes.slice(deletedIds.length).reduce((sum:any,result:any)=>sum+Number(result.meta?.changes || 0),0);
    return new Response(JSON.stringify({success:true,count,error:null}),{status:200,headers:corsHeaders});
  }catch{return new Response(JSON.stringify({success:false,error:'Question batch could not be saved'}),{status:500,headers:corsHeaders});}
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
