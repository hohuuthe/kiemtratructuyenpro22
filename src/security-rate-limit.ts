export interface RateLimitOptions {
  maxAttempts: number;
  windowMs: number;
  blockMs: number;
}

function clientIp(request: Request): string {
  return String(
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0] ||
    'unknown'
  ).trim().slice(0, 120);
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map(v=>v.toString(16).padStart(2,'0')).join('');
}

async function ensureSchema(db: any) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS _security_rate_limits (
      scope TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      window_start TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      blocked_until TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(scope,key_hash)
    )
  `).run();
}

export async function consumeSecurityAttempt(
  db: any,
  request: Request,
  scope: string,
  identity: unknown,
  options: RateLimitOptions
): Promise<{allowed:boolean; retryAfterSeconds:number; keyHash:string}> {
  await ensureSchema(db);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const resetBefore = new Date(now - options.windowMs).toISOString();
  const blockUntil = new Date(now + options.blockMs).toISOString();
  const keyHash = await sha256([scope, clientIp(request), String(identity??'').trim().toLocaleLowerCase('vi')].join('|'));

  const row: any = await db.prepare(`
    INSERT INTO _security_rate_limits(scope,key_hash,window_start,count,blocked_until,updated_at)
    VALUES(?,?,?,1,NULL,?)
    ON CONFLICT(scope,key_hash) DO UPDATE SET
      window_start = CASE
        WHEN _security_rate_limits.window_start < ? THEN excluded.window_start
        ELSE _security_rate_limits.window_start
      END,
      count = CASE
        WHEN _security_rate_limits.window_start < ? THEN 1
        ELSE _security_rate_limits.count + 1
      END,
      blocked_until = CASE
        WHEN _security_rate_limits.blocked_until IS NOT NULL
             AND _security_rate_limits.blocked_until > ? THEN _security_rate_limits.blocked_until
        WHEN _security_rate_limits.window_start < ? THEN NULL
        WHEN _security_rate_limits.count + 1 > ? THEN ?
        ELSE NULL
      END,
      updated_at = excluded.updated_at
    RETURNING count, blocked_until
  `).bind(
    scope,keyHash,nowIso,nowIso,
    resetBefore,resetBefore,nowIso,resetBefore,
    options.maxAttempts,blockUntil
  ).first();

  const blockedUntilMs = Date.parse(String(row?.blocked_until||''));
  const allowed = !(Number.isFinite(blockedUntilMs) && blockedUntilMs > now);
  return {
    allowed,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((blockedUntilMs-now)/1000)),
    keyHash
  };
}

export async function clearSecurityAttempts(db:any, scope:string, keyHash:string) {
  try {
    await db.prepare('DELETE FROM _security_rate_limits WHERE scope=? AND key_hash=?').bind(scope,keyHash).run();
  } catch {}
}
