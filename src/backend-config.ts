/**
 * CẤU HÌNH HỆ THỐNG BACKEND - 100% CƠ SỞ DỮ LIỆU POSTGRESQL / NEON
 * Đã gỡ bỏ hoàn toàn mọi kết nối tới cơ sở dữ liệu cũ D1.
 */

export const BACKEND_CONFIG = {
  // 1. Google Gemini AI
  GEMINI_API_KEY: "", 

  // 2. Neon.tech PostgreSQL Database (Cơ sở dữ liệu chính thức 100%)
  NEON_DATABASE_URL: "",

  // 3. Cloudflare R2 Storage (Lưu trữ ảnh & đề thi)
  CLOUDFLARE_R2_ACCOUNT_ID: "",
  CLOUDFLARE_R2_ACCESS_KEY_ID: "",
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: "",
  CLOUDFLARE_R2_BUCKET_NAME: "",
  CLOUDFLARE_R2_PUBLIC_URL: "", 
};

/**
 * Lấy cấu hình ưu tiên: Dán trực tiếp > Biến môi trường
 */
export function getConfig(key: keyof typeof BACKEND_CONFIG): string {
  // Ưu tiên 1: Giá trị dán trực tiếp trong file này (Hardcoded)
  const hardcoded = BACKEND_CONFIG[key];
  if (hardcoded && hardcoded.trim().length > 0) {
    return hardcoded.trim();
  }
  
  // Ưu tiên 2: Biến môi trường
  const envKey = key;
  const envVal = process.env[envKey] || "";
  return envVal.trim();
}

/**
 * Kiểm tra xem biến đã được cấu hình hợp lệ chưa (dài hơn 5 ký tự)
 */
export function isConfigured(key: keyof typeof BACKEND_CONFIG): boolean {
  const val = getConfig(key);
  return val.length > 5 && !val.includes("YOUR_") && !val.includes("CHƯA_");
}

/**
 * Phân giải chuỗi kết nối CSDL theo đúng slug hoặc fallback về mặc định cho Node.js server
 */
export function getTenantDatabaseConfig(slug?: string, options: { exactOnly?: boolean } = {}): { url: string; source: string; slug: string } {
  const cleanSlug = (slug || '').trim();
  if (!cleanSlug || cleanSlug === 'default' || cleanSlug === 'root') {
    const defaultUrl = getConfig('NEON_DATABASE_URL') || process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || '';
    return { url: defaultUrl.trim(), source: 'NEON_DATABASE_URL', slug: '' };
  }

  if (options.exactOnly) {
    const v = Object.prototype.hasOwnProperty.call(process.env,cleanSlug) ? process.env[cleanSlug] : undefined;
    return v && v.trim() ? {url:v.trim(),source:cleanSlug,slug:cleanSlug} : {url:'',source:'NOT_FOUND',slug:cleanSlug};
  }
  // 1. Tên biến 100% trùng khớp nguyên bản với slug (ví dụ kiemtra1)
  if (process.env[cleanSlug] && process.env[cleanSlug]!.trim().length > 0) {
    return { url: process.env[cleanSlug]!.trim(), source: cleanSlug, slug: cleanSlug };
  }

  // 2. Chữ hoa (ví dụ KIEMTRA1)
  const upper = cleanSlug.toUpperCase();
  if (process.env[upper] && process.env[upper]!.trim().length > 0) {
    return { url: process.env[upper]!.trim(), source: upper, slug: cleanSlug };
  }

  // 3. Chữ thường (ví dụ kiemtra1)
  const lower = cleanSlug.toLowerCase();
  if (process.env[lower] && process.env[lower]!.trim().length > 0) {
    return { url: process.env[lower]!.trim(), source: lower, slug: cleanSlug };
  }

  // 4. Các biến thể định dạng NEON_DATABASE_URL_XXX
  const normalized = cleanSlug.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const candidates = [
    `NEON_DATABASE_URL_${normalized}`,
    `DATABASE_URL_${normalized}`,
    `NEON_DATABASE_URL_${cleanSlug}`,
    `DATABASE_URL_${cleanSlug}`,
    `${normalized}_DATABASE_URL`
  ];

  for (const k of candidates) {
    if (process.env[k] && process.env[k]!.trim().length > 0) {
      return { url: process.env[k]!.trim(), source: k, slug: cleanSlug };
    }
  }

  // Tuyệt đối không fallback về CSDL mặc định khi slug riêng chưa có biến môi trường
  return { url: '', source: 'NOT_FOUND', slug: cleanSlug };
}
