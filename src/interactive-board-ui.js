const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let actor=null,manage=false,list=[],page=1,total=0,generation=0,wired=false,pendingBoard=null;
let ws=null,room=null,objects=new Map(),remoteStrokes=new Map(),tool='pen',drawing=null,lastSegmentIndex=0,locked=false;
let activeBoard=null,activeAccessCode='',manualExit=false,reconnectTimer=null,reconnectAttempts=0;
let roomTokenExpiresAt=0,tokenRefreshAttempts=0,currentPageId='';
let undoStack=[],redoStack=[],renderQueued=false,lastRateNotice=0,userLocked=false;
let pendingReliable=new Map(),dragState=null;

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
  const result=await api('POST','/api/board/join',{boardId:b.id,accessCode,pageId:options.pageId||currentPageId||undefined});
  activeBoard=b;activeAccessCode=accessCode;manualExit=false;room=result.data;
  roomTokenExpiresAt=Date.now()+Math.max(30,Number(room.token_expires_in)||300)*1000-10000;
  currentPageId=String(room.current_page_id||room.pages?.[0]?.id||'');
  if(!options.reconnect){objects.clear();remoteStrokes.clear();tokenRefreshAttempts=0;}
  if(options.pageSwitch){undoStack=[];redoStack=[];}
  locked=room.board.status==='locked';
  renderPageControls();
  $('boards-home')?.classList.add('hidden');$('board-room')?.classList.remove('hidden');$('board-room-title').textContent=room.board.name;
  $('board-lock')?.classList.toggle('hidden',!room.board.can_manage);$('board-clear')?.classList.toggle('hidden',!room.board.can_manage);
  connectSocket();
 }catch(e){
  if(e.code==='BOARD_ACCESS_CODE_REQUIRED'&&!options.reconnect){openCode(b);return;}
  if(options.reconnect){
    if(e.status===401||e.status===403){manualExit=true;$('board-room-status').textContent=e.message||'Bạn không còn quyền truy cập bảng này.';return;}
    scheduleReconnect();return;
  }
  feedback(e.message,true);
 }
}
function wsUrl(path){const u=new URL(path,location.href);u.protocol=location.protocol==='https:'?'wss:':'ws:';return u.href;}
function connectSocket(pageId=currentPageId){
 if(ws)try{ws.onclose=null;ws.close()}catch{};if(!room)return;
 const base=room.realtime_base_path||room.realtime_path;
 const url=new URL(wsUrl(base));url.searchParams.set('pageId',pageId||currentPageId);
 const socket=new WebSocket(url.href);ws=socket;
 $('board-room-status').textContent=reconnectAttempts?'Đang kết nối lại...':'Đang kết nối realtime...';
 socket.onopen=()=>{reconnectAttempts=0;if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}$('board-room-status').textContent='Đã kết nối realtime';for(const payload of pendingReliable.values()){try{socket.send(payload)}catch{}}};
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
  if(room&&Date.now()<roomTokenExpiresAt){connectSocket(currentPageId);return;}
  if(tokenRefreshAttempts>=2){$('board-room-status').textContent='Phiên realtime đã hết hạn. Vui lòng thoát và vào lại bảng.';return;}
  tokenRefreshAttempts++;
  await join(activeBoard,activeAccessCode,{reconnect:true});
 },delay);
}
function handleMessage(m){
 if(m.type==='snapshot'){objects.clear();for(const o of m.objects||[])objects.set(o.id,o);locked=!!m.locked;userLocked=!!m.userLocked;scheduleRender();renderParticipants(m.participants||[]);syncLockUi();applyPageBackground();return;}
 if(m.type==='put'&&m.object){objects.set(m.object.id,m.object);remoteStrokes.delete(m.object.id);scheduleRender();return;}
 if(m.type==='delete'){objects.delete(m.objectId);remoteStrokes.delete(m.objectId);scheduleRender();return;}
 if(m.type==='clear_page'){for(const [id,o] of objects)if(o.pageId===m.pageId)objects.delete(id);scheduleRender();return;}
 if(m.type==='stroke_segment'){let s=remoteStrokes.get(m.objectId);if(!s){s={id:m.objectId,pageId:m.pageId,type:'stroke',points:[],color:m.color,width:m.width};remoteStrokes.set(m.objectId,s);}s.points.push(...(m.points||[]));scheduleRender();return;}
 if(m.type==='page_created'&&m.page){if(!room.pages.some(p=>String(p.id)===String(m.page.id))){room.pages=[...room.pages,m.page].sort((a,b)=>(a.page_no||0)-(b.page_no||0));renderPageControls();}return;}
 if(m.type==='page_deleted'){room.pages=(room.pages||[]).filter(p=>String(p.id)!==String(m.pageId));renderPageControls();if(String(m.pageId)===String(currentPageId)){const next=room.pages[0];if(next)switchPage(next.id);else exitRoom();}return;}
 if(m.type==='op_ack'&&m.clientOpId){pendingReliable.delete(String(m.clientOpId));return;}
 if(m.type==='clear_user_objects'){for(const id of m.objectIds||[])objects.delete(id);scheduleRender();return;}
 if(m.type==='stroke_cancel'){remoteStrokes.delete(m.objectId);scheduleRender();return;}
 if(m.type==='user_lock_state'){userLocked=!!m.blocked;syncLockUi();window.showToast?.(userLocked?'Giáo viên đã tạm khóa quyền tương tác của bạn.':'Giáo viên đã mở lại quyền tương tác cho bạn.','info');return;}
 if(m.type==='rate_limited'){const now=Date.now();if(now-lastRateNotice>5000){lastRateNotice=now;window.showToast?.('Thao tác quá nhanh, hệ thống đang giảm nhịp để bảo vệ lớp học.','info');}return;}
 if(m.type==='presence'){renderParticipants(m.participants||[]);return;}
 if(m.type==='lock_state'){locked=!!m.locked;syncLockUi();return;}
 if(m.type==='policy_changed'){locked=!!m.locked;roomTokenExpiresAt=0;syncLockUi();$('board-room-status').textContent='Cấu hình bảng vừa thay đổi — đang xác thực lại...';return;}
 if(m.type==='board_unavailable'){manualExit=true;window.showToast?.('Bảng đã đóng hoặc tạm ngừng truy cập.','info');exitRoom();return;}
 if(m.type==='board_deleted'){manualExit=true;window.showToast?.('Bảng này đã được giáo viên xóa.','info');exitRoom();return;}
}
function sendOps(ops){
 if(!ops.length)return;
 const transient=ops.every(op=>op.kind==='stroke_segment');
 const clientOpId=transient?'':crypto.randomUUID();
 const payload=JSON.stringify({type:'op_batch',clientOpId:clientOpId||undefined,ops});
 if(!transient&&clientOpId){
   pendingReliable.set(clientOpId,payload);
   if(pendingReliable.size>40){const oldest=pendingReliable.keys().next().value;pendingReliable.delete(oldest);}
 }
 if(ws?.readyState===WebSocket.OPEN)ws.send(payload);
}
function myId(){return String(actor?.id||actor?.user_id||'');}
function remember(action){undoStack.push(action);if(undoStack.length>100)undoStack.shift();redoStack=[];syncHistoryButtons();}
function syncHistoryButtons(){if($('board-undo'))$('board-undo').disabled=!undoStack.length;if($('board-redo'))$('board-redo').disabled=!redoStack.length;}
function renderPageControls(){
 const select=$('board-page-select');if(!select||!room)return;
 const pages=room.pages||[];
 select.innerHTML=pages.map(p=>'<option value="'+esc(p.id)+'">'+esc((p.page_no||'')+'. '+(p.title||'Trang'))+'</option>').join('');
 select.value=currentPageId||pages[0]?.id||'';applyPageBackground();
 const idx=pages.findIndex(p=>String(p.id)===String(select.value));
 if($('board-page-prev'))$('board-page-prev').disabled=idx<=0;
 if($('board-page-next'))$('board-page-next').disabled=idx<0||idx>=pages.length-1;
 $('board-add-page')?.classList.toggle('hidden',!room.board.can_manage);
 $('board-delete-page')?.classList.toggle('hidden',!room.board.can_manage||pages.length<=1);
}
async function switchPage(pageId){
 if(!room||!pageId||pageId===currentPageId)return;
 try{
   manualExit=false;
   if(ws)try{ws.onclose=null;ws.close(1000,'switch page')}catch{}
   ws=null;objects.clear();remoteStrokes.clear();drawing=null;dragState=null;scheduleRender();
   const allowed=Array.isArray(room.allowed_page_ids)&&room.allowed_page_ids.includes(String(pageId));
   if(allowed&&Date.now()<roomTokenExpiresAt){
     currentPageId=String(pageId);undoStack=[];redoStack=[];renderPageControls();connectSocket(currentPageId);return;
   }
   await join(activeBoard,activeAccessCode,{pageId,pageSwitch:true});
 }catch(e){window.showToast?.(e.message||'Không thể chuyển trang.','error');}
}
function cloneObject(o){return JSON.parse(JSON.stringify(o));}
function translateObject(o,dx,dy){
 const n=cloneObject(o);
 if(n.type==='stroke'&&Array.isArray(n.points))n.points=n.points.map(p=>[p[0]+dx,p[1]+dy]);
 else if(n.type==='note'||n.type==='text'){n.x+=dx;n.y+=dy;}
 else {n.x1+=dx;n.y1+=dy;n.x2+=dx;n.y2+=dy;}
 return n;
}
function hitObject(point){
 const [x,y]=point,items=[...objects.values()].reverse();
 for(const o of items){
  if(o.pageId!==currentPageId)continue;
  if(!room?.board?.can_manage && String(o.creatorId||'')!==myId())continue;
  if((o.type==='note'||o.type==='text')&&x>=o.x&&x<=o.x+(o.w||220)&&y>=o.y&&y<=o.y+(o.h||120))return o;
  if(o.type==='stroke'&&Array.isArray(o.points)){
   const threshold=Math.max(12,(o.width||3)*3);
   for(let i=0;i<o.points.length;i+=Math.max(1,Math.floor(o.points.length/180))){
    const p=o.points[i];if(Math.hypot(x-p[0],y-p[1])<=threshold)return o;
   }
  }
  if(['rect','ellipse','line','arrow'].includes(o.type)){
   const minX=Math.min(o.x1,o.x2)-14,maxX=Math.max(o.x1,o.x2)+14,minY=Math.min(o.y1,o.y2)-14,maxY=Math.max(o.y1,o.y2)+14;
   if(x>=minX&&x<=maxX&&y>=minY&&y<=maxY)return o;
  }
 }
 return null;
}
async function undo(){
 const action=undoStack.pop();if(!action)return;
 if(action.kind==='put'){sendOps([{kind:'delete',pageId:action.object.pageId,objectId:action.object.id}]);objects.delete(action.object.id);}
 else if(action.kind==='delete'){sendOps([{kind:'put',object:action.object}]);objects.set(action.object.id,action.object);}
 else if(action.kind==='update'){sendOps([{kind:'put',object:action.before}]);objects.set(action.before.id,action.before);}
 redoStack.push(action);syncHistoryButtons();scheduleRender();
}
async function redo(){
 const action=redoStack.pop();if(!action)return;
 if(action.kind==='put'){sendOps([{kind:'put',object:action.object}]);objects.set(action.object.id,action.object);}
 else if(action.kind==='delete'){sendOps([{kind:'delete',pageId:action.object.pageId,objectId:action.object.id}]);objects.delete(action.object.id);}
 else if(action.kind==='update'){sendOps([{kind:'put',object:action.after}]);objects.set(action.after.id,action.after);}
 undoStack.push(action);syncHistoryButtons();scheduleRender();
}
function renderParticipants(items){
 $('board-online-count').textContent=items.length+' người';
 $('board-participants').innerHTML=items.map(p=>{
   const roleLabel=p.role==='teacher'?'Giáo viên':p.role==='admin'?'Admin':'Học sinh';
   const canModerate=room?.board?.can_manage&&p.role==='student'&&String(p.userId)!==myId();
   return '<div class="rounded-lg bg-white border px-3 py-2 space-y-1"><div class="flex items-center justify-between gap-2"><div class="min-w-0"><p class="font-bold truncate">'+esc(p.displayName)+'</p><p class="text-[11px] text-slate-500">'+esc(roleLabel)+(p.blocked?' • đang khóa':'')+'</p></div>'+(canModerate?'<div class="flex gap-1"><button data-board-user-clear="'+esc(p.userId)+'" class="shrink-0 rounded-md bg-rose-50 text-rose-700 px-2 py-1 text-[11px] font-bold">Xóa nét</button><button data-board-user-lock="'+esc(p.userId)+'" data-blocked="'+(p.blocked?'1':'0')+'" class="shrink-0 rounded-md px-2 py-1 text-[11px] font-bold '+(p.blocked?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-800')+'">'+(p.blocked?'Mở':'Khóa')+'</button></div>':'')+'</div></div>';
 }).join('');
}
function syncLockUi(){
 const overlay=$('board-locked-overlay');overlay?.classList.toggle('hidden',!(locked||userLocked));
 const label=overlay?.querySelector('span');if(label)label.textContent=userLocked?'Giáo viên đang khóa quyền tương tác của bạn':(locked?'Bảng đang khóa chỉnh sửa':'');
 const btn=$('board-lock');if(btn&&!btn.classList.contains('hidden'))btn.textContent=locked?'🔓 Mở cho HS':'🔒 Khóa HS';
}
function canvas(){return $('board-canvas');}
function logicalPoint(ev){const c=canvas(),r=c.getBoundingClientRect();return [Math.round((ev.clientX-r.left)*1600/r.width),Math.round((ev.clientY-r.top)*900/r.height)];}
function scheduleRender(){if(renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{renderQueued=false;render();});}
function applyPageBackground(){
 const wrap=$('board-canvas-wrap'),page=(room?.pages||[]).find(p=>String(p.id)===String(currentPageId));if(!wrap)return;
 const type=page?.background_type||'white';wrap.style.backgroundColor='#ffffff';wrap.style.backgroundImage='';wrap.style.backgroundSize='';
 if(type==='grid')wrap.style.backgroundImage='linear-gradient(#e5e7eb 1px, transparent 1px),linear-gradient(90deg,#e5e7eb 1px,transparent 1px)',wrap.style.backgroundSize='32px 32px';
 if(type==='lined')wrap.style.backgroundImage='repeating-linear-gradient(to bottom,transparent 0,transparent 31px,#dbeafe 32px)';
 if(type==='dots')wrap.style.backgroundImage='radial-gradient(#cbd5e1 1.5px,transparent 1.5px)',wrap.style.backgroundSize='24px 24px';
}
function render(){
 const c=canvas();if(!c)return;const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);ctx.lineCap='round';ctx.lineJoin='round';
 const all=[...objects.values(),...remoteStrokes.values()];
 for(const o of all)drawObject(ctx,o);
 if(drawing)drawObject(ctx,drawing);
}
function drawObject(ctx,o){
 if(!o)return;ctx.save();ctx.strokeStyle=o.color||'#111827';ctx.fillStyle=o.color||'#111827';ctx.lineWidth=o.width||3;ctx.lineCap='round';ctx.lineJoin='round';
 if(o.type==='stroke'&&o.points?.length){ctx.beginPath();o.points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.stroke();}
 else if(o.type==='note'||o.type==='text'){ctx.fillStyle='#fff7c2';ctx.strokeStyle='#eab308';ctx.lineWidth=1.5;ctx.fillRect(o.x,o.y,o.w||220,o.h||120);ctx.strokeRect(o.x,o.y,o.w||220,o.h||120);ctx.fillStyle=o.color||'#111827';ctx.font=(o.fontSize||20)+'px sans-serif';wrapText(ctx,o.text||'',o.x+12,o.y+28,(o.w||220)-24,26);}
 else if(o.type==='line'||o.type==='arrow'){ctx.beginPath();ctx.moveTo(o.x1,o.y1);ctx.lineTo(o.x2,o.y2);ctx.stroke();if(o.type==='arrow'){const a=Math.atan2(o.y2-o.y1,o.x2-o.x1),len=16+Math.min(16,(o.width||3)*2);ctx.beginPath();ctx.moveTo(o.x2,o.y2);ctx.lineTo(o.x2-len*Math.cos(a-Math.PI/6),o.y2-len*Math.sin(a-Math.PI/6));ctx.moveTo(o.x2,o.y2);ctx.lineTo(o.x2-len*Math.cos(a+Math.PI/6),o.y2-len*Math.sin(a+Math.PI/6));ctx.stroke();}}
 else if(o.type==='rect'){ctx.strokeRect(Math.min(o.x1,o.x2),Math.min(o.y1,o.y2),Math.abs(o.x2-o.x1),Math.abs(o.y2-o.y1));}
 else if(o.type==='ellipse'){const cx=(o.x1+o.x2)/2,cy=(o.y1+o.y2)/2,rx=Math.abs(o.x2-o.x1)/2,ry=Math.abs(o.y2-o.y1)/2;ctx.beginPath();ctx.ellipse(cx,cy,Math.max(1,rx),Math.max(1,ry),0,0,Math.PI*2);ctx.stroke();}
 ctx.restore();
}
function wrapText(ctx,text,x,y,maxWidth,lineHeight){const words=String(text).split(/\s+/);let line='';for(const word of words){const test=line?line+' '+word:word;if(ctx.measureText(test).width>maxWidth&&line){ctx.fillText(line,x,y);line=word;y+=lineHeight;}else line=test;}if(line)ctx.fillText(line,x,y);}
function noteText(){return ($('board-note-text')?.value||$('board-note-text-mobile')?.value||'').trim().slice(0,500);}
function canEdit(){return room?.board?.can_manage||(!locked&&!userLocked&&room?.board?.student_permission!=='view');}
function pointerDown(e){
 if(!room||!canEdit())return;const p=logicalPoint(e);canvas().setPointerCapture?.(e.pointerId);
 if(tool==='select'){
   const target=hitObject(p);if(!target)return;
   if(!room.board.can_manage&&room.board.student_permission==='comment'&&!['note','text'].includes(target.type))return;
   dragState={id:target.id,start:p,before:cloneObject(target)};
   return;
 }
 if(tool==='note'){if(!room.board.can_manage&&room.board.student_permission==='view')return;const text=noteText();if(!text){window.showToast?.('Nhập nội dung ghi chú trước.','info');return;}const o={id:crypto.randomUUID(),pageId:currentPageId,type:'note',x:p[0],y:p[1],w:260,h:130,text,color:$('board-color').value,fontSize:20,creatorId:myId()};objects.set(o.id,o);sendOps([{kind:'put',object:o}]);remember({kind:'put',object:o});scheduleRender();return;}
 if(tool==='eraser'){const target=hitObject(p);if(target){sendOps([{kind:'delete',pageId:target.pageId,objectId:target.id}]);objects.delete(target.id);remember({kind:'delete',object:target});scheduleRender();}return;}
 if(!room.board.can_manage&&room.board.student_permission!=='draw')return;
 if(['line','arrow','rect','ellipse'].includes(tool)){drawing={id:crypto.randomUUID(),pageId:currentPageId,type:tool,x1:p[0],y1:p[1],x2:p[0],y2:p[1],color:$('board-color').value,width:Number($('board-width').value)||3};return;}
 drawing={id:crypto.randomUUID(),pageId:currentPageId,type:'stroke',points:[p],color:$('board-color').value,width:Number($('board-width').value)||3};lastSegmentIndex=0;
}
function pointerMove(e){
 const p=logicalPoint(e);
 if(dragState){
   const dx=p[0]-dragState.start[0],dy=p[1]-dragState.start[1],moved=translateObject(dragState.before,dx,dy);
   objects.set(moved.id,moved);scheduleRender();return;
 }
 if(!drawing)return;
 if(drawing.type!=='stroke'){drawing.x2=p[0];drawing.y2=p[1];scheduleRender();return;}
 const last=drawing.points[drawing.points.length-1];if(Math.hypot(p[0]-last[0],p[1]-last[1])<2)return;drawing.points.push(p);if(drawing.points.length-lastSegmentIndex>=8){const pts=drawing.points.slice(lastSegmentIndex);lastSegmentIndex=drawing.points.length-1;sendOps([{kind:'stroke_segment',pageId:drawing.pageId,objectId:drawing.id,points:pts,color:drawing.color,width:drawing.width}]);}scheduleRender();
}
function pointerUp(){
 if(dragState){
   const after=objects.get(dragState.id),before=dragState.before;dragState=null;
   if(after&&JSON.stringify(after)!==JSON.stringify(before)){sendOps([{kind:'put',object:after}]);remember({kind:'update',before,after:cloneObject(after)});}
   scheduleRender();return;
 }
 if(!drawing)return;const done={...drawing,creatorId:myId()};drawing=null;
 const valid=done.type==='stroke'?done.points?.length>1:Math.hypot((done.x2||0)-(done.x1||0),(done.y2||0)-(done.y1||0))>3;
 if(valid){objects.set(done.id,done);sendOps([{kind:'put',object:done}]);remember({kind:'put',object:done});}
 scheduleRender();
}
function exitRoom(){
 manualExit=true;if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}
 if(ws)try{ws.onclose=null;ws.close(1000,'exit')}catch{};ws=null;room=null;activeBoard=null;activeAccessCode='';reconnectAttempts=0;
 roomTokenExpiresAt=0;tokenRefreshAttempts=0;currentPageId='';userLocked=false;pendingReliable.clear();dragState=null;undoStack=[];redoStack=[];objects.clear();remoteStrokes.clear();drawing=null;$('board-room')?.classList.add('hidden');$('boards-home')?.classList.remove('hidden');
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
 $('board-export-image')?.addEventListener('click',()=>{
   const source=canvas();if(!source)return;
   const out=document.createElement('canvas');out.width=1600;out.height=900;const ctx=out.getContext('2d');
   ctx.fillStyle='#fff';ctx.fillRect(0,0,out.width,out.height);
   const pageInfo=(room?.pages||[]).find(p=>String(p.id)===String(currentPageId));
   if(pageInfo?.background_type==='grid'){ctx.strokeStyle='#e5e7eb';ctx.lineWidth=1;for(let x=0;x<=1600;x+=32){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,900);ctx.stroke();}for(let y=0;y<=900;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1600,y);ctx.stroke();}}
   if(pageInfo?.background_type==='lined'){ctx.strokeStyle='#dbeafe';for(let y=32;y<=900;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1600,y);ctx.stroke();}}
   if(pageInfo?.background_type==='dots'){ctx.fillStyle='#cbd5e1';for(let y=12;y<900;y+=24)for(let x=12;x<1600;x+=24){ctx.beginPath();ctx.arc(x,y,1.5,0,Math.PI*2);ctx.fill();}}
   ctx.drawImage(source,0,0);out.toBlob(blob=>{if(!blob)return;const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(room?.board?.name||'bang-tuong-tac').replace(/[^\p{L}\p{N}._-]+/gu,'-')+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);},'image/png');
 });
 $('board-lock')?.addEventListener('click',()=>{if(room?.board?.can_manage)sendOps([{kind:locked?'unlock':'lock'}]);});
 $('board-clear')?.addEventListener('click',()=>{if(!room?.board?.can_manage)return;window.showConfirmModal?.('Xóa toàn bộ nội dung đang có trên trang bảng này?',()=>{sendOps([{kind:'clear_page',pageId:currentPageId}]);undoStack=[];redoStack=[];syncHistoryButtons();});});
 $('board-page-select')?.addEventListener('change',e=>switchPage(e.target.value));
 $('board-page-prev')?.addEventListener('click',()=>{const pages=room?.pages||[],i=pages.findIndex(p=>String(p.id)===String(currentPageId));if(i>0)switchPage(pages[i-1].id);});
 $('board-page-next')?.addEventListener('click',()=>{const pages=room?.pages||[],i=pages.findIndex(p=>String(p.id)===String(currentPageId));if(i>=0&&i<pages.length-1)switchPage(pages[i+1].id);});
 $('board-add-page')?.addEventListener('click',async()=>{if(!room?.board?.can_manage)return;try{const result=await api('POST','/api/board/pages',{boardId:room.board.id});if(!(room.pages||[]).some(p=>String(p.id)===String(result.data.id)))room.pages=[...(room.pages||[]),result.data];renderPageControls();await join(activeBoard,activeAccessCode,{pageId:result.data.id,pageSwitch:true});}catch(e){window.showToast?.(e.message||'Không thể thêm trang.','error');}});
 $('board-delete-page')?.addEventListener('click',()=>{if(!room?.board?.can_manage||!currentPageId)return;const target=(room.pages||[]).find(p=>String(p.id)===String(currentPageId));window.showConfirmModal?.('Xóa trang “'+(target?.title||'')+'”?',async()=>{try{await api('DELETE','/api/board/pages?id='+encodeURIComponent(currentPageId));room.pages=(room.pages||[]).filter(p=>String(p.id)!==String(currentPageId));const next=room.pages[0];if(next)await switchPage(next.id);renderPageControls();}catch(e){window.showToast?.(e.message||'Không thể xóa trang.','error');}});});
 $('board-participants')?.addEventListener('click',e=>{
   const lockBtn=e.target.closest('[data-board-user-lock]'),clearBtn=e.target.closest('[data-board-user-clear]');
   if(!room?.board?.can_manage)return;
   if(lockBtn)sendOps([{kind:'set_user_lock',targetUserId:lockBtn.dataset.boardUserLock,blocked:lockBtn.dataset.blocked!=='1'}]);
   if(clearBtn)window.showConfirmModal?.('Xóa toàn bộ đóng góp của học sinh này trên trang hiện tại?',()=>sendOps([{kind:'clear_user_objects',targetUserId:clearBtn.dataset.boardUserClear,pageId:currentPageId}]));
 });
 $('board-undo')?.addEventListener('click',undo);$('board-redo')?.addEventListener('click',redo);syncHistoryButtons();
}
