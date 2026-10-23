from pathlib import Path
import re,json
R=Path.cwd()
def write(p,s):
 t=R/p;t.parent.mkdir(parents=True,exist_ok=True);t.write_text(s)
def edit(p,fn):
 t=R/p;s=t.read_text();n=fn(s);assert n!=s,p;t.write_text(n)
def rep(s,a,b):
 assert a in s, a[:120]
 return s.replace(a,b)
write('src/security-policy.ts', '''/** Shared authorization primitives; display labels never grant privileges. */
export function canonicalRole(role: unknown): string {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'admin') return 'admin';
  if (['teacher', 'gi\\u00e1o vi\\u00ean'].includes(value)) return 'teacher';
  return 'user';
}
export function asFlag(value: unknown, fallback = false): boolean {
  if (value === null || value === undefined || value === '') return fallback;
  return value === true || value === 1 || value === '1' || value === 'true';
}
export function withoutAnswers(detail: any): any {
  const {correctAnswer, aiFeedback, ...safe} = detail || {};
  if (safe.question) {
    const {answer, correctAnswer: nestedAnswer, answerImage, ...question} = safe.question;
    if (question.options && typeof question.options === 'object') {
      const {answerImage, answer, correctAnswer, ...options} = question.options;
      question.options = options;
    }
    safe.question = question;
  }
  return safe;
}
export function normalizeScope(value: unknown): string {
  return String(value || '').normalize('NFC').trim().toLowerCase().replace(/\\s+/g, ' ');
}
''')
p='functions/api/exam/utils.ts';s=(R/p).read_text()
s="import { canonicalRole } from '../../../src/security-policy';\n"+s
start=s.index('export async function verifyJWT(');end=s.index('/**',start)
s=s[:start]+'''export async function verifyJWT(token: string, secret: string) {
    try {
        if (typeof token !== 'string' || token.length > 262144 || !secret) return null;
        const parts = token.split('.');
        if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
        const [encodedHeader, encodedPayload, encodedSignature] = parts;
        const header = JSON.parse(b64DecodeUnicode(encodedHeader));
        if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        const signature = Uint8Array.from(atob(encodedSignature.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        if (!await crypto.subtle.verify('HMAC', key, signature, encoder.encode(`${encodedHeader}.${encodedPayload}`))) return null;
        const claims = JSON.parse(b64DecodeUnicode(encodedPayload));
        if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null;
        const now = Math.floor(Date.now() / 1000);
        if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= now) return null;
        if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now)) return null;
        return claims;
    } catch { return null; }
}

'''+s[end:]
s=rep(s,"account.profile_expiry_date || ''","account.profile_expiry_date || '', account.username || '',\n      account.account_revision || '', account.profile_revision || ''")
s=rep(s,"return signJWT({...claims, tokenType:'auth', authProof:proof, iat:now, exp:now + 12*3600}, secret);","return signJWT({...claims, id:account.id, user_id:account.user_id || account.id,\n      role:canonicalRole(account.role), tokenType:'auth', authProof:proof, iat:now, exp:now + 12*3600}, secret);")
s=rep(s,'SELECT a.id, a.user_id, a.username, a.password, a.role, a.is_active, a.expiry_date,','SELECT a.id, a.user_id, a.username, a.password, a.role, a.is_active, a.expiry_date,\n               a.xmin::text AS account_revision, u.xmin::text AS profile_revision,')
s=rep(s,"const audience = account.target_audience ||\n        (String(account.role).toLowerCase() === 'admin' ? 'Qu\u1ea3n tr\u1ecb vi\u00ean' :\n        ['teacher','gi\u00e1o vi\u00ean'].includes(String(account.role).toLowerCase()) ? 'Gi\u00e1o vi\u00ean' : 'H\u1ecdc sinh');","const role = canonicalRole(account.role);\n      const audience = role === 'admin' ? 'Qu\u1ea3n tr\u1ecb vi\u00ean' : role === 'teacher' ? 'Gi\u00e1o vi\u00ean' : 'H\u1ecdc sinh';")
s=rep(s,'username:account.username, role:account.role, target_audience:audience,','username:account.username, role, target_audience:audience,')
start=s.index('const secretByDbCache = ');end=s.index('export async function hashToken',start)
s=s[:start]+'''async function bindSecretToDatabase(rawSecret: string, db: any): Promise<string> {
    if (!rawSecret || rawSecret.length < 32 || !db?.connectionUrl) throw new Error('Secure authentication configuration required');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(rawSecret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
    const value = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('kttt-database-v2:' + db.connectionUrl));
    return Array.from(new Uint8Array(value), v => v.toString(16).padStart(2,'0')).join('');
}
export async function getDynamicSecret(db: any, envSecret?: string) {
    if (!db) throw new Error('Database unavailable');
    if (envSecret?.trim()) return bindSecretToDatabase(envSecret.trim(), db);
    // ON CONFLICT plus re-read prevents concurrent cold starts signing with different keys.
    await db.prepare('CREATE TABLE IF NOT EXISTS _internal_secrets (key TEXT PRIMARY KEY, value TEXT)').run();
    await db.prepare("INSERT INTO _internal_secrets (key,value) VALUES ('jwt',?) ON CONFLICT(key) DO NOTHING")
        .bind(crypto.randomUUID() + '-' + crypto.randomUUID()).run();
    const row = await db.prepare("SELECT value FROM _internal_secrets WHERE key = 'jwt'").first();
    return bindSecretToDatabase(row?.value, db);
}

'''+s[end:]
start=s.index('export function checkIsAdmin(')
s=s[:start]+'''export function checkIsAdmin(user: any): boolean {
    return !!user && canonicalRole(user.role) === 'admin';
}
export function checkIsTeacherOrAdmin(user: any): boolean {
    return !!user && ['teacher','admin'].includes(canonicalRole(user.role));
}
'''
s=re.sub(r'        // [^\n]*\n        try \{\n            await db.prepare\("DROP TABLE IF EXISTS duytricsdl CASCADE"\).run\(\);\n        \} catch \{\}', '', s)
write(p,s)
p='functions/api/auth/login.ts';s=(R/p).read_text()
s=rep(s,'SELECT accounts.id, accounts.user_id,','SELECT accounts.xmin::text AS account_revision, users.xmin::text AS profile_revision, accounts.id, accounts.user_id,')
s=rep(s,'await db.prepare(`UPDATE accounts SET password = ? WHERE id = ?`).bind(upgradedHash, result.id).run();',"const updated = await db.prepare(`UPDATE accounts SET password = ? WHERE id = ? AND password = ? RETURNING xmin::text AS account_revision`).bind(upgradedHash, result.id, result.password).first();\n            if (!updated) throw new Error('Account changed during login');\n            result.account_revision = updated.account_revision;")
s=rep(s,'signAuthSession(account, {','signAuthSession(result, {')
s=rep(s,'const { password: _passwordHash, ...safeAccount } = account;','const { password: _passwordHash, account_revision: _ar, profile_revision: _pr, ...safeAccount } = account;')
write(p,s)
write('functions/api/accounts/clean-schema.ts', '''/** Legacy destructive D1 migration is not supported on Neon. */
export const onRequest = async () => new Response(JSON.stringify({
  error: 'Schema maintenance is disabled in the public API.', code: 'MAINTENANCE_DISABLED'
}), {status:410, headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
''')
p='functions/api/neon-adapter.ts';s=(R/p).read_text()
s=rep(s,'const stmt = {','const stmt = {\n        toQuery() { return sqlClient.query(convertSqliteToPostgres(queryText), boundParams); },')
s=re.sub(r"            if \(err.message && err.message.includes\('already exists'\)\) \{[\s\S]*?\n            \}\n",'',s)
s=re.sub(r"            console.error\('\[NEON ERROR in (all|first|run)\(\)\]:',[^\n]+", "            console.error('[NEON] query failed', err.code || 'DATABASE_ERROR');",s)
start=s.index('    async batch(statements: any[])');end=s.index('    async exec(',start)
s=s[:start]+'''    async batch(statements: any[]): Promise<any[]> {
      if (!statements.length) return [];
      const result: any = await sqlClient.transaction(statements.map(st => st.toQuery()));
      return result.map((res: any) => ({results:res.rows || [], success:true, meta:{changes:res.rowCount || 0}}));
    },
'''+s[end:]
s=re.sub(r"        if \(err.message && err.message.includes\('already exists'\)\) \{[\s\S]*?\n        \}\n",'',s)
s=s.replace("console.error('[NEON ERROR in exec()]:', err.message);","console.error('[NEON] execution failed', err.code || 'DATABASE_ERROR');")
write(p,s)
p='functions/api/exams.ts';s=(R/p).read_text()
s=rep(s,'const now = new Date().toISOString();','let now = new Date().toISOString();')
needle='    if (existingRecord) {\n'
s=rep(s,needle,needle+"      now = new Date(Math.max(Date.now(), (Date.parse(existingRecord.updated_at || '') || 0) + 1)).toISOString();\n")
write(p,s)
