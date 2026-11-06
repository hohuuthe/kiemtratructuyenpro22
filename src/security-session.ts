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
    let normalized = expiry;
    if (/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
      normalized = expiry + 'T23:59:59.999+07:00';
    } else {
      const vi = expiry.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (vi) {
        const day = Number(vi[1]);
        const month = Number(vi[2]);
        const year = Number(vi[3]);
        const probe = new Date(Date.UTC(year, month - 1, day));
        if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return false;
        normalized = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T23:59:59.999+07:00`;
      }
    }
    const expiration = Date.parse(normalized);
    if (!Number.isFinite(expiration) || expiration < Date.now()) return false;
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

/** Compatibility only for sessions issued before target_audience joined the auth fingerprint. */
export function legacyAccountSessionMaterialV1(row: any): string {
  return JSON.stringify([
    String(row.id || ''), String(row.user_id || ''), String(row.username || ''),
    String(row.password || ''), String(row.role || ''),
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
