import { verifyAuthSession, getDynamicSecret, getDatabase } from '../exam/utils';

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store, max-age=0',
  'Pragma': 'no-cache',
  'Vary': 'Authorization',
  'X-Content-Type-Options': 'nosniff'
};

export const onRequestGet: PagesFunction = async (context: any) => {
  try {
    const bearer = context.request.headers.get('Authorization') || '';
    if (!bearer.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Phiên đăng nhập không hợp lệ.' }), { status: 401, headers });
    }
    const db = getDatabase(context);
    const user: any = await verifyAuthSession(
      bearer.slice(7),
      await getDynamicSecret(db, context.env?.JWT_SECRET),
      db
    );
    if (!user) {
      return new Response(JSON.stringify({ error: 'Phiên đăng nhập đã hết hạn hoặc không còn hợp lệ.' }), { status: 401, headers });
    }
    return new Response(JSON.stringify({
      data: {
        id: user.id,
        user_id: user.user_id || user.id,
        username: user.username || '',
        role: user.role || 'user',
        target_audience: user.target_audience || '',
        full_name: user.full_name || user.username || '',
        donvi: user.donvi || '',
        lop: user.lop || '',
        is_vip: !!user.is_vip,
        is_active: true,
        expiry_date: null
      },
      error: null
    }), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ error: 'Không thể xác minh phiên đăng nhập.' }), { status: 503, headers });
  }
};
