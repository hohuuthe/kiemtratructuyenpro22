from pathlib import Path
R=Path.cwd();p=R/'src/main.js';s=p.read_text()
a=s.index('        function escapeHTML(text) {');b=s.index('        window.formatContent = ',a)
s=s[:a]+'''        function escapeHTML(text) {
            return String(text ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
        }
        // Confirmation messages support formatting, never active content or attributes.
        function safeConfirmationHtml(message) {
            const doc=new DOMParser().parseFromString(String(message ?? ''),'text/html');
            const tags=new Set(['B','STRONG','I','EM','BR','P','SPAN','UL','OL','LI','DIV']);
            const clean=node=>{
                if(node.nodeType===3)return document.createTextNode(node.textContent || '');
                if(node.nodeType!==1)return document.createTextNode('');
                if(!tags.has(node.tagName))return document.createTextNode(node.textContent || '');
                const el=document.createElement(node.tagName.toLowerCase());
                if(/^[a-zA-Z0-9_ :./\\[\\]%-]+$/.test(node.className || ''))el.className=node.className;
                for(const child of node.childNodes)el.appendChild(clean(child));
                return el;
            };
            const wrapper=document.createElement('div');
            for(const child of doc.body.childNodes)wrapper.appendChild(clean(child));
            return wrapper.innerHTML;
        }

'''+s[b:]
s=s.replace("        const ADMIN_PASSWORD = 'giaovien';\n",'')
s=s.replace('if (password === ADMIN_PASSWORD) {','if (currentUser && (isAdminLoggedIn || isTeacherLoggedIn)) {')
a=s.index('        function showConfirmModal(');b=s.index('        window.showLoadingProgress',a)
x=s[a:b].replace('${message}','${safeConfirmationHtml(message)}').replace('${title}','${escapeHTML(title)}').replace('${cancelText}','${escapeHTML(cancelText)}').replace('${confirmText}','${escapeHTML(confirmText)}')
s=s[:a]+x+s[b:]
s=s.replace("${examConfig.name || 'Ch\u01b0a c\u00f3 t\u00ean'}", "${escapeHTML(examConfig.name || 'Ch\u01b0a c\u00f3 t\u00ean')}")
for raw in ['student.full_name',"student.lop || '-'","student.donvi || '-'",'student.lop','student.donvi']:
 s=s.replace('${'+raw+'}','${escapeHTML('+raw+')}')
p.write_text(s)
p=R/'functions/api/settings.ts';s=p.read_text().replace('    } catch (queryErr) {}','    } catch (queryErr) { throw queryErr; }');p.write_text(s)
p=R/'functions/api/health.ts';s=p.read_text();s="import {resolveTenantFromRequest} from '../../src/tenant-host-map';\n"+s;s=s.replace("const slug = request.headers.get('x-tenant-slug') || '';",'const slug = resolveTenantFromRequest(request,env);');p.write_text(s)
p=R/'tests/exam-tab-separation.test.mjs';s=p.read_text().replace("assert.ok(utils.includes('Number(claims.exp) <= now'));","assert.ok(utils.includes('claims.exp <= now'));\n assert.ok(utils.includes(\"typeof claims.exp !== 'number'\"));");p.write_text(s)
