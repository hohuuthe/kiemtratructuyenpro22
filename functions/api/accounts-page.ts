import {verifyAuthSession,getDynamicSecret,getDatabase,checkIsAdmin} from './exam/utils';
import {parseManagementPage,accountsPageQuery} from '../../src/management-page-queries.js';
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store'};
export const onRequestGet:PagesFunction=async context=>{
 try{
  const db=getDatabase(context),token=context.request.headers.get('Authorization')||'';
  if(!token.startsWith('Bearer '))return Response.json({error:'Yêu cầu đăng nhập Admin.'},{status:401,headers});
  const actor=await verifyAuthSession(token.slice(7),await getDynamicSecret(db,context.env?.JWT_SECRET),db);
  if(!checkIsAdmin(actor))return Response.json({error:'Chỉ Admin có quyền quản lý tài khoản.'},{status:403,headers});
  const page=parseManagementPage(context.request.url),q=accountsPageQuery(page);
  const count=await db.prepare(q.countSQL).bind(...q.countArgs).first();
  const {results}=await db.prepare(q.rowsSQL).bind(...q.rowsArgs).all();
  const total=Number(count?.total||0);
  return Response.json({data:results||[],total,page:page.page,limit:page.limit,has_more:page.page*page.limit<total,error:null},{headers});
 }catch(e){return Response.json({error:'Không thể tải trang tài khoản.'},{status:500,headers});}
};