import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveTenantRoutingFromRequest, resolveTenantFromRequest } from '../src/tenant-host-map.ts';
import { getTenantDatabaseUrl, getEffectiveDb } from '../functions/api/neon-adapter.ts';
import { getTenantDatabaseConfig } from '../src/backend-config.ts';

const defaultUrl='postgresql://u:pass@default.example.neon.tech/defaultdb?sslmode=require';
const csdlaUrl='postgresql://u:pass@csdla.example.neon.tech/csdla_db?sslmode=require';
const v1Url='postgresql://u:pass@v1.example.neon.tech/v1_db?sslmode=require';
const env={
 NEON_DATABASE_URL:defaultUrl,
 DATABASE_URL:'postgresql://ignored.example/fallback',
 csdla:csdlaUrl,
 v1:v1Url,
 V1:'postgresql://wrong.example/wrong'
};
function route(path: string,bindings: any=env,host='testpro.id.vn'){
 return resolveTenantRoutingFromRequest({url:'https://'+host+path},bindings);
}
test('root and direct /api/* use default, ignoring query and headers',()=>{
 for(const path of ['/','/api/health','/api/auth/login','/index.html','/assets/a.js','/?tenant=csdla','/?slug=v1']) {
   const selected=route(path);
   assert.equal(selected.slug,'default');
   assert.equal(getTenantDatabaseUrl(env,selected.slug,{exactOnly:selected.source==='path'}).url,defaultUrl);
 }
});
test('path slug selects exactly matching Cloudflare variable',()=>{
 for(const key of ['csdla','v1']) {
   for(const path of ['/'+key,'/'+key+'/','/'+key+'/api/health','/'+key+'/api/auth/login']) {
     const selected=route(path);
     assert.deepEqual(selected,{slug:key,source:'path',prefix:'/'+key});
     assert.equal(resolveTenantFromRequest({url:'https://testpro.id.vn'+path},env),key);
     assert.equal(getTenantDatabaseUrl(env,key,{exactOnly:true}).url,env[key as keyof typeof env]);
   }
 }
 const onlyUpper={NEON_DATABASE_URL:defaultUrl,V1:v1Url};
 assert.equal(getTenantDatabaseUrl(onlyUpper,'v1',{exactOnly:true}).source,'NOT_FOUND');
 assert.equal(getTenantDatabaseUrl(onlyUpper,'v1',{exactOnly:true}).url,'');
});
test('missing and malformed bindings fail closed',()=>{
 const binding={NEON_DATABASE_URL:defaultUrl,DATABASE_URL:defaultUrl};
 assert.equal(getTenantDatabaseUrl(binding,'no_such_school',{exactOnly:true}).url,'');
 assert.throws(()=>getEffectiveDb({env:binding,request:new Request('https://testpro.id.vn/no_such_school/api/health')}));
 assert.throws(()=>getEffectiveDb({env:{...binding,csdla:'invalid'},request:new Request('https://testpro.id.vn/csdla/api/health')}));
});
test('untrusted headers, query and Referer do not choose the tenant',()=>{
 const req=new Request('https://testpro.id.vn/csdla/api/results?tenant=v1&slug=v1',{
   headers:{'X-Tenant-Slug':'v1','X-Tenant':'v1','Referer':'https://testpro.id.vn/v1'}
 });
 assert.equal(resolveTenantFromRequest(req,env),'csdla');
 assert.equal(getEffectiveDb({env,request:req}).connectionUrl,csdlaUrl);
 const spoof=new Request('https://testpro.id.vn/api/results?tenant=csdla',{
   headers:{'X-Tenant-Slug':'csdla'}
 });
 assert.equal(getEffectiveDb({env,request:spoof}).connectionUrl,defaultUrl);
});
test('Neon database client cache is separate per connection URL',()=>{
 const a=getEffectiveDb({env,request:new Request('https://testpro.id.vn/csdla/api/health')});
 const b=getEffectiveDb({env,request:new Request('https://testpro.id.vn/v1/api/health')});
 const root=getEffectiveDb({env,request:new Request('https://testpro.id.vn/api/health')});
 assert.notEqual(a,b);
 assert.notEqual(a,root);
 assert.notEqual(b,root);
 assert.equal(a.connectionUrl,csdlaUrl);
 assert.equal(b.connectionUrl,v1Url);
});
test('hostname-pinned tenant cannot be overridden by path',()=>{
 const bindings={...env,TENANT_HOST_MAP:JSON.stringify({'school-a.example.vn':'school_a'}),school_a:csdlaUrl};
 assert.deepEqual(route('/v1/api/results',bindings,'school-a.example.vn'),{
   slug:'school_a',source:'hostname',prefix:''
 });
 assert.throws(()=>route('/v1',env,'evil.invalid'));
});
test('malformed tenant paths are invalid',()=>{
 for(const p of ['/default','/root','/two%2fwords','/two%5cwords',
   '/%20abc','/v1%2Fapi/health']) assert.throws(()=>route(p),p);
});
test('Node resolver supports exact-only variables and default',()=>{
 const keys=['csdla','NEON_DATABASE_URL'];
 const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try {
   process.env.csdla=csdlaUrl;
   process.env.NEON_DATABASE_URL=defaultUrl;
   assert.equal(getTenantDatabaseConfig('csdla',{exactOnly:true}).url,csdlaUrl);
   assert.equal(getTenantDatabaseConfig('unknown_slug',{exactOnly:true}).url,'');
   assert.equal(getTenantDatabaseConfig('default').url,defaultUrl);
 } finally {
   for(const k of keys) {
     if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];
   }
 }
});
test('tenant API router preserves all existing endpoint families',()=>{
 const router=readFileSync('functions/[slug]/api/[[path]].ts','utf8');
 const required=['auth/login','accounts','questions','results','exams','exam/grade','questions/import-word','teacher-classes','documents','settings','health'];
 for(const endpoint of required)assert.ok(router.includes("'"+endpoint+"':"),endpoint);
 assert.match(router,/resolveTenantRoutingFromRequest/);
 assert.doesNotMatch(router,/request\.headers\.get\(['"]X-Tenant-Slug/);
});
