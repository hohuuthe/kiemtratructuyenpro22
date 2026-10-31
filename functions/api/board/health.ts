import { boardJson, getBoardRequestContext } from './common';

export const onRequestGet: PagesFunction = async (context: any) => {
  try {
    const { user, isAdmin } = await getBoardRequestContext(context);
    if (!user || !isAdmin) return boardJson({ error: 'Chỉ Quản trị viên được kiểm tra trạng thái Bảng tương tác.' }, 403);

    const secret = String(context.env?.BOARD_REALTIME_SECRET || '').trim();
    const binding = context.env?.BOARD_REALTIME;
    const checks: any = {
      database: true,
      realtime_secret: Boolean(secret),
      realtime_binding: Boolean(binding && typeof binding.fetch === 'function'),
      realtime_worker: false
    };

    if (!checks.realtime_secret || !checks.realtime_binding) {
      return boardJson({ ok: false, checks, error: 'Realtime chưa được cấu hình đầy đủ.' }, 503);
    }

    try {
      const response = await binding.fetch(new Request('https://board.internal/internal/health', {
        method: 'GET',
        headers: { 'X-Board-Internal-Secret': secret }
      }));
      checks.realtime_worker = response.ok;
      if (!response.ok) {
        return boardJson({ ok: false, checks, error: 'Worker realtime không phản hồi hợp lệ.' }, 503);
      }
    } catch (error: any) {
      return boardJson({ ok: false, checks, error: error?.message || 'Không kết nối được Worker realtime.' }, 503);
    }

    return boardJson({ ok: true, checks });
  } catch (error: any) {
    return boardJson({ ok: false, error: error?.message || 'Không thể kiểm tra Bảng tương tác.' }, 500);
  }
};
