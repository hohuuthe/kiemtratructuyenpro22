import { verifyAuthSession, getDynamicSecret, getDatabase } from '../exam/utils';

interface Env {
  NEON_DATABASE_URL?: string;
  DATABASE_URL?: string;
  DB?: any;
  JWT_SECRET?: string;
}

const headers = {
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store, max-age=0',
  'Pragma':'no-cache',
  'Vary':'Authorization'
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const bearer=context.request.headers.get('Authorization')||'';
    if(!bearer.startsWith('Bearer ')||!bearer.slice(7).trim()) {
      return new Response(JSON.stringify({error:'Phiên đăng nhập không hợp lệ.'}),{status:401,headers});
    }
    const db=getDatabase(context);
    const secret=await getDynamicSecret(db,context.env?.JWT_SECRET);
    const user:any=await verifyAuthSession(bearer.slice(7),secret,db);
    if(!user) return new Response(JSON.stringify({error:'Phiên đăng nhập đã hết hạn hoặc không còn hiệu lực.'}),{status:401,headers});
    const safe={
      id:user.id,
      user_id:user.user_id||user.id,
      username:user.username||'',
      role:user.role||'user',
      target_audience:user.target_audience||'Học sinh',
      full_name:user.full_name||user.username||'',
      donvi:user.donvi||'',
      lop:user.lop||'',
      is_vip:Boolean(user.is_vip)
    };
    return new Response(JSON.stringify({data:safe,error:null}),{status:200,headers});
  } catch {
    return new Response(JSON.stringify({error:'Không thể xác minh phiên đăng nhập.'}),{status:503,headers});
  }
};
