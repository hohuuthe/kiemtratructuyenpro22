export const onRequestPost: PagesFunction = async (context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  return new Response(JSON.stringify({ 
    error: "Cơ chế tự đăng ký tài khoản đã bị khóa tuyệt đối. Chỉ Admin mới có quyền tạo tài khoản." 
  }), { 
    status: 403, 
    headers: corsHeaders 
  });
}

export const onRequestOptions: PagesFunction = async () => {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    });
};
