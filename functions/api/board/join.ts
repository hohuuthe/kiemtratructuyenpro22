import { signJWT } from '../exam/utils';
import { consumeRateLimit, hashRateLimitKey, clientIp } from '../rate-limit';
import { resolveTenantRoutingFromRequest } from '../../../src/tenant-host-map';
import { boardJson, getBoardRequestContext, cleanId, canEnterBoard, canManageBoard, loadBoard } from './common';

function realtimeSecret(env: any) {
  return String(env?.BOARD_REALTIME_SECRET || '').trim();
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
    if (board.access_mode === 'protected' && !canManageBoard(user, board, isAdmin)) {
      const rateKey = await hashRateLimitKey([
        'board-code', clientIp(context.request), boardId, user.id || user.user_id || ''
      ]);
      const rate = await consumeRateLimit(db, rateKey, 15, 300);
      if (!rate.allowed) return boardJson({
        error: 'Đã nhập mã bảng quá nhiều lần. Vui lòng thử lại sau.',
        code: 'BOARD_ACCESS_RATE_LIMITED',
        retry_after: rate.retryAfter
      }, 429);
    }
    const gate = await canEnterBoard(user, board, isAdmin, body.accessCode);
    if (!gate.ok) return boardJson({ error: gate.error, code: gate.code || 'BOARD_ACCESS_DENIED' }, gate.status || 403);
    const userId = String(user.id || user.user_id || '');
    const owner = canManageBoard(user, board, isAdmin);
    if (!owner) {
      const blocked:any = await db.prepare('SELECT reason FROM interactive_board_blocks WHERE board_id=? AND user_id=? LIMIT 1').bind(boardId,userId).first();
      if (blocked) return boardJson({ error: blocked.reason ? 'Bạn đã bị giáo viên chặn khỏi bảng này: ' + blocked.reason : 'Bạn đã bị giáo viên chặn khỏi bảng này.', code: 'BOARD_USER_BLOCKED' }, 403);
    }

    const { results: pages } = await db.prepare(
      `SELECT id,page_no,title,background_type,background_image_url,canvas_width,canvas_height,revision
       FROM interactive_board_pages WHERE board_id=? ORDER BY page_no ASC LIMIT 20`
    ).bind(boardId).all();
    if (!pages?.length) return boardJson({ error: 'Bảng chưa có trang hợp lệ.' }, 409);
    const requestedPageId = cleanId(body.pageId);
    const selectedPage = requestedPageId
      ? pages.find((page: any) => String(page.id) === requestedPageId)
      : pages[0];
    if (!selectedPage) return boardJson({ error: 'Trang không thuộc bảng này.' }, 403);

    const secret = realtimeSecret(context.env);
    const realtime = context.env?.BOARD_REALTIME;
    if (!secret || !realtime || typeof realtime.fetch !== 'function') {
      return boardJson({
        error: 'Dịch vụ realtime của Bảng tương tác chưa sẵn sàng.',
        code: 'BOARD_REALTIME_NOT_READY'
      }, 503);
    }

    const route = resolveTenantRoutingFromRequest(context.request, context.env);
    const tenant = String(route.slug || 'default');
    const permission = owner ? 'manage' : board.student_permission;
    // Realtime dùng role tương tác riêng, không dùng trực tiếp role tài khoản (student account thường có role=user).
    const realtimeRole = owner ? 'manager' : 'student';
    const displayRole = isAdmin ? 'admin'
      : (String(user.role || '').toLowerCase() === 'teacher' || String(user.target_audience || '').toLocaleLowerCase('vi') === 'giáo viên')
        ? 'teacher' : 'student';
    const now = Math.floor(Date.now() / 1000);
    const token = await signJWT({
      tokenType: 'board_join',
      tenant,
      boardId,
      userId,
      displayName: String(user.full_name || user.username || 'Người dùng').slice(0, 100),
      studentClass: String(user.lop || '').slice(0, 100),
      studentUnit: String(user.donvi || '').slice(0, 180),
      role: realtimeRole,
      displayRole,
      permission,
      boardRevision: Number(board.revision || 1),
      pageId: String(selectedPage.id),
      pageIds: pages.map((page: any) => String(page.id)).slice(0, 20),
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
        current_page_id: String(selectedPage.id),
        allowed_page_ids: pages.map((page: any) => String(page.id)).slice(0, 20),
        realtime_base_path: prefix + '/api/board/realtime?token=' + encodeURIComponent(token),
        realtime_path: prefix + '/api/board/realtime?token=' + encodeURIComponent(token) +
          '&pageId=' + encodeURIComponent(String(selectedPage.id)),
        token_expires_in: 300
      }
    });
  } catch (error: any) {
    console.error('[BOARD JOIN]', error?.message || error);
    return boardJson({ error: 'Không thể tham gia bảng tương tác.' }, 500);
  }
};
