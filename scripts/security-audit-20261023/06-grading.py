from pathlib import Path
root=Path.cwd()
def change(name,fn):
 p=root/name;s=p.read_text();p.write_text(fn(s))
change('functions/api/exam/security.ts',lambda s:"import {canonicalRole} from '../../../src/security-policy';\n"+s.replace("if (role === 'admin' || audience === 'admin' || audience === 'qu\u1ea3n tr\u1ecb vi\u00ean') return true;","if (canonicalRole(role) === 'admin') return true;").replace("return !!row.creator_id && String(row.creator_id) === String(user.id);","return canonicalRole(role) === 'teacher' && !!row.creator_id && [String(user.id),String(user.user_id || user.id)].includes(String(row.creator_id));"))
change('functions/api/exam/utils.ts',lambda s:s.replace('token.length > 262144','token.length > 8 * 1024 * 1024'))
change('functions/api/exam/submission.ts',lambda s:s.replace("db.prepare('SELECT id FROM accounts WHERE id=? FOR UPDATE').bind(accountId)","db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))').bind(JSON.stringify([String(record.exam_id),String(record.user_id)]))"))
p=root/'src/security-policy.ts';s=p.read_text()+'''
/** An answer can be inferred from per-question scores; hide those as well. */
export function restrictResultDetail(detail:any, revealAnswers:boolean, revealScore:boolean):any {
  const safe=revealAnswers && revealScore ? {...detail} : withoutAnswers(detail);
  if(!revealScore) for(const key of ['score','isCorrect','correctStatements','aiFeedback','correctAnswer']) delete safe[key];
  return safe;
}
''';p.write_text(s)
p=root/'functions/api/exam/grade.ts';s=p.read_text().replace('asFlag, withoutAnswers','asFlag, withoutAnswers, restrictResultDetail')
s=s.replace("function isTF4UserOptTrue(uAns: any, opt: string): boolean {\n    if (!uAns || typeof uAns !== 'object') return false;", "function isTF4UserOptTrue(uAns: any, opt: string): boolean | null {\n    if (!uAns || typeof uAns !== 'object') return null;")
s=s.replace("    if (val === true || val === 1 || val === '1') return true;", "    if (val === undefined || val === null || val === '') return null;\n    if (val === false || val === 0 || val === '0') return false;\n    if (val === true || val === 1 || val === '1') return true;")
s=s.replace("        return u === 'D' || u === '\u0110' || u === '\u0110\u00daNG' || u === 'DUNG' || u === 'T' || u === 'TRUE' || u === '1';", "        if (['D','\\u0110','\\u0110\\u00daNG','DUNG','T','TRUE','1'].includes(u)) return true;\n        if (['S','SAI','F','FALSE','0'].includes(u)) return false;")
s=s.replace("    return false;\n}\n\nexport const onRequestPost", "    return null;\n}\n\nexport const onRequestPost")
a=s.index("                let u = String(userAnswer || '').trim();")
b=s.index("            } else if (trueQ.type === 'TL')",a)
s=s[:a]+'''                const isCaseSensitive=asFlag(examConfig.sqCaseSensitive ?? examConfig.sq_case_sensitive);
                const isPunctuationSensitive=asFlag(examConfig.sqPunctuationSensitive ?? examConfig.sq_punctuation_sensitive);
                const normalize=(value:any)=>{
                    let text=String(value ?? '').normalize('NFC').trim();
                    if(!isCaseSensitive)text=text.toLowerCase();
                    if(!isPunctuationSensitive)text=text.replace(/[.,\\/#!$%\\^&\\*;:{}=\\-_`~()]/g,'').replace(/\\s+/g,' ').trim();
                    return text;
                };
                const acceptable=String(correctAnswer ?? '').split(/[|;]+/).map(normalize).filter(Boolean);
                const given=normalize(userAnswer);
                isCorrect=given!=='' && acceptable.includes(given);
'''+s[b:]
s=s.replace("const isAutoGradeEssay = examConfig.autoGradeEssay !== false && examConfig.auto_grade_essay !== false;", "const isAutoGradeEssay = asFlag(examConfig.auto_grade_essay ?? examConfig.autoGradeEssay);")
s=s.replace("detailedResults:(details||[]).map((d:any)=>reveal?d:withoutAnswers(d))", "detailedResults:(details||[]).map((d:any)=>restrictResultDetail(d,reveal,showScore))")
s=s.replace("detailedResults.map((d:any)=>shouldShowDetails?d:withoutAnswers(d))", "detailedResults.map((d:any)=>restrictResultDetail(d,shouldShowDetails,shouldShowScore))")
s=s.replace("method: 'POST',\n                                headers:","method: 'POST',\n                                signal: AbortSignal.timeout(12000),\n                                headers:")
s=s.replace("if(!Array.isArray(studentAnswers)||!Array.isArray(clientQuestions)||studentAnswers.length!==questionIds.length", "if(!Array.isArray(questionIds)||!Array.isArray(studentAnswers)||!Array.isArray(clientQuestions)||studentAnswers.length!==questionIds.length")
s=s.replace("const cheatWarningCount = Number(body.cheatWarningCount ?? body.studentInfo?.cheatWarningCount ?? 0) || 0;", "const cheatWarningCount = Math.min(100000,Math.max(0,Math.floor(Number(body.cheatWarningCount ?? body.studentInfo?.cheatWarningCount ?? 0) || 0)));")
p.write_text(s)
change('functions/api/config.ts',lambda s:s.replace('  GEMINI_API_KEY: string;','  GEMINI_API_KEY: string;\n  CF_PAGES_COMMIT_SHA?: string;').replace('    timestamp: Date.now(),','    timestamp: Date.now(),\n    build_sha: env.CF_PAGES_COMMIT_SHA || null,'))
