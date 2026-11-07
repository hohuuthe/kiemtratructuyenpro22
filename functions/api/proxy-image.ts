interface Env {
  CLOUDFLARE_R2_PUBLIC_URL?: string;
  CLOUDFLARE_R2_BUCKET_NAME?: string;
  CLOUDFLARE_R2_ACCOUNT_ID?: string;
}

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const SAFE_IMAGE_TYPES = new Set([
  'image/png','image/jpeg','image/jpg','image/gif','image/webp','image/avif'
]);

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h === '::1') return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(h) || /^fe[89ab][0-9a-f]:/i.test(h)) return true;
  return false;
}

function allowedUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || isPrivateHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const raw = new URL(context.request.url).searchParams.get('url') || '';
    if (raw.length > 4096) return new Response('URL vượt giới hạn.', { status: 400 });
    const imageUrl = allowedUrl(raw);
    if (!imageUrl) return new Response('Nguồn ảnh không được phép.', { status: 403 });

    const imgRes = await fetch(imageUrl.href, { redirect: 'error' });
    if (!imgRes.ok) return new Response('Không thể tải ảnh nguồn.', { status: imgRes.status });

    const contentType = String(imgRes.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!SAFE_IMAGE_TYPES.has(contentType)) {
      return new Response('Nguồn không phải định dạng ảnh an toàn.', { status: 415 });
    }
    const declared = Number(imgRes.headers.get('content-length') || 0);
    if (declared > MAX_IMAGE_BYTES) return new Response('Ảnh vượt giới hạn proxy.', { status: 413 });

    const buffer = await imgRes.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) return new Response('Ảnh vượt giới hạn proxy.', { status: 413 });

    return new Response(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cross-Origin-Resource-Policy': 'same-site'
      }
    });
  } catch {
    return new Response('Lỗi máy chủ proxy ảnh.', { status: 500 });
  }
};
