from pathlib import Path
p=Path('src/main.js')
s=p.read_text()
start=s.index('    // Global Fetch Interceptor: Tự động đính kèm Header X-Tenant-Slug')
stop=s.index('    window.showDatabaseErrorDialog = function()',start)
chunk=s[start:stop]
# Keep error handling, but never trust or attach browser-controlled tenant selectors.
replacement="""    // Database selection is performed exclusively by the trusted request hostname.
    // The earlier X-Tenant-Slug interceptor caused 421 rejections after backend hardening.
    const originalWindowFetch = window.fetch.bind(window);
    const patchedFetch = async function(resource, init) {
        const response = await originalWindowFetch(resource, init);
        if (response.status >= 500) {
            try {
                const json = await response.clone().json();
                if (json && json.db_not_configured && typeof window.showDatabaseErrorDialog === 'function') {
                    window.showDatabaseErrorDialog();
                }
            } catch {}
        }
        return response;
    };

"""
assert "X-Tenant-Slug" in chunk
s=s[:start]+replacement+s[stop:]
# Surface actionable server errors instead of disguising DB/hostname errors as bad passwords.
old="const errMsg = error && error.includes('hạn mức') ? error : '❌ Tên đăng nhập hoặc mật khẩu không đúng!';"
new="""const errMsg = response.status === 401 ? '❌ Tên đăng nhập hoặc mật khẩu không đúng!' :
                          response.status === 403 ? 'Tài khoản bị khóa, hết hạn hoặc chưa được cấp quyền.' :
                          response.status === 421 ? 'Tên miền chưa được cấu hình truy cập cơ sở dữ liệu. Vui lòng liên hệ quản trị viên.' :
                          response.status === 503 || response.status >= 500 ? 'Máy chủ hoặc cơ sở dữ liệu đang gặp lỗi. Vui lòng thử lại sau.' :
                          (error || 'Không thể đăng nhập.');"""
assert old in s
s=s.replace(old,new)
p.write_text(s)
Path('tests/tenant-fetch-compatibility.test.mjs').write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('Do not attach obsolete browser X-Tenant-Slug after hostname-only backend routing',()=>{
 const ui=readFileSync('src/main.js','utf8');
 assert.doesNotMatch(ui,/headers\\.set\\(['"]X-Tenant-Slug['"]/);
 assert.doesNotMatch(ui,/headers\\.has\\(['"]X-Tenant-Slug['"]/);
 assert.match(ui,/response\\.status === 421/);
 assert.match(ui,/response\\.status === 401/);
});
""")
