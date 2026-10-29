/**
 * Shared document-link business logic for Cloudflare Pages + Express.
 *
 * 'db' exposes async all(sql, params), first(sql, params), run(sql, params)
 * and is already bound to the current tenant's Neon database.
 * All visibility checks run server-side. Never accept a client-supplied owner.
 */
import {
  DOCUMENT_AUDIENCES, canManageDocument, documentActorRole, documentOwnerId, documentAudienceValues,
  normalizeDocumentLinkInput, DocumentLinkInputError, canViewDocument
} from './document-link-policy.js';

export class DocumentLinkServiceError extends Error {
  constructor(status, message) {
    super(message); this.name='DocumentLinkServiceError'; this.status=status;
  }
}
const deny=(status,message)=>{throw new DocumentLinkServiceError(status,message);};
const managementColumns='id,id_nguoi_tao,tieu_de,duong_link,doi_tuong_duoc_truy_cap,thoi_gian_het_han,hoat_dong,mo_ta,danh_muc,doi_tuong_truy_cap_nhieu,id_nguoi_cap_nhat,thoi_gian_tao,thoi_gian_cap_nhat';
const readerColumns='id,id_nguoi_tao,tieu_de,duong_link,doi_tuong_duoc_truy_cap,doi_tuong_truy_cap_nhieu,thoi_gian_het_han,hoat_dong,mo_ta,danh_muc,thoi_gian_tao,thoi_gian_cap_nhat';
const eligible={
  guest: ['public'],
  student: ['public','authenticated','student'],
  teacher: ['public','authenticated','teacher'],
  admin: ['public','authenticated','student','teacher','admin']
};
const postgresArray=values=>'{'+values.join(',')+'}';
const cleanId=(id)=>{
  if(typeof id!=='string'||!id.trim()||id.length>100)deny(400,'Mã tài liệu không hợp lệ.');
  return id.trim();
};
const cleanPayload=(payload)=>{
  try{return normalizeDocumentLinkInput(payload);}
  catch(error){if(error instanceof DocumentLinkInputError)deny(400,error.message);throw error;}
};
function requireEditor(actor){
  if(!canManageDocument(actor))deny(403,'Chỉ quản trị viên và giáo viên được quản lý liên kết tài liệu.');
}
export async function listDocumentLinks(db, actor, {manage=false,includeReadable=false}={}){
  const role=documentActorRole(actor);
  if(manage)requireEditor(actor);
  const params=[];
  let query='SELECT '+(manage?managementColumns:readerColumns)+' FROM quan_ly_tai_lieu WHERE 1=1';
  if(manage){
    if(role!=='admin'){
      // Teachers may manage only their own documents. The library view also
      // includes active documents shared with their role, but never grants edit.
      query+=' AND (id_nguoi_tao = ?';
      params.push(documentOwnerId(actor));
      if(includeReadable && role==='teacher'){
        query+=' OR (hoat_dong = 1 AND (thoi_gian_het_han IS NULL OR thoi_gian_het_han > CURRENT_TIMESTAMP)';
        query+=" AND NOT (doi_tuong_truy_cap_nhieu @> ARRAY['owner']::TEXT[])";
        query+=' AND doi_tuong_truy_cap_nhieu && ARRAY['+eligible.teacher.map(()=>'?').join(',')+']::TEXT[])';
        params.push(...eligible.teacher);
      }
      query+=')';
    }
  } else {
    query+=' AND hoat_dong = 1 AND (thoi_gian_het_han IS NULL OR thoi_gian_het_han > CURRENT_TIMESTAMP)';
    const audiences=eligible[role]||eligible.guest;
    // Owner-only documents must never appear in another user's read response,
    // even when stale data also contains a broadly visible audience.
    const owner=documentOwnerId(actor);
    query+=' AND ((NOT (doi_tuong_truy_cap_nhieu @> ARRAY[\'owner\']::TEXT[]) AND doi_tuong_truy_cap_nhieu && ARRAY['+audiences.map(()=>'?').join(',')+']::TEXT[])';
    params.push(...audiences);
    if(owner){query+=' OR (doi_tuong_truy_cap_nhieu @> ARRAY[\'owner\']::TEXT[] AND id_nguoi_tao = ?)';params.push(owner);}
    query+=')';
  }
  query+=' ORDER BY thoi_gian_tao DESC NULLS LAST, id DESC LIMIT 2000';
  const rows=await db.all(query,params);
  if (manage) return (rows||[]).filter(row=>!documentAudienceValues(row).includes('owner') || documentOwnerId(actor)===String(row.id_nguoi_tao||'')).map(row=>{
    const canReadOwnerOnly = !documentAudienceValues(row).includes('owner') ||
      documentOwnerId(actor) === String(row.id_nguoi_tao || '');
    const canEdit = canManageDocument(actor,row);
    return {
      ...row,
      // Shared documents are read-only; never disclose management audit details
      // or owner-only links to another teacher or administrator.
      id_nguoi_cap_nhat: canEdit ? row.id_nguoi_cap_nhat : undefined,
      duong_link: (canEdit || canViewDocument(actor,row)) && canReadOwnerOnly ? row.duong_link : '',
      co_quyen_quan_ly: canEdit,
      co_quyen_xem: canEdit || canViewDocument(actor,row)
    };
  });
  return rows||[];
}

/**
 * Page-based listing used by both HTTP runtimes. The permission predicate is
 * evaluated in SQL BEFORE the count, filtering and LIMIT/OFFSET: even the
 * total cannot disclose private document counts.
 */
export function parseDocumentLinkPage(url){
  const p=new URL(url,'https://local.invalid').searchParams;
  const integer=(name,fallback,max)=>{
    const raw=p.get(name);
    if(raw===null)return fallback;
    if(!/^[1-9]\d*$/.test(raw))deny(400,'Tham số '+name+' không hợp lệ.');
    return Math.min(max,Number(raw));
  };
  const audience=(p.get('audience')||'').trim();
  if(audience&&!Object.hasOwn(DOCUMENT_AUDIENCES,audience))deny(400,'Đối tượng lọc không hợp lệ.');
  return {page:integer('page',1,100000),limit:integer('limit',50,100),
    search:(p.get('search')||'').trim().slice(0,120),audience};
}
export async function listDocumentLinksPage(db,actor,{manage=false,includeReadable=false,page=1,limit=50,search='',audience=''}={}){
  const role=documentActorRole(actor),owner=documentOwnerId(actor);
  if(manage)requireEditor(actor);
  if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isSafeInteger(limit)||limit<1||limit>100)
    deny(400,'Thông số phân trang không hợp lệ.');
  if(audience&&!Object.hasOwn(DOCUMENT_AUDIENCES,audience))deny(400,'Đối tượng lọc không hợp lệ.');
  const params=[];
  let scope=' FROM quan_ly_tai_lieu WHERE 1=1';
  const ownerArray="doi_tuong_truy_cap_nhieu @> ARRAY['owner']::TEXT[]";
  if(manage){
    if(role==='admin'){
      // Admin may manage ordinary documents, but "Chính chủ" is invisible
      // and unmanageable unless admin is its actual creator.
      scope+=' AND (NOT ('+ownerArray+') OR id_nguoi_tao = ?)';
      params.push(owner);
    }else{
      scope+=' AND (id_nguoi_tao = ?';params.push(owner);
      if(includeReadable&&role==='teacher'){
        scope+=' OR (hoat_dong = 1 AND (thoi_gian_het_han IS NULL OR thoi_gian_het_han > CURRENT_TIMESTAMP)';
        scope+=' AND NOT ('+ownerArray+') AND doi_tuong_truy_cap_nhieu && ARRAY[?,?,?]::TEXT[])';
        params.push(...eligible.teacher);
      }
      scope+=')';
    }
  }else{
    scope+=' AND hoat_dong = 1 AND (thoi_gian_het_han IS NULL OR thoi_gian_het_han > CURRENT_TIMESTAMP)';
    const allowed=eligible[role]||eligible.guest;
    scope+=' AND ((NOT ('+ownerArray+') AND doi_tuong_truy_cap_nhieu && ARRAY['+allowed.map(()=>'?').join(',')+']::TEXT[])';
    params.push(...allowed);
    if(owner){scope+=' OR ('+ownerArray+' AND id_nguoi_tao = ?)';params.push(owner);}
    scope+=')';
  }
  if(audience){scope+=' AND doi_tuong_truy_cap_nhieu @> ARRAY[?]::TEXT[]';params.push(audience);}
  if(search){
    const fields=['tieu_de','mo_ta','danh_muc','duong_link'];
    scope+=' AND ('+fields.map(field=>'POSITION(LOWER(?) IN LOWER(COALESCE('+field+",''))) > 0").join(' OR ')+')';
    params.push(...fields.map(()=>search.slice(0,120)));
  }
  const totalRow=await db.first('SELECT COUNT(*) AS total'+scope,params);
  const total=Number(totalRow?.total||0);
  const rows=await db.all('SELECT '+(manage?managementColumns:readerColumns)+scope+
    ' ORDER BY thoi_gian_tao DESC NULLS LAST,id DESC LIMIT ? OFFSET ?',
    [...params,limit,(page-1)*limit]);
  const data=manage?(rows||[]).map(row=>{
    const canEdit=canManageDocument(actor,row);
    const canRead=canEdit||canViewDocument(actor,row);
    return {...row,id_nguoi_cap_nhat:canEdit?row.id_nguoi_cap_nhat:undefined,
      duong_link:canRead?row.duong_link:'',co_quyen_quan_ly:canEdit,co_quyen_xem:canRead};
  }):rows||[];
  return {data,total,page,limit,has_more:page*limit<total};
}

export async function createDocumentLink(db,actor,payload,makeId=()=>crypto.randomUUID()){
  requireEditor(actor);
  const value=cleanPayload(payload);
  const owner=documentOwnerId(actor);
  if(!owner)deny(401,'Phiên đăng nhập không hợp lệ.');
  const id=makeId();
  const sql='INSERT INTO quan_ly_tai_lieu (id,id_nguoi_tao,tieu_de,duong_link,doi_tuong_duoc_truy_cap,thoi_gian_het_han,hoat_dong,mo_ta,danh_muc,id_nguoi_cap_nhat,doi_tuong_truy_cap_nhieu) VALUES (?,?,?,?,?,?,?,?,?,?,?::TEXT[])';
  await db.run(sql,[id,owner,value.tieu_de,value.duong_link,value.doi_tuong_duoc_truy_cap,value.thoi_gian_het_han,value.hoat_dong,value.mo_ta,value.danh_muc,owner,postgresArray(value.doi_tuong_truy_cap_nhieu)]);
  return {id};
}
export async function updateDocumentLink(db,actor,payload){
  requireEditor(actor);
  const id=cleanId(payload?.id);
  const value=cleanPayload(payload);
  const existing=await db.first('SELECT id,id_nguoi_tao,doi_tuong_truy_cap_nhieu FROM quan_ly_tai_lieu WHERE id = ?',[id]);
  if(!existing)deny(404,'Không tìm thấy tài liệu cần sửa.');
  if(documentAudienceValues(existing).includes('owner') && String(existing.id_nguoi_tao)!==documentOwnerId(actor))
    deny(403,'Chỉ người đăng được sửa liên kết Chính chủ.');
  if(!canManageDocument(actor,existing))deny(403,'Bạn không có quyền sửa tài liệu này.');
  const isAdmin=documentActorRole(actor)==='admin';
  const guard=isAdmin?'':' AND id_nguoi_tao = ?';
  const params=[value.tieu_de,value.duong_link,value.doi_tuong_duoc_truy_cap,
    value.thoi_gian_het_han,value.hoat_dong,value.mo_ta,value.danh_muc,
    documentOwnerId(actor),postgresArray(value.doi_tuong_truy_cap_nhieu),id];
  if(!isAdmin)params.push(documentOwnerId(actor));
  const sql='UPDATE quan_ly_tai_lieu SET tieu_de=?,duong_link=?,doi_tuong_duoc_truy_cap=?,thoi_gian_het_han=?,hoat_dong=?,mo_ta=?,danh_muc=?,id_nguoi_cap_nhat=?,doi_tuong_truy_cap_nhieu=?::TEXT[] WHERE id=?'+guard;
  const changed=await db.run(sql,params);
  if(changed < 1)deny(409,'Tài liệu đã thay đổi. Hãy tải lại danh sách.');
  return {id};
}
export async function deleteDocumentLink(db,actor,idInput){
  requireEditor(actor);
  const id=cleanId(idInput);
  const existing=await db.first('SELECT id,id_nguoi_tao,doi_tuong_truy_cap_nhieu FROM quan_ly_tai_lieu WHERE id = ?',[id]);
  if(!existing)deny(404,'Không tìm thấy tài liệu cần xóa.');
  if(documentAudienceValues(existing).includes('owner') && String(existing.id_nguoi_tao)!==documentOwnerId(actor))
    deny(403,'Chỉ người đăng được xóa liên kết Chính chủ.');
  if(!canManageDocument(actor,existing))deny(403,'Bạn không có quyền xóa tài liệu này.');
  const isAdmin=documentActorRole(actor)==='admin';
  const params=isAdmin?[id]:[id,documentOwnerId(actor)];
  const sql='DELETE FROM quan_ly_tai_lieu WHERE id = ?'+(isAdmin?'':' AND id_nguoi_tao = ?');
  const changed=await db.run(sql,params);
  if(changed < 1)deny(409,'Tài liệu đã thay đổi. Hãy tải lại danh sách.');
  return {success:true};
}
