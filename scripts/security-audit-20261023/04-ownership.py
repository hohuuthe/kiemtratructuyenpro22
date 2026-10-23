from pathlib import Path
import re
R=Path.cwd()
def put(p,s):
 t=R/p;t.parent.mkdir(parents=True,exist_ok=True);t.write_text(s)
put('functions/api/results.ts', '''import {getDatabase,getDynamicSecret,verifyAuthSession,checkIsAdmin,checkIsTeacherOrAdmin} from './exam/utils';
import {asFlag,withoutAnswers} from '../../src/security-policy';
const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers});
export const onRequestOptions=async()=>new Response(null,{status:204,headers});
async function actor(context:any,db:any) {
  const bearer=context.request.headers.get('Authorization');
  return bearer?.startsWith('Bearer ')?verifyAuthSession(bearer.slice(7),await getDynamicSecret(db,context.env.JWT_SECRET),db):null;
}
function ownership(user:any,alias='r'):{sql:string;params:any[]} {
  if(checkIsAdmin(user))return {sql:'TRUE',params:[]};
  if(checkIsTeacherOrAdmin(user))return {
    sql:`EXISTS (SELECT 1 FROM exam_configs e WHERE CAST(e.id AS TEXT)=CAST(${alias}.exam_id AS TEXT) AND e.creator_id IN (?,?))`,
    params:[String(user.id),String(user.user_id || user.id)]};
  if(user)return {sql:`${alias}.user_id IN (?,?)`,params:[String(user.id),String(user.user_id || user.id)]};
  return {sql:'FALSE',params:[]};
}
function serialize(row:any,user:any,includeDetails:boolean) {
  const staffOwner=checkIsAdmin(user)||(checkIsTeacherOrAdmin(user)&&[String(user.id),String(user.user_id || user.id)].includes(String(row._owner)));
  const studentOwner=!!user&&row.user_id&&[String(user.id),String(user.user_id || user.id)].includes(String(row.user_id));
  const canSeeDetails=staffOwner || (studentOwner&&asFlag(row._show_details,true));
  const canSeeScore=staffOwner || asFlag(row._show_score,true);
  const safe:any={id:row.id,user_id:staffOwner||studentOwner?row.user_id || '':'',
    student_name:row.student_name,student_class:row.student_class,lop:row.lop || '',
    don_vi:row.don_vi || row.student_class || '',exam_id:row.exam_id,exam_name:row.exam_name,
    score:canSeeScore?row.score:null,correct_count:canSeeScore?row.correct_count:null,
    time_taken:row.time_taken,total_questions:row.total_questions,created_at:row.created_at,
    loai_thi_sinh:row.loai_thi_sinh,cheat_warning_count:Number(row.cheat_warning_count)||0};
  safe.userId=safe.user_id;safe.donvi=safe.don_vi;safe.cheatWarningCount=safe.cheat_warning_count;
  if(includeDetails && (staffOwner||studentOwner)) {
    let details:any[]=[];
    try { details=typeof row.details==='string'?JSON.parse(row.details):row.details || []; }catch{}
    safe.details=canSeeDetails?details:details.map(withoutAnswers);
    safe.ai_grading_summary=canSeeDetails?row.ai_grading_summary || null:null;
  }
  return safe;
}
export async function onRequestGet(context:any) {
  const db=getDatabase(context),url=new URL(context.request.url);
  const user=await actor(context,db);
  const id=url.searchParams.get('id'),examId=url.searchParams.get('examId') || url.searchParams.get('exam_id');
  const scope=ownership(user);
  const clauses:string[]=[],params:any[]=[];
  if(id){clauses.push('r.id=?');params.push(id);}
  if(examId){clauses.push('CAST(r.exam_id AS TEXT)=?');params.push(examId);}
  const shared=(id||examId)?"EXISTS (SELECT 1 FROM exam_configs s WHERE CAST(s.id AS TEXT)=CAST(r.exam_id AS TEXT) AND CAST(s.is_shared_results AS TEXT) IN ('1','true','t'))":'FALSE';
  clauses.push('('+scope.sql+' OR '+shared+')');params.push(...scope.params);
  const where=clauses.join(' AND ');
  if(url.searchParams.get('count')==='true') {
    const count=await db.prepare(`SELECT COUNT(*) AS count FROM results r WHERE ${where}`).bind(...params).first();
    return reply({count:Number(count?.count || 0),error:null});
  }
  const rawLimit=url.searchParams.get('limit');
  const limit=rawLimit==='all'||rawLimit==='0'||rawLimit==='-1'?-1:Math.max(1,Math.min(1000,Number(rawLimit)||1000));
  const page=Math.max(1,Math.trunc(Number(url.searchParams.get('page'))||1));
  const offset=Math.max(0,Math.trunc(Number(url.searchParams.get('offset'))||(page-1)*(limit>0?limit:1000)));
  const pagination=limit>0?` LIMIT ${Math.trunc(limit)} OFFSET ${offset}`:'';
  const result=await db.prepare(`SELECT r.*,e.creator_id AS _owner,e.show_details AS _show_details,e.show_score AS _show_score
    FROM results r LEFT JOIN exam_configs e ON CAST(e.id AS TEXT)=CAST(r.exam_id AS TEXT)
    WHERE ${where} ORDER BY r.created_at DESC,r.id DESC${pagination}`).bind(...params).all();
  const rows=result.results || [];
  const includeDetails=!!id||url.searchParams.get('includeDetails')==='true';
  if(id)return rows.length?reply({data:serialize(rows[0],user,includeDetails),error:null}):reply({data:null,error:'Result not found or access denied'},404);
  const data=rows.map((row:any)=>serialize(row,user,includeDetails));
  return reply({data,total:data.length,limit,offset,has_more:limit>0&&data.length===limit,error:null});
}
export async function onRequestPut(context:any) {
  const db=getDatabase(context),user=await actor(context,db);
  if(!checkIsTeacherOrAdmin(user))return reply({error:'Staff authorization required'},403);
  const body=await context.request.json();
  const scope=ownership(user);
  const current=await db.prepare(`SELECT r.* FROM results r WHERE r.id=? AND ${scope.sql}`).bind(String(body.id || ''),...scope.params).first();
  if(!current)return reply({error:'Result not found or access denied'},403);
  const score=Number(body.score ?? current.score),correct=Number(body.correct_count ?? current.correct_count);
  if(!Number.isFinite(score)||score<0||score>100000||!Number.isInteger(correct)||correct<0||correct>Number(current.total_questions))return reply({error:'Invalid score or correct count'},400);
  const details=body.details===undefined?current.details:typeof body.details==='string'?body.details:JSON.stringify(body.details);
  try { if(!Array.isArray(JSON.parse(typeof details==='string'?details:JSON.stringify(details))))throw new Error(); }catch{return reply({error:'Invalid grading details'},400);}
  const changed=await db.prepare(`UPDATE results r SET score=?,correct_count=?,details=? WHERE r.id=? AND ${scope.sql} RETURNING r.id`).bind(score,correct,details,current.id,...scope.params).all();
  return changed.results.length===1?reply({success:true,error:null}):reply({error:'Result changed or permission revoked'},409);
}
export async function onRequestDelete(context:any) {
  const db=getDatabase(context),user=await actor(context,db),url=new URL(context.request.url);
  if(!checkIsTeacherOrAdmin(user))return reply({error:'Staff authorization required'},403);
  if(url.searchParams.get('clearAll')==='true') {
    if(!checkIsAdmin(user))return reply({error:'Admin authorization required'},403);
    const deleted=await db.prepare('DELETE FROM results RETURNING id').all();
    return reply({success:true,deletedCount:deleted.results.length,error:null});
  }
  const body=await context.request.json().catch(()=>({}));
  const raw=url.searchParams.get('id')?[url.searchParams.get('id')]:Array.isArray(body.ids)?body.ids:body.id?[body.id]:[];
  const ids=[...new Set(raw.map((id:any)=>String(id).trim()).filter(Boolean))];
  if(!ids.length||ids.length>2000)return reply({error:'Invalid result ID list'},400);
  const marks=ids.map(()=>'?').join(','),scope=ownership(user);
  const deleted=await db.prepare(`WITH requested AS (SELECT r.id FROM results r WHERE r.id IN (${marks})),
    permitted AS (SELECT r.id FROM results r WHERE r.id IN (${marks}) AND ${scope.sql})
    DELETE FROM results WHERE id IN (SELECT id FROM permitted)
    AND (SELECT COUNT(*) FROM requested)=(SELECT COUNT(*) FROM permitted) RETURNING id`).bind(...ids,...ids,...scope.params).all();
  if(!deleted.results.length)return reply({error:'No authorized matching results were deleted',deletedCount:0},403);
  return reply({success:true,deletedCount:deleted.results.length,error:null});
}
''')
p=R/'functions/api/accounts.ts';s=p.read_text();needle='    const isTeacher = checkIsTeacherOrAdmin(user) && !isAdmin;';assert needle in s
s=s.replace(needle,needle+'''
    if (!isAdmin && !isTeacher) {
        const directory=await db.prepare(`SELECT a.id,u.full_name,u.donvi FROM accounts a
          LEFT JOIN users u ON u.id=COALESCE(a.user_id,a.id)
          WHERE a.role IN ('admin','teacher') AND CAST(a.is_active AS TEXT) IN ('1','true','t') ORDER BY u.full_name,a.id`).all();
        return new Response(JSON.stringify({data:directory.results || [],error:null}),{status:200,headers:corsHeaders});
    }
''');p.write_text(s)
p=R/'functions/api/users.ts';s=p.read_text();needle="    if (!teacherDonvi && user.donvi) {\n      teacherDonvi = user.donvi.trim();\n    }";assert needle in s
s=s.replace(needle,needle+"\n    if (!teacherDonvi) return new Response(JSON.stringify({data:[],error:null}),{status:200,headers:corsHeaders});");p.write_text(s)
p=R/'functions/api/exam/export-docx.ts';s=p.read_text();needle='    const mapRowRead = (row: any) => {';assert needle in s
s=s.replace(needle,"    if (!checkIsTeacherOrAdmin(tokenUser) || (!checkIsAdmin(tokenUser) && String(dbExam?.creator_id || teacherId) !== String(tokenUser.id))) {\n      return new Response(JSON.stringify({error:'Exam export is restricted to its owner'}),{status:403,headers:{'Content-Type':'application/json'}});\n    }\n\n"+needle);p.write_text(s)
p=R/'functions/api/exams.ts';s=p.read_text()
s=s.replace("ec.is_shared_results = 1 OR ec.is_shared_results = 'true' OR ec.is_shared_results = true","CAST(ec.is_shared_results AS TEXT) IN ('1','true','t')")
p.write_text(s)
p=R/'functions/api/health.ts';s=p.read_text();s=s.replace('SELECT COUNT(*) as count FROM users','SELECT 1 AS count');s=s.replace('      user_count: userCount,\n','');s=s.replace('error: dbError','error: dbStatus === "CONNECTED_OK" ? null : "DATABASE_UNAVAILABLE"');p.write_text(s)
