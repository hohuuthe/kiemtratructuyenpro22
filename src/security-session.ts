/**
 * Session state is bound to the *current* account row, not just a signed role.
 * Any password/role/username/status change invalidates every prior token.
 * The canonical representation is shared by Cloudflare Pages and Node.
 */
export function isAccountEnabled(row: any): boolean {
  if (!row || !row.id || !row.password) return false;
  if (row.is_active === 0 || row.is_active === false || row.is_active === '0' || row.is_active === 'false') return false;
  const expiry = String(row.expiry_date || '').trim();
  if (expiry) {
    const expiration = /^\d{4}-\d{2}-\d{2}$/.test(expiry)
      ? Date.parse(expiry + 'T23:59:59.999Z')
      : Date.parse(expiry);
    if (Number.isFinite(expiration) && expiration < Date.now()) return false;
  }
  return true;
}

export function accountSessionMaterial(row: any): string {
  return JSON.stringify([
    String(row.id || ''), String(row.user_id || ''), String(row.username || ''),
    String(row.password || ''), String(row.role || ''),
    String(row.target_audience || ''),
    row.is_active === false || row.is_active === 0 || row.is_active === '0' || row.is_active === 'false' ? '0' : '1',
    String(row.expiry_date || '')
  ]);
}

export async function accountSessionState(row: any): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(accountSessionMaterial(row)));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export function isUnexpiredAccountToken(payload: any): boolean {
  return !!(payload && payload.id && typeof payload.auth_state === 'string'
    && /^[0-9a-f]{64}$/.test(payload.auth_state)
    && typeof payload.exp === 'number' && Number.isFinite(payload.exp)
    && payload.exp > Math.floor(Date.now() / 1000));
}
