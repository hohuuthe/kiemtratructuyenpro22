from pathlib import Path
import re
R=Path.cwd()
def put(p,s):
 t=R/p;t.parent.mkdir(parents=True,exist_ok=True);t.write_text(s)
def rep(s,a,b):
 assert a in s,a[:100]
 return s.replace(a,b)
put('functions/api/exam/attempt-envelope.ts', '''/** Immutable grading snapshot: public questions are authenticated, answers are AES-GCM sealed. */
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
function projection(q: any): any {
  let opts=q.options || {};
  if(typeof opts==='string') { try{opts=JSON.parse(opts);}catch{opts={};} }
  const options:any={};
  for(const key of ['A','B','C','D']) if(Object.hasOwn(opts,key)) options[key]=opts[key];
  return {id:String(q.id),type:q.type,level:q.level || '',lesson:q.lesson || '',content:q.content || '',options,image:q.image || ''};
}
const encode=(data:Uint8Array)=>{
  let value='';for(let i=0;i<data.length;i+=8192)value+=String.fromCharCode(...data.subarray(i,i+8192));
  return btoa(value).replace(/=/g,'').replace(/\\+/g,'-').replace(/\\//g,'_');
};
const decode=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function encryptionKey(secret:string) {
  const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('kttt-attempt-answers-v1:'+secret));
  return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
}
async function proof(q:any,secret:string) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return encode(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify(canonical(projection(q)))))));
}
export async function createAttemptEnvelope(questions:any[],secret:string,revealAnswers=false) {
  const answers=questions.map(q=>({id:String(q.id),answer:q.answer || '',answerImage:q.options?.answerImage || ''}));
  const plain=new TextEncoder().encode(JSON.stringify(answers));
  if(plain.byteLength>3000000)throw new Error('Answer snapshot exceeds safe size');
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(secret),plain);
  return {
    questions:questions.map(q=>revealAnswers?{...projection(q),answer:q.answer}:projection(q)),
    answerEnvelope:encode(iv)+'.'+encode(new Uint8Array(encrypted)),
    questionProofs:await Promise.all(questions.map(q=>proof(q,secret)))
  };
}
export async function restoreAttemptQuestions(claims:any,questions:any[],secret:string):Promise<any[]> {
  if(!Array.isArray(questions)||!Array.isArray(claims.questionIds)||!Array.isArray(claims.questionProofs)||questions.length!==claims.questionIds.length)throw new Error('QUESTION_MISMATCH');
  const [iv,data]=String(claims.answerEnvelope || '').split('.');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv)},await encryptionKey(secret),decode(data));
  const answers=JSON.parse(new TextDecoder().decode(plain));
  if(!Array.isArray(answers)||answers.length!==questions.length)throw new Error('QUESTION_MISMATCH');
  return Promise.all(questions.map(async(q,i)=>{
    if(String(q.id)!==String(claims.questionIds[i])||String(answers[i].id)!==String(q.id)||await proof(q,secret)!==claims.questionProofs[i])throw new Error('QUESTION_MISMATCH');
    const original=projection(q);
    return {...original,answer:answers[i].answer,options:{...original.options,...(answers[i].answerImage?{answerImage:answers[i].answerImage}:{})}};
  }));
}
''')
put('functions/api/exam/submission.ts', '''/** Single PostgreSQL statement: either save BOTH result and replay marker, or neither. */
export async function persistExamResult(db:any, record:any, tokenHash:string, accountId:string|null, maxAttempts:number) {
  const fields=['id','user_id','student_name','student_class','lop','don_vi','exam_name','exam_id','score','time_taken','correct_count','total_questions','details','loai_thi_sinh','cheat_warning_count','created_at'];
  const values=fields.map(k=>record[k] ?? null);
  const statement=db.prepare(`WITH accepted AS (
    INSERT INTO _submitted_exam_tokens(token_hash,exam_id,student_name,submitted_at)
    SELECT ?,?,?,? WHERE (?=0 OR (SELECT COUNT(*) FROM results WHERE exam_id=? AND user_id=?) < ?)
    ON CONFLICT(token_hash) DO NOTHING RETURNING token_hash
  ) INSERT INTO results (${fields.join(',')}) SELECT ${fields.map(()=>'?').join(',')} FROM accepted RETURNING id`)
    .bind(tokenHash,record.exam_id,record.student_name,record.created_at,maxAttempts,record.exam_id,record.user_id,maxAttempts,...values);
  const statements=accountId?[db.prepare('SELECT id FROM accounts WHERE id=? FOR UPDATE').bind(accountId),statement]:[statement];
  const outcome=await db.batch(statements);
  const saved=outcome[outcome.length-1];
  if(saved.results?.length===1)return {inserted:true};
  const existing=await db.prepare('SELECT * FROM results WHERE id=?').bind(record.id).first();
  if(existing)return {inserted:false,existing};
  return {inserted:false,quotaExceeded:true};
}
''')
p='functions/api/exam/generate.ts';s=(R/p).read_text()
s="import { createAttemptEnvelope } from './attempt-envelope';\nimport { asFlag, normalizeScope } from '../../../src/security-policy';\n"+s
s=rep(s,'if (!dbExam && teacherId) {','if (!dbExam && !examId && teacherId) {')
s=s.replace("mappedExam.immediate_feedback !== undefined ? mappedExam.immediate_feedback : (examConfig?.immediateFeedback ? 1 : 0)","asFlag(mappedExam.immediate_feedback) ? 1 : 0")
s=s.replace("Boolean(mappedExam.immediate_feedback == 1 || mappedExam.immediate_feedback === true || mappedExam.immediate_feedback === '1' || examConfig?.immediateFeedback)","asFlag(mappedExam.immediate_feedback)")
a=s.index('                if (tokenUser && (tokenUser.id || tokenUser.user_id)) {');b=s.index('            } catch(e) {}',a)
s=s[:a]+s[b:]
s=s.replace('            } catch(e) {}\n                }\n            } catch(e) {}\n        }','            } catch(e) {}\n        }')
a=s.index('        // KI\u1ec2M TRA QUY\u1ec0N TRUY C\u1eacP');b=s.index('        // Chu\u1ea9n h\u00f3a v\u00e0 \u0111\u1ed1i s\u00e1nh b\u00e0i h\u1ecdc',a)
s=s[:a]+'''        if (examId && !dbExam) return new Response(JSON.stringify({error:'Exam not found'}),{status:404,headers:corsHeaders});
        if (!isAdmin && !isTeacher) {
            const parseDate=(value:any)=>{
                if(!value)return null;
                const text=String(value);
                const at=Date.parse(/T/.test(text)&&!/(?:Z|[+-]\\d{2}:?\\d{2})$/.test(text)?text+'+07:00':text);
                if(!Number.isFinite(at))throw new Error('Invalid exam schedule');
                return at;
            };
            const starts=parseDate(activeExamConfig.tg_bd),ends=parseDate(activeExamConfig.tg_kt);
            if((starts&&Date.now()<starts)||(ends&&Date.now()>ends))return new Response(JSON.stringify({error:'Exam is outside its access window'}),{status:403,headers:corsHeaders});
            if(['\\u0110\\u1ec1 cho \\u0111\\u01a1n v\\u1ecb','\\u0110\\u1ec1 thi cho \\u0111\\u01a1n v\\u1ecb'].includes(activeExamConfig.chedodethi)) {
                if(!tokenUser)return new Response(JSON.stringify({error:'Sign in with an assigned student account'}),{status:401,headers:corsHeaders});
                const teacher=await db.prepare('SELECT u.donvi FROM accounts a JOIN users u ON u.id=COALESCE(a.user_id,a.id) WHERE a.id=?').bind(effectiveTeacherId).first();
                const acl=typeof activeExamConfig.access_control==='object'?activeExamConfig.access_control:{};
                const units=[activeExamConfig.target_donvi || activeExamConfig.donvi || teacher?.donvi,...(Array.isArray(acl.allowedUnits)?acl.allowedUnits:[])].map(normalizeScope).filter(Boolean);
                const classes=String(activeExamConfig.target_lop || activeExamConfig.lop || '').split(/[,;\\n]+/).map(normalizeScope).filter(Boolean);
                if(!units.includes(normalizeScope(tokenUser.donvi))||(classes.length&&!classes.includes(normalizeScope(tokenUser.lop))))return new Response(JSON.stringify({error:'Student is not assigned to this unit/class'}),{status:403,headers:corsHeaders});
            }
        }
        const maxAttemptsVal=Math.max(0,Number(activeExamConfig.max_attempts || activeExamConfig.maxAttempts || 0));
        if(maxAttemptsVal>0&&!isAdmin&&!isTeacher) {
            if(!tokenUser)return new Response(JSON.stringify({error:'Sign in for an exam with limited attempts'}),{status:401,headers:corsHeaders});
            const count=await db.prepare('SELECT COUNT(*) AS count FROM results WHERE exam_id=? AND user_id=?').bind(String(activeExamConfig.id),String(tokenUser.user_id || tokenUser.id)).first();
            if(Number(count?.count || 0)>=maxAttemptsVal)return new Response(JSON.stringify({error:'Attempt limit reached'}),{status:403,headers:corsHeaders});
        }

'''+s[b:]
a=s.index('        const isImmediateFeedback = Boolean(');b=s.index('        const token = await signJWT(payload, SECRET);',a)
s=s[:a]+'''        const isImmediateFeedback = asFlag(activeExamConfig.immediate_feedback ?? activeExamConfig.immediateFeedback);
        const envelope=await createAttemptEnvelope(selectedQuestions,SECRET,isImmediateFeedback);
        const questionIds=selectedQuestions.map(q=>String(q.id));
        const clientQuestions=envelope.questions;
        const started=Date.now();
        const timeLimit=Math.min(480,Math.max(1,Number(activeExamConfig.time_limit || activeExamConfig.timeLimit || 45)));
        const payload = {
            tokenType:'exam', jti:crypto.randomUUID(), questionIds,
            answerEnvelope:envelope.answerEnvelope, questionProofs:envelope.questionProofs,
            examConfig:makeGradeSessionConfig(activeExamConfig),
            maxAttempts:isAdmin || isTeacher?0:maxAttemptsVal,
            subject:tokenUser?{accountId:tokenUser.id,userId:tokenUser.user_id || tokenUser.id,
              name:tokenUser.full_name,lop:tokenUser.lop || '',donvi:tokenUser.donvi || ''}:null,
            maxCheatWarnings:maxCheatWarningsFromDB, teacherId:effectiveTeacherId,
            timestamp:started, exp:Math.floor(started/1000)+timeLimit*60+120
        };

'''+s[b:]
s=re.sub(r'(Number\((?:mappedExam|examConfig)\.points[^\n]*?\)) \|\| 1',r'\1',s)
put(p,s)
p='functions/api/exam/security.ts';s=(R/p).read_text();s=rep(s,"'showDetails','show_details'","'showDetails','show_details','showScore','show_score'");put(p,s)
p='functions/api/exam/grade.ts';s=(R/p).read_text()
s="import { restoreAttemptQuestions } from './attempt-envelope';\nimport { persistExamResult } from './submission';\nimport { asFlag, withoutAnswers } from '../../../src/security-policy';\n"+s
s=rep(s,'let authenticatedUserId = studentInfo.userId || null;','let authenticatedUserId = null;\n        let verifiedAccount: any = null;')
s=rep(s,'authenticatedUserId = verifiedUser.user_id || verifiedUser.id;','verifiedAccount = verifiedUser;\n                    authenticatedUserId = verifiedUser.user_id || verifiedUser.id;')
s=rep(s,'if (!decoded) {',"if (!decoded || decoded.tokenType !== 'exam') {")
a=s.index('        // B\u1ea2O M\u1eacT: Ch\u1ed1ng n\u1ed9p b\u00e0i');b=s.index('        // 1. Chu\u1ea9n h\u00f3a thang \u0111i\u1ec3m',a)
s=s[:a]+'''        if(decoded.subject && (!verifiedAccount || String(decoded.subject.accountId)!==String(verifiedAccount.id))) {
            return new Response(JSON.stringify({error:'This attempt belongs to another or revoked account'}),{status:403,headers:corsHeaders});
        }
        if(!decoded.subject)authenticatedUserId=null;
        else {
            authenticatedUserId=decoded.subject.userId;
            authenticatedStudentName=decoded.subject.name;
            authenticatedLop=decoded.subject.lop;
            authenticatedDonvi=decoded.subject.donvi;
        }
        const {questionIds,examConfig={},teacherId}=decoded;
        if(!Array.isArray(studentAnswers)||!Array.isArray(clientQuestions)||studentAnswers.length!==questionIds.length||clientQuestions.length!==questionIds.length) {
            return new Response(JSON.stringify({error:'Answer count does not match the issued exam'}),{status:400,headers:corsHeaders});
        }
        const tokenHash=await hashToken(token);
        const resultId='attempt-'+tokenHash;
        const responseForSaved=(saved:any,duplicate=false)=>{
            const details=typeof saved.details==='string'?JSON.parse(saved.details):saved.details;
            const reveal=asFlag(examConfig.show_details ?? examConfig.showDetails,true);
            const showScore=asFlag(examConfig.show_score ?? examConfig.showScore,true);
            return new Response(JSON.stringify({resultId:saved.id,score:showScore?saved.score:null,
                correctCount:showScore?saved.correct_count:null,duplicate,
                detailedResults:(details||[]).map((d:any)=>reveal?d:withoutAnswers(d))}),{status:200,headers:corsHeaders});
        };
        const prior=await db.prepare('SELECT * FROM results WHERE id=?').bind(resultId).first();
        if(prior)return responseForSaved(prior,true);
        let issuedQuestions:any[];
        try { issuedQuestions=await restoreAttemptQuestions(decoded,clientQuestions,SECRET); }
        catch { return new Response(JSON.stringify({error:'Question payload differs from the issued exam'}),{status:400,headers:corsHeaders}); }

'''+s[b:]
a=s.index('            if (studentInfo.examId) {');b=s.index('            if (!aiKey) {',a)
s=s[:a]+'''            if (examConfig.id) {
                const row=await db.prepare('SELECT ai_grading_key FROM exam_configs WHERE id=? AND creator_id=?').bind(String(examConfig.id),String(teacherId)).first();
                if(row?.ai_grading_key)aiKey=String(row.ai_grading_key);
            }
'''+s[b:]
a=s.index('        // 2. Truy xu\u1ea5t c\u00e2u h\u1ecfi g\u1ed1c');b=s.index('        // Parse tf4 points configuration',a)
s=s[:a]+'''        // Grade exactly the original server-issued snapshot, even if the bank is edited later.
        const trueQuestionsMap:Record<string,any> = Object.fromEntries(issuedQuestions.map(q=>[String(q.id),{...q,type:normalizeType(q.type)}]));

'''+s[b:]
a=s.index('        // L\u01b0u k\u1ebft qu\u1ea3 b\u00e0i thi v\u00e0o');b=s.index('        // B\u1ea2O M\u1eacT: N\u1ebfu c\u1ea5u h\u00ecnh',a)
s=s[:a]+'''        const record={
            id:resultId,user_id:authenticatedUserId,student_name:authenticatedStudentName,
            student_class:decoded.subject?authenticatedDonvi:String(studentInfo.unit || ''),
            lop:authenticatedLop,don_vi:authenticatedDonvi,exam_name:String(examConfig.name || ''),
            exam_id:String(examConfig.id || ''),score:finalScore,
            time_taken:Math.max(0,Math.floor((Date.now()-Number(decoded.timestamp))/1000)),
            correct_count:correctCount,total_questions:questionIds.length,details:JSON.stringify(detailedResults),
            loai_thi_sinh:authenticatedUserId?'Authenticated':'Guest',cheat_warning_count:cheatWarningCount,
            created_at:new Date().toISOString()
        };
        const persisted=await persistExamResult(db,record,tokenHash,decoded.subject?.accountId || null,Number(decoded.maxAttempts || 0));
        if(persisted.existing)return responseForSaved(persisted.existing,true);
        if(!persisted.inserted)return new Response(JSON.stringify({error:'Attempt limit reached; no result was saved',code:'ATTEMPT_LIMIT'}),{status:403,headers:corsHeaders});

'''+s[b:]
a=s.index('        const shouldShowDetails = ');b=s.index('        return new Response(JSON.stringify({',a)
s=s[:a]+'''        const shouldShowDetails=asFlag(examConfig.show_details ?? examConfig.showDetails,true);
        const shouldShowScore=asFlag(examConfig.show_score ?? examConfig.showScore,true);
        const clientDetailedResults=detailedResults.map((d:any)=>shouldShowDetails?d:withoutAnswers(d));

'''+s[b:]
s=rep(s,'score: finalScore,','score: shouldShowScore ? finalScore : null,')
s=s.replace('rawEarnedScore: calculatedRaw,','rawEarnedScore: shouldShowScore ? calculatedRaw : null,').replace('scale10Score: calculatedScale10,','scale10Score: shouldShowScore ? calculatedScale10 : null,').replace('            correctCount,\n            cheatWarningCount,','            correctCount: shouldShowScore ? correctCount : null,\n            cheatWarningCount,')
s=s.replace('const isTf4CustomMode = Boolean(examConfig.tf4ScoringMode || examConfig.tf4_scoring_mode);','const isTf4CustomMode = asFlag(examConfig.tf4ScoringMode ?? examConfig.tf4_scoring_mode);')
s=s.replace('const isCaseSensitive = examConfig.sqCaseSensitive ?? examConfig.sq_case_sensitive ?? false;','const isCaseSensitive = asFlag(examConfig.sqCaseSensitive ?? examConfig.sq_case_sensitive);').replace('const isPunctuationSensitive = examConfig.sqPunctuationSensitive ?? examConfig.sq_punctuation_sensitive ?? false;','const isPunctuationSensitive = asFlag(examConfig.sqPunctuationSensitive ?? examConfig.sq_punctuation_sensitive);')
put(p,s)
