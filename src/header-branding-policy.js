/** Shared, restrictive policy for tenant-scoped application header banners. */
export const HEADER_BRANDING_MODES = Object.freeze(['text', 'banner', 'both']);
export const DEFAULT_HEADER_TITLE = 'HỆ THỐNG KIỂM TRA TRỰC TUYẾN';
const FOLDER = 'luuhinhnh/banner-he-thong';

export function headerMode(mode) {
  return HEADER_BRANDING_MODES.includes(mode) ? mode : 'text';
}

export function validTenantBannerKey(key, tenant) {
  const slug = String(tenant || 'default');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(slug)) return false;
  const prefix = FOLDER + '/' + slug + '/';
  if (typeof key !== 'string' || !key.startsWith(prefix)) return false;
  const filename = key.slice(prefix.length);
  return /^[a-f0-9]{32}\.(png|jpg|webp)$/.test(filename);
}

export function bannerPublicUrl(key, tenant, env) {
  if (!validTenantBannerKey(key, tenant)) throw new Error('Đường dẫn banner không thuộc tenant hợp lệ.');
  const explicit = String(env?.CLOUDFLARE_R2_PUBLIC_URL || '').trim();
  const fallback = env?.CLOUDFLARE_R2_BUCKET_NAME && env?.CLOUDFLARE_R2_ACCOUNT_ID
    ? 'https://' + env.CLOUDFLARE_R2_BUCKET_NAME + '.' + env.CLOUDFLARE_R2_ACCOUNT_ID + '.r2.dev'
    : '';
  const raw = (explicit || fallback).replace(/\/+$/, '');
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('Chưa có đường dẫn công khai Cloudflare R2.'); }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new Error('Đường dẫn công khai Cloudflare R2 không hợp lệ.');
  return parsed.href.replace(/\/+$/, '') + '/' + key;
}

export function normalizedHeaderBranding(raw) {
  const mode = headerMode(raw?.header_display_mode);
  const url = typeof raw?.header_banner_url === 'string' &&
    /^https:\/\/[^\s"'<>]+$/.test(raw.header_banner_url)
    ? raw.header_banner_url : '';
  // Fail safe: never hide the header title if a banner is unavailable.
  return {
    mode: mode !== 'text' && !url ? 'text' : mode,
    url,
    alt: typeof raw?.header_banner_alt === 'string'
      ? raw.header_banner_alt.slice(0, 120) : '',
    key: typeof raw?.header_banner_key === 'string' ? raw.header_banner_key : ''
  };
}
