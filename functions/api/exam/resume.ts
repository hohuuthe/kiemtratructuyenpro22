// Permanently retired: browser sessions never resume after a document exits.
// The server-side liveness finalizer preserves and grades the last saved work.
const headers = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'Content-Type, Authorization',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Content-Type':'application/json',
  'Cache-Control':'no-store'
};
export const onRequestOptions:PagesFunction=async()=>new Response(null,{status:204,headers});
export const onRequestPost:PagesFunction=async()=>new Response(JSON.stringify({
  code:'EXAM_RESUME_DISABLED',
  error:'Ứng dụng không còn khôi phục phiên thi. Bài trước được máy chủ tự nộp; vui lòng bắt đầu lượt mới khi đủ điều kiện.'
}),{status:410,headers});
