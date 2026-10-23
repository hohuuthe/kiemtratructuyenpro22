from pathlib import Path
R=Path.cwd()
def put(p,s):
 t=R/p;t.parent.mkdir(parents=True,exist_ok=True);t.write_text(s)
put('functions/api/_middleware.ts', '''import {getDatabase, getDynamicSecret, verifyAuthSession, verifyJWT, checkIsTeacherOrAdmin} from './exam/utils';
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
      if (!/^Bearer [^\\s]+$/.test(header)) return json('Invalid session',401,'SESSION_INVALID');
      const db = getDatabase(context);
      const secret = await getDynamicSecret(db,env.JWT_SECRET);
      user = await verifyAuthSession(header.slice(7),secret,db);
      if (!user && url.pathname === '/api/upload-image') {
        const attempt = await verifyJWT(header.slice(7),secret);
        if (attempt?.tokenType === 'exam' && Array.isArray(attempt.questionIds)) {
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
      (request.method !== 'GET' && /^\\/api\\/(exams|questions|results|accounts|users|settings|teacher-classes)(?:\\/|$)/.test(url.pathname));
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
    if (result.status >= 500) return new Response(JSON.stringify({error:'Service unavailable. Your changes have not been confirmed.',code:'SERVICE_UNAVAILABLE'}),{status:result.status,headers});
    return new Response(result.body,{status:result.status,statusText:result.statusText,headers});
  } catch(error: any) {
    console.error('[API] request rejected', error?.code || error?.name || 'ERROR');
    const tenantError=/hostname|tenant|host map/i.test(String(error?.message));
    return json(tenantError?'Tenant hostname is not configured':'Service unavailable',tenantError?421:503,tenantError?'TENANT_DENIED':'SERVICE_UNAVAILABLE');
  }
}
''')
put('functions/_middleware.ts', '''/** Never serve database backups, server bundles, or environment files as web assets. */
export async function onRequest(context: any): Promise<Response> {
  let path: string;
  try { path=decodeURIComponent(new URL(context.request.url).pathname); } catch { return new Response(null,{status:400}); }
  if (/(?:\\.(?:sql|db|sqlite|sqlite3|map|cjs)|\\/\\.env(?:\\.[^/]*)?|\\/server\\.ts)$/i.test(path)) return new Response(null,{status:404});
  return context.next();
}
''')
routes={'accounts':'accounts','accounts/clean-schema':'accounts/clean-schema','auth/change-password':'auth/change-password','auth/login':'auth/login','auth/register':'auth/register','ai/generate':'ai/generate','config':'config','db':'db','exam/export-docx':'exam/export-docx','exam/generate':'exam/generate','exam/grade':'exam/grade','exams':'exams','health':'health','proxy-image':'proxy-image','questions':'questions','questions/import-word':'questions/import-word','results':'results','settings':'settings','teacher-classes':'teacher-classes','upload-image':'upload-image','users':'users'}
imports='\n'.join(f"import * as h{i} from '../functions/api/{p}';" for i,p in enumerate(routes.values()))
entries=',\n'.join(f"  '/api/{k}':h{i}" for i,k in enumerate(routes))
put('src/pages-api-dispatch.ts',imports+'''
import * as accountById from '../functions/api/accounts/[id]';
import * as userById from '../functions/api/users/[id]';
import {onRequest as middleware} from '../functions/api/_middleware';
const routes: Record<string, any> = {
'''+entries+'''
};
/** Express and Cloudflare execute the same handlers: no second authorization implementation. */
export async function dispatchPagesApi(request: Request, env: any): Promise<Response> {
  const path=new URL(request.url).pathname;
  let module=routes[path], params:any={};
  if (!module) {
    const match=path.match(/^\\/api\\/(accounts|users)\\/([^/]+)$/);
    if(match) { module=match[1]==='accounts'?accountById:userById; params.id=decodeURIComponent(match[2]); }
  }
  const method=request.method[0]+request.method.slice(1).toLowerCase();
  const handler=module?.['onRequest'+method] || module?.onRequest;
  const context:any={request,env,params,data:{},waitUntil:(promise:Promise<any>)=>promise.catch(()=>{}),
    next:()=>handler?handler(context):Promise.resolve(new Response(JSON.stringify({error:module?'Method not allowed':'Not found'}),{status:module?405:404,headers:{'Content-Type':'application/json'}}))};
  return middleware(context);
}
''')
put('server.ts','''import express from 'express';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'node:path';
import {createServer as createViteServer} from 'vite';
import {dispatchPagesApi} from './src/pages-api-dispatch';

dotenv.config();
const production=process.env.NODE_ENV === 'production' || process.argv[1]?.endsWith('.cjs');
async function startServer() {
  const app=express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((req,res,next)=>{
    if (/(?:\\.(?:sql|db|sqlite|sqlite3|map|cjs)|\\/\\.env(?:\\.[^/]*)?|\\/server\\.ts)$/i.test(req.path)) return res.status(404).end();
    next();
  });
  app.use('/api/auth',rateLimit({windowMs:15*60*1000,limit:15,standardHeaders:true,legacyHeaders:false}));
  app.use('/api',rateLimit({windowMs:5*60*1000,limit:500,standardHeaders:true,legacyHeaders:false}));
  app.use('/api',express.raw({type:()=>true,limit:'32mb'}));
  app.use('/api',async(req,res)=>{
    try {
      const host=req.headers.host || 'localhost';
      const url=new URL(req.originalUrl, `${req.secure?'https':'http'}://${host}`);
      const headers=new Headers();
      for (const [key,value] of Object.entries(req.headers)) if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);
      const body=Buffer.isBuffer(req.body)&&req.body.length?req.body:undefined;
      const request=new Request(url,{method:req.method,headers,...(body?{body}: {})});
      const result=await dispatchPagesApi(request,process.env);
      res.status(result.status);
      result.headers.forEach((value,key)=>res.setHeader(key,value));
      res.send(Buffer.from(await result.arrayBuffer()));
    } catch { res.status(503).json({error:'Service unavailable'}); }
  });
  if (!production) {
    const vite=await createViteServer({server:{middlewareMode:true},appType:'spa'});
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve('dist'),{dotfiles:'deny'}));
    app.get('*',(_req,res)=>res.sendFile(path.resolve('dist/index.html')));
  }
  const port=Number(process.env.PORT || 3000);
  app.listen(port,process.env.HOST || '0.0.0.0',()=>console.log('[SERVER] listening on port',port));
}
startServer().catch(()=>{console.error('[SERVER] startup failed');process.exitCode=1;});
''')
p=R/'src/tenant-host-map.ts';s=p.read_text();s=s.replace("export function resolveTenantFromRequest(request: { url: string }, env: any): string {\n  return resolveTenantFromHostname(new URL(request.url).hostname, env);\n}",'''export function resolveTenantFromRequest(request: { url: string; headers?: Headers }, env: any): string {
  const url=new URL(request.url);
  const slug=resolveTenantFromHostname(url.hostname,env);
  const normalize=(value:string)=>value==='root'?'default':value;
  const supplied=[request.headers?.get?.('x-tenant-slug'),request.headers?.get?.('x-tenant'),...url.searchParams.getAll('tenant'),...url.searchParams.getAll('slug')].filter(Boolean);
  if(supplied.some(value=>normalize(String(value))!==slug))throw new Error('Untrusted tenant selector');
  return slug;
}
''');p.write_text(s)
