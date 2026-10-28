/**
 * A tenant is selected ONLY by its configured public hostname.
 * Client headers, query parameters, path segments and Referer never route a DB.
 * TENANT_HOST_MAP example: {"school-a.example.vn":"school_a","school-b.example.vn":"school_b"}.
 * Add custom default hostname as {"app.example.vn":"default"}.
 * testpro.id.vn is an explicitly approved built-in hostname for the default tenant.
 */
export function resolveTenantFromHostname(hostname: string, env: any): string {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '');
  if (!host || /[^a-z0-9.\-]/.test(host)) throw new Error('Invalid hostname');

  const raw = env?.TENANT_HOST_MAP ?? (typeof process !== 'undefined' ? process.env?.TENANT_HOST_MAP : undefined);
  let hostMap: Record<string, string> = {};
  if (raw) {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid TENANT_HOST_MAP');
    hostMap = parsed;
  }

  // This explicitly approved custom domain uses the same default Neon database as Pages.
  // Exact match only; an attacker-controlled subdomain must never inherit this route.
  // Keep it pinned to default even if TENANT_HOST_MAP accidentally assigns another slug.
  if (host === 'testpro.id.vn') return 'default';

  const normalized = Object.entries(hostMap).filter(([name]) => name.toLowerCase().replace(/\.$/, '') === host);
  if (normalized.length) {
    const slug = normalized[0][1];
    if (typeof slug !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(slug)) throw new Error('Invalid tenant mapping');
    return slug === 'root' ? 'default' : slug;
  }

  // Standard platform or local origin is the default tenant; custom domains must be mapped.
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.pages.dev')) return 'default';
  throw new Error('Hostname is not registered in TENANT_HOST_MAP');
}

export function resolveTenantFromRequest(request: { url: string }, env: any): string {
  return resolveTenantFromHostname(new URL(request.url).hostname, env);
}
