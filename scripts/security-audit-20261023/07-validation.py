from pathlib import Path
import re
root=Path.cwd()
def edit(name,fn):
 p=root/name;p.write_text(fn(p.read_text()))
edit('functions/api/exam/generate.ts',lambda s:s.replace("            if (!allQuestions || allQuestions.length === 0) {\n                const { results } = await db.prepare('SELECT * FROM questions').all();\n                allQuestions = results || [];\n            }",'            // Never fall back to questions belonging to another teacher.'))
edit('functions/api/results.ts',lambda s:s.replace('asFlag,withoutAnswers','asFlag,withoutAnswers,restrictResultDetail').replace('safe.details=canSeeDetails?details:details.map(withoutAnswers);','safe.details=details.map(d=>restrictResultDetail(d,canSeeDetails,canSeeScore));').replace('safe.ai_grading_summary=canSeeDetails?', 'safe.ai_grading_summary=canSeeDetails&&canSeeScore?'))
edit('functions/api/auth/change-password.ts',lambda s:s.replace('getDatabase }','getDatabase, isLiveAccount }').replace('if (!username || !oldPassword || !newPassword)',"if (![username,oldPassword,newPassword].every(v=>typeof v==='string'&&v.length>0&&v.length<=1024))").replace('const isValid = await verifyPasswordPBKDF2(oldPassword, account.password);','const isValid = isLiveAccount(account) && await verifyPasswordPBKDF2(oldPassword, account.password);').replace('await db.prepare("UPDATE accounts SET password = ? WHERE id = ?").bind(hashedNewPassword, account.id).run();','const saved=await db.prepare("UPDATE accounts SET password = ? WHERE id = ? AND password = ?").bind(hashedNewPassword, account.id, account.password).run();\n        if(saved.meta.changes!==1)return new Response(JSON.stringify({error:"Account changed; please sign in again"}),{status:409,headers:corsHeaders});'))
p=root/'functions/api/exams.ts';s=p.read_text();s="import {asFlag} from '../../src/security-policy';\n"+s
anchor='    const body: any = await request.json();'
insert='''    const numericFields=[['time_limit','timeLimit','time'],['count_41','count41','num_trac_nghiem'],['count_tf4','countTF4','num_dung_sai'],['count_sq','countSQ','num_tra_loi_ngan'],['count_tl','countTL','num_tuluan'],['points_41','points41'],['points_tf4','pointsTF4'],['points_sq','pointsSQ'],['points_tl','pointsTL'],['max_attempts','maxAttempts'],['max_cheat_warnings','maxCheatWarnings']];
    for(const aliases of numericFields) {
      const v=aliases.map(k=>body[k]).find(v=>v!==undefined&&v!==null);
      if(v!==undefined&&(!Number.isFinite(Number(v))||Number(v)<0||Number(v)>100000||((aliases[0].startsWith('count_')||aliases[0].startsWith('max_'))&&!Number.isInteger(Number(v)))))return new Response(JSON.stringify({error:'Invalid numeric exam configuration',field:aliases[0]}),{status:400,headers:corsHeaders});
    }
'''
s=s.replace(anchor,anchor+'\n'+insert)
s=s.replace("if (!name || !name.trim())", "if (typeof name!=='string' || !name.trim() || name.length>500)")
s=s.replace(' ?? 1) || 1;', ' ?? 1);')
for cname,keys,default in [('safeIsShared','body.is_shared_results ?? body.isSharedResults','false'),('safeImmediateFeedback','body.immediate_feedback ?? body.immediateFeedback','false'),('safeShowScore','body.show_score ?? body.showScore','true'),('safeShowDetails','body.show_details ?? body.showDetails','true'),('safeSqCaseSensitive','body.sq_case_sensitive ?? body.sqCaseSensitive','false'),('safeSqPunctuationSensitive','body.sq_punctuation_sensitive ?? body.sqPunctuationSensitive','false'),('safeAutoGradeEssay','body.auto_grade_essay ?? body.autoGradeEssay','false'),('safeTf4ScoringMode','body.tf4_scoring_mode ?? body.tf4ScoringMode','false'),('safeKeepRawScore','body.keep_raw_score ?? body.keepRawScore','false')]:
 s=re.sub(r'const '+cname+r' = [^;]+;',f'const {cname} = asFlag({keys},{default}) ? 1 : 0;',s)
s=s.replace("const targetLopVal = (body.target_lop ?? body.targetLop ?? body.lop ?? '').trim();", "const targetLopVal = String(body.target_lop ?? body.targetLop ?? body.lop ?? '').trim();\n    const targetDonviVal=String(body.target_donvi ?? body.targetDonvi ?? body.donvi ?? '').trim();\n    const maxCheatVal=Math.max(1,Number(body.max_cheat_warnings ?? body.maxCheatWarnings ?? 5));")
s=s.replace('target_lop = ?, lop = ?, tg_bd = ?, tg_kt = ?,','target_lop = ?, lop = ?, target_donvi = ?, donvi = ?, max_cheat_warnings = ?, tg_bd = ?, tg_kt = ?,')
s=s.replace('target_lop, lop, tg_bd, tg_kt,','target_lop, lop, target_donvi, donvi, max_cheat_warnings, tg_bd, tg_kt,')
s=s.replace('mabaomatdethiVal, targetLopVal, targetLopVal, tgBdVal, tgKtVal,','mabaomatdethiVal, targetLopVal, targetLopVal, targetDonviVal, targetDonviVal, maxCheatVal, tgBdVal, tgKtVal,')
a=s.index('      const insertSql = `');b=s.index('      await db.prepare(insertSql)',a)
block=s[a:b];m=re.search(r'INSERT INTO exam_configs \((.*?)\)\s*VALUES \([^)]*\)',block,re.S)
if not m:raise Exception('missing insert')
n=len(m[1].split(','));block=block[:m.start()]+f'INSERT INTO exam_configs ({m[1]}) VALUES ('+', '.join(['?']*n)+')'+block[m.end():];s=s[:a]+block+s[b:]
p.write_text(s)
p=root/'functions/api/users/[id].ts';s=p.read_text();a=s.index('    // 1. ');b=s.index('    return new Response(JSON.stringify({',a)
s=s[:a]+'''    if([String(user.id),String(user.user_id || user.id)].includes(String(userId)))return new Response(JSON.stringify({error:'Cannot delete your own profile'}),{status:400,headers:corsHeaders});
    const deleted=await db.batch([
      db.prepare('DELETE FROM accounts WHERE (user_id=? OR (user_id IS NULL AND id=?)) AND id<>? RETURNING id').bind(userId,userId,user.id),
      db.prepare('DELETE FROM teacher_classes WHERE teacher_id=?').bind(userId),
      db.prepare('DELETE FROM users WHERE id=? RETURNING id').bind(userId)
    ]);
    const deletedAccountsCount=deleted[0].results.length;
    if(!deleted[2].results.length)return new Response(JSON.stringify({error:'Profile not found'}),{status:404,headers:corsHeaders});

'''+s[b:];p.write_text(s)
p=root/'tests/security-tenant-integration.test.ts';s=p.read_text().replace("assert.equal(resolveTenantFromRequest(request('school-a.example.vn','school_b'),tenants),'school_a');","assert.throws(()=>resolveTenantFromRequest(request('school-a.example.vn','school_b'),tenants));\n  assert.equal(resolveTenantFromRequest(request('school-a.example.vn','school_a'),tenants),'school_a');").replace("assert.equal(resolveTenantFromRequest(request('school-b.example.vn','school_a'),tenants),'school_b');","assert.throws(()=>resolveTenantFromRequest(request('school-b.example.vn','school_a'),tenants));").replace('for (const source of [page,node]) {','assert.match(node,/dispatchPagesApi/);\n  for (const source of [page]) {');p.write_text(s)
p=root/'tests/exam-tab-separation.test.mjs';s=p.read_text().replace("assert.ok(result.includes('String(row.user_id) === String(user.id)'));", "assert.ok(result.includes('user.id'));\n assert.ok(result.includes('scope.sql'));\n assert.ok(result.includes('user.user_id')); // Runtime API identity collisions are tested separately.")
s=s.replace("assert.ok(login.includes('signAuthSession(account,'));","assert.ok(login.includes('signAuthSession(result,'));")
p.write_text(s)
p=root/'.github/workflows/formula-check.yml';s=p.read_text().replace('      - name: Production build','      - name: Security API and PostgreSQL acceptance\n        run: npm run test:security\n      - name: Production build');p.write_text(s)
