export const onRequest: PagesFunction = async (context: any) => {
  if (!context.env?.BOARD_REALTIME || typeof context.env.BOARD_REALTIME.fetch !== 'function') {
    return new Response(JSON.stringify({ error: 'Dịch vụ realtime chưa được liên kết.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  const url=new URL(context.request.url);
  const isWebSocket=(context.request.headers.get('Upgrade') || '').toLowerCase() === 'websocket';
  const isSnapshot=context.request.method==='GET' && url.searchParams.get('snapshot')==='1';
  if (!isWebSocket && !isSnapshot) {
    return new Response(JSON.stringify({ error: 'Yêu cầu realtime không hợp lệ.' }), {
      status: 426,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
  return context.env.BOARD_REALTIME.fetch(context.request);
};
