interface Env {
  CLOUDFLARE_R2_PUBLIC_URL?: string;
  CLOUDFLARE_R2_BUCKET_NAME?: string;
  CLOUDFLARE_R2_ACCOUNT_ID?: string;
}

function normalizedBase(value: unknown) {
  const raw=String(value||'').trim().replace(/\/+$/,'');
  if(!raw)return '';
  try{
    const url=new URL(raw);
    return url.protocol==='https:'?url.href.replace(/\/+$/,''):'';
  }catch{return '';}
}

function allowedImageUrl(raw: string, env: Env) {
  let url: URL;
  try { url=new URL(raw); } catch { return null; }
  if(url.protocol!=='https:'||url.username||url.password)return null;
  const bases=[
    normalizedBase(env.CLOUDFLARE_R2_PUBLIC_URL),
    env.CLOUDFLARE_R2_BUCKET_NAME&&env.CLOUDFLARE_R2_ACCOUNT_ID
      ? normalizedBase('https://'+env.CLOUDFLARE_R2_BUCKET_NAME+'.'+env.CLOUDFLARE_R2_ACCOUNT_ID+'.r2.dev')
      : ''
  ].filter(Boolean);
  if(!bases.some(base=>url.href===base||url.href.startsWith(base+'/')))return null;
  return url;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const raw = new URL(context.request.url).searchParams.get('url');
    if (!raw) return new Response('Yêu cầu tham số URL hợp lệ.', { status: 400 });
    const imageUrl=allowedImageUrl(raw,context.env||{});
    if(!imageUrl)return new Response('Nguồn ảnh không được phép.',{status:403});

    const imgRes = await fetch(imageUrl.href,{redirect:'error'});
    if (!imgRes.ok) return new Response('Không thể tải ảnh nguồn.', { status: imgRes.status });
    const contentType = String(imgRes.headers.get('content-type') || '').toLowerCase();
    if(!contentType.startsWith('image/'))return new Response('Nguồn không phải hình ảnh.',{status:415});
    const declared=Number(imgRes.headers.get('content-length')||0);
    if(declared>12*1024*1024)return new Response('Ảnh vượt giới hạn proxy.',{status:413});
    const buffer = await imgRes.arrayBuffer();
    if(buffer.byteLength>12*1024*1024)return new Response('Ảnh vượt giới hạn proxy.',{status:413});

    return new Response(buffer, {
      headers: {
        'Content-Type': contentType || 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch {
    return new Response('Lỗi máy chủ proxy ảnh.', { status: 500 });
  }
};
