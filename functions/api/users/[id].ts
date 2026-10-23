import { verifyAuthSession, getDynamicSecret, getDatabase } from '../exam/utils';

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
    const { full_name, phone_number, gender, dob, address, donvi, lop, occupation, target_audience, payment_status, payment_method, is_active, expiry_date } = body;

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
    // 1. Tìm và xóa toàn bộ tài khoản đăng nhập gắn với người dùng này (qua user_id hoặc id)
    let deletedAccountsCount = 0;
    try {
      const { results: findAccounts } = await db.prepare("SELECT id, username, role FROM accounts WHERE user_id = ? OR id = ?").bind(userId, userId).all();
      if (findAccounts && findAccounts.length > 0) {
        for (const acc of findAccounts) {
          if (acc.id === user.id) continue;
          await db.prepare("DELETE FROM accounts WHERE id = ?").bind(acc.id).run();
          deletedAccountsCount++;
        }
      }
    } catch (errAcc) {
      console.warn("Lỗi khi tìm và xóa tài khoản gắn với người dùng:", errAcc);
    }

    // 2. Xóa hồ sơ người dùng khỏi bảng users và phân công lớp
    await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
    try {
      await db.prepare("DELETE FROM teacher_classes WHERE teacher_id = ?").bind(userId).run();
    } catch (e) {}

    return new Response(JSON.stringify({ 
      data: { 
        success: true, 
        deletedUserId: userId, 
        deletedAccountsCount: deletedAccountsCount 
      }, 
      error: null 
    }), { status: 200, headers: corsHeaders });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Lỗi server' }), { status: 500, headers: corsHeaders });
  }
};
