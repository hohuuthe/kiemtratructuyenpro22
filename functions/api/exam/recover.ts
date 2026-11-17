// School exam recovery has been retired. Disconnected school attempts are
// finalized by /api/exam/lifecycle from the last server-acknowledged draft.
// Keep this route as a predictable response for previously deployed clients.
const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
export const onRequestOptions: PagesFunction = async () =>
  new Response(null,{status:204,headers});
export const onRequestPost: PagesFunction = async () =>
  new Response(JSON.stringify({
    code:'EXAM_RECOVERY_RETIRED',
    error:'Chức năng khôi phục phiên thi cũ đã ngừng. Máy chủ sẽ tự kết thúc bài thi trước khi cho phép tạo lượt mới.'
  }),{status:410,headers});
