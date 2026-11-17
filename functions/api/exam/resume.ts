// Resume/recovery of earlier attempts is retired for BOTH ordinary school exams
// and published online contests. This endpoint never reads any prior session,
// lock, result, draft, or contestant record. Start a NEW counted attempt instead.
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store'
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, {status:204,headers});

export const onRequestPost: PagesFunction = async () =>
  new Response(JSON.stringify({
    code:'EXAM_RECOVERY_RETIRED',
    error:'Không khôi phục phiên thi cũ. Vui lòng chọn đề và bắt đầu lượt mới nếu còn lượt và đáp ứng điều kiện của đề.'
  }),{status:410,headers});
