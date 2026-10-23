import { getDatabase, getDynamicSecret, verifyJWT } from './exam/utils';
import { accountSessionState, isAccountEnabled, isUnexpiredAccountToken } from '../../src/security-session';

/** Fail closed for every browser account bearer JWT across all Pages API endpoints. */
export const onRequest: PagesFunction = async (context) => {
  const { request, env } = context as any;
  if (request.method === 'OPTIONS') return context.next();
  const path = new URL(request.url).pathname;
  // Exam attempt tokens are not account-login tokens. Login/password endpoints use credentials.
  if (['/api/auth/login', '/api/auth/change-password', '/api/auth/register', '/api/exam/grade'].includes(path)) return context.next();
  const header = request.headers.get('Authorization') || '';
  if (!header) return context.next();

  const unauthorized = () => new Response(JSON.stringify({ error: 'Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.' }), {
    status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
  if (!header.startsWith('Bearer ')) return unauthorized();

  try {
    const db = getDatabase(context);
    const secret = await getDynamicSecret(db, (env as any).JWT_SECRET);
    const payload: any = await verifyJWT(header.slice(7), secret);
    if (!isUnexpiredAccountToken(payload)) return unauthorized();
    const account = await db.prepare(
      'SELECT id, user_id, username, password, role, is_active, expiry_date FROM accounts WHERE id = ?'
    ).bind(payload.id).first();
    if (!isAccountEnabled(account)) return unauthorized();
    if (payload.auth_state !== await accountSessionState(account)) return unauthorized();
    return context.next();
  } catch (error) {
    console.error('[AUTH] Account session validation could not complete');
    return new Response(JSON.stringify({ error: 'Không thể xác minh phiên đăng nhập.' }), {
      status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
};
