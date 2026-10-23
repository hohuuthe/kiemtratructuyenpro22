import { neon } from '@neondatabase/serverless';

/**
 * Bộ phân tích và chuyển đổi câu lệnh SQL SQLite sang PostgreSQL chuẩn mực
 * An toàn tuyệt đối: Không thay thế dấu ? nằm trong chuỗi ký tự '...' hoặc "..." hoặc comment.
 */
export function convertSqliteToPostgres(sql: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let paramIndex = 1;
  let result = '';

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1];

    if (inLineComment) {
      result += char;
      if (char === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      result += char;
      if (char === '*' && nextChar === '/') {
        result += '/';
        i++;
        inBlockComment = false;
      }
      continue;
    }

    if (inSingleQuote) {
      result += char;
      if (char === "'" && sql[i - 1] !== '\\') {
        if (nextChar === "'") {
          result += "'";
          i++;
        } else {
          inSingleQuote = false;
        }
      }
      continue;
    }

    if (inDoubleQuote) {
      result += char;
      if (char === '"' && sql[i - 1] !== '\\') {
        inDoubleQuote = false;
      }
      continue;
    }

    // Comment phát hiện
    if (char === '-' && nextChar === '-') {
      inLineComment = true;
      result += '--';
      i++;
      continue;
    }
    if (char === '/' && nextChar === '*') {
      inBlockComment = true;
      result += '/*';
      i++;
      continue;
    }

    // String phát hiện
    if (char === "'") {
      inSingleQuote = true;
      result += char;
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      result += char;
      continue;
    }

    if (char === '?') {
      result += `$${paramIndex++}`;
    } else {
      result += char;
    }
  }

  // Tương thích INSERT OR REPLACE INTO trong Postgres -> INSERT INTO ... ON CONFLICT
  const trimmed = result.trim();
  if (/^INSERT\s+OR\s+REPLACE\s+INTO\s+_internal_secrets/i.test(trimmed)) {
    result = result.replace(/^INSERT\s+OR\s+REPLACE\s+INTO\s+_internal_secrets/i, 'INSERT INTO _internal_secrets')
      + ' ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value';
  } else if (/^INSERT\s+OR\s+REPLACE\s+INTO\s+([a-zA-Z0-9_]+)/i.test(trimmed)) {
    result = result.replace(/^INSERT\s+OR\s+REPLACE\s+INTO/i, 'INSERT INTO')
      + ' ON CONFLICT (id) DO NOTHING';
  }

  // Tự động chuyển đổi ALTER TABLE ADD COLUMN thành ADD COLUMN IF NOT EXISTS trong PostgreSQL
  result = result.replace(/ALTER\s+TABLE\s+([a-zA-Z0-9_]+)\s+ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/gi, 'ALTER TABLE $1 ADD COLUMN IF NOT EXISTS ');
  result = result.replace(/ALTER\s+TABLE\s+([a-zA-Z0-9_]+)\s+ADD\s+(?!COLUMN|CONSTRAINT|IF\s+NOT\s+EXISTS)([a-zA-Z0-9_]+)/gi, 'ALTER TABLE $1 ADD COLUMN IF NOT EXISTS $2');

  return result;
}

/**
 * Chuẩn hóa URL Database PostgreSQL với sslmode=require
 */
export function normalizeDatabaseUrl(raw?: string): string {
  let url = (raw || '').trim();
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    url = url.substring(1, url.length - 1).trim();
  }
  if (url && !url.includes('sslmode=') && !url.includes('ssl=')) {
    url += (url.includes('?') ? '&' : '?') + 'sslmode=require';
  }
  return url;
}

/**
 * Trích xuất tenant slug từ request context hoặc tham số
 */
export function extractTenantSlug(requestOrSlug?: any): string {
  if (!requestOrSlug) return '';
  if (typeof requestOrSlug === 'string') return requestOrSlug.trim();
  
  if (typeof requestOrSlug === 'object') {
    // Nếu đối tượng được truyền vào là Cloudflare context (có .request)
    const req = requestOrSlug.request || requestOrSlug;

    // 1. Kiểm tra Request Headers (Cloudflare Pages hoặc Node.js)
    if (req.headers) {
      const headerVal = typeof req.headers.get === 'function' ?
        (req.headers.get('x-tenant-slug') || req.headers.get('x-tenant')) :
        (req.headers['x-tenant-slug'] || req.headers['x-tenant']);
      if (headerVal && typeof headerVal === 'string' && headerVal.trim().length > 0) {
        return headerVal.trim();
      }
    }

    // 2. Kiểm tra URL Query Params (?tenant= hoặc ?slug=)
    try {
      const urlStr = req.url || '';
      if (urlStr.includes('?')) {
        const urlObj = new URL(urlStr, 'http://localhost');
        const qTenant = urlObj.searchParams.get('tenant') || urlObj.searchParams.get('slug');
        if (qTenant && qTenant.trim().length > 0) return qTenant.trim();
      }
    } catch {}

    // 3. Kiểm tra URL pathname (nếu route là /slug/api/...)
    try {
      const urlStr = req.url || '';
      if (urlStr) {
        const parsed = new URL(urlStr, 'http://localhost');
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        if (pathParts.length > 0 && pathParts[0] !== 'api' && pathParts[0] !== 'assets' && pathParts[0] !== 'index.html' && pathParts[0] !== 'favicon.ico') {
          return pathParts[0];
        }
      }
    } catch {}

    // 4. Kiểm tra Referer header (nếu client fetch từ trang /slug/...)
    try {
      if (req.headers) {
        const referer = typeof req.headers.get === 'function' ? req.headers.get('referer') : req.headers['referer'];
        if (referer) {
          const parsed = new URL(referer, 'http://localhost');
          const pathParts = parsed.pathname.split('/').filter(Boolean);
          if (pathParts.length > 0 && pathParts[0] !== 'api' && pathParts[0] !== 'assets' && pathParts[0] !== 'index.html' && pathParts[0] !== 'favicon.ico') {
            return pathParts[0];
          }
        }
      }
    } catch {}
  }
  return '';
}

export const DEFAULT_NEON_URL = "";

/**
 * Phân giải chuỗi kết nối CSDL theo đúng slug hoặc fallback về mặc định
 * Quy tắc:
 * 1. Không có slug (URL mặc định) -> dùng NEON_DATABASE_URL
 * 2. Có slug (ví dụ 'kiemtra1') -> tìm biến có tên 100% giống slug (ví dụ 'kiemtra1' hoặc 'KIEMTRA1')
 */
export function getTenantDatabaseUrl(env: any, tenantSlug?: string): { url: string; source: string; slug: string } {
  const slug = (tenantSlug || '').trim();

  // 1. Nếu không có slug (Đường dẫn mặc định) -> Kết nối NEON_DATABASE_URL
  if (!slug || slug === 'default' || slug === 'root') {
    const defaultUrl = (
      env?.NEON_DATABASE_URL ||
      env?.DATABASE_URL ||
      (typeof process !== 'undefined' ? process.env?.NEON_DATABASE_URL || process.env?.DATABASE_URL : '') ||
      DEFAULT_NEON_URL
    );
    return { url: normalizeDatabaseUrl(defaultUrl), source: 'NEON_DATABASE_URL', slug: '' };
  }

  // 2. Nếu đường dẫn có chứa Slug (ví dụ kiemtra1):
  // Ưu tiên 1: Tên biến 100% trùng khớp nguyên bản với slug (ví dụ: kiemtra1)
  if (env && typeof env[slug] === 'string' && env[slug].trim().length > 0) {
    return { url: normalizeDatabaseUrl(env[slug].trim()), source: slug, slug };
  }
  if (typeof process !== 'undefined' && process.env && typeof process.env[slug] === 'string' && process.env[slug]!.trim().length > 0) {
    return { url: normalizeDatabaseUrl(process.env[slug]!.trim()), source: slug, slug };
  }

  // Ưu tiên 2: Tên biến chữ hoa (ví dụ: KIEMTRA1)
  const upperSlug = slug.toUpperCase();
  if (env && typeof env[upperSlug] === 'string' && env[upperSlug].trim().length > 0) {
    return { url: normalizeDatabaseUrl(env[upperSlug].trim()), source: upperSlug, slug };
  }
  if (typeof process !== 'undefined' && process.env && typeof process.env[upperSlug] === 'string' && process.env[upperSlug]!.trim().length > 0) {
    return { url: normalizeDatabaseUrl(process.env[upperSlug]!.trim()), source: upperSlug, slug };
  }

  // Ưu tiên 3: Tên biến chữ thường (ví dụ: kiemtra1)
  const lowerSlug = slug.toLowerCase();
  if (env && typeof env[lowerSlug] === 'string' && env[lowerSlug].trim().length > 0) {
    return { url: normalizeDatabaseUrl(env[lowerSlug].trim()), source: lowerSlug, slug };
  }
  if (typeof process !== 'undefined' && process.env && typeof process.env[lowerSlug] === 'string' && process.env[lowerSlug]!.trim().length > 0) {
    return { url: normalizeDatabaseUrl(process.env[lowerSlug]!.trim()), source: lowerSlug, slug };
  }

  // Ưu tiên 4: Các biến thể chuẩn định dạng NEON_DATABASE_URL_XXX
  const normalizedKey = slug.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const candidateKeys = [
    `NEON_DATABASE_URL_${normalizedKey}`,
    `DATABASE_URL_${normalizedKey}`,
    `NEON_DATABASE_URL_${slug}`,
    `DATABASE_URL_${slug}`,
    `${normalizedKey}_DATABASE_URL`
  ];

  for (const k of candidateKeys) {
    if (env && typeof env[k] === 'string' && env[k].trim().length > 0) {
      return { url: normalizeDatabaseUrl(env[k].trim()), source: k, slug };
    }
    if (typeof process !== 'undefined' && process.env && typeof process.env[k] === 'string' && process.env[k]!.trim().length > 0) {
      return { url: normalizeDatabaseUrl(process.env[k]!.trim()), source: k, slug };
    }
  }

  // Tuyệt đối không fallback về CSDL mặc định khi slug riêng chưa có biến môi trường
  return { url: '', source: 'NOT_FOUND', slug };
}

export function createNeonD1Shim(databaseUrl: string) {
  const cleanUrl = normalizeDatabaseUrl(databaseUrl);
  const sqlClient = neon(cleanUrl, { fullResults: true });

  const shim = {
    isNeon: true,
    connectionUrl: cleanUrl,
    prepare(queryText: string) {
      let boundParams: any[] = [];
      const stmt = {
        bind(...args: any[]) {
          boundParams = args.map(p => {
            if (p === undefined) return null;
            if (typeof p === 'boolean') return p ? 1 : 0;
            return p;
          });
          return stmt;
        },
        async all(): Promise<{ results: any[]; success: boolean; meta?: any }> {
          try {
            const pgSql = convertSqliteToPostgres(queryText);
            const res: any = await sqlClient.query(pgSql, boundParams);
            return {
              results: res.rows || [],
              success: true,
              meta: {
                changes: res.rowCount || 0
              }
            };
          } catch (err: any) {
            if (err.message && err.message.includes('already exists')) {
              return { results: [], success: true, meta: { changes: 0 } };
            }
            console.error('[NEON ERROR in all()]:', err.message, '\nQuery:', queryText, '\nParams:', boundParams);
            throw err;
          }
        },
        async first(): Promise<any> {
          try {
            const pgSql = convertSqliteToPostgres(queryText);
            const res: any = await sqlClient.query(pgSql, boundParams);
            return (res.rows && res.rows.length > 0) ? res.rows[0] : null;
          } catch (err: any) {
            if (err.message && err.message.includes('already exists')) {
              return null;
            }
            console.error('[NEON ERROR in first()]:', err.message, '\nQuery:', queryText, '\nParams:', boundParams);
            throw err;
          }
        },
        async run(): Promise<{ success: boolean; meta: { changes: number; last_row_id?: any } }> {
          try {
            const pgSql = convertSqliteToPostgres(queryText);
            const res: any = await sqlClient.query(pgSql, boundParams);
            return {
              success: true,
              meta: {
                changes: res.rowCount || 0,
                last_row_id: null
              }
            };
          } catch (err: any) {
            if (err.message && err.message.includes('already exists')) {
              return { success: true, meta: { changes: 0, last_row_id: null } };
            }
            console.error('[NEON ERROR in run()]:', err.message, '\nQuery:', queryText, '\nParams:', boundParams);
            throw err;
          }
        }
      };
      return stmt;
    },
    async batch(statements: any[]): Promise<any[]> {
      const results: any[] = [];
      for (const st of statements) {
        if (typeof st.all === 'function') {
          results.push(await st.all());
        } else if (typeof st.run === 'function') {
          results.push(await st.run());
        }
      }
      return results;
    },
    async exec(rawSql: string): Promise<any> {
      try {
        const pgSql = convertSqliteToPostgres(rawSql);
        return await sqlClient.query(pgSql);
      } catch (err: any) {
        if (err.message && err.message.includes('already exists')) {
          return { rows: [], rowCount: 0 };
        }
        console.error('[NEON ERROR in exec()]:', err.message);
        throw err;
      }
    }
  };

  return shim;
}

// Bộ nhớ đệm Client Shim cho từng Database URL độc lập
const tenantShimCache = new Map<string, any>();

/**
 * Lấy đối tượng Database Client tương ứng với ngữ cảnh request / slug
 */
export function getEffectiveDb(envOrContext: any, requestOrSlug?: any): any {
  let env = envOrContext;
  let req = requestOrSlug;

  // Hỗ trợ truyền context trực tiếp: getEffectiveDb(context)
  if (envOrContext && typeof envOrContext === 'object') {
    if (envOrContext.env) {
      env = envOrContext.env;
    }
    if (envOrContext.request && !req) {
      req = envOrContext.request;
    }
  }

  // Tenant routing is a server-side decision, never derived from headers,
  // URL query arguments, path fragments, or Referer supplied by clients.
  const request = req && typeof req === 'object' ? (req.request || req) : null;
  let slug = '';
  if (request) {
    const origin = new URL(request.url || 'https://invalid.invalid');
    let approvedHosts: Record<string, string> = {};
    try {
      const mapping = env?.TENANT_HOST_MAP;
      if (typeof mapping === 'string' && mapping.trim()) {
        const parsed = JSON.parse(mapping);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid tenant host map');
        approvedHosts = parsed;
      }
    } catch {
      throw new Error('Tenant configuration invalid: contact administrator');
    }
    const host = origin.hostname.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(approvedHosts, host)) {
      const approvedSlug = approvedHosts[host];
      if (typeof approvedSlug !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(approvedSlug)) {
        throw new Error('Invalid approved tenant identifier');
      }
      slug = approvedSlug;
    }
    const suppliedSlug = request.headers?.get?.('x-tenant-slug') ||
      request.headers?.get?.('x-tenant') ||
      origin.searchParams.get('tenant') ||
      origin.searchParams.get('slug');
    if (suppliedSlug && suppliedSlug !== slug) {
      throw new Error('Untrusted tenant selector: request rejected');
    }
  }
  const { url: databaseUrl, source } = getTenantDatabaseUrl(env, slug);

  if (!databaseUrl || databaseUrl.trim().length === 0) {
    throw new Error("Không thể kết nối tới Cơ sở dữ liệu, xin vui lòng liên hệ với quản trị hệ thống.");
  }

  const cleanUrl = normalizeDatabaseUrl(databaseUrl);

  if (!tenantShimCache.has(cleanUrl)) {
    const shim = createNeonD1Shim(cleanUrl);
    tenantShimCache.set(cleanUrl, shim);
  }

  return tenantShimCache.get(cleanUrl);
}
