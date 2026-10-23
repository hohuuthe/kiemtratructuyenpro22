import { accountSessionState } from '../../../src/security-session';
import { signJWT, getDynamicSecret, verifyPassword, hashPasswordPBKDF2, getDatabase } from '../exam/utils';

interface Env {
  NEON_DATABASE_URL?: string;
  DATABASE_URL?: string;
  DB?: any;
  JWT_SECRET?: string;
}

function mapRowRead(row: any): any {
  if (!row) return row;
  const mapped: any = {};
  for (const [key, val] of Object.entries(row)) {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          mapped[key] = JSON.parse(trimmed);
        } catch {
          mapped[key] = val;
        }
      } else {
        mapped[key] = val;
      }
    } else {
      mapped[key] = val;
    }
  }
  return mapped;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const db = getDatabase(context);

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  try {
    const body: any = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return new Response(JSON.stringify({ error: 'Thiếu tên đăng nhập hoặc mật khẩu.' }), { status: 400, headers: corsHeaders });
    }

    if (!db) {
      return new Response(JSON.stringify({ error: "Database not configured." }), { status: 500, headers: corsHeaders });
    }

    // Lấy tài khoản theo username kết hợp thông tin hồ sơ người dùng từ bảng users
    const stmt = db.prepare(`
      SELECT accounts.id, accounts.user_id, accounts.username, accounts.password, accounts.role, accounts.is_active, accounts.expiry_date, accounts.created_at,
             users.full_name, users.phone_number, users.target_audience, users.donvi, users.lop, users.gender, users.dob, users.address, users.occupation, users.payment_status, users.payment_method
      FROM accounts 
      LEFT JOIN users ON (users.id = accounts.user_id OR users.id = accounts.id)
      WHERE accounts.username = ?
    `).bind(username ?? null);
    const result: any = await stmt.first();

    if (!result || !result.password) {
        return new Response(JSON.stringify({ error: "Tên đăng nhập hoặc mật khẩu không đúng." }), { status: 401, headers: corsHeaders });
    }

    // Xác thực mật khẩu với chuẩn PBKDF2 kết hợp salt (hỗ trợ nâng cấp mật khẩu cũ SHA-256)
    const isValid = await verifyPassword(password, result.password);
    if (!isValid) {
        return new Response(JSON.stringify({ error: "Tên đăng nhập hoặc mật khẩu không đúng." }), { status: 401, headers: corsHeaders });
    }

    if (result.is_active === 0 || result.is_active === false) {
        return new Response(JSON.stringify({ error: "Tài khoản của bạn đã bị khóa hoặc chưa được kích hoạt." }), { status: 403, headers: corsHeaders });
    }

    // Tự động nâng cấp mật khẩu cũ (SHA-256) lên PBKDF2 cấp ngân hàng khi đăng nhập thành công
    if (!result.password.startsWith('pbkdf2:sha256:')) {
        try {
            const upgradedHash = await hashPasswordPBKDF2(password);
            await db.prepare(`UPDATE accounts SET password = ? WHERE id = ?`).bind(upgradedHash, result.id).run();
        } catch (upgradeErr) {
            console.warn("Không thể tự động nâng cấp hash mật khẩu:", upgradeErr);
        }
    }

    const account = mapRowRead(result);
    const finalTargetAudience = account.target_audience || (account.role === 'admin' ? 'Quản trị viên' : (account.role === 'teacher' || account.role === 'giáo viên' ? 'Giáo viên' : 'Học sinh'));
    const finalFullName = account.full_name || account.username;
    account.target_audience = finalTargetAudience;
    account.full_name = finalFullName;

    // Ký JWT
    const SECRET = await getDynamicSecret(db, env.JWT_SECRET);
    const token = await signJWT({ 
        id: account.id,
        auth_state: await accountSessionState(account),
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        user_id: account.user_id || account.id,
        role: account.role, 
        target_audience: finalTargetAudience,
        full_name: finalFullName,
        username: account.username,
        donvi: account.donvi || '',
        lop: account.lop || ''
    }, SECRET);

    // Trả về đúng cấu trúc giống endpoint cũ để Frontend không bị vỡ logic
    return new Response(JSON.stringify({
        data: account,
        token: token,
        error: null
    }), { status: 200, headers: corsHeaders });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || 'Lỗi server' }), { status: 500, headers: corsHeaders });
  }
}

export const onRequestOptions: PagesFunction = async () => {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    });
};
