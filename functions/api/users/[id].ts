import { verifyAuthSession, getDynamicSecret, getDatabase } from '../exam/utils';
import { USER_DELETE_CASCADE_SQL, USER_DELETE_CALL_SQL, parseUserDeletionResult, userDeleteHttpError } from '../../../src/user-delete-cascade';

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

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  const { request, env, params } = context;
  const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }
  const token = authHeader.substring(7);
  const user: any = await verifyAuthSession(token, SECRET, db);
  if (!user || user.role !== 'admin') {
    return new Response(JSON.stringify({ error: "Chỉ Quản trị viên mới được sửa hồ sơ người dùng" }), { status: 403, headers: corsHeaders });
  }

  const userId = params.id as string;
  try {
    const body: any = await request.json();
    const { full_name, phone_number, gender, dob, address, donvi, lop, occupation, target_audience, payment_status, payment_method, is_vip, is_active, expiry_date } = body;

    const updates = [];
    const sqlParams = [];
    if (full_name !== undefined) { updates.push("full_name = ?"); sqlParams.push(full_name); }
    if (phone_number !== undefined) { updates.push("phone_number = ?"); sqlParams.push(phone_number); }
    if (gender !== undefined) { updates.push("gender = ?"); sqlParams.push(gender); }
    if (dob !== undefined) { updates.push("dob = ?"); sqlParams.push(dob); }
    if (address !== undefined) { updates.push("address = ?"); sqlParams.push(address); }
    if (donvi !== undefined) { updates.push("donvi = ?"); sqlParams.push(donvi); }
    if (lop !== undefined) { updates.push("lop = ?"); sqlParams.push(lop); }
    if (occupation !== undefined) { updates.push("occupation = ?"); sqlParams.push(occupation); }
    if (target_audience !== undefined) { updates.push("target_audience = ?"); sqlParams.push(target_audience); }
    if (payment_status !== undefined) { updates.push("payment_status = ?"); sqlParams.push(payment_status); }
    if (payment_method !== undefined) { updates.push("payment_method = ?"); sqlParams.push(payment_method); }
    if (is_vip !== undefined) {
      const current: any = await db.prepare("SELECT target_audience FROM users WHERE id = ? LIMIT 1").bind(userId).first();
      const effectiveAudience = target_audience !== undefined ? target_audience : current?.target_audience;
      const teacher = String(effectiveAudience || '').trim().toLocaleLowerCase('vi') === 'giáo viên';
      updates.push("is_vip = ?");
      sqlParams.push(teacher && (is_vip === true || is_vip === 1 || is_vip === '1' || is_vip === 'true') ? 1 : 0);
    } else if (target_audience !== undefined && String(target_audience || '').trim().toLocaleLowerCase('vi') !== 'giáo viên') {
      updates.push("is_vip = 0");
    }
    if (is_active !== undefined) { updates.push("is_active = ?"); sqlParams.push(is_active ? 1 : 0); }
    if (expiry_date !== undefined) { updates.push("expiry_date = ?"); sqlParams.push(expiry_date); }

    if (updates.length > 0) {
      sqlParams.push(userId);
      await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...sqlParams).run();
    }

    return new Response(JSON.stringify({ data: { id: userId }, error: null }), { status: 200, headers: corsHeaders });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Lỗi server' }), { status: 500, headers: corsHeaders });
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const db = getDatabase(context);
  const { request, env, params } = context;
  const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
  }
  const token = authHeader.substring(7);
  const user: any = await verifyAuthSession(token, SECRET, db);
  if (!user || user.role !== 'admin') {
    return new Response(JSON.stringify({ error: "Chỉ Quản trị viên mới được xóa hồ sơ người dùng" }), { status: 403, headers: corsHeaders });
  }

  const userId = params.id as string;
  try {
    const target: any = await db.prepare(
      `SELECT u.id, u.full_name, u.target_audience,
              EXISTS(
                SELECT 1 FROM accounts a
                WHERE (a.user_id = u.id OR a.id = u.id)
                  AND LOWER(COALESCE(a.role,'')) IN ('teacher','giáo viên')
              ) AS has_teacher_account,
              EXISTS(
                SELECT 1 FROM accounts a
                WHERE (a.user_id = u.id OR a.id = u.id)
                  AND (
                    LOWER(COALESCE(a.role,''))='admin'
                    OR LOWER(COALESCE(a.username,'')) IN ('admin','adminhht')
                    OR LOWER(COALESCE(a.id,'')) IN ('admin','adminhht')
                  )
              ) AS has_admin_account
       FROM users u WHERE u.id = ? LIMIT 1`
    ).bind(userId).first();

    if (!target) {
      return new Response(JSON.stringify({ error: "Không tìm thấy hồ sơ người dùng" }), { status: 404, headers: corsHeaders });
    }

    const audience = String(target.target_audience || '').trim().toLocaleLowerCase('vi');
    const isAdminTarget = target.has_admin_account === true || target.has_admin_account === 1 ||
      ['quản trị viên','admin'].includes(audience);
    if (isAdminTarget) {
      return new Response(JSON.stringify({ error: "BẢO MẬT HỆ THỐNG: Tuyệt đối không được xóa tài khoản hoặc hồ sơ Quản trị viên (Admin)!" }), { status: 400, headers: corsHeaders });
    }

    if (userId === user.user_id || userId === user.id) {
      return new Response(JSON.stringify({ error: "Không thể tự xóa tài khoản của chính mình!" }), { status: 400, headers: corsHeaders });
    }

    // Every non-admin profile now uses the same database-side atomic cascade.
    // This covers students too: results, QR participation/cards, board references,
    // legacy owned resources, linked accounts, and the profile itself.
    await db.exec(USER_DELETE_CASCADE_SQL);
    const row: any = await db.prepare(USER_DELETE_CALL_SQL).bind(userId).first();
    const deletion = parseUserDeletionResult(row);
    if (!deletion?.success) throw new Error('USER_DELETE_EMPTY_RESULT');

    return new Response(JSON.stringify({
      data: deletion,
      error: null
    }), { status: 200, headers: corsHeaders });
  } catch (e: any) {
    const mapped = userDeleteHttpError(e);
    return new Response(JSON.stringify({ error: mapped.error, code: mapped.code }), {
      status: mapped.status,
      headers: corsHeaders
    });
  }
};
