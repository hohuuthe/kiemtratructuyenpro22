from pathlib import Path
import re
r=Path.cwd();p=r/'src/main.js';s=p.read_text()
def change(old,new):
 global s
 assert old in s,old[:120]
 s=s.replace(old,new)
change("                console.log('Initializing application components...');","                console.log('Initializing application components...');\n                localStorage.removeItem('remember_password');")
change("                        await adminLogin(true);","                        const resumed=await adminLogin(true);\n                        if (!resumed) await loadData().catch(()=>{});")
change("            const savedPassword = localStorage.getItem('remember_password') || '';","            localStorage.removeItem('remember_password');")
change("            const isRemembered = localStorage.getItem('is_auto_login') !== 'false' ? 'checked' : '';","            const isRemembered = localStorage.getItem('is_auto_login') === 'true' ? 'checked' : '';")
change('value="${savedUsername}" placeholder="Tên đăng nhập"','value="${escapeHTML(savedUsername)}" placeholder="Tên đăng nhập"')
change('value="${savedPassword}" placeholder="Nhập mật khẩu"','value="" placeholder="Nhập mật khẩu"')
change('Lưu tài khoản và mật khẩu','Duy trì đăng nhập tối đa 12 giờ (không lưu mật khẩu)')
change("            const password = passwordInput ? passwordInput.value : (isAutoLogin ? localStorage.getItem('remember_password') : '');","            const password = isAutoLogin ? '' : (passwordInput ? passwordInput.value : '');\n            const previousToken = isAutoLogin ? localStorage.getItem('auth_token') : null;")
change("            if (!username || !password) {","            if (isAutoLogin ? !previousToken : (!username || !password)) {")
change("                return;\n            }\n\n            if (submitBtn && !isAutoLogin)","                return false;\n            }\n\n            if (submitBtn && !isAutoLogin)")
change("""                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });""","""                const response = isAutoLogin
                    ? await fetch('/api/auth/me',{headers:{'Authorization':'Bearer '+previousToken},cache:'no-store'})
                    : await fetch('/api/auth/login',{
                        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})
                    });""")
change("                    token = resJson.token;","                    token = isAutoLogin ? previousToken : resJson.token;")
change("                if (error || !data) {\n                    if (submitBtn) {","                if (error || !data) {\n                    if(isAutoLogin){localStorage.removeItem('auth_token');localStorage.setItem('is_auto_login','false');}\n                    if (submitBtn) {")
change("                    document.getElementById('login-btn')?.classList.remove('hidden');\n                    return;\n                }\n\n                if (data.expiry_date","                    document.getElementById('login-btn')?.classList.remove('hidden');\n                    return false;\n                }\n\n                if (data.expiry_date")
change("""                // Luôn lưu lại thông tin đăng nhập thành công vào localStorage để tự động login lần sau
                localStorage.setItem('remember_username', username);
                localStorage.setItem('remember_password', password);
                localStorage.setItem('is_auto_login', 'true');""","""                // Never persist reusable passwords in the browser.
                localStorage.removeItem('remember_password');
                const keepSignedIn=isAutoLogin||!!document.getElementById('remember-login')?.checked||!!document.getElementById('rememberMe')?.checked;
                localStorage.setItem('remember_username',String(data.username||username));
                localStorage.setItem('is_auto_login',keepSignedIn?'true':'false');""")
change("isAdminLoggedIn = (roleLower === 'admin' || audienceLower === 'admin' || audienceLower === 'quản trị viên');","isAdminLoggedIn = roleLower === 'admin';")
change("isTeacherLoggedIn = !isAdminLoggedIn && (audienceLower === 'giáo viên' || roleLower === 'teacher' || roleLower === 'giáo viên');","isTeacherLoggedIn = roleLower === 'teacher' || roleLower === 'giáo viên';")
change("                await handleSuccessfulLogin();\n            } catch (err)","                await handleSuccessfulLogin();\n                return true;\n            } catch (err)")
change("                if (!isAutoLogin) showToast('❌ Lỗi kết nối máy chủ!', 'error');\n            }","                if (!isAutoLogin) showToast('❌ Lỗi kết nối máy chủ!', 'error');\n                return false;\n            }")
change("            localStorage.removeItem('auth_token');\n            isAdminLoggedIn","            localStorage.removeItem('auth_token');\n            localStorage.removeItem('remember_password');\n            isAdminLoggedIn")
# Strip exactly the two old silent password-login blocks.
for indent in ['            ','                ']:
 start=indent+"if (!token && localStorage.getItem('is_auto_login') === 'true') {"
 assert start in s
 a=s.index(start);n=0
 for i in range(s.index('{',a),len(s)):
  if s[i]=='{':n+=1
  elif s[i]=='}':
   n-=1
   if n==0:break
 s=s[:a]+s[i+1:]
s,changed=re.subn(r"onclick=\"zoomImage\('\$\{[^}\n]+\}'\)\"", 'onclick="zoomImage(this.src)"',s)
assert changed>=5,changed
# Never persist third-party API credentials in cached settings.
s=s.replace("localStorage.setItem('appSettings', JSON.stringify(appSettings));","localStorage.setItem('appSettings', JSON.stringify({...appSettings, aiGradingKey: ''}));")
p.write_text(s)
p=r/'functions/api/auth/me.ts';p.parent.mkdir(parents=True,exist_ok=True)
p.write_text("""import {getDatabase} from '../exam/utils';
export async function onRequestGet(context:any) {
 const user=context.data?.authUser;
 const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
 if(!user)return new Response(JSON.stringify({error:'Session invalid'}),{status:401,headers});
 const db=getDatabase(context);
 const row=await db.prepare('SELECT a.id,a.user_id,a.username,a.role,a.is_active,a.expiry_date,u.full_name,u.phone_number,u.donvi,u.lop,u.gender,u.dob,u.address,u.occupation,u.payment_status,u.payment_method FROM accounts a LEFT JOIN users u ON u.id=COALESCE(a.user_id,a.id) WHERE a.id=?').bind(user.id).first();
 if(!row)return new Response(JSON.stringify({error:'Session invalid'}),{status:401,headers});
 return new Response(JSON.stringify({data:{...row,role:user.role,target_audience:user.target_audience,full_name:user.full_name,donvi:user.donvi,lop:user.lop},error:null}),{status:200,headers});
}
""")
p=r/'src/pages-api-dispatch.ts';s=p.read_text()
assert "  '/api/auth/login':h" in s
s="import * as sessionMe from '../functions/api/auth/me';\n"+s
s=s.replace("  '/api/auth/login':h","  '/api/auth/me':sessionMe,\n  '/api/auth/login':h")
p.write_text(s)
p=r/'tests/client-credential-retention.test.mjs'
p.write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('No persistent passwords; session validated by API',()=>{
 const js=readFileSync('src/main.js','utf8');
 assert.doesNotMatch(js,/localStorage\\.(?:setItem|getItem)\\(['"]remember_password['"]/);
 assert.match(js,/localStorage\\.removeItem\\('remember_password'\\)/);
 assert.match(js,/fetch\\('\\/api\\/auth\\/me'/);
 assert.match(js,/isAdminLoggedIn = roleLower === 'admin'/);
 assert.doesNotMatch(js,/onclick="zoomImage\\('\\$\\{/);
 assert.doesNotMatch(js,/localStorage\\.setItem\\('appSettings', JSON\\.stringify\\(appSettings\\)\\)/);
 const endpoint=readFileSync('functions/api/auth/me.ts','utf8');
 assert.doesNotMatch(endpoint,/a\\.password/);
 assert.match(endpoint,/context\\.data\\?\\.authUser/);
});
""")
