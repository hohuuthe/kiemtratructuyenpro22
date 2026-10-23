from pathlib import Path
import re
R=Path.cwd()
def put(p,s):
 t=R/p;t.parent.mkdir(parents=True,exist_ok=True);t.write_text(s)
put('src/safe-image-url.js', '''/** Image URLs are data, never HTML attributes or executable document content. */
export function normalizedImageUrl(value, allowBlob=false) {
  if(typeof value !== 'string' || value.length>11200000 || /[<>"'`\\u0000-\\u0020\\u007f]/.test(value))return '';
  if(/^data:image\\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))return value;
  if(/^\\/(?!\\/)/.test(value))return value;
  try {
    const url=new URL(value);
    if(url.protocol==='https:' && !url.username && !url.password)return url.href;
    if(allowBlob && url.protocol==='blob:')return url.href;
  }catch{}
  return '';
}
export function escapeImageSource(value) {
  return normalizedImageUrl(String(value ?? ''),true).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
''')
p=R/'src/main.js';s=p.read_text();s="import {escapeImageSource as safeImageSrc} from './safe-image-url.js';\n"+s
s=re.sub(r'src="\$\{([^{}\n]+)\}"',lambda m:'src="${safeImageSrc('+m[1]+')}"' if 'safeImageSrc(' not in m[1] else m[0],s)
s=s.replace('${d.aiFeedback}', '${escapeHTML(d.aiFeedback)}')
s=s.replace('window.currentExamToken = result.token;', 'window.currentExamToken = result.token;\n                window.currentExamUploadToken = result.uploadToken || null;')
s=s.replace('window.currentExamToken = null;', 'window.currentExamToken = null;\n            window.currentExamUploadToken = null;')
s=s.replace("(typeof window !== 'undefined' && window.currentExamToken) || localStorage.getItem('auth_token')", "(typeof window !== 'undefined' && window.currentExamUploadToken) || localStorage.getItem('auth_token')")
p.write_text(s)
p=R/'functions/api/exam/generate.ts';s=p.read_text();s=s.replace('        const token = await signJWT(payload, SECRET);', '''        const token = await signJWT(payload, SECRET);
        const uploadToken=await signJWT({tokenType:'upload',scope:'image:upload',examJti:payload.jti,exp:payload.exp},SECRET);''');s=s.replace('            questions: clientQuestions,\n            token,', '            questions: clientQuestions,\n            token, uploadToken,');p.write_text(s)
p=R/'functions/api/_middleware.ts';s=p.read_text().replace("attempt?.tokenType === 'exam' && Array.isArray(attempt.questionIds)", "attempt?.tokenType === 'upload' && attempt.scope === 'image:upload' && typeof attempt.examJti === 'string'");p.write_text(s)
p=R/'functions/api/upload-image.ts';s=p.read_text().replace("attempt?.tokenType === 'exam' && Array.isArray(attempt.questionIds)", "attempt?.tokenType === 'upload' && attempt.scope === 'image:upload' && typeof attempt.examJti === 'string'");p.write_text(s)
p=R/'functions/api/exam/grade.ts';s=p.read_text();s="import {normalizedImageUrl} from '../../../src/safe-image-url.js';\n"+s
needle='        const tokenHash=await hashToken(token);';assert needle in s
s=s.replace(needle,'''        for(const answer of studentAnswers) {
            if(answer && typeof answer==='object' && answer.image && !normalizedImageUrl(answer.image)) {
                return new Response(JSON.stringify({error:'Invalid answer image source'}),{status:400,headers:corsHeaders});
            }
        }
'''+needle);p.write_text(s)
p=R/'tests/security-release-acceptance.test.ts';s=p.read_text();a="    await t.test('tenant fixtures remain physically distinct and transactions were used',";assert a in s
s=s.replace(a,'''    await t.test('short image upload capability cannot access grading or management APIs',async()=>{
      const generated=await issue(await createExam());assert.ok(generated.uploadToken.length<1500);
      const body={base64:'data:image/png;base64,iVBORw0KGgo='};
      assert.equal((await request('a','/api/upload-image',{method:'POST',token:generated.uploadToken,body})).status,200);
      assert.equal((await request('a','/api/exams',{method:'POST',token:generated.uploadToken,body:{name:'Forbidden'}})).status,401);
      assert.equal((await request('a','/api/upload-image',{method:'POST',token:generated.token,body})).status,401);
      assert.equal((await request('b','/api/upload-image',{method:'POST',token:generated.uploadToken,body})).status,401);
    });
    await t.test('answer images cannot persist active HTML or SVG payloads',async()=>{
      const generated=await issue(await createExam());
      for(const image of ['https://image.invalid/a" onerror="alert(1)','javascript:alert(1)','data:image/svg+xml;base64,PHN2Zz4=']) {
        assert.equal((await submit(generated,[{text:'essay',image}])).status,400);
      }
    });
'''+a);p.write_text(s)
put('tests/safe-image-url.test.mjs', '''import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedImageUrl,escapeImageSource} from '../src/safe-image-url.js';
test('Images cannot break out of attributes or embed executable document URLs',()=>{
 for(const value of ['javascript:alert(1)','https://example.invalid/a" onerror="alert(1)','data:image/svg+xml;base64,PHN2Zz4=','//evil.invalid/x','https://name:pass@example.invalid/x'])assert.equal(normalizedImageUrl(value),'');
 assert.equal(normalizedImageUrl('data:image/png;base64,iVBORw0KGgo='),'data:image/png;base64,iVBORw0KGgo=');
 assert.equal(escapeImageSource('https://images.invalid/x?a=1&b=2'),'https://images.invalid/x?a=1&amp;b=2');
});
''')
