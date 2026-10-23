from pathlib import Path
p=Path('src/main.js');s=p.read_text()
a=s.index('    // Database selection is performed exclusively by the trusted request hostname.')
b=s.index('    window.showDatabaseErrorDialog',a)
replacement="""    // Tenant follows the visible /v1 path. Cloudflare validates this selector
    // against configured database bindings; it must not change mid-session.
    const initialTenantSlug = window.__CURRENT_TENANT_SLUG || '';
    const originalWindowFetch = window.fetch.bind(window);
    const patchedFetch = async function(resource, init) {
        const raw = typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource?.url;
        let target;
        try { target = new URL(raw, window.location.origin); } catch {}
        const isApi = target?.origin === window.location.origin && target.pathname.startsWith('/api/');
        if (isApi && initialTenantSlug) {
            const headers = new Headers(init?.headers || (resource instanceof Request ? resource.headers : undefined));
            headers.set('X-Tenant-Slug', initialTenantSlug);
            init = {...init, headers};
        }
        const response = await originalWindowFetch(resource, init);
        if (response.status >= 500) {
            try {
                const json = await response.clone().json();
                if (json && json.db_not_configured && typeof window.showDatabaseErrorDialog === 'function')
                    window.showDatabaseErrorDialog();
            } catch {}
        }
        return response;
    };

"""
s=s[:a]+replacement+s[b:]
# Request-scoped login state cannot bleed across path namespaces in localStorage.
anchor="    window.__CURRENT_TENANT_SLUG = getTenantSlugFromUrl();"
assert anchor in s
s=s.replace(anchor,anchor+"""
    // Auth/session caches belong to exactly one path-based tenant.
    const previousTenant = sessionStorage.getItem('kttt_last_tenant_slug');
    if (previousTenant !== null && previousTenant !== window.__CURRENT_TENANT_SLUG) {
        localStorage.removeItem('auth_token');
        localStorage.setItem('is_auto_login','false');
    }
    sessionStorage.setItem('kttt_last_tenant_slug',window.__CURRENT_TENANT_SLUG);
""")
p.write_text(s)
p=Path('tests/tenant-fetch-compatibility.test.mjs');s=p.read_text()
s=s.replace("assert.doesNotMatch(ui,/headers\\.set\\(['\"]X-Tenant-Slug['\"]/);","assert.match(ui,/headers\\.set\\('X-Tenant-Slug', initialTenantSlug\\)/);")
s=s.replace("assert.doesNotMatch(ui,/headers\\.has\\(['\"]X-Tenant-Slug['\"]/);","assert.match(ui,/target\\.pathname\\.startsWith\\('\/api\/'\\)/);")
p.write_text(s)
