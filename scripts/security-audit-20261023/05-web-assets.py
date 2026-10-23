from pathlib import Path
import re,json
R=Path.cwd()
def put(p,s):
 t=R/p;t.parent.mkdir(parents=True,exist_ok=True);t.write_text(s)
put('functions/api/proxy-image.ts','''/** Exact operator allowlist, no redirects, no executable SVG/HTML, bounded response. */
export async function onRequestGet(context:any) {
  const {env,request}=context;
  const raw=new URL(request.url).searchParams.get('url');
  let target:URL;
  try { target=new URL(raw || ''); }catch{return new Response('Invalid image URL',{status:400});}
  const allowed=new Set(String(env.IMAGE_PROXY_ALLOWED_HOSTS || '').split(',').map((s:string)=>s.trim().toLowerCase()).filter(Boolean));
  try { if(env.CLOUDFLARE_R2_PUBLIC_URL)allowed.add(new URL(env.CLOUDFLARE_R2_PUBLIC_URL).hostname.toLowerCase()); }catch{}
  if(target.protocol!=='https:'||target.username||target.password||(target.port&&target.port!=='443')||!allowed.has(target.hostname.toLowerCase()))return new Response('Image host is not allowed',{status:403});
  try {
    const response=await fetch(target,{redirect:'error',signal:AbortSignal.timeout(10000)});
    const type=String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if(!response.ok||!['image/png','image/jpeg','image/gif','image/webp','image/avif'].includes(type))return new Response('Unsupported image',{status:415});
    if(Number(response.headers.get('content-length') || 0)>8*1024*1024)return new Response('Image too large',{status:413});
    const reader=response.body?.getReader();if(!reader)return new Response(null,{status:502});
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8*1024*1024){await reader.cancel();return new Response('Image too large',{status:413});}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return new Response(bytes,{headers:{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=3600'}});
  }catch{return new Response('Image fetch failed',{status:502});}
}
''')
p=R/'functions/api/upload-image.ts';s=p.read_text();s=s.replace('verifyAuthSession, getDynamicSecret, getDatabase','verifyAuthSession, verifyJWT, getDynamicSecret, getDatabase')
s=s.replace('const isValidExamSession = user && user.questionIds && user.teacherId;',"const attempt = !isStaff ? await verifyJWT(token, secret) : null;\n    const isValidExamSession = attempt?.tokenType === 'exam' && Array.isArray(attempt.questionIds);")
needle='    let r2AccessKeyId = env.CLOUDFLARE_R2_ACCESS_KEY_ID;';assert needle in s
s=s.replace(needle,'''    if(typeof base64!=='string'||base64.length>11200000||!/^data:image\\/(png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      return new Response(JSON.stringify({error:'Only bounded PNG/JPEG/GIF/WebP/AVIF images are accepted'}),{status:415,headers:{'Content-Type':'application/json'}});
    }
'''+needle)
s=s.replace('String(user.id),mimeType','String(user.id)+\':\'+await crypto.subtle.digest(\'SHA-256\',new TextEncoder().encode(db.connectionUrl)).then(b=>Array.from(new Uint8Array(b)).map(v=>v.toString(16).padStart(2,\'0\')).join(\'\')),mimeType')
p.write_text(s)
p=R/'src/main.js';s=p.read_text();s=s.replace("const uploadToken = localStorage.getItem('auth_token') || (typeof window !== 'undefined' && window.currentExamToken) || '';","const uploadToken = (typeof window !== 'undefined' && window.currentExamToken) || localStorage.getItem('auth_token') || '';")
s=s.replace("console.warn('Blocked native confirm:', msg);\n        return true;", "console.warn('Native confirm requires an explicit custom confirmation:', msg);\n        if (typeof window.showToast === 'function') window.showToast('Vui l\u00f2ng x\u00e1c nh\u1eadn thao t\u00e1c trong h\u1ed9p tho\u1ea1i c\u1ee7a \u1ee9ng d\u1ee5ng.', 'warning');\n        return false;")
a=s.find('const originalConsoleError = console.error;');b=s.find('// H\u00e0m t\u1ef1 \u0111\u1ed9ng ki\u1ec3m tra',a);assert a>=0 and b>a
s=s[:a]+s[b:]
s=s.replace('examContainer.innerHTML = window.originalExamInterfaceHTML;\n            }\n        }\n\n        function showResults', 'examContainer.innerHTML = window.originalExamInterfaceHTML;\n                if (typeof renderCurrentQuestion === \'function\') renderCurrentQuestion();\n            }\n        }\n\n        function showResults')
p.write_text(s)
p=R/'vite.config.ts';s=p.read_text();s="import fs from 'node:fs';\nimport path from 'node:path';\n"+s
s=s.replace("plugins: [tailwindcss()],",'''plugins: [tailwindcss(), {
    name: 'exclude-private-server-artifacts',
    closeBundle() {
      const walk=(dir:string)=>{if(!fs.existsSync(dir))return;for(const item of fs.readdirSync(dir,{withFileTypes:true})){
        const file=path.join(dir,item.name);
        if(item.isDirectory())walk(file);
        else if(/\\.(sql|db|sqlite|sqlite3|cjs|map)$/i.test(item.name)||item.name.startsWith('.env'))fs.unlinkSync(file);
      }};
      walk(path.resolve('dist'));
    }
  }],''')
s=s.replace("    'process.env.GEMINI_API_KEY': JSON.stringify(process.env.GEMINI_API_KEY),\n",'')
s=s.replace("allowedHosts: true", "allowedHosts: ['localhost','127.0.0.1']")
p.write_text(s)
p=R/'package.json';data=json.loads(p.read_text());data['scripts']['build']=data['scripts']['build'].replace('dist/server.cjs','build/server.cjs');data['scripts']['start']='node build/server.cjs';data['scripts']['test:security']='node --import tsx --test tests/security-release-acceptance.test.ts';p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
p=R/'public/sw.js';s=p.read_text();s=s.replace("const CACHE_NAME = 'online-exam-system-v2';","const CACHE_NAME = 'online-exam-system-v3-security';")
s=s.replace("if (request.method !== 'GET') {","if (request.method !== 'GET' || request.headers.has('Authorization') || url.origin !== self.location.origin) {")
p.write_text(s)
put('public/_headers','''/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: geolocation=(), microphone=(), camera=(self)
/index.html
  Cache-Control: no-cache
/sw.js
  Cache-Control: no-cache
''')
