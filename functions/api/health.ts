import {resolveTenantFromRequest} from '../../src/tenant-host-map';
import { getEffectiveDb } from './neon-adapter';

interface Env {
  NEON_DATABASE_URL?: string;
  DATABASE_URL?: string;
  GEMINI_API_KEY?: string;
  CLOUDFLARE_R2_BUCKET_NAME?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tenant-Slug',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  const slug = resolveTenantFromRequest(request,env);
  const bindingName=slug==='default'?'NEON_DATABASE_URL':slug;
  const bindingValue=slug==='default'?(env.NEON_DATABASE_URL || env.DATABASE_URL):((env as any)[slug] || (env as any)[slug.toUpperCase()] || (env as any)['NEON_DATABASE_URL_'+slug.toUpperCase()]);
  const bindingConfigured=typeof bindingValue==='string' && bindingValue.trim().length>0;
  const bindingLooksLikePostgres=bindingConfigured && /^postgres(?:ql)?:\/\//i.test(bindingValue.trim().replace(/^['\"]|['\"]$/g,''));
  let dbStatus = "UNKNOWN";
  let dbError = null;
  let userCount = 0;

  try {
    const db = getEffectiveDb(context);
    const res = await db.prepare("SELECT 1 AS count").first();
    // Neon connection success does not imply that application tables are usable.
    await db.prepare("SELECT 1 FROM accounts LIMIT 1").all();
    await db.prepare("SELECT 1 FROM questions LIMIT 1").all();
    userCount = Number(res?.count || 0);
    dbStatus = "CONNECTED_OK";
  } catch (err: any) {
    dbStatus = "CONNECTION_FAILED";
    const rawMsg = err?.message || String(err);
    dbError = rawMsg.replace(/postgresql:\/\/[^@]+@/gi, 'postgresql://***:***@');
  }

  return new Response(JSON.stringify({
    status: dbStatus === "CONNECTED_OK" ? "OK" : "ERROR",
    tenant_slug: slug || "DEFAULT",
    environment: {
      has_gemini_key: !!env.GEMINI_API_KEY,
      has_r2_configured: !!env.CLOUDFLARE_R2_BUCKET_NAME,
    },
    database: {
      status: dbStatus,
      binding_name: bindingName,
      binding_configured: bindingConfigured,
      binding_url_valid: bindingLooksLikePostgres,
      schema_accessible: dbStatus === 'CONNECTED_OK',
      error: dbStatus === 'CONNECTED_OK' ? null : !bindingConfigured ? 'TENANT_BINDING_MISSING' : !bindingLooksLikePostgres ? 'DATABASE_URL_INVALID' : 'DATABASE_QUERY_FAILED'
    },
    timestamp: new Date().toISOString()
  }, null, 2), {
    status: dbStatus === "CONNECTED_OK" ? 200 : (!bindingConfigured ? 424 : 503),
    headers: corsHeaders
  });
};
