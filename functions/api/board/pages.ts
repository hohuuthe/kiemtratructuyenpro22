import { resolveTenantRoutingFromRequest } from '../../../src/tenant-host-map';
import { boardJson, getBoardRequestContext, canManageBoard, cleanId, cleanText, loadBoard } from './common';

function background(value:any){
  const v=String(value||'white').trim();
  return ['white','grid','lined','dots'].includes(v)?v:'white';
}
async function pageCount(db:any,boardId:string){
  const row:any=await db.prepare('SELECT COUNT(*)::int AS total FROM interactive_board_pages WHERE board_id=?').bind(boardId).first();
  return Number(row?.total||0);
}
export const onRequestOptions: PagesFunction=async()=>boardJson({ok:true});

export const onRequestGet: PagesFunction=async(context:any)=>{
  try{
    const {db,user,isAdmin}=await getBoardRequestContext(context);
    if(!user)return boardJson({error:'Vui lòng đăng nhập.'},401);
    const boardId=cleanId(new URL(context.request.url).searchParams.get('boardId'));
    const board=await loadBoard(db,boardId);
    if(!board)return boardJson({error:'Không tìm thấy bảng.'},404);
    if(!canManageBoard(user,board,isAdmin))return boardJson({error:'Chỉ người quản lý bảng được đọc trực tiếp metadata trang.'},403);
    const {results}=await db.prepare(
      'SELECT id,page_no,title,background_type,background_image_url,canvas_width,canvas_height,revision FROM interactive_board_pages WHERE board_id=? ORDER BY page_no ASC LIMIT 20'
    ).bind(boardId).all();
    return boardJson({data:results||[]});
  }catch(error:any){console.error('[BOARD PAGES GET]',error?.message||error);return boardJson({error:'Không thể tải danh sách trang.'},500);}
};

export const onRequestPost: PagesFunction=async(context:any)=>{
  try{
    const {db,user,isAdmin}=await getBoardRequestContext(context);
    if(!user)return boardJson({error:'Phiên đăng nhập không hợp lệ.'},401);
    const input:any=await context.request.json();
    const boardId=cleanId(input.boardId);
    const board=await loadBoard(db,boardId);
    if(!board)return boardJson({error:'Không tìm thấy bảng.'},404);
    if(!canManageBoard(user,board,isAdmin))return boardJson({error:'Bạn không có quyền thêm trang.'},403);
    let created:any=null;
    for(let attempt=0;attempt<3&&!created;attempt++){
      const count=await pageCount(db,boardId);
      if(count>=20)return boardJson({error:'Mỗi bảng tối đa 20 trang để tiết kiệm tài nguyên.'},409);
      const maxRow:any=await db.prepare('SELECT COALESCE(MAX(page_no),0)::int AS max_no FROM interactive_board_pages WHERE board_id=?').bind(boardId).first();
      const pageNo=Number(maxRow?.max_no||0)+1,id=crypto.randomUUID();
      const defaultTitle='Bảng '+pageNo;
      const title=cleanText(input.title,100,defaultTitle)||defaultTitle;
      try{
        await db.prepare(
          'INSERT INTO interactive_board_pages (id,board_id,page_no,title,background_type,canvas_width,canvas_height,revision,created_at,updated_at) VALUES (?,?,?,?,?,1600,900,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)'
        ).bind(id,boardId,pageNo,title,background(input.background_type)).run();
        created={id,board_id:boardId,page_no:pageNo,title,background_type:background(input.background_type),background_image_url:'',canvas_width:1600,canvas_height:900,revision:1};
      }catch(error:any){
        const msg=String(error?.message||'').toLowerCase();
        const concurrent=msg.includes('unique')||msg.includes('duplicate');
        if(!concurrent||attempt===2)throw error;
      }
    }
    if(!created)return boardJson({error:'Không thể cấp số trang mới. Vui lòng thử lại.'},409);
    try{
      const secret=String(context.env?.BOARD_REALTIME_SECRET||'').trim();
      if(secret&&context.env?.BOARD_REALTIME?.fetch){
        const route=resolveTenantRoutingFromRequest(context.request,context.env);
        await context.env.BOARD_REALTIME.fetch(new Request('https://board.internal/internal/board-page-created',{
          method:'POST',headers:{'Content-Type':'application/json','X-Board-Internal-Secret':secret},
          body:JSON.stringify({tenant:String(route.slug||'default'),boardId,page:created})
        }));
      }
    }catch(error:any){console.warn('[BOARD PAGE CREATE BROADCAST]',error?.message||error);}
    return boardJson({data:created},201);
  }catch(error:any){console.error('[BOARD PAGE CREATE]',error?.message||error);return boardJson({error:error?.message||'Không thể thêm trang.'},400);}
};

export const onRequestPut: PagesFunction=async(context:any)=>{
  try{
    const {db,user,isAdmin}=await getBoardRequestContext(context);
    if(!user)return boardJson({error:'Phiên đăng nhập không hợp lệ.'},401);
    const input:any=await context.request.json(),pageId=cleanId(input.id);
    const page:any=await db.prepare('SELECT * FROM interactive_board_pages WHERE id=? LIMIT 1').bind(pageId).first();
    if(!page)return boardJson({error:'Không tìm thấy trang.'},404);
    const board=await loadBoard(db,String(page.board_id));
    if(!canManageBoard(user,board,isAdmin))return boardJson({error:'Bạn không có quyền sửa trang.'},403);
    const expected=Math.max(1,Number(input.revision||page.revision||1));
    const title=cleanText(input.title,100,page.title||'');
    const bg=background(input.background_type||page.background_type);
    const rawBgImage=input.background_image_url===undefined?String(page.background_image_url||''):String(input.background_image_url||'').trim();
    if(rawBgImage&&(!/^https:\/\//i.test(rawBgImage)||rawBgImage.length>2048))return boardJson({error:'Đường dẫn ảnh nền không hợp lệ.'},400);
    const result=await db.prepare(
      'UPDATE interactive_board_pages SET title=?,background_type=?,background_image_url=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=?'
    ).bind(title,bg,rawBgImage,pageId,expected).run();
    if(!Number(result.meta?.changes||0))return boardJson({error:'Trang vừa được thay đổi ở thiết bị khác. Vui lòng tải lại.'},409);
    const updated=await db.prepare('SELECT id,page_no,title,background_type,background_image_url,canvas_width,canvas_height,revision FROM interactive_board_pages WHERE id=?').bind(pageId).first();
    try{
      const secret=String(context.env?.BOARD_REALTIME_SECRET||'').trim();
      if(secret&&context.env?.BOARD_REALTIME?.fetch){
        const route=resolveTenantRoutingFromRequest(context.request,context.env);
        await context.env.BOARD_REALTIME.fetch(new Request('https://board.internal/internal/board-page-updated',{
          method:'POST',headers:{'Content-Type':'application/json','X-Board-Internal-Secret':secret},
          body:JSON.stringify({tenant:String(route.slug||'default'),boardId:String(page.board_id),page:updated})
        }));
      }
    }catch(error:any){console.warn('[BOARD PAGE UPDATE BROADCAST]',error?.message||error);}
    return boardJson({data:updated});
  }catch(error:any){console.error('[BOARD PAGE UPDATE]',error?.message||error);return boardJson({error:error?.message||'Không thể cập nhật trang.'},400);}
};

export const onRequestDelete: PagesFunction=async(context:any)=>{
  try{
    const {db,user,isAdmin}=await getBoardRequestContext(context);
    if(!user)return boardJson({error:'Phiên đăng nhập không hợp lệ.'},401);
    const pageId=cleanId(new URL(context.request.url).searchParams.get('id'));
    const page:any=await db.prepare('SELECT id,board_id,page_no FROM interactive_board_pages WHERE id=? LIMIT 1').bind(pageId).first();
    if(!page)return boardJson({error:'Không tìm thấy trang.'},404);
    const board=await loadBoard(db,String(page.board_id));
    if(!canManageBoard(user,board,isAdmin))return boardJson({error:'Bạn không có quyền xóa trang.'},403);
    if(await pageCount(db,String(page.board_id))<=1)return boardJson({error:'Bảng phải còn ít nhất một trang.'},409);
    await db.prepare('DELETE FROM interactive_board_pages WHERE id=?').bind(pageId).run();
    try{
      const secret=String(context.env?.BOARD_REALTIME_SECRET||'').trim();
      if(secret&&context.env?.BOARD_REALTIME?.fetch){
        const route=resolveTenantRoutingFromRequest(context.request,context.env);
        await context.env.BOARD_REALTIME.fetch(new Request('https://board.internal/internal/board-page-reset',{
          method:'POST',headers:{'Content-Type':'application/json','X-Board-Internal-Secret':secret},
          body:JSON.stringify({tenant:String(route.slug||'default'),boardId:String(page.board_id),pageId})
        }));
      }
    }catch(error:any){console.warn('[BOARD PAGE PURGE]',error?.message||error);}
    return boardJson({ok:true});
  }catch(error:any){console.error('[BOARD PAGE DELETE]',error?.message||error);return boardJson({error:'Không thể xóa trang.'},500);}
};
