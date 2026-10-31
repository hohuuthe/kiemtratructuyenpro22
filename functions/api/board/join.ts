import { signJWT } from '../exam/utils';
import { resolveTenantRoutingFromRequest } from '../../../src/tenant-host-map';
import { boardJson, getBoardRequestContext, cleanId, canEnterBoard, canManageBoard, loadBoard } from './common';

function realtimeSecret(env: any) {
  return String(env?.BOARD_REALTIME_SECRET || env?.JWT_SECRET || '').trim();
}

export const onRequestOptions: PagesFunction = async () => boardJson({ ok: true });

export const onRequestPost: PagesFunction = async (context: any) => {
  try {
    const { db, user, isAdmin } = await getBoardRequestContext(context);
    if (!user) return boardJson({ error: 'Vui lòng đăng nhập trước khi vào bảng.' }, 401);
    const body: any = await context.request.json();
    const boardId = cleanId(body.boardId || body.id);
    if (!boardId) return boardJson({ error: 'Mã bảng không hợp lệ.' }, 400);
    const board = await loadBoard(db, boardId);
    if (!board) return boardJson({ error: 'Không tìm thấy bảng.' }, 404);
    const gate = await canEnterBoard(user, board, isAdmin, body.accessCode);
    if (!gate.ok) return boardJson({ error: gate.error, code: gate.code || 'BOARD_ACCESS_DENIED' }, gate.status || 403);

    const { results: pages } = await db.prepare(
      `SELECT id,page_no,title,background_type,canvas_width,canvas_height,revision
       FROM interactive_board_pages WHERE board_id=? ORDER BY page_no ASC LIMIT 50`
    ).bind(boardId).all();
    if (!pages?.length) return boardJson({ error: 'Bảng chưa có trang hợp lệ.' }, 409);

    const secret = realtimeSecret(context.env);
    if (!secret) return boardJson({ error: 'Realtime chưa được cấu hình trên máy chủ.', code: 'BOARD_REALTIME_NOT_CONFIGURED' }, 503);

    const route = resolveTenantRoutingFromRequest(context.request, context.env);
    const tenant = String(route.slug || 'default');
    const owner = canManageBoard(user, board, isAdmin);
    const permission = owner ? 'manage' : board.student_permission;
    const now = Math.floor(Date.now() / 1000);
    const token = await signJWT({
      tokenType: 'board_join',
      tenant,
      boardId,
      userId: String(user.id || user.user_id || ''),
      displayName: String(user.full_name || user.username || 'Người dùng').slice(0, 100),
      role: owner ? (isAdmin ? 'admin' : 'teacher') : 'student',
      permission,
      boardRevision: Number(board.revision || 1),
      pageId: String(pages[0].id),
      maxParticipants: Math.max(1, Math.min(120, Number(board.max_participants) || 60)),
      initialLocked: board.status === 'locked',
      iat: now,
      exp: now + 300
    }, secret);
    const prefix = route.source === 'path' && route.prefix ? route.prefix : '';
    return boardJson({
      data: {
        board: {
          id: board.id, name: board.name, description: board.description || '',
          status: board.status, student_permission: board.student_permission,
          can_manage: owner, revision: Number(board.revision || 1)
        },
        pages: pages || [],
        realtime_path: prefix + '/api/board/realtime?token=' + encodeURIComponent(token) +
          '&pageId=' + encodeURIComponent(String(pages[0].id)),
        token_expires_in: 300
      }
    });
  } catch (error: any) {
    console.error('[BOARD JOIN]', error?.message || error);
    return boardJson({ error: 'Không thể tham gia bảng tương tác.' }, 500);
  }
};
