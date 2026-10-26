import {verifyAuthSession,getDynamicSecret,getDatabase} from './exam/utils';
import {ensureDocumentLinkSchema} from '../../src/document-links-schema.js';
import {listDocumentLinks,createDocumentLink,updateDocumentLink,deleteDocumentLink,DocumentLinkServiceError} from '../../src/document-links-service.js';
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
async function state(context:any){
 const db=getDatabase(context);
 if(!db)throw new Error('Neon database unavailable');
 const bearer=context.request.headers.get('Authorization')||'';
 let user=null;
 if(bearer){
  if(!bearer.startsWith('Bearer '))return {db,user,invalid:true};
  const secret=await getDynamicSecret(db,context.env?.JWT_SECRET);
  user=await verifyAuthSession(bearer.slice(7),secret,db);
  if(!user)return {db,user,invalid:true};
 }
 await ensureDocumentLinkSchema(db,db.connectionUrl);
 return {db,user,invalid:false};
}
const adapter=db=>({
 all:async(sql,params)=> (await db.prepare(sql).bind(...params).all()).results||[],
 first:async(sql,params)=>db.prepare(sql).bind(...params).first(),
 run:async(sql,params)=>Number((await db.prepare(sql).bind(...params).run()).meta?.changes||0)
});
const failure=e=>reply({error:e instanceof DocumentLinkServiceError?e.message:'Không thể xử lý tài liệu. Vui lòng kiểm tra kết nối và cơ sở dữ liệu.'},e instanceof DocumentLinkServiceError?e.status:500);
export const onRequestGet:PagesFunction=async context=>{
 try{
  const {db,user,invalid}=await state(context);
  if(invalid)return reply({error:'Phiên đăng nhập không hợp lệ.'},401);
  const manage=new URL(context.request.url).searchParams.get('manage')==='1';
  return reply({data:await listDocumentLinks(adapter(db),user,{manage}),error:null});
 }catch(e){return failure(e);}
};
export const onRequestPost:PagesFunction=async context=>{
 try{
  const {db,user,invalid}=await state(context);
  if(invalid)return reply({error:'Phiên đăng nhập không hợp lệ.'},401);
  return reply({data:await createDocumentLink(adapter(db),user,await context.request.json()),error:null},201);
 }catch(e){return failure(e);}
};
export const onRequestPut:PagesFunction=async context=>{
 try{
  const {db,user,invalid}=await state(context);
  if(invalid)return reply({error:'Phiên đăng nhập không hợp lệ.'},401);
  return reply({data:await updateDocumentLink(adapter(db),user,await context.request.json()),error:null});
 }catch(e){return failure(e);}
};
export const onRequestDelete:PagesFunction=async context=>{
 try{
  const {db,user,invalid}=await state(context);
  if(invalid)return reply({error:'Phiên đăng nhập không hợp lệ.'},401);
  return reply({data:await deleteDocumentLink(adapter(db),user,new URL(context.request.url).searchParams.get('id')),error:null});
 }catch(e){return failure(e);}
};
