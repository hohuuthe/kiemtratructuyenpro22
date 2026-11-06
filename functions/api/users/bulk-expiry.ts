import {
  verifyAuthSession,
  getDynamicSecret,
  getDatabase,
  checkIsAdmin
} from '../exam/utils';
import { normalizeVietnamExpiryForStorage } from '../../../src/account-expiry';

const MAX_BULK_EXPIRY = 500;

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

function normalizeIds(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value.map((id: any) => String(id ?? '').trim()).filter(Boolean)
  )];
}

function marks(count: number) {
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
      return json({ error: 'Chỉ Admin mới được cập nhật hạn dùng người dùng.' }, 403);
    }

    const body: any = await request.json();
    const userIds = normalizeIds(body?.user_ids);
    if (!userIds.length) {
      return json({ error: 'Chưa chọn người dùng cần cập nhật hạn dùng.' }, 400);
    }
    if (userIds.length > MAX_BULK_EXPIRY) {
      return json({ error: `Mỗi lần chỉ được cập nhật tối đa ${MAX_BULK_EXPIRY} người dùng.` }, 400);
    }

    let expiry: string | null;
    try {
      expiry = normalizeVietnamExpiryForStorage(body?.expiry_date);
    } catch {
      return json({ error: 'Ngày hết hạn không hợp lệ.' }, 400);
    }

    const placeholders = marks(userIds.length);
    const before: any = await db.prepare(
      `SELECT id FROM users WHERE id IN (${placeholders})`
    ).bind(...userIds).all();
    const found = new Set((before?.results || []).map((row: any) => String(row.id)));
    const missing = userIds.filter(id => !found.has(id));

    if (missing.length || found.size !== userIds.length) {
      return json({
        error: 'Danh sách người dùng đã thay đổi. Chưa cập nhật hạn dùng cho người dùng nào.',
        code: 'USER_SELECTION_CHANGED',
        missing_user_ids: missing
      }, 409);
    }

    const update: any = await db.prepare(
      `UPDATE users SET expiry_date = ? WHERE id IN (${placeholders})`
    ).bind(expiry, ...userIds).run();

    const after: any = await db.prepare(
      `SELECT id, expiry_date FROM users WHERE id IN (${placeholders})`
    ).bind(...userIds).all();
    const rows = after?.results || [];
    const expected = expiry || '';
    const confirmed = new Set(
      rows
        .filter((row: any) => String(row.expiry_date || '') === expected)
        .map((row: any) => String(row.id))
    );

    if (rows.length !== userIds.length || userIds.some(id => !confirmed.has(id))) {
      return json({
        error: 'Không thể xác nhận toàn bộ hạn dùng người dùng sau khi ghi. Cần kiểm tra lại dữ liệu.',
        code: 'USER_EXPIRY_VERIFY_FAILED'
      }, 500);
    }

    const changed = Number(update?.meta?.changes);
    return json({
      data: {
        success: true,
        updated: Number.isFinite(changed) ? changed : userIds.length,
        verified: userIds.length,
        user_ids: userIds,
        expiry_date: expiry,
        unlimited: expiry === null,
        self_profile_updated: userIds.includes(String(actor.user_id || actor.id || ''))
      },
      error: null
    });
  } catch (error: any) {
    console.error('POST /api/users/bulk-expiry error:', error);
    return json({ error: error?.message || 'Không thể cập nhật hạn dùng người dùng.' }, 500);
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
