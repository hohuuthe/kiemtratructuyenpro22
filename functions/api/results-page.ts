import {verifyAuthSession,getDynamicSecret,getDatabase,checkIsAdmin,checkIsTeacherOrAdmin} from './exam/utils';
import {parseManagementPage,resultsPageQuery} from '../../src/management-page-queries.js';
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store'};
export const onRequestGet:PagesFunction=async context=>{
 try{
  const db=getDatabase(context),token=context.request.headers.get('Authorization')||'';
  if(!token.startsWith('Bearer '))return Response.json({error:'Yêu cầu đăng nhập.'},{status:401,headers});
  const actor=await verifyAuthSession(token.slice(7),await getDynamicSecret(db,context.env?.JWT_SECRET),db);
  if(!actor||!checkIsTeacherOrAdmin(actor))return Response.json({error:'Không có quyền xem kết quả.'},{status:403,headers});
  const page=parseManagementPage(context.request.url),q=resultsPageQuery(page,{...actor,role:checkIsAdmin(actor)?'admin':'teacher'});
  const count=await db.prepare(q.countSQL).bind(...q.countArgs).first();
  const {results}=await db.prepare(q.rowsSQL).bind(...q.rowsArgs).all();
  const total=Number(count?.total||0);
  return Response.json({data:results||[],total,page:page.page,limit:page.limit,has_more:page.page*page.limit<total,error:null},{headers});
 }catch(e){return Response.json({error:'Không thể tải trang kết quả.'},{status:500,headers});}
};