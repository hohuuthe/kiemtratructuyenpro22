export async function hashRateLimitKey(parts: any[]): Promise<string> {
  const raw = parts.map(v => String(v ?? '').trim().toLocaleLowerCase('vi')).join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, '0')).join('');
}

export async function consumeRateLimit(
  db: any,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> {
  if (!db || !key || limit < 1 || windowSeconds < 1) {
    return { allowed: true, remaining: Math.max(0, limit), retryAfter: 0 };
  }
  const now = Date.now();
  const bucket = Math.floor(now / (windowSeconds * 1000));
  const retryAfter = Math.max(1, Math.ceil(((bucket + 1) * windowSeconds * 1000 - now) / 1000));
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS _security_rate_limits (
        rate_key TEXT NOT NULL,
        bucket BIGINT NOT NULL,
        hits INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(rate_key, bucket)
      )
    `).run();
    const row: any = await db.prepare(`
      INSERT INTO _security_rate_limits(rate_key,bucket,hits,updated_at)
      VALUES(?,?,1,?)
      ON CONFLICT(rate_key,bucket) DO UPDATE SET
        hits=_security_rate_limits.hits+1,
        updated_at=excluded.updated_at
      RETURNING hits
    `).bind(key,bucket,new Date(now).toISOString()).first();
    const hits = Math.max(1, Number(row?.hits) || 1);
    if (Math.random() < 0.02) {
      const oldBucket = bucket - 24;
      try { await db.prepare('DELETE FROM _security_rate_limits WHERE bucket < ?').bind(oldBucket).run(); } catch {}
    }
    return { allowed: hits <= limit, remaining: Math.max(0, limit - hits), retryAfter };
  } catch {
    // Availability-safe fallback: a rate-limit storage outage must not block a
    // legitimate examination. Other authentication checks remain authoritative.
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfter: 0 };
  }
}

export function clientIp(request: Request): string {
  return String(
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0] ||
    'unknown'
  ).trim().slice(0, 80);
}
