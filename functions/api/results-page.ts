import {verifyAuthSession,getDynamicSecret,getDatabase,checkIsAdmin,checkIsTeacherOrAdmin} from './exam/utils';
import {parseManagementPage,resultsPageQuery,resolveTeacherManagementScope,resultsFacetQuery,teacherOwnedExamNamesQuery} from '../../src/management-page-queries.js';
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store'};
export const onRequestGet:PagesFunction=async context=>{
 try{
  const db=getDatabase(context),token=context.request.headers.get('Authorization')||'';
  if(!token.startsWith('Bearer '))return Response.json({error:'Yêu cầu đăng nhập.'},{status:401,headers});
  const actor=await verifyAuthSession(token.slice(7),await getDynamicSecret(db,context.env?.JWT_SECRET),db);
  if(!actor||!checkIsTeacherOrAdmin(actor))return Response.json({error:'Không có quyền xem kết quả.'},{status:403,headers});
  const page=parseManagementPage(context.request.url);
  const verified=await resolveTeacherManagementScope({...actor,role:checkIsAdmin(actor)?'admin':'teacher'},async(sql,args)=>(await db.prepare(sql).bind(...args).all()).results||[]);
  const q=resultsPageQuery(page,verified);
  const count=await db.prepare(q.countSQL).bind(...q.countArgs).first();
  const {results}=await db.prepare(q.rowsSQL).bind(...q.rowsArgs).all();
  const total=Number(count?.total||0);
  let facets:any=null;
  if(new URL(context.request.url).searchParams.get('facets')==='1') {
    const query=resultsFacetQuery(verified);
    const rows=await db.prepare(query.sql).bind(...query.args).all();
    facets={rows:rows.results||[]};
    if(verified.role==='teacher') {
      // The result list and the filter dropdown must use the same verified
      // teacher identity; never advertise another creator's exam title.
      const owned=teacherOwnedExamNamesQuery(verified);
      const exams=await db.prepare(owned.sql).bind(...owned.args).all();
      facets.exams=(exams.results||[]).map(x=>x.name).filter(Boolean);
    }
    if(verified.role==='admin') {
      const teachers=await db.prepare(`SELECT a.id,a.username,u.full_name FROM accounts a LEFT JOIN users u ON u.id=COALESCE(a.user_id,a.id) WHERE LOWER(a.role) IN ('teacher','giáo viên') OR LOWER(u.target_audience)='giáo viên' ORDER BY u.full_name,a.username LIMIT 500`).all();
      facets.teachers=(teachers.results||[]).map(x=>({id:x.id,label:x.full_name||x.username||x.id}));
    }
  }
  return Response.json({data:results||[],total,page:page.page,limit:page.limit,has_more:page.page*page.limit<total,facets,error:null},{headers});
 }catch(e){return Response.json({error:'Không thể tải trang kết quả.'},{status:500,headers});}
};