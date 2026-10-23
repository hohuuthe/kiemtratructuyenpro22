import {getDatabase, getDynamicSecret, verifyAuthSession, verifyJWT, checkIsTeacherOrAdmin} from './exam/utils';
import {resolveTenantFromRequest} from '../../src/tenant-host-map';

const json = (error: string, status: number, code: string) => new Response(JSON.stringify({error,code}), {
  status, headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
});
/** A supplied invalid token must never be silently downgraded to anonymous access. */
export async function onRequest(context: any): Promise<Response> {
  const {request,env} = context;
  const url = new URL(request.url);
  try {
    resolveTenantFromRequest(request, env);
    const origin = request.headers.get('Origin');
    const allowed = new Set([url.origin, ...String(env.ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean)]);
    if (origin && !allowed.has(origin)) return json('Origin is not allowed',403,'ORIGIN_DENIED');
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:{
      'Access-Control-Allow-Origin':origin || url.origin,
      'Access-Control-Allow-Headers':'Content-Type, Authorization, X-Tenant-Slug',
      'Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS','Vary':'Origin'
    }});
    const authPath = ['/api/auth/login','/api/auth/register','/api/auth/change-password'].includes(url.pathname);
    const header = request.headers.get('Authorization');
    let user: any = null;
    if (header && !authPath) {
      if (!/^Bearer [^\s]+$/.test(header)) return json('Invalid session',401,'SESSION_INVALID');
      const db = getDatabase(context);
      const secret = await getDynamicSecret(db,env.JWT_SECRET);
      user = await verifyAuthSession(header.slice(7),secret,db);
      if (!user && url.pathname === '/api/upload-image') {
        const attempt = await verifyJWT(header.slice(7),secret);
        if (attempt?.tokenType === 'upload' && attempt.scope === 'image:upload' && typeof attempt.examJti === 'string') {
          context.data ||= {}; context.data.examSession = attempt;
        }
      }
      if (!user && !context.data?.examSession) return json('Session expired or revoked. Sign in again.',401,'SESSION_REVOKED');
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const maximum = authPath ? 8192 : 32 * 1024 * 1024;
      const length = Number(request.headers.get('Content-Length') || 0);
      if (length > maximum) return json('Request is too large',413,'BODY_LIMIT');
      const reader = request.clone().body?.getReader();
      if (reader) {
        let bytes=0;
        while(true) {
          const {done,value}=await reader.read(); if(done)break;
          bytes += value.byteLength;
          if(bytes>maximum) { void reader.cancel(); return json('Request is too large',413,'BODY_LIMIT'); }
        }
      }
    }
    const privileged = url.pathname === '/api/exam/export-docx' ||
      (request.method !== 'GET' && /^\/api\/(exams|questions|results|accounts|users|settings|teacher-classes)(?:\/|$)/.test(url.pathname));
    if (privileged && !checkIsTeacherOrAdmin(user)) return json('Staff authorization required',user?403:401,'ACCESS_DENIED');
    if (authPath && env.AUTH_RATE_LIMITER) {
      const ip=request.headers.get('CF-Connecting-IP') || 'unknown';
      const permitted=await env.AUTH_RATE_LIMITER.limit({key:new URL(request.url).hostname+':'+ip});
      if (!permitted.success) return json('Too many authentication attempts',429,'RATE_LIMIT');
    }
    context.data ||= {}; context.data.authUser=user;
    const result = await context.next();
    const headers = new Headers(result.headers);
    headers.set('Cache-Control','no-store');
    headers.set('X-Content-Type-Options','nosniff');
    headers.set('Referrer-Policy','no-referrer');
    headers.set('Vary','Authorization, Origin');
    headers.set('Access-Control-Allow-Origin',origin || url.origin);
    if (url.pathname === '/api/health') return new Response(result.body,{status:result.status,statusText:result.statusText,headers});
    if (result.status >= 500) return new Response(JSON.stringify({error:'Service unavailable. Your changes have not been confirmed.',code:'SERVICE_UNAVAILABLE'}),{status:result.status,headers});
    return new Response(result.body,{status:result.status,statusText:result.statusText,headers});
  } catch(error: any) {
    console.error('[API] request rejected', error?.code || error?.name || 'ERROR');
    const tenantError=/hostname|tenant|host map/i.test(String(error?.message));
    return json(tenantError?'Tenant hostname is not configured':'Service unavailable',tenantError?421:503,tenantError?'TENANT_DENIED':'SERVICE_UNAVAILABLE');
  }
}
