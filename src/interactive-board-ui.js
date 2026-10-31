const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let actor=null,manage=false,list=[],page=1,total=0,generation=0,wired=false,pendingBoard=null;
let ws=null,room=null,objects=new Map(),remoteStrokes=new Map(),tool='pen',drawing=null,lastSegmentIndex=0,locked=false;
let activeBoard=null,activeAccessCode='',manualExit=false,reconnectTimer=null,reconnectAttempts=0;
let roomTokenExpiresAt=0,tokenRefreshAttempts=0;

function token(){return localStorage.getItem(window.tenantStorageKey?window.tenantStorageKey('auth_token'):'auth_token')||'';}
async function api(method,url,body){
 const response=await fetch(url,{method,headers:{...(token()?{Authorization:'Bearer '+token()}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'});
 const data=await response.json().catch(()=>({error:'Máy chủ không trả JSON hợp lệ.'}));
 if(!response.ok){const e=Error(data.error||'Không thể thực hiện thao tác.');e.code=data.code;e.status=response.status;throw e;}return data;
}
function feedback(text,error=false){const el=$('boards-feedback');if(!el)return;el.textContent=text;el.className='rounded-xl p-3 text-sm '+(error?'bg-rose-50 text-rose-800':'bg-emerald-50 text-emerald-800');}
function dateLocal(v){if(!v)return '';const d=new Date(v);if(Number.isNaN(d.getTime()))return '';const pad=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());}
function statusLabel(v){return {draft:'Nháp',open:'Đang mở',locked:'Đang khóa',closed:'Đã đóng',archived:'Lưu trữ'}[v]||v;}
function modeLabel(v){return {public:'Công khai',unit:'Theo lớp/đơn vị',protected:'Mã bảo mật'}[v]||v;}
function renderList(){
 const root=$('boards-list');if(!root)return;
 if(!list.length){root.innerHTML='<div class="col-span-full rounded-xl bg-slate-50 p-8 text-center text-slate-500">Chưa có bảng tương tác phù hợp.</div>';return;}
 root.innerHTML=list.map(b=>'<article class="rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3 min-w-0">'+
  '<div class="flex justify-between gap-2"><div class="min-w-0"><h3 class="font-black text-slate-900 truncate">'+esc(b.name)+'</h3><p class="text-xs text-slate-500 truncate">'+esc(b.creator_name||'')+'</p></div><span class="shrink-0 text-xs rounded-full bg-slate-100 px-2 py-1">'+esc(statusLabel(b.status))+'</span></div>'+
  '<p class="text-sm text-slate-600 min-h-10 line-clamp-2">'+esc(b.description||'Không có mô tả')+'</p>'+
  '<div class="flex flex-wrap gap-1 text-[11px]"><span class="rounded bg-blue-50 text-blue-800 px-2 py-1">'+esc(modeLabel(b.access_mode))+'</span><span class="rounded bg-emerald-50 text-emerald-800 px-2 py-1">'+esc(b.student_permission==='draw'?'Vẽ + ghi':b.student_permission==='comment'?'Ghi chú':'Chỉ xem')+'</span>'+(b.target_lop?'<span class="rounded bg-amber-50 text-amber-900 px-2 py-1">'+esc(b.target_lop)+'</span>':'')+'</div>'+
  '<div class="flex flex-wrap gap-2 pt-2 border-t"><button data-board-enter="'+esc(b.id)+'" class="flex-1 rounded-xl bg-emerald-700 text-white py-2.5 px-3 font-bold text-sm">Vào bảng</button>'+
  (manage?'<button data-board-edit="'+esc(b.id)+'" class="rounded-xl bg-blue-50 text-blue-700 py-2.5 px-3 font-bold text-sm">Sửa</button><button data-board-delete="'+esc(b.id)+'" class="rounded-xl bg-rose-50 text-rose-700 py-2.5 px-3 font-bold text-sm">Xóa</button>':'')+'</div></article>').join('');
 const pages=Math.max(1,Math.ceil(total/20)),p=$('boards-pagination');if(p){p.innerHTML='<button id="boards-prev" class="rounded-lg border px-3 py-2" '+(page<=1?'disabled':'')+'>‹ Trước</button><span>Trang '+page+' / '+pages+'</span><button id="boards-next" class="rounded-lg border px-3 py-2" '+(page>=pages?'disabled':'')+'>Sau ›</button>';}
}
async function load(){
 const seq=++generation;const root=$('boards-list');if(root)root.innerHTML='<div class="col-span-full text-center p-8 text-slate-500">Đang tải danh sách bảng...</div>';
 try{const result=await api('GET','/api/boards?page='+page+'&limit=20'+(manage?'&manage=1':''));if(seq!==generation)return;list=result.data||[];total=Number(result.total)||0;renderList();}
 catch(e){if(seq!==generation)return;list=[];renderList();feedback(e.message,true);}
}
function toggleAccessFields(){
 const mode=$('board-edit-form')?.elements.namedItem('access_mode')?.value;
 $('board-unit-fields')?.classList.toggle('hidden',mode!=='unit');
 $('board-code-field')?.classList.toggle('hidden',mode!=='protected');
}
function openEdit(id=''){
 if(!manage)return;const b=id?list.find(x=>x.id===id):null,f=$('board-edit-form');if(!f)return;f.reset();
 f.elements.namedItem('id').value=b?.id||'';f.elements.namedItem('revision').value=b?.revision||'';
 for(const k of ['name','description','status','access_mode','student_permission','max_participants','target_donvi','target_lop'])if(b&&f.elements.namedItem(k))f.elements.namedItem(k).value=b[k]??'';
 if(!b){f.elements.namedItem('status').value='open';f.elements.namedItem('access_mode').value='public';f.elements.namedItem('student_permission').value='draw';f.elements.namedItem('max_participants').value='60';f.elements.namedItem('target_donvi').value=actor?.donvi||'';}
 f.elements.namedItem('starts_at').value=dateLocal(b?.starts_at);f.elements.namedItem('ends_at').value=dateLocal(b?.ends_at);
 $('board-edit-title').textContent=b?'Sửa bảng tương tác':'Tạo bảng tương tác';toggleAccessFields();$('board-edit-modal').classList.remove('hidden');f.elements.namedItem('name').focus();
}
function closeEdit(){$('board-edit-modal')?.classList.add('hidden');}
function openCode(b){pendingBoard=b;$('board-code-modal')?.classList.remove('hidden');const f=$('board-code-form');f.reset();f.elements.namedItem('access_code').focus();}
function closeCode(){pendingBoard=null;$('board-code-modal')?.classList.add('hidden');}

async function join(b,accessCode='',options={}){
 try{
  const result=await api('POST','/api/board/join',{boardId:b.id,accessCode});
  activeBoard=b;activeAccessCode=accessCode;manualExit=false;room=result.data;
  roomTokenExpiresAt=Date.now()+Math.max(30,Number(room.token_expires_in)||300)*1000-10000;
  if(!options.reconnect){objects.clear();remoteStrokes.clear();tokenRefreshAttempts=0;}
  locked=room.board.status==='locked';
  $('boards-home')?.classList.add('hidden');$('board-room')?.classList.remove('hidden');$('board-room-title').textContent=room.board.name;
  $('board-lock')?.classList.toggle('hidden',!room.board.can_manage);$('board-clear')?.classList.toggle('hidden',!room.board.can_manage);
  connectSocket();
 }catch(e){
  if(e.code==='BOARD_ACCESS_CODE_REQUIRED'&&!options.reconnect){openCode(b);return;}
  if(options.reconnect){scheduleReconnect();return;}
  feedback(e.message,true);
 }
}
function wsUrl(path){const u=new URL(path,location.href);u.protocol=location.protocol==='https:'?'wss:':'ws:';return u.href;}
function connectSocket(){
 if(ws)try{ws.onclose=null;ws.close()}catch{};if(!room)return;const socket=new WebSocket(wsUrl(room.realtime_path));ws=socket;
 $('board-room-status').textContent=reconnectAttempts?'Đang kết nối lại...':'Đang kết nối realtime...';
 socket.onopen=()=>{reconnectAttempts=0;if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}$('board-room-status').textContent='Đã kết nối realtime';};
 socket.onclose=()=>{if(ws!==socket||manualExit)return;$('board-room-status').textContent='Mất kết nối — đang thử kết nối lại...';scheduleReconnect();};
 socket.onerror=()=>{$('board-room-status').textContent='Kết nối realtime không ổn định';};
 socket.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return;}handleMessage(m);};
}
function scheduleReconnect(){
 if(manualExit||!activeBoard||reconnectTimer)return;
 if(reconnectAttempts>=8){$('board-room-status').textContent='Mất kết nối. Vui lòng thoát và vào lại bảng.';return;}
 reconnectAttempts++;
 const delay=Math.min(1000*Math.pow(1.7,reconnectAttempts-1),12000);
 reconnectTimer=setTimeout(async()=>{
  reconnectTimer=null;if(manualExit||!activeBoard)return;
  if(room&&Date.now()<roomTokenExpiresAt){connectSocket();return;}
  if(tokenRefreshAttempts>=2){$('board-room-status').textContent='Phiên realtime đã hết hạn. Vui lòng thoát và vào lại bảng.';return;}
  tokenRefreshAttempts++;
  await join(activeBoard,activeAccessCode,{reconnect:true});
 },delay);
}
function handleMessage(m){
 if(m.type==='snapshot'){objects.clear();for(const o of m.objects||[])objects.set(o.id,o);locked=!!m.locked;render();renderParticipants(m.participants||[]);syncLockUi();return;}
 if(m.type==='put'&&m.object){objects.set(m.object.id,m.object);remoteStrokes.delete(m.object.id);render();return;}
 if(m.type==='delete'){objects.delete(m.objectId);remoteStrokes.delete(m.objectId);render();return;}
 if(m.type==='clear_page'){for(const [id,o] of objects)if(o.pageId===m.pageId)objects.delete(id);render();return;}
 if(m.type==='stroke_segment'){let s=remoteStrokes.get(m.objectId);if(!s){s={id:m.objectId,pageId:m.pageId,type:'stroke',points:[],color:m.color,width:m.width};remoteStrokes.set(m.objectId,s);}s.points.push(...(m.points||[]));render();return;}
 if(m.type==='presence'){renderParticipants(m.participants||[]);return;}
 if(m.type==='lock_state'){locked=!!m.locked;syncLockUi();return;}
}
function sendOps(ops){if(ws?.readyState===WebSocket.OPEN&&ops.length)ws.send(JSON.stringify({type:'op_batch',ops}));}
function renderParticipants(items){$('board-online-count').textContent=items.length+' người';$('board-participants').innerHTML=items.map(p=>'<div class="rounded-lg bg-white border px-3 py-2"><p class="font-bold truncate">'+esc(p.displayName)+'</p><p class="text-[11px] text-slate-500">'+esc(p.role==='teacher'?'Giáo viên':p.role==='admin'?'Admin':'Học sinh')+'</p></div>').join('');}
function syncLockUi(){const overlay=$('board-locked-overlay');overlay?.classList.toggle('hidden',!locked);const btn=$('board-lock');if(btn&&!btn.classList.contains('hidden'))btn.textContent=locked?'🔓 Mở cho HS':'🔒 Khóa HS';}
function canvas(){return $('board-canvas');}
function logicalPoint(ev){const c=canvas(),r=c.getBoundingClientRect();return [(ev.clientX-r.left)*1600/r.width,(ev.clientY-r.top)*900/r.height];}
function render(){
 const c=canvas();if(!c)return;const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);ctx.lineCap='round';ctx.lineJoin='round';
 const all=[...objects.values(),...remoteStrokes.values()];
 for(const o of all){ctx.strokeStyle=o.color||'#111827';ctx.fillStyle=o.color||'#111827';ctx.lineWidth=o.width||3;
  if(o.type==='stroke'&&o.points?.length){ctx.beginPath();o.points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.stroke();}
  else if(o.type==='note'||o.type==='text'){ctx.save();ctx.fillStyle='#fff7c2';ctx.strokeStyle='#eab308';ctx.lineWidth=1.5;ctx.fillRect(o.x,o.y,o.w||220,o.h||120);ctx.strokeRect(o.x,o.y,o.w||220,o.h||120);ctx.fillStyle=o.color||'#111827';ctx.font=(o.fontSize||20)+'px sans-serif';wrapText(ctx,o.text||'',o.x+12,o.y+28,(o.w||220)-24,26);ctx.restore();}
 }
 if(drawing?.points?.length){ctx.strokeStyle=drawing.color;ctx.lineWidth=drawing.width;ctx.beginPath();drawing.points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.stroke();}
}
function wrapText(ctx,text,x,y,maxWidth,lineHeight){const words=String(text).split(/\s+/);let line='';for(const word of words){const test=line?line+' '+word:word;if(ctx.measureText(test).width>maxWidth&&line){ctx.fillText(line,x,y);line=word;y+=lineHeight;}else line=test;}if(line)ctx.fillText(line,x,y);}
function noteText(){return ($('board-note-text')?.value||$('board-note-text-mobile')?.value||'').trim().slice(0,500);}
function canEdit(){return room?.board?.can_manage||(!locked&&room?.board?.student_permission!=='view');}
function pointerDown(e){
 if(!room||!canEdit())return;const p=logicalPoint(e);canvas().setPointerCapture?.(e.pointerId);
 if(tool==='note'){if(!room.board.can_manage&&room.board.student_permission==='view')return;const text=noteText();if(!text){window.showToast?.('Nhập nội dung ghi chú trước.','info');return;}const o={id:crypto.randomUUID(),pageId:room.pages[0].id,type:'note',x:p[0],y:p[1],w:260,h:130,text,color:$('board-color').value,fontSize:20};objects.set(o.id,{...o,creatorId:actor?.id||actor?.user_id});sendOps([{kind:'put',object:o}]);render();return;}
 if(!room.board.can_manage&&room.board.student_permission!=='draw')return;drawing={id:crypto.randomUUID(),pageId:room.pages[0].id,type:'stroke',points:[p],color:$('board-color').value,width:Number($('board-width').value)||3};lastSegmentIndex=0;
}
function pointerMove(e){if(!drawing)return;const p=logicalPoint(e),last=drawing.points[drawing.points.length-1];if(Math.hypot(p[0]-last[0],p[1]-last[1])<2)return;drawing.points.push(p);if(drawing.points.length-lastSegmentIndex>=8){const pts=drawing.points.slice(lastSegmentIndex);lastSegmentIndex=drawing.points.length-1;sendOps([{kind:'stroke_segment',pageId:drawing.pageId,objectId:drawing.id,points:pts,color:drawing.color,width:drawing.width}]);}render();}
function pointerUp(){if(!drawing)return;const done=drawing;drawing=null;if(done.points.length>1){objects.set(done.id,{...done,creatorId:actor?.id||actor?.user_id});sendOps([{kind:'put',object:done}]);}render();}
function exitRoom(){
 manualExit=true;if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}
 if(ws)try{ws.onclose=null;ws.close(1000,'exit')}catch{};ws=null;room=null;activeBoard=null;activeAccessCode='';reconnectAttempts=0;
 roomTokenExpiresAt=0;tokenRefreshAttempts=0;objects.clear();remoteStrokes.clear();drawing=null;$('board-room')?.classList.add('hidden');$('boards-home')?.classList.remove('hidden');
}

export function resetInteractiveBoards(){generation++;list=[];actor=null;manage=false;page=1;total=0;exitRoom();}
export function initInteractiveBoards(user){
 actor=user||null;const role=String(actor?.role||'').toLowerCase(),aud=String(actor?.target_audience||'').toLowerCase();manage=role==='admin'||role==='teacher'||role==='giáo viên'||aud==='giáo viên'||aud==='quản trị viên';
 $('boards-new')?.classList.toggle('hidden',!manage);load();
}
export function connectInteractiveBoards(){
 if(wired||!$('boards-list'))return;wired=true;
 $('boards-new')?.addEventListener('click',()=>openEdit());
 $('boards-reload')?.addEventListener('click',()=>load());
 $('boards-prev')?.addEventListener?.('click',()=>{});
 $('boards-pagination')?.addEventListener('click',e=>{if(e.target.id==='boards-prev'&&page>1){page--;load()}if(e.target.id==='boards-next'&&page*20<total){page++;load()}});
 $('boards-list')?.addEventListener('click',e=>{const enter=e.target.closest('[data-board-enter]'),edit=e.target.closest('[data-board-edit]'),del=e.target.closest('[data-board-delete]');if(enter){const b=list.find(x=>x.id===enter.dataset.boardEnter);if(b)join(b);}if(edit)openEdit(edit.dataset.boardEdit);if(del){const b=list.find(x=>x.id===del.dataset.boardDelete);if(!b)return;const go=async()=>{try{await api('DELETE','/api/boards?id='+encodeURIComponent(b.id));feedback('Đã xóa bảng.');load();}catch(err){feedback(err.message,true)}};window.showConfirmModal?.('Xóa bảng “'+b.name+'”?',go);}});
 $('board-edit-close')?.addEventListener('click',closeEdit);$('board-edit-cancel')?.addEventListener('click',closeEdit);
 $('board-edit-form')?.elements.namedItem('access_mode')?.addEventListener('change',toggleAccessFields);
 $('board-edit-form')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,fd=new FormData(f);const id=fd.get('id');const body={id,revision:Number(fd.get('revision'))||undefined,name:fd.get('name'),description:fd.get('description'),status:fd.get('status'),access_mode:fd.get('access_mode'),student_permission:fd.get('student_permission'),max_participants:Number(fd.get('max_participants'))||60,target_donvi:fd.get('target_donvi'),target_lop:fd.get('target_lop'),access_code:fd.get('access_code'),starts_at:fd.get('starts_at')?new Date(String(fd.get('starts_at'))).toISOString():null,ends_at:fd.get('ends_at')?new Date(String(fd.get('ends_at'))).toISOString():null};const btn=f.querySelector('[type=submit]');btn.disabled=true;try{await api(id?'PUT':'POST','/api/boards',body);closeEdit();feedback('Đã lưu bảng tương tác.');load();}catch(err){feedback(err.message,true)}finally{btn.disabled=false;}});
 $('board-code-cancel')?.addEventListener('click',closeCode);$('board-code-form')?.addEventListener('submit',e=>{e.preventDefault();const b=pendingBoard,code=e.currentTarget.elements.namedItem('access_code').value;closeCode();if(b)join(b,code);});
 document.querySelectorAll('[data-board-tool]').forEach(btn=>btn.addEventListener('click',()=>{tool=btn.dataset.boardTool;document.querySelectorAll('[data-board-tool]').forEach(x=>{x.classList.toggle('bg-emerald-700',x===btn);x.classList.toggle('text-white',x===btn);x.classList.toggle('bg-slate-100',x!==btn);});}));
 canvas()?.addEventListener('pointerdown',pointerDown);canvas()?.addEventListener('pointermove',pointerMove);canvas()?.addEventListener('pointerup',pointerUp);canvas()?.addEventListener('pointercancel',pointerUp);
 $('board-exit')?.addEventListener('click',exitRoom);
 $('board-lock')?.addEventListener('click',()=>{if(room?.board?.can_manage)sendOps([{kind:locked?'unlock':'lock'}]);});
 $('board-clear')?.addEventListener('click',()=>{if(!room?.board?.can_manage)return;window.showConfirmModal?.('Xóa toàn bộ nội dung đang có trên trang bảng này?',()=>sendOps([{kind:'clear_page',pageId:room.pages[0].id}]));});
}
