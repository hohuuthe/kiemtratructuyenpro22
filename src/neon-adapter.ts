import { neon } from '@neondatabase/serverless';
import { getConfig, getTenantDatabaseConfig } from './backend-config';

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

const neonSqlCache = new Map<string, any>();

export function getNeonSql(urlOrSlug?: string) {
  let targetUrl = (urlOrSlug || '').trim();

  // Nếu tham số không phải là chuỗi connection postgres:// thì coi là slug và phân giải
  if (!targetUrl.startsWith('postgres')) {
    targetUrl = getTenantDatabaseConfig(targetUrl).url;
  }

  if (!targetUrl || !targetUrl.startsWith('postgres') || targetUrl.includes('YOUR_')) {
    return null;
  }

  const cleanUrl = normalizeDatabaseUrl(targetUrl);
  if (!neonSqlCache.has(cleanUrl)) {
    neonSqlCache.set(cleanUrl, neon(cleanUrl, { fullResults: true }));
  }
  return neonSqlCache.get(cleanUrl);
}
