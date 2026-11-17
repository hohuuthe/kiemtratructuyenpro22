// School-exam recovery intentionally retired. A previous unfinished attempt
// never controls a new start. /exam/start uses only a counted results reservation.
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};
export const onRequestOptions: PagesFunction = async () => new Response(null,{status:204,headers});
export const onRequestPost: PagesFunction = async () => new Response(
  JSON.stringify({
    code:'EXAM_RECOVERY_RETIRED',
    error:'Không hỗ trợ khôi phục phiên thi cũ. Vui lòng chọn đề và bắt đầu lượt mới nếu còn lượt.'
  }),{status:410,headers}
);
