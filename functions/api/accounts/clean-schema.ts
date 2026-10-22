import { verifyJWT, getDynamicSecret, getDatabase } from '../exam/utils';

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
    return new Response(JSON.stringify({ error: "Chỉ Quản trị viên mới có quyền thực hiện dọn dẹp cấu trúc CSDL" }), { status: 403, headers: corsHeaders });
  }

  try {
    // 1. Tạo bảng users nếu chưa có
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

    // Migration thêm cột lop nếu bảng users đã tồn tại từ trước
    try {
      await db.prepare("ALTER TABLE users ADD COLUMN lop TEXT").run();
    } catch {}

    // 2. Sao lưu toàn bộ hồ sơ người dùng từ accounts sang users trước khi xóa cột
    try {
      const { results: accList } = await db.prepare("SELECT * FROM accounts").all();
      if (accList && accList.length > 0) {
        for (const a of accList as any[]) {
          const uId = a.user_id || a.id;
          await db.prepare(`
            INSERT OR IGNORE INTO users 
            (id, full_name, phone_number, gender, dob, address, donvi, lop, occupation, target_audience, payment_status, payment_method, is_active, expiry_date, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            uId,
            a.full_name || '',
            a.phone_number || '',
            a.gender || '',
            a.dob || null,
            a.address || '',
            a.donvi || '',
            a.lop || '',
            a.occupation || '',
            a.target_audience || 'Học sinh',
            a.payment_status || 'Chưa thanh toán',
            a.payment_method || '',
            a.is_active ?? 1,
            a.expiry_date || null,
            a.created_at || new Date().toISOString()
          ).run();
        }
      }
    } catch (syncErr) {
      console.warn("Backup accounts to users:", syncErr);
    }

    // 3. Chuẩn hóa bảng accounts (chỉ giữ các cột liên quan đến tài khoản)
    // Tạo bảng tạm accounts_clean
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS accounts_clean (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        is_active INTEGER DEFAULT 1,
        expiry_date TEXT,
        created_at TEXT
      )
    `).run();

    // Copy dữ liệu sang accounts_clean
    await db.prepare(`
      INSERT OR REPLACE INTO accounts_clean (id, user_id, username, password, role, is_active, expiry_date, created_at)
      SELECT id, COALESCE(user_id, id), username, password, COALESCE(role, 'user'), COALESCE(is_active, 1), expiry_date, COALESCE(created_at, datetime('now'))
      FROM accounts
    `).run();

    // Thay thế bảng accounts cũ
    await db.prepare("DROP TABLE accounts").run();
    await db.prepare("ALTER TABLE accounts_clean RENAME TO accounts").run();
    try {
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id)").run();
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username)").run();
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON accounts(created_at)").run();
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_accounts_role ON accounts(role)").run();
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_accounts_user_created ON accounts(user_id, created_at DESC)").run();
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_accounts_username_active ON accounts(username, is_active)").run();
    } catch {}

    // 4. Lấy thông tin các cột hiện tại để phản hồi
    const { results: columnsInfo } = await db.prepare("PRAGMA table_info(accounts)").all();

    return new Response(JSON.stringify({
      success: true,
      message: "Đã xóa toàn bộ các cột không cần thiết trong bảng accounts trên D1!",
      columns: (columnsInfo || []).map((c: any) => c.name)
    }), { status: 200, headers: corsHeaders });

  } catch (err: any) {
    // Fallback: Nếu không thể dùng cách tái tạo bảng, xóa từng cột bằng DROP COLUMN
    try {
      const colsToDrop = ['full_name', 'target_audience', 'donvi', 'occupation', 'phone_number', 'gender', 'dob', 'address', 'payment_status', 'payment_method'];
      for (const col of colsToDrop) {
        try {
          await db.prepare(`ALTER TABLE accounts DROP COLUMN ${col}`).run();
        } catch {}
      }

      const { results: columnsInfo } = await db.prepare("PRAGMA table_info(accounts)").all();
      return new Response(JSON.stringify({
        success: true,
        message: "Đã xóa các cột không cần thiết bằng lệnh DROP COLUMN!",
        columns: (columnsInfo || []).map((c: any) => c.name)
      }), { status: 200, headers: corsHeaders });
    } catch (fallbackErr: any) {
      return new Response(JSON.stringify({ error: fallbackErr.message || err.message }), { status: 500, headers: corsHeaders });
    }
  }
};
