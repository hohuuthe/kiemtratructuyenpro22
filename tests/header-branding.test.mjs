import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bannerPublicUrl, headerMode, validTenantBannerKey, normalizedHeaderBranding } from '../src/header-branding-policy.js';

const key = 'luuhinhnh/banner-he-thong/gialaithptlehoan/' + 'a'.repeat(32) + '.webp';
const env = {
  CLOUDFLARE_R2_PUBLIC_URL:'https://static.example.test/assets/',
  CLOUDFLARE_R2_BUCKET_NAME:'shared-photos',
  CLOUDFLARE_R2_ACCOUNT_ID:'example-account'
};
const read = path => readFileSync(new URL('../' + path,import.meta.url),'utf8');

test('only three display modes are supported with safe text-only fallback',()=>{
  assert.equal(headerMode('text'),'text');
  assert.equal(headerMode('banner'),'banner');
  assert.equal(headerMode('both'),'both');
  for(const invalid of ['','script','BANNER',null,{},'javascript:alert(1)'])
    assert.equal(headerMode(invalid),'text');
  assert.equal(normalizedHeaderBranding(null).mode,'text');
  assert.equal(normalizedHeaderBranding({header_display_mode:'both'}).mode,'text');
  assert.equal(normalizedHeaderBranding({header_display_mode:'banner',header_banner_url:''}).mode,'text');
});

test('banner key uses strict tenant-prefix and immutable unique filename',()=>{
  assert.equal(validTenantBannerKey(key,'gialaithptlehoan'),true);
  for(const bad of [
    key.replace('gialaithptlehoan','other'),
    'luuhinhnh/banner-he-thong/gialaithptlehoan/../../private.jpg',
    'luuhinhnh/image.jpg',
    key.replace(/\.webp$/,'.svg'),
    key.replace('a'.repeat(32),'image'),
    key.replace('a'.repeat(32),'a'.repeat(33))
  ]) assert.equal(validTenantBannerKey(bad,'gialaithptlehoan'),false,bad);
  assert.equal(validTenantBannerKey(key,'../anything'),false);
});

test('server constructs public URLs from authenticated tenant keys, rejects untrusted origins',()=>{
  assert.equal(bannerPublicUrl(key,'gialaithptlehoan',env),'https://static.example.test/assets/'+key);
  assert.throws(()=>bannerPublicUrl(key,'other',env));
  assert.throws(()=>bannerPublicUrl(key,'gialaithptlehoan',{...env,CLOUDFLARE_R2_PUBLIC_URL:'http://bad.test'}));
  assert.throws(()=>bannerPublicUrl(key,'gialaithptlehoan',{...env,CLOUDFLARE_R2_PUBLIC_URL:'https://user:pass@bad.test'}));
});

test('banner title remains readable if image fails, absent URL or mode text',()=>{
  const front=read('src/header-branding-ui.js');
  assert.match(front,/image\.onerror = \(\) =>/);
  assert.match(front,/title\.classList\.remove\('sr-only'\)/);
  assert.match(front,/banner\.hidden = true/);
  assert.match(front,/headerMode/);
  assert.match(front,/requestJson\('POST', \{ base64 \}\)/);
  assert.match(front,/requestJson\('PUT', draft\)/);
  assert.match(front,/refreshHeader\?\.\(\)/);
  assert.match(front,/file\.size > 5 \* 1024 \* 1024/);
});

test('admin-only upload and settings save, forbid R2 fallback and check image signature',()=>{
  const api=read('functions/api/header-banner.ts');
  assert.match(api,/verifyAuthSession\(/);
  assert.match(api,/checkIsAdmin\(/);
  assert.match(api,/resolveTenantRoutingFromRequest/);
  assert.match(api,/inspectImage\(bytes, mime\)/);
  assert.match(api,/validTenantBannerKey\(key, tenant\)/);
  assert.match(api,/new PutObjectCommand/);
  assert.match(api,/return response\(503/);
  assert.doesNotMatch(api,/database_base64_compressed|image\/svg/);
  assert.match(api,/ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS/);
});

test('public bootstrap publishes only non-secret appearance fields and supports older schemas',()=>{
  const publicApi=read('functions/api/bootstrap.ts');
  assert.match(publicApi,/header_display_mode: branding\.mode/);
  assert.match(publicApi,/header_banner_url: branding\.url/);
  assert.doesNotMatch(publicApi,/ai_grading_key|password|accounts/);
  assert.match(publicApi,/catch \{\s*header = null/);
  assert.match(read('server.ts'),/app\.get\('\/api\/bootstrap'/);
});

test('layout and administrator settings integrate with current lazy-loaded settings tab',()=>{
  const main=read('src/main.js');
  const html=read('index.html');
  const tab=read('public/components/tab-settings.html');
  assert.match(main,/applyHeaderBranding\(appSettings\)/);
  assert.match(main,/populateBrandingSettings\(appSettings\)/);
  assert.match(main,/window\.saveHeaderBrandingSettings/);
  assert.match(main,/headerDisplayMode:d\.header_display_mode/);
  assert.match(html,/id="app-header-banner"/);
  assert.match(html,/id="app-header-banner-img"/);
  assert.match(tab,/id="settings-header-mode"/);
  assert.match(tab,/id="settings-header-banner-file"/);
  assert.match(tab,/id="settings-banner-key"/);
  assert.match(tab,/id="settings-header-save"/);
  assert.match(read('public/header-branding.css'),/max-height:108px/);
  assert.match(read('migrations/20261114_header_banner_branding.sql'),/ALTER TABLE public\.app_settings/);
});
