import { resolveTenantRoutingFromRequest } from '../../../src/tenant-host-map';
import { boardJson, getBoardRequestContext, cleanId, cleanText, canManageBoard, loadBoard } from './common';

function realtimeSecret(env:any){return String(env?.BOARD_REALTIME_SECRET||'').trim();}
function actorId(user:any){return String(user?.id||user?.user_id||'').trim();}

async function notifyRealtime(context:any, boardId:string, targetUserId:string, blocked:boolean){
  const secret=realtimeSecret(context.env), realtime=context.env?.BOARD_REALTIME;
  if(!secret||!realtime||typeof realtime.fetch!=='function')return;
  const route=resolveTenantRoutingFromRequest(context.request,context.env);
  await realtime.fetch(new Request('https://board.internal/internal/board-user-block',{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Board-Internal-Secret':secret},
    body:JSON.stringify({tenant:String(route.slug||'default'),boardId,targetUserId,blocked})
  }));
}

export const onRequestOptions: PagesFunction=async()=>boardJson({ok:true});

export const onRequestGet: PagesFunction=async(context:any)=>{
  try{
    const {db,user,isAdmin}=await getBoardRequestContext(context);
    if(!user)return boardJson({error:'Vui lòng đăng nhập.'},401);
    const boardId=cleanId(new URL(context.request.url).searchParams.get('boardId'));
    if(!boardId)return boardJson({error:'Mã bảng không hợp lệ.'},400);
    const board=await loadBoard(db,boardId);
    if(!board)return boardJson({error:'Không tìm thấy bảng.'},404);
    if(!canManageBoard(user,board,isAdmin))return boardJson({error:'Bạn không có quyền quản lý bảng này.'},403);
    const {results}=await db.prepare(`
      SELECT b.user_id,b.reason,b.blocked_by,b.created_at,b.updated_at,
             COALESCE(u.full_name,a.username,b.user_id) AS display_name,
             COALESCE(u.lop,'') AS lop,COALESCE(u.donvi,'') AS donvi
      FROM interactive_board_blocks b
      LEFT JOIN accounts a ON a.id=b.user_id OR a.user_id=b.user_id
      LEFT JOIN users u ON u.id=COALESCE(a.user_id,b.user_id)
      WHERE b.board_id=?
      ORDER BY b.updated_at DESC
      LIMIT 200
    `).bind(boardId).all();
    return boardJson({data:results||[]});
  }catch(error:any){
    console.error('[BOARD MODERATION LIST]',error?.message||error);
    return boardJson({error:'Không thể tải danh sách học sinh bị chặn.'},500);
  }
};

export const onRequestPost: PagesFunction=async(context:any)=>{
  try{
    const {db,user,isAdmin}=await getBoardRequestContext(context);
    if(!user)return boardJson({error:'Vui lòng đăng nhập.'},401);
    const input:any=await context.request.json();
    const boardId=cleanId(input.boardId),targetUserId=cleanId(input.targetUserId);
    const action=String(input.action||'').trim();
    if(!boardId||!targetUserId||!['block','unblock'].includes(action))return boardJson({error:'Yêu cầu kiểm soát không hợp lệ.'},400);
    const board=await loadBoard(db,boardId);
    if(!board)return boardJson({error:'Không tìm thấy bảng.'},404);
    if(!canManageBoard(user,board,isAdmin))return boardJson({error:'Bạn không có quyền quản lý bảng này.'},403);
    if(targetUserId===actorId(user))return boardJson({error:'Không thể tự chặn tài khoản quản lý bảng.'},400);

    if(action==='block'){
      const reason=cleanText(input.reason||'',300);
      await db.prepare(`
        INSERT INTO interactive_board_blocks(board_id,user_id,blocked_by,reason,created_at,updated_at)
        VALUES(?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        ON CONFLICT(board_id,user_id) DO UPDATE SET
          blocked_by=excluded.blocked_by,reason=excluded.reason,updated_at=CURRENT_TIMESTAMP
      `).bind(boardId,targetUserId,actorId(user),reason).run();
      await notifyRealtime(context,boardId,targetUserId,true);
      return boardJson({ok:true,blocked:true});
    }

    await db.prepare('DELETE FROM interactive_board_blocks WHERE board_id=? AND user_id=?').bind(boardId,targetUserId).run();
    await notifyRealtime(context,boardId,targetUserId,false);
    return boardJson({ok:true,blocked:false});
  }catch(error:any){
    console.error('[BOARD MODERATION WRITE]',error?.message||error);
    return boardJson({error:error?.message||'Không thể cập nhật quyền tham gia bảng.'},500);
  }
};
