import {DOCUMENT_AUDIENCES,documentAudienceValues,canManageDocument} from './document-link-policy.js';
const $=id=>document.getElementById(id);
const clean=t=>String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const active=v=>v===1||v===true||v==='1';
const safeLink=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}};
let list=[],actor=null,manage=false,generation=0;
function status(message,error=false){const el=$('documents-feedback');if(!el)return;el.textContent=message;el.classList.remove('hidden');el.className='text-sm rounded-lg p-3 '+(error?'bg-rose-50 text-rose-800':'bg-emerald-50 text-emerald-800');}
function dateLabel(iso){if(!iso)return 'Không giới hạn';const d=new Date(iso);return Number.isNaN(d.getTime())?'Không hợp lệ':d.toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',year:'numeric'});}
function expirationLocal(iso){if(!iso)return '';const d=new Date(iso);return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d).replace(' ','T');}
function render(){
 const body=$('documents-table-body');if(!body)return;
 const q=($('documents-search')?.value||'').trim().toLocaleLowerCase('vi');
 const audience=$('documents-audience-filter')?.value||'';
 const rows=list.filter(r=>(!audience||documentAudienceValues(r).includes(audience))&&(!q||[r.tieu_de,r.duong_link,r.mo_ta,r.danh_muc].join(' ').toLocaleLowerCase('vi').includes(q)));
 $('documents-total').textContent=rows.length+' tài liệu';
 body.innerHTML=rows.length?rows.map((r,i)=>{
 const expires=!!r.thoi_gian_het_han&&Date.parse(r.thoi_gian_het_han)<=Date.now();
 const inactive=!active(r.hoat_dong);
 const label=expires?'Hết hạn':inactive?'Đã tắt':'Đang mở';
 const safeUrl=safeLink(r.duong_link);
 const audienceText=documentAudienceValues(r).map(a=>DOCUMENT_AUDIENCES[a]).join(', ');
 return '<tr class="border-t border-slate-100 hover:bg-emerald-50/40"><td class="p-3">'+(i+1)+'</td><td class="p-3 font-semibold text-slate-800 break-words">'+clean(r.tieu_de)+'</td><td class="p-3 max-w-[220px] break-words whitespace-pre-line text-slate-600">'+clean(r.mo_ta||'—')+'</td><td class="p-3">'+clean(r.danh_muc||'Chung')+'</td><td class="p-3 max-w-[250px] break-all"><a class="text-blue-700 underline" href="'+clean(safeUrl||'#')+'" target="_blank" rel="noopener noreferrer nofollow">Mở tài liệu ↗</a><div class="text-[11px] text-slate-500">'+clean(r.duong_link)+'</div></td><td class="p-3">'+clean(audienceText)+'</td><td class="p-3 text-xs">'+clean(dateLabel(r.thoi_gian_het_han))+'</td><td class="p-3 text-center">'+clean(label)+'</td><td class="p-3"><div class="flex justify-center gap-2">'+(manage?'<button type="button" class="documents-edit rounded bg-blue-50 text-blue-700 px-2 py-1 font-bold" data-id="'+clean(r.id)+'">Sửa</button><button type="button" class="documents-delete rounded bg-rose-50 text-rose-700 px-2 py-1 font-bold" data-id="'+clean(r.id)+'">Xóa</button>':'<span class="text-slate-400">—</span>')+'</div></td></tr>';
 }).join(''):'<tr><td colspan="9" class="text-center p-8 text-slate-500">Chưa có tài liệu phù hợp.</td></tr>';

 const mobile=$('documents-mobile-list');
 if(mobile)mobile.innerHTML=rows.length?rows.map(r=>{
  const audiences=documentAudienceValues(r).map(a=>DOCUMENT_AUDIENCES[a]).join(' · ');
  const expired=!!r.thoi_gian_het_han&&Date.parse(r.thoi_gian_het_han)<=Date.now();
  const state=expired?'Hết hạn':!active(r.hoat_dong)?'Đã tắt':'Đang mở';
  const safeUrl=safeLink(r.duong_link);
  return '<article class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3 min-w-0">'+
   '<div class="flex justify-between gap-3 items-start"><h3 class="font-bold text-slate-900 text-base break-words min-w-0">'+clean(r.tieu_de)+'</h3><span class="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">'+clean(state)+'</span></div>'+
   '<p class="text-sm text-slate-600 whitespace-pre-line break-words">'+clean(r.mo_ta||'Chưa có mô tả')+'</p>'+
   '<div class="flex flex-wrap gap-2"><span class="bg-emerald-50 text-emerald-800 px-2 py-1 rounded-lg text-xs font-semibold">'+clean(r.danh_muc||'Chung')+'</span><span class="bg-blue-50 text-blue-800 px-2 py-1 rounded-lg text-xs">'+clean(audiences)+'</span></div>'+
   '<p class="text-xs text-slate-500">Hết hạn: '+clean(dateLabel(r.thoi_gian_het_han))+'</p>'+
   '<div class="pt-2 border-t border-slate-100 flex flex-wrap gap-2"><a class="flex-1 text-center py-2.5 px-3 rounded-xl bg-emerald-700 text-white font-bold text-sm" href="'+clean(safeUrl||'#')+'" target="_blank" rel="noopener noreferrer nofollow">Mở tài liệu</a>'+
   (manage?'<button type="button" data-id="'+clean(r.id)+'" class="documents-edit px-4 py-2.5 rounded-xl bg-blue-50 text-blue-700 font-bold">Sửa</button><button type="button" data-id="'+clean(r.id)+'" class="documents-delete px-4 py-2.5 rounded-xl bg-rose-50 text-rose-700 font-bold">Xóa</button>':'')+'</div></article>';
 }).join(''):'<div class="text-center text-slate-500 p-8">Chưa có tài liệu phù hợp.</div>';
}
function modal(id){
 if(!manage)return;
 const f=$('documents-form');f.reset();const found=list.find(x=>x.id===id);
 f.elements.namedItem('id').value=found?.id||'';
 for(const name of ['tieu_de','duong_link','mo_ta','danh_muc'])if(found)f.elements.namedItem(name).value=found[name]||'';
 if(!found)f.elements.namedItem('danh_muc').value='Chung';
 const selections=found?documentAudienceValues(found):['authenticated'];
 f.querySelectorAll('[name="doi_tuong_truy_cap_nhieu"]').forEach(box=>{box.checked=selections.includes(box.value);});
 $('documents-audience-error')?.classList.add('hidden');
 f.elements.namedItem('thoi_gian_het_han').value=expirationLocal(found?.thoi_gian_het_han);
 f.elements.namedItem('hoat_dong').checked=!found||active(found.hoat_dong);
 $('documents-modal-title').textContent=found?'Sửa liên kết tài liệu':'Thêm liên kết tài liệu';
 $('documents-modal').classList.remove('hidden');f.elements.namedItem('tieu_de').focus();
}
function close(){ $('documents-modal')?.classList.add('hidden');}
async function request(method,url,payload){
 const token=localStorage.getItem('auth_token')||'';
 const response=await fetch(url,{method,headers:{...(token?{'Authorization':'Bearer '+token}:{}),...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined,cache:'no-store'});
 const data=await response.json().catch(()=>({error:'Máy chủ không trả dữ liệu JSON hợp lệ.'}));
 if(!response.ok)throw Error(data.error||'Không thể thực hiện thao tác.');
 return data;
}
async function load(){
 const seq=++generation;const token=localStorage.getItem('auth_token')||'';
 const useManage=manage&&!!token;
 const body=$('documents-table-body');if(body)body.innerHTML='<tr><td colspan="7" class="text-center p-8 text-slate-500">Đang tải tài liệu...</td></tr>';
 try{const result=await request('GET','/api/documents'+(useManage?'?manage=1':''));if(seq!==generation)return;list=Array.isArray(result.data)?result.data:[];render();}
 catch(e){if(seq!==generation)return;list=[];render();status(e.message,true);}
}
export function resetDocumentLinks(){generation++;list=[];actor=null;manage=false;close();const body=$('documents-table-body');if(body)body.replaceChildren();const mobile=$('documents-mobile-list');if(mobile)mobile.replaceChildren();}
export function initDocumentLinks(user){
 actor=user||null;manage=canManageDocument(actor);
 $('documents-new')?.classList.toggle('hidden',!manage);
 load();
}
let wired=false;
export function connectDocumentLinks(){
 if(wired)return;
 if(!$('documents-form') || !$('documents-table-body'))return;
 wired=true;
 $('documents-new')?.addEventListener('click',()=>modal());
 $('documents-reload')?.addEventListener('click',()=>load());
 $('documents-search')?.addEventListener('input',render);
 $('documents-audience-filter')?.addEventListener('change',render);
 $('documents-cancel')?.addEventListener('click',close);
 $('documents-cancel-top')?.addEventListener('click',close);
 $('documents-modal')?.addEventListener('click',e=>{if(e.target===$('documents-modal'))close();});
 const handleAction=e=>{
  const edit=e.target.closest('.documents-edit'),del=e.target.closest('.documents-delete');
  if(edit)modal(edit.dataset.id);
  if(del&&manage){const item=list.find(x=>x.id===del.dataset.id);if(!item)return;
   const perform=async()=>{try{await request('DELETE','/api/documents?id='+encodeURIComponent(item.id));status('Đã xóa liên kết tài liệu.');await load();}catch(err){status(err.message,true);}};
   if(typeof window.showConfirmModal==='function')window.showConfirmModal('Xóa liên kết “'+item.tieu_de+'”? Hành động này không xóa tệp gốc.',perform);
  }
 };
 $('documents-table-body')?.addEventListener('click',handleAction);
 $('documents-mobile-list')?.addEventListener('click',handleAction);
 $('documents-form')?.addEventListener('submit',async e=>{
  e.preventDefault();if(!manage)return;
  const f=e.currentTarget;
  const raw=f.elements.namedItem('thoi_gian_het_han').value;
  const expiration=raw?new Date(raw+':00+07:00').toISOString():null;
  const checked=[...f.querySelectorAll('[name="doi_tuong_truy_cap_nhieu"]:checked')].map(input=>input.value);
  if(!checked.length){$('documents-audience-error')?.classList.remove('hidden');f.querySelector('[name="doi_tuong_truy_cap_nhieu"]')?.focus();return;}
  $('documents-audience-error')?.classList.add('hidden');
  const value={id:f.elements.namedItem('id').value,tieu_de:f.elements.namedItem('tieu_de').value,mo_ta:f.elements.namedItem('mo_ta').value,danh_muc:f.elements.namedItem('danh_muc').value,duong_link:f.elements.namedItem('duong_link').value,doi_tuong_duoc_truy_cap:checked[0],doi_tuong_truy_cap_nhieu:checked,thoi_gian_het_han:expiration,hoat_dong:f.elements.namedItem('hoat_dong').checked};
  const button=f.querySelector('[type=submit]');button.disabled=true;
  try{await request(value.id?'PUT':'POST','/api/documents',value);close();status('Đã lưu tài liệu thành công.');await load();}
  catch(err){status(err.message,true);}
  finally{button.disabled=false;}
 });
}
