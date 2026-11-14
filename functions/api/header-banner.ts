import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { checkIsAdmin, getDatabase, getDynamicSecret, verifyAuthSession } from './exam/utils';
import { resolveTenantRoutingFromRequest } from '../../src/tenant-host-map';
import { bannerPublicUrl, headerMode, validTenantBannerKey } from '../../src/header-branding-policy.js';

interface Env {
  NEON_DATABASE_URL?: string;
  DATABASE_URL?: string;
  JWT_SECRET?: string;
  CLOUDFLARE_R2_ACCESS_KEY_ID?: string;
  CLOUDFLARE_R2_SECRET_ACCESS_KEY?: string;
  CLOUDFLARE_R2_BUCKET_NAME?: string;
  CLOUDFLARE_R2_ACCOUNT_ID?: string;
  CLOUDFLARE_R2_PUBLIC_URL?: string;
  [key: string]: any;
}

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff'
};
const response = (status: number, result: object) =>
  new Response(JSON.stringify(result), { status, headers });

async function adminContext(context: EventContext<Env, any, any>) {
  const db = getDatabase(context);
  const auth = context.request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return { db, user: null };
  const secret = await getDynamicSecret(db, context.env.JWT_SECRET);
  const user = await verifyAuthSession(auth.slice(7).trim(), secret, db);
  return { db, user: checkIsAdmin(user) ? user : null };
}

async function ensureBannerColumns(db: any) {
  // Additive, idempotent migration, scoped to the VERIFIED current database.
  await db.prepare("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS header_display_mode TEXT NOT NULL DEFAULT 'text'").run();
  await db.prepare("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS header_banner_url TEXT NOT NULL DEFAULT ''").run();
  await db.prepare("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS header_banner_key TEXT NOT NULL DEFAULT ''").run();
  await db.prepare("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS header_banner_alt TEXT NOT NULL DEFAULT ''").run();
  await db.prepare("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS header_banner_tablet_url TEXT NOT NULL DEFAULT ''").run();
  await db.prepare("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS header_banner_tablet_key TEXT NOT NULL DEFAULT ''").run();
  await db.prepare("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS header_banner_mobile_url TEXT NOT NULL DEFAULT ''").run();
  await db.prepare("ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS header_banner_mobile_key TEXT NOT NULL DEFAULT ''").run();
}

function getTenant(context: EventContext<Env, any, any>) {
  return resolveTenantRoutingFromRequest(context.request, context.env).slug;
}

function inspectImage(bytes: Uint8Array, mime: string) {
  const png = mime === 'image/png' && bytes.length > 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const jpeg = mime === 'image/jpeg' && bytes.length > 10 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = mime === 'image/webp' && bytes.length > 16 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return png ? 'png' : jpeg ? 'jpg' : webp ? 'webp' : null;
}

export const onRequestPost: PagesFunction<Env> = async context => {
  try {
    const { user } = await adminContext(context);
    if (!user) return response(403, { error: 'Chỉ Admin được tải banner hệ thống.' });
    const body: any = await context.request.json();
    const base64 = body?.base64;
    if (typeof base64 !== 'string' || base64.length > 7_000_000) {
      return response(413, { error: 'Ảnh banner không hợp lệ hoặc vượt 5 MB.' });
    }
    const matched = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(base64);
    if (!matched) return response(415, { error: 'Chỉ chấp nhận PNG, JPG hoặc WebP.' });
    const raw = atob(matched[2]);
    if (raw.length > 5 * 1024 * 1024 || raw.length === 0) return response(413, { error: 'Ảnh banner tối đa 5 MB.' });
    const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
    const mime = matched[1] === 'jpeg' ? 'image/jpeg' : 'image/' + matched[1];
    const extension = inspectImage(bytes, mime);
    if (!extension) return response(415, { error: 'Chữ ký tệp ảnh không khớp định dạng.' });
    const tenant = getTenant(context);
    const key = 'luuhinhnh/banner-he-thong/' + tenant + '/' + crypto.randomUUID().replace(/-/g, '') + '.' + extension;
    const env = context.env;
    if (!env.CLOUDFLARE_R2_ACCESS_KEY_ID || !env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ||
        !env.CLOUDFLARE_R2_BUCKET_NAME || !env.CLOUDFLARE_R2_ACCOUNT_ID) {
      return response(503, { error: 'Kho Cloudflare R2 chưa được cấu hình; không thể lưu banner an toàn.' });
    }
    const url = bannerPublicUrl(key, tenant, env);
    const s3 = new S3Client({
      region: 'auto',
      endpoint: 'https://' + env.CLOUDFLARE_R2_ACCOUNT_ID + '.r2.cloudflarestorage.com',
      credentials: {
        accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID,
        secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY
      },
      forcePathStyle: true
    });
    await s3.send(new PutObjectCommand({
      Bucket: env.CLOUDFLARE_R2_BUCKET_NAME,
      Key: key,
      Body: bytes,
      ContentType: mime,
      CacheControl: 'public, max-age=31536000, immutable'
    }));
    return response(200, { data: { key, url }, error: null });
  } catch (error: any) {
    console.error('[Header banner upload]', error?.message || error);
    return response(500, { error: 'Không thể lưu banner lên kho hình ảnh R2.' });
  }
};

export const onRequestPut: PagesFunction<Env> = async context => {
  try {
    const { db, user } = await adminContext(context);
    if (!user) return response(403, { error: 'Chỉ Admin được thay đổi giao diện đầu trang.' });
    const body: any = await context.request.json();
    if (!['text', 'banner', 'both'].includes(body?.header_display_mode))
      return response(400, { error: 'Chế độ hiển thị không hợp lệ.' });
    const mode = headerMode(body.header_display_mode);
    const tenant = getTenant(context);
    const key = typeof body.header_banner_key === 'string' ? body.header_banner_key : '';
    const url = typeof body.header_banner_url === 'string' ? body.header_banner_url : '';
    if (key || url) {
      if (!validTenantBannerKey(key, tenant) || url !== bannerPublicUrl(key, tenant, context.env))
        return response(400, { error: 'Banner không hợp lệ hoặc không thuộc cơ sở dữ liệu hiện tại.' });
    }
    const optionalVariant = (device: 'tablet' | 'mobile') => {
      const candidateKey = body['header_banner_' + device + '_key'];
      const candidateUrl = body['header_banner_' + device + '_url'];
      if (candidateKey === undefined && candidateUrl === undefined) return null;
      if (typeof candidateKey !== 'string' || typeof candidateUrl !== 'string')
        throw new Error('Thiếu hoặc sai định dạng banner ' + device + '.');
      if (!candidateKey && !candidateUrl) return { key: '', url: '' };
      if (!validTenantBannerKey(candidateKey, tenant) ||
          candidateUrl !== bannerPublicUrl(candidateKey, tenant, context.env))
        throw new Error('Banner ' + device + ' không thuộc tenant hiện tại.');
      return { key: candidateKey, url: candidateUrl };
    };
    let tablet: { key: string; url: string } | null;
    let mobile: { key: string; url: string } | null;
    try {
      tablet = optionalVariant('tablet');
      mobile = optionalVariant('mobile');
    } catch (error: any) {
      return response(400, { error: error.message || 'Banner thiết bị không hợp lệ.' });
    }
    if (mode !== 'text' && (!key || !url))
      return response(400, { error: 'Vui lòng tải và lưu banner máy tính trước khi chọn chế độ có hình.' });
    const alt = typeof body.header_banner_alt === 'string' ? body.header_banner_alt.trim().slice(0, 120) : '';
    const title = typeof body.app_title === 'string' ? body.app_title.trim() : '';
    if (!title || title.length > 180) return response(400, { error: 'Tiêu đề hệ thống phải có 1–180 ký tự.' });
    await ensureBannerColumns(db);
    const existing: any = await db.prepare(`
      SELECT header_banner_tablet_url, header_banner_tablet_key,
             header_banner_mobile_url, header_banner_mobile_key
      FROM app_settings WHERE id = 1
    `).first();
    if (!existing) return response(409, { error: 'Không tồn tại cấu hình hệ thống để cập nhật.' });
    const tabletAsset = tablet ?? {
      key: String(existing.header_banner_tablet_key || ''),
      url: String(existing.header_banner_tablet_url || '')
    };
    const mobileAsset = mobile ?? {
      key: String(existing.header_banner_mobile_key || ''),
      url: String(existing.header_banner_mobile_url || '')
    };
    // Clearing the main banner also clears the two optional image variants.
    const finalTablet = key && url ? tabletAsset : { key: '', url: '' };
    const finalMobile = key && url ? mobileAsset : { key: '', url: '' };
    const changed = await db.prepare(`
      UPDATE app_settings
      SET header_display_mode = ?, header_banner_url = ?, header_banner_key = ?,
          header_banner_tablet_url = ?, header_banner_tablet_key = ?,
          header_banner_mobile_url = ?, header_banner_mobile_key = ?,
          header_banner_alt = ?, app_title = ?
      WHERE id = 1
    `).bind(mode, url, key,
      finalTablet.url, finalTablet.key,
      finalMobile.url, finalMobile.key,
      alt, title).run();
    if (!changed?.meta?.changes && !changed?.changes) {
      const exists = await db.prepare('SELECT id FROM app_settings WHERE id = 1').first();
      if (!exists) return response(409, { error: 'Không tồn tại cấu hình hệ thống để cập nhật.' });
    }
    return response(200, {
      data: {
        app_title: title,
        header_display_mode: mode,
        header_banner_url: url,
        header_banner_key: key,
        header_banner_tablet_url: finalTablet.url,
        header_banner_tablet_key: finalTablet.key,
        header_banner_mobile_url: finalMobile.url,
        header_banner_mobile_key: finalMobile.key,
        header_banner_alt: alt
      },
      error: null
    });
  } catch (error: any) {
    console.error('[Header branding save]', error?.message || error);
    return response(500, { error: 'Không thể lưu cấu hình banner. Cấu hình cũ được giữ nguyên.' });
  }
};
