/**
 * Routing contract:
 *   https://<pages-host>/             -> env.NEON_DATABASE_URL
 *   https://<pages-host>/v1           -> env.v1
 *   https://<pages-host>/v2           -> env.v2
 * API calls are sent to /api/... with X-Tenant-Slug derived from the application path.
 * The selector is a database NAMESPACE, never an authorization grant; each API
 * still authenticates the account/token against the selected database.
 * Custom dedicated hostnames in TENANT_HOST_MAP are pinned to their tenant.
 */
const slugPattern = /^[a-z][a-z0-9_-]{0,63}$/;
const reservedPaths = new Set([
  'api', 'assets', 'static', 'src', 'public', 'index.html',
  'favicon.ico', 'favicon.png', 'manifest.json', 'sw.js',
  'robots.txt', 'sitemap.xml', '.well-known', 'default', 'root'
]);

export class TenantRoutingError extends Error {
  code = 'TENANT_ROUTING_DENIED';
  constructor(message: string) { super(message); this.name = 'TenantRoutingError'; }
}
function validateSlug(value: unknown): string {
  if (typeof value !== 'string' || !slugPattern.test(value))
    throw new TenantRoutingError('Invalid tenant slug');
  return value;
}
export function applicationSlugFromPath(pathname: string): string {
  const first = String(pathname || '').split('/').filter(Boolean)[0] || '';
  let slug: string;
  try { slug = decodeURIComponent(first).toLowerCase(); }
  catch { throw new TenantRoutingError('Invalid tenant path encoding'); }
  if (!slug || reservedPaths.has(slug)) return '';
  return validateSlug(slug);
}
function hostMapping(env: any): Record<string, string> {
  const raw = env?.TENANT_HOST_MAP ?? (typeof process !== 'undefined' ? process.env?.TENANT_HOST_MAP : undefined);
  if (!raw) return {};
  let parsed: any;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { throw new TenantRoutingError('Invalid TENANT_HOST_MAP'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TenantRoutingError('Invalid TENANT_HOST_MAP');
  const mapped: Record<string, string> = Object.create(null);
  for (const [host, slug] of Object.entries(parsed)) {
    if (!/^[a-z0-9.-]+$/i.test(host) || typeof slug !== 'string') throw new TenantRoutingError('Invalid TENANT_HOST_MAP entry');
    mapped[host.toLowerCase().replace(/\.$/, '')] = slug === 'root' || slug === 'default' ? 'default' : validateSlug(slug);
  }
  return mapped;
}
function cleanHost(hostname: string): string {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '');
  if (!host || !/^[a-z0-9.-]+$/.test(host)) throw new TenantRoutingError('Invalid hostname');
  return host;
}
export function resolveTenantFromHostname(hostname: string, env: any): string {
  const host = cleanHost(hostname);
  const mapping = hostMapping(env);
  if (Object.prototype.hasOwnProperty.call(mapping, host)) return mapping[host];
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.pages.dev')) return 'default';
  throw new TenantRoutingError('Custom hostname is not registered in TENANT_HOST_MAP');
}
export function resolveTenantFromRequest(request: {url: string; headers?: any}, env: any): string {
  const url = new URL(request.url);
  const host = cleanHost(url.hostname);
  const mapped = hostMapping(env);
  const isPinnedHost = Object.prototype.hasOwnProperty.call(mapped,host);
  const hostTenant = resolveTenantFromHostname(host,env);
  const getHeader = (key: string) => typeof request.headers?.get === 'function'
    ? request.headers.get(key) : request.headers?.[key];
  const headerA = getHeader('x-tenant-slug');
  const headerB = getHeader('x-tenant');
  const headerSlug = headerA || headerB || '';
  if (headerA && headerB && headerA !== headerB) throw new TenantRoutingError('Conflicting tenant headers');
  const pathSlug = applicationSlugFromPath(url.pathname);
  const selected = headerSlug ? validateSlug(headerSlug) : pathSlug || 'default';
  if (headerSlug && pathSlug && selected !== pathSlug) throw new TenantRoutingError('Tenant URL and header disagree');
  if (isPinnedHost && selected !== 'default' && selected !== hostTenant)
    throw new TenantRoutingError('Tenant hostname is pinned to a different database');
  const chosen = isPinnedHost ? hostTenant : selected;
  // A query parameter is never a tenant selector. Reject mismatched legacy
  // selectors rather than silently reading another tenant's database.
  for (const key of ['tenant','slug']) for (const entry of url.searchParams.getAll(key))
    if (entry && entry !== chosen) throw new TenantRoutingError('Tenant query and path disagree');
  return chosen;
}
