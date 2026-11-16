// Legacy direct-abandon endpoint intentionally retired. A separate delete
// before the replacement start would strand students after network failure
// and could bypass the counted-attempt policy. Replacement is accepted only
// atomically in /api/exam/start with a signed READY snapshot and matching
// authenticated active attempt.
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};
export const onRequestOptions: PagesFunction = async () =>
  new Response(null, {status:204,headers});
export const onRequestPost: PagesFunction = async () =>
  new Response(JSON.stringify({
    code:'EXAM_DIRECT_ABANDON_DISABLED',
    error:'Không thể hủy bài thi trước khi chuẩn bị phiên mới. Vui lòng chọn Tạo bài thi mới từ hộp thoại phiên thi hiện có.'
  }), {status:409,headers});
