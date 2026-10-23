/** Image URLs are data, never HTML attributes or executable document content. */
export function normalizedImageUrl(value, allowBlob=false) {
  if(typeof value !== 'string' || value.length>11200000 || /[<>"'`\u0000-\u0020\u007f]/.test(value))return '';
  if(/^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))return value;
  if(/^\/(?!\/)/.test(value))return value;
  try {
    const url=new URL(value);
    if(url.protocol==='https:' && !url.username && !url.password)return url.href;
    if(allowBlob && url.protocol==='blob:')return url.href;
  }catch{}
  return '';
}
export function escapeImageSource(value) {
  return normalizedImageUrl(String(value ?? ''),true).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
