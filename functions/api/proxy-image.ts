/** Exact operator allowlist, no redirects, no executable SVG/HTML, bounded response. */
export async function onRequestGet(context:any) {
  const {env,request}=context;
  const raw=new URL(request.url).searchParams.get('url');
  let target:URL;
  try { target=new URL(raw || ''); }catch{return new Response('Invalid image URL',{status:400});}
  const allowed=new Set(String(env.IMAGE_PROXY_ALLOWED_HOSTS || '').split(',').map((s:string)=>s.trim().toLowerCase()).filter(Boolean));
  try { if(env.CLOUDFLARE_R2_PUBLIC_URL)allowed.add(new URL(env.CLOUDFLARE_R2_PUBLIC_URL).hostname.toLowerCase()); }catch{}
  if(target.protocol!=='https:'||target.username||target.password||(target.port&&target.port!=='443')||!allowed.has(target.hostname.toLowerCase()))return new Response('Image host is not allowed',{status:403});
  try {
    const response=await fetch(target,{redirect:'error',signal:AbortSignal.timeout(10000)});
    const type=String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if(!response.ok||!['image/png','image/jpeg','image/gif','image/webp','image/avif'].includes(type))return new Response('Unsupported image',{status:415});
    if(Number(response.headers.get('content-length') || 0)>8*1024*1024)return new Response('Image too large',{status:413});
    const reader=response.body?.getReader();if(!reader)return new Response(null,{status:502});
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8*1024*1024){await reader.cancel();return new Response('Image too large',{status:413});}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return new Response(bytes,{headers:{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=3600'}});
  }catch{return new Response('Image fetch failed',{status:502});}
}
