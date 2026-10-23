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
  let dbStatus = "UNKNOWN";
  let dbError = null;
  let userCount = 0;

  try {
    const db = getEffectiveDb(context);
    const res = await db.prepare("SELECT 1 AS count").first();
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
      error: dbStatus === "CONNECTED_OK" ? null : "DATABASE_UNAVAILABLE"
    },
    timestamp: new Date().toISOString()
  }, null, 2), {
    status: dbStatus === "CONNECTED_OK" ? 200 : 500,
    headers: corsHeaders
  });
};
