import {verifyAuthSession,getDynamicSecret,getDatabase} from './exam/utils';
import {DOCUMENT_AUDIENCES,documentActorRole,documentOwnerId,canManageDocument,normalizeDocumentLinkInput,DocumentLinkInputError} from '../../src/document-link-policy.js';
import {ensureDocumentLinkSchema} from '../../src/document-links-schema.js';
const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
async function state(context:any){
 const db=getDatabase(context);
 const secret=await getDynamicSecret(db,context.env.JWT_SECRET);
 const bearer=context.request.headers.get('Authorization')||'';
 const user=bearer.startsWith('Bearer ')?await verifyAuthSession(bearer.slice(7),secret,db):null;
 await ensureDocumentLinkSchema(db);
 return {db,user,invalid:!!bearer&&!user};
}
const fields='id,id_nguoi_tao,tieu_de,duong_link,doi_tuong_duoc_truy_cap,thoi_gian_het_han,hoat_dong';
export const onRequestOptions:PagesFunction=async()=>new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type'}});
export const onRequestGet:PagesFunction=async context=>{
 try{
 const {db,user,invalid}=await state(context);if(invalid)return reply({error:'Phiên đăng nhập không hợp lệ.'},401);
 const role=documentActorRole(user);
 const manage=new URL(context.request.url).searchParams.get('manage')==='1';
 if(manage&&!canManageDocument(user))return reply({error:'Không có quyền quản lý tài liệu.'},403);
 let sql='SELECT '+fields+' FROM quan_ly_tai_lieu WHERE 1=1';const params:any[]=[];
 if(manage){
   if(role!=='admin'){sql+=' AND id_nguoi_tao = ?';params.push(documentOwnerId(user));}
 }else{
   sql+=" AND hoat_dong = 1 AND (thoi_gian_het_han IS NULL OR (thoi_gian_het_han ~ '^\\d{4}-' AND thoi_gian_het_han > ?))";
   params.push(new Date().toISOString());
   const roles:any={guest:['public'],student:['public','authenticated','student'],teacher:['public','authenticated','teacher'],admin:['public','authenticated','student','teacher','admin']};
   const allowed=roles[role]||['public'];
   sql+=' AND doi_tuong_duoc_truy_cap IN ('+allowed.map(()=>'?').join(',')+')';
   params.push(...allowed);
 }
 sql+=' ORDER BY id DESC LIMIT 1000';
 const found=await db.prepare(sql).bind(...params).all();
 return reply({data:found.results||[],error:null});
 }catch(e:any){return reply({error:'Không thể tải tài liệu. Kiểm tra kết nối hoặc cấu trúc cơ sở dữ liệu.'},500);}
};
export const onRequestPost:PagesFunction=async context=>{
 try{
 const {db,user}=await state(context);if(!canManageDocument(user))return reply({error:'Chỉ Admin hoặc giáo viên được tạo tài liệu.'},403);
 const input=normalizeDocumentLinkInput(await context.request.json());
 const id=crypto.randomUUID(),owner=documentOwnerId(user);
 await db.prepare('INSERT INTO quan_ly_tai_lieu ('+fields+') VALUES (?,?,?,?,?,?,?)')
 .bind(id,owner,input.tieu_de,input.duong_link,input.doi_tuong_duoc_truy_cap,input.thoi_gian_het_han,input.hoat_dong).run();
 return reply({data:{id},error:null},201);
 }catch(e:any){return reply({error:e instanceof DocumentLinkInputError?e.message:'Không thể tạo tài liệu.'},e instanceof DocumentLinkInputError?400:500);}
};
export const onRequestPut:PagesFunction=async context=>{
 try{
 const {db,user}=await state(context);if(!canManageDocument(user))return reply({error:'Không có quyền sửa tài liệu.'},403);
 const body:any=await context.request.json();
 const id=String(body?.id||'');if(!id||id.length>100)return reply({error:'ID không hợp lệ.'},400);
 const existing=await db.prepare('SELECT id,id_nguoi_tao FROM quan_ly_tai_lieu WHERE id = ?').bind(id).first();
 if(!existing)return reply({error:'Không tìm thấy tài liệu.'},404);
 if(!canManageDocument(user,existing))return reply({error:'Không có quyền sửa tài liệu này.'},403);
 const value=normalizeDocumentLinkInput(body);
 const ownerGuard=documentActorRole(user)==='admin'?'':' AND id_nguoi_tao = ?';
 const params=[value.tieu_de,value.duong_link,value.doi_tuong_duoc_truy_cap,value.thoi_gian_het_han,value.hoat_dong,id];
 if(ownerGuard)params.push(documentOwnerId(user));
 const changed=await db.prepare('UPDATE quan_ly_tai_lieu SET tieu_de=?,duong_link=?,doi_tuong_duoc_truy_cap=?,thoi_gian_het_han=?,hoat_dong=? WHERE id=?'+ownerGuard).bind(...params).run();
 if(!changed.meta?.changes)return reply({error:'Không thể cập nhật bản ghi hoặc quyền đã thay đổi.'},409);
 return reply({data:{id},error:null});
 }catch(e:any){return reply({error:e instanceof DocumentLinkInputError?e.message:'Không thể cập nhật tài liệu.'},e instanceof DocumentLinkInputError?400:500);}
};
export const onRequestDelete:PagesFunction=async context=>{
 try{
 const {db,user}=await state(context);if(!canManageDocument(user))return reply({error:'Không có quyền xóa tài liệu.'},403);
 const id=new URL(context.request.url).searchParams.get('id')||'';
 if(!id||id.length>100)return reply({error:'ID không hợp lệ.'},400);
 const existing=await db.prepare('SELECT id,id_nguoi_tao FROM quan_ly_tai_lieu WHERE id = ?').bind(id).first();
 if(!existing)return reply({error:'Không tìm thấy tài liệu.'},404);
 if(!canManageDocument(user,existing))return reply({error:'Không có quyền xóa tài liệu này.'},403);
 const guard=documentActorRole(user)==='admin'?'':' AND id_nguoi_tao = ?';
 const result=await db.prepare('DELETE FROM quan_ly_tai_lieu WHERE id = ?'+guard).bind(...(guard?[id,documentOwnerId(user)]:[id])).run();
 if(!result.meta?.changes)return reply({error:'Bản ghi đã thay đổi, hãy tải lại.'},409);
 return reply({success:true,error:null});
 }catch{return reply({error:'Không thể xóa tài liệu.'},500);}
};
