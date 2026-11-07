import {
  verifyAuthSession,
  getDynamicSecret,
  hashPasswordPBKDF2,
  verifyPassword,
  getDatabase,
  checkIsAdmin
} from '../exam/utils';

const MAX_RESET_ACCOUNTS = 500;
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 128;

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store, max-age=0'
    }
  });
}

function normalizeAccountIds(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map((id: any) => String(id ?? '').trim())
      .filter(Boolean)
  )];
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',');
}

export async function onRequestPost(context: any) {
  const { request, env } = context;
  const db = getDatabase(context);

  try {
    const authHeader = request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Yêu cầu đăng nhập Admin.' }, 401);
    }

    const secret = await getDynamicSecret(db, env.JWT_SECRET);
    const actor: any = await verifyAuthSession(authHeader.slice(7), secret, db);
    if (!actor || !checkIsAdmin(actor)) {
      return json({ error: 'Chỉ Admin mới được reset mật khẩu tài khoản.' }, 403);
    }

    const body: any = await request.json();
    const accountIds = normalizeAccountIds(body?.account_ids);
    const password = String(body?.password ?? '');

    if (accountIds.length === 0) {
      return json({ error: 'Chưa chọn tài khoản cần reset mật khẩu.' }, 400);
    }
    if (accountIds.length > MAX_RESET_ACCOUNTS) {
      return json({ error: `Mỗi lần chỉ được reset tối đa ${MAX_RESET_ACCOUNTS} tài khoản.` }, 400);
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return json({ error: `Mật khẩu mặc định phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.` }, 400);
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      return json({ error: `Mật khẩu mặc định không được vượt quá ${MAX_PASSWORD_LENGTH} ký tự.` }, 400);
    }

    const marks = placeholders(accountIds.length);
    const before: any = await db.prepare(
      `SELECT id FROM accounts WHERE id IN (${marks})`
    ).bind(...accountIds).all();
    const foundIds = new Set((before?.results || []).map((row: any) => String(row.id)));
    const missing = accountIds.filter(id => !foundIds.has(id));

    // Fail before writing anything if the requested selection is stale/invalid.
    if (missing.length > 0 || foundIds.size !== accountIds.length) {
      return json({
        error: 'Danh sách tài khoản đã thay đổi. Không có mật khẩu nào được reset.',
        code: 'ACCOUNT_SELECTION_CHANGED',
        missing_account_ids: missing
      }, 409);
    }

    // Generate a distinct PBKDF2 salt/hash for every account. Reusing one hash
    // would also reuse its salt and unnecessarily couples the security of the batch.
    const hashes = new Map<string,string>();
    for (const id of accountIds) {
      const hash = await hashPasswordPBKDF2(password);
      if (!hash.startsWith('pbkdf2:sha256:') || !(await verifyPassword(password, hash))) {
        return json({
          error: 'Không thể xác minh kết quả mã hóa mật khẩu. Không có tài khoản nào được cập nhật.'
        }, 500);
      }
      hashes.set(id, hash);
    }

    // Apply all per-account hashes in one atomic PostgreSQL statement.
    const payload = accountIds.map(id => ({ id, password: hashes.get(id) }));
    const updated: any = await db.prepare(`
      WITH input AS (
        SELECT * FROM jsonb_to_recordset(?::jsonb) AS x(id text, password text)
      ),
      changed AS (
        UPDATE accounts a SET password = input.password
        FROM input WHERE a.id = input.id
        RETURNING a.id, a.password
      )
      SELECT COUNT(*)::int AS count FROM changed
    `).bind(JSON.stringify(payload)).first();
    if (Number(updated?.count || 0) !== accountIds.length) {
      return json({
        error: 'Số tài khoản được cập nhật không khớp danh sách đã chọn.',
        code: 'PASSWORD_RESET_WRITE_MISMATCH'
      }, 500);
    }

    // Read-after-write verification for every requested account.
    const after: any = await db.prepare(
      `SELECT id, password FROM accounts WHERE id IN (${marks})`
    ).bind(...accountIds).all();
    const rows = after?.results || [];
    if (rows.length !== accountIds.length) {
      return json({
        error: 'Không thể xác nhận toàn bộ mật khẩu sau khi ghi.',
        code: 'PASSWORD_RESET_VERIFY_FAILED'
      }, 500);
    }
    for (const row of rows) {
      const expected = hashes.get(String(row.id));
      if (!expected || String(row.password || '') !== expected || !(await verifyPassword(password, String(row.password || '')))) {
        return json({
          error: 'Không thể xác nhận toàn bộ mật khẩu sau khi ghi.',
          code: 'PASSWORD_RESET_VERIFY_FAILED'
        }, 500);
      }
    }

    return json({
      data: {
        success: true,
        updated: accountIds.length,
        account_ids: accountIds,
        password_scheme: 'pbkdf2:sha256',
        unique_salt_per_account: true,
        session_tokens_invalidated: true,
        self_reset: accountIds.includes(String(actor.id || ''))
      },
      error: null
    });
  } catch (error: any) {
    console.error('POST /api/accounts/reset-password error:', error);
    return json({ error: error?.message || 'Không thể reset mật khẩu tài khoản.' }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    }
  });
}
