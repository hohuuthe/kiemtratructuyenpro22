const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let actor=null,manage=false,list=[],page=1,total=0,generation=0,wired=false,pendingBoard=null;
let ws=null,room=null,objects=new Map(),remoteStrokes=new Map(),tool='pen',drawing=null,lastSegmentIndex=0,locked=false;
let activeBoard=null,activeAccessCode='',manualExit=false,reconnectTimer=null,reconnectAttempts=0;
let roomTokenExpiresAt=0,tokenRefreshAttempts=0,currentPageId='';
let undoStack=[],redoStack=[],renderQueued=false,lastRateNotice=0,userLocked=false;
let pendingReliable=new Map(),dragState=null,snapshotLoading=false,participantsCache=[];
let remoteLasers=new Map(),lastLaserSent=0;
let zoomLevel=1,panDrag=null,timerState=null,timerTick=null,aiResultText='',aiClusterPlan=null,followTeacher=true;

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
  $('board-lock')?.classList.toggle('hidden',!room.board.can_manage);$('board-clear')?.classList.toggle('hidden',!room.board.can_manage);$('board-laser-tool')?.classList.toggle('hidden',!room.board.can_manage);
  for(const id of ['board-ai','board-template','board-timer','board-export-pdf','board-bring-here'])$(id)?.classList.toggle('hidden',!room.board.can_manage);
  $('board-follow-teacher')?.classList.toggle('hidden',!!room.board.can_manage);
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
 if(m.type==='snapshot_begin'){objects.clear();remoteStrokes.clear();snapshotLoading=true;locked=!!m.locked;userLocked=!!m.userLocked;timerState=m.timer||null;renderParticipants(m.participants||[]);syncLockUi();syncTimerUi();applyPageBackground();$('board-room-status').textContent='Đang đồng bộ bảng...';return;}
 if(m.type==='snapshot_chunk'){for(const o of m.objects||[])objects.set(o.id,o);scheduleRender();return;}
 if(m.type==='snapshot_end'){snapshotLoading=false;scheduleRender();renderParticipants(participantsCache);$('board-room-status').textContent='Đã kết nối realtime';return;}
 if(m.type==='put'&&m.object){objects.set(m.object.id,m.object);remoteStrokes.delete(m.object.id);scheduleRender();renderParticipants(participantsCache);return;}
 if(m.type==='delete'){objects.delete(m.objectId);remoteStrokes.delete(m.objectId);scheduleRender();renderParticipants(participantsCache);return;}
 if(m.type==='clear_page'){for(const [id,o] of objects)if(o.pageId===m.pageId)objects.delete(id);remoteStrokes.clear();drawing=null;dragState=null;scheduleRender();renderParticipants(participantsCache);return;}
 if(m.type==='stroke_segment'){let s=remoteStrokes.get(m.objectId);if(!s){s={id:m.objectId,pageId:m.pageId,type:'stroke',points:[],color:m.color,width:m.width};remoteStrokes.set(m.objectId,s);}s.points.push(...(m.points||[]));scheduleRender();return;}
 if(m.type==='page_updated'&&m.page){room.pages=(room.pages||[]).map(p=>String(p.id)===String(m.page.id)?{...p,...m.page}:p);renderPageControls();return;}
 if(m.type==='page_created'&&m.page){if(!room.pages.some(p=>String(p.id)===String(m.page.id))){room.pages=[...room.pages,m.page].sort((a,b)=>(a.page_no||0)-(b.page_no||0));renderPageControls();}return;}
 if(m.type==='page_deleted'){room.pages=(room.pages||[]).filter(p=>String(p.id)!==String(m.pageId));renderPageControls();if(String(m.pageId)===String(currentPageId)){const next=room.pages[0];if(next)switchPage(next.id);else exitRoom();}return;}
 if(m.type==='op_ack'&&m.clientOpId){pendingReliable.delete(String(m.clientOpId));return;}
 if(m.type==='clear_user_objects'){for(const id of m.objectIds||[])objects.delete(id);scheduleRender();renderParticipants(participantsCache);return;}
 if(m.type==='laser'){remoteLasers.set(String(m.userId),{x:m.x,y:m.y,name:m.displayName||'Giáo viên',expires:Date.now()+900});scheduleRender();setTimeout(()=>{const v=remoteLasers.get(String(m.userId));if(v&&v.expires<=Date.now()){remoteLasers.delete(String(m.userId));scheduleRender();}},950);return;}
 if(m.type==='stroke_cancel'){remoteStrokes.delete(m.objectId);scheduleRender();return;}
 if(m.type==='user_lock_state'){userLocked=!!m.blocked;if(userLocked){drawing=null;dragState=null;scheduleRender();}syncLockUi();window.showToast?.(userLocked?'Giáo viên đã tạm khóa quyền tương tác của bạn.':'Giáo viên đã mở lại quyền tương tác cho bạn.','info');return;}
 if(m.type==='page_focus'){if(followTeacher&&!room?.board?.can_manage&&m.pageId&&String(m.pageId)!==String(currentPageId))switchPage(String(m.pageId));return;}
 if(m.type==='vote_state'){const o=objects.get(String(m.objectId));if(o){o.voteCount=Math.max(0,Number(m.voteCount)||0);objects.set(o.id,o);scheduleRender();}return;}
 if(m.type==='timer_state'){timerState=m.timer||null;syncTimerUi();return;}
 if(m.type==='rate_limited'){const now=Date.now();if(now-lastRateNotice>5000){lastRateNotice=now;window.showToast?.('Thao tác quá nhanh, hệ thống đang giảm nhịp để bảo vệ lớp học.','info');}const opId=String(m.clientOpId||''),payload=pendingReliable.get(opId);if(opId&&payload){setTimeout(()=>{if(pendingReliable.has(opId)&&ws?.readyState===WebSocket.OPEN)try{ws.send(payload)}catch{}},Math.max(250,Math.min(10000,Number(m.retryAfterMs)||1000)));}return;}
 if(m.type==='presence'){renderParticipants(m.participants||[]);return;}
 if(m.type==='lock_state'){locked=!!m.locked;if(locked&&!room?.board?.can_manage){drawing=null;dragState=null;scheduleRender();}syncLockUi();return;}
 if(m.type==='policy_changed'){locked=!!m.locked;roomTokenExpiresAt=0;syncLockUi();$('board-room-status').textContent='Cấu hình bảng vừa thay đổi — đang xác thực lại...';return;}
 if(m.type==='board_unavailable'){manualExit=true;window.showToast?.('Bảng đã đóng hoặc tạm ngừng truy cập.','info');exitRoom();return;}
 if(m.type==='board_deleted'){manualExit=true;window.showToast?.('Bảng này đã được giáo viên xóa.','info');exitRoom();return;}
}
function sendOps(ops){
 if(!ops.length)return;
 const transient=ops.every(op=>op.kind==='stroke_segment'||op.kind==='laser');
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
function safeFileName(value){return String(value||'bang-tuong-tac').normalize('NFC').replace(/[^\p{L}\p{N}._-]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,100)||'bang-tuong-tac';}
function setZoom(value){
 zoomLevel=Math.max(.5,Math.min(2,Math.round(Number(value)*10)/10));
 const wrap=$('board-canvas-wrap');if(wrap){wrap.style.width=(zoomLevel*100)+'%';wrap.style.maxWidth=zoomLevel===1?'100%':'none';}
 if($('board-zoom-label'))$('board-zoom-label').textContent=Math.round(zoomLevel*100)+'%';
}
function resetView(){setZoom(1);const stage=$('board-stage-scroll');if(stage){stage.scrollLeft=0;stage.scrollTop=0;}}
function syncTimerUi(){
 const el=$('board-timer-display');if(!el)return;
 if(timerTick){clearInterval(timerTick);timerTick=null;}
 const paint=()=>{
   if(!timerState?.endAt){el.classList.add('hidden');return;}
   const remain=Math.max(0,Math.ceil((Number(timerState.endAt)-Date.now())/1000));
   const mm=String(Math.floor(remain/60)).padStart(2,'0'),ss=String(remain%60).padStart(2,'0');
   el.textContent=(timerState.label?timerState.label+' · ':'')+mm+':'+ss;el.classList.remove('hidden');
   if(remain<=0){if(timerTick){clearInterval(timerTick);timerTick=null;}el.classList.add('bg-rose-700');}
   else el.classList.remove('bg-rose-700');
 };
 paint();if(timerState?.endAt&&Number(timerState.endAt)>Date.now())timerTick=setInterval(paint,1000);
}
function renderBackgroundToCanvas(ctx,pageInfo){
 ctx.fillStyle='#fff';ctx.fillRect(0,0,1600,900);
 if(pageInfo?.background_type==='grid'){ctx.strokeStyle='#e5e7eb';ctx.lineWidth=1;for(let x=0;x<=1600;x+=32){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,900);ctx.stroke();}for(let y=0;y<=900;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1600,y);ctx.stroke();}}
 if(pageInfo?.background_type==='lined'){ctx.strokeStyle='#dbeafe';ctx.lineWidth=1;for(let y=32;y<=900;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1600,y);ctx.stroke();}}
 if(pageInfo?.background_type==='dots'){ctx.fillStyle='#cbd5e1';for(let y=12;y<900;y+=24)for(let x=12;x<1600;x+=24){ctx.beginPath();ctx.arc(x,y,1.5,0,Math.PI*2);ctx.fill();}}
}
function renderObjectsToCanvas(pageInfo,pageObjects){
 const out=document.createElement('canvas');out.width=1600;out.height=900;const ctx=out.getContext('2d');renderBackgroundToCanvas(ctx,pageInfo);
 for(const o of pageObjects||[])drawObject(ctx,o);return out;
}
async function ensureFreshRoomToken(pageId=currentPageId){
 if(room&&Date.now()<roomTokenExpiresAt)return;
 if(!activeBoard)throw Error('Phiên bảng không còn hoạt động.');
 const current=room,currentPage=currentPageId;
 const result=await api('POST','/api/board/join',{boardId:activeBoard.id,accessCode:activeAccessCode,pageId:currentPage||pageId});
 const fresh=result.data;if(!fresh?.realtime_base_path)throw Error('Không thể làm mới phiên bảng.');
 room={...current,...fresh,current_page_id:currentPage,pages:current?.pages||fresh.pages};
 currentPageId=currentPage;
 roomTokenExpiresAt=Date.now()+Math.max(30,Number(fresh.token_expires_in)||300)*1000-10000;
}
async function fetchPageSnapshot(pageId){
 await ensureFreshRoomToken(pageId);
 if(!room?.realtime_base_path)throw Error('Phiên realtime chưa sẵn sàng.');
 const url=new URL(room.realtime_base_path,location.href);url.searchParams.set('snapshot','1');url.searchParams.set('pageId',String(pageId));
 const response=await fetch(url.href,{cache:'no-store'});if(!response.ok)throw Error(response.status===410?'Trang đã bị xóa.':'Không thể đọc dữ liệu trang.');
 return response.json();
}
async function exportBoardPdf(){
 if(!room?.board?.can_manage)return;
 const btn=$('board-export-pdf');if(btn)btn.disabled=true;
 try{
   const {jsPDF}=await import('jspdf');const pdf=new jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true});
   const pages=(room.pages||[]).slice(0,20);if(!pages.length)throw Error('Bảng chưa có trang.');
   for(let i=0;i<pages.length;i++){
     if(i>0)pdf.addPage('a4','landscape');
     if(btn)btn.textContent='📄 '+(i+1)+'/'+pages.length;
     const snap=await fetchPageSnapshot(pages[i].id),canvas=renderObjectsToCanvas(pages[i],snap.objects||[]);
     const data=canvas.toDataURL('image/jpeg',.82);pdf.addImage(data,'JPEG',5,5,287,161.44,undefined,'FAST');
     pdf.setFontSize(9);pdf.setTextColor(80);pdf.text(String(i+1)+' / '+String(pages.length),6,204);
   }
   pdf.save(safeFileName(room.board.name)+'.pdf');
 }catch(e){window.showToast?.(e.message||'Không thể xuất PDF.','error');}
 finally{if(btn){btn.disabled=false;btn.textContent='📄 PDF';}}
}
function boardTextItems(){return [...objects.values()].filter(o=>o.pageId===currentPageId&&(o.type==='note'||o.type==='text')&&String(o.text||'').trim()).slice(0,80);}
function boardTextPayload(){return boardTextItems().map((o,i)=>(i+1)+'. '+String(o.text).trim()).join('\n').slice(0,12000);}
function aiStorageKey(){const username=String(actor?.username||'').trim();return username?'gemini_api_key_'+username:'';}
function readAiKeys(){const typed=String($('board-ai-key')?.value||'').trim();if(typed)return typed;const k=aiStorageKey();try{return k?String(localStorage.getItem(k)||''):''}catch{return '';}}
async function runBoardAi(){
 if(!room?.board?.can_manage)return;
 const source=boardTextPayload();if(!source){window.showToast?.('Trang hiện tại chưa có ghi chú/chữ để AI phân tích.','info');return;}
 const key=readAiKeys();if(!key){window.showToast?.('Hãy nhập Gemini API Key cá nhân.','info');return;}
 const typed=String($('board-ai-key')?.value||'').trim(),storageKey=aiStorageKey();if(typed&&storageKey)try{localStorage.setItem(storageKey,typed)}catch{}
 const mode=$('board-ai-mode')?.value||'summary',extra=String($('board-ai-extra')?.value||'').trim().slice(0,500);
 aiClusterPlan=null;
 const instruction={
   summary:'Tóm tắt súc tích các ý kiến, giữ đủ ý chính và không bịa thêm.',
   themes:'Phân nhóm các sticky theo chủ đề.',
   actions:'Rút ra danh sách việc cần làm, ưu tiên và bước tiếp theo từ các ý kiến.',
   lesson:'Viết phần kết luận bài học ngắn gọn, dễ hiểu cho học sinh THPT dựa đúng vào các ý trên bảng.'
 }[mode];
 const isThemes=mode==='themes';
 const prompt=isThemes
   ? 'Bạn là trợ lý lớp học. Hãy phân nhóm các ý kiến bên dưới thành tối đa 4 chủ đề. Trả duy nhất JSON dạng {"groups":[{"title":"Tên nhóm","noteNumbers":[1,2]}]}. Mỗi số chỉ xuất hiện tối đa một lần, chỉ dùng số có trong dữ liệu. '+(extra?'Yêu cầu bổ sung: '+extra+' ':'')+'Dữ liệu:\n'+source
   : 'Bạn là trợ lý lớp học. '+instruction+'\n'+(extra?'Yêu cầu bổ sung: '+extra+'\n':'')+'Chỉ sử dụng dữ liệu sau, không suy diễn ngoài dữ liệu:\n'+source;
 const btn=$('board-ai-run');if(btn){btn.disabled=true;btn.textContent='Đang phân tích...';}
 try{
   const res=await api('POST','/api/ai/generate',{apiKey:key,model:'gemini-3.8-flash',contents:[{role:'user',parts:[{text:prompt}]}],config:isThemes?{responseMimeType:'application/json'}:{}});
   const raw=String(res.text||'').trim();
   if(isThemes){
     let parsed;try{parsed=JSON.parse(raw.replace(/^\`\`\`(?:json)?/i,'').replace(/\`\`\`$/,'').trim())}catch{throw Error('AI trả kết quả phân nhóm không đúng định dạng.');}
     const max=boardTextItems().length,seen=new Set(),groups=[];
     for(const g of Array.isArray(parsed?.groups)?parsed.groups.slice(0,4):[]){
       const nums=[];for(const n of Array.isArray(g?.noteNumbers)?g.noteNumbers:[]){const v=Math.trunc(Number(n));if(v>=1&&v<=max&&!seen.has(v)){seen.add(v);nums.push(v);}}
       if(nums.length)groups.push({title:String(g?.title||'Nhóm').slice(0,80),noteNumbers:nums.slice(0,12)});
     }
     if(!groups.length)throw Error('AI chưa tạo được nhóm hợp lệ.');
     aiClusterPlan={groups};aiResultText=groups.map((g,i)=>(i+1)+'. '+g.title+': '+g.noteNumbers.join(', ')).join('\n');
     $('board-ai-result').textContent=aiResultText;$('board-ai-insert').textContent='Sắp xếp lên bảng';$('board-ai-insert').classList.remove('hidden');
   }else{
     aiResultText=raw.slice(0,6000);$('board-ai-result').textContent=aiResultText||'AI không trả nội dung.';$('board-ai-insert').textContent='Chèn lên bảng';$('board-ai-insert')?.classList.toggle('hidden',!aiResultText);
   }
 }catch(e){$('board-ai-result').textContent=e.message||'Không thể gọi AI.';aiClusterPlan=null;}
 finally{if(btn){btn.disabled=false;btn.textContent='Phân tích bằng AI';}}
}
function applyAiCluster(){
 if(!aiClusterPlan||!room?.board?.can_manage)return;
 const notes=boardTextItems(),groups=aiClusterPlan.groups||[],ops=[],changed=[];
 const colWidth=1500/Math.max(1,groups.length);
 groups.forEach((g,gi)=>{
   const title={id:crypto.randomUUID(),pageId:currentPageId,type:'note',x:50+gi*colWidth,y:40,w:Math.min(330,colWidth-30),h:90,text:g.title,color:'#111827',fontSize:22,creatorId:myId()};
   objects.set(title.id,title);ops.push({kind:'put',object:title});changed.push({kind:'put',object:title});
   g.noteNumbers.slice(0,7).forEach((n,ri)=>{const original=notes[n-1];if(!original)return;const before=cloneObject(original),after={...cloneObject(original),x:50+gi*colWidth,y:160+ri*100,w:Math.min(330,colWidth-30),h:86};objects.set(after.id,after);ops.push({kind:'put',object:after});changed.push({kind:'update',before,after:cloneObject(after)});});
 });
 if(ops.length)sendOps(ops);for(const a of changed)remember(a);scheduleRender();$('board-ai-modal')?.classList.add('hidden');window.showToast?.('AI đã sắp xếp sticky theo chủ đề.','success');
}
function insertAiResult(){
 if(!aiResultText||!room?.board?.can_manage)return;
 const text=aiResultText.slice(0,1800),o={id:crypto.randomUUID(),pageId:currentPageId,type:'note',x:80,y:80,w:620,h:300,text,color:'#111827',fontSize:20,creatorId:myId()};
 objects.set(o.id,o);sendOps([{kind:'put',object:o}]);remember({kind:'put',object:o});scheduleRender();window.showToast?.('Đã chèn kết quả AI lên bảng.','success');
}
function templateObjects(kind){
 const id=()=>crypto.randomUUID(),base=(type,props)=>({id:id(),pageId:currentPageId,type,creatorId:myId(),color:'#334155',width:3,...props});
 const note=(x,y,w,h,text)=>base('note',{x,y,w,h,text,fontSize:22});
 if(kind==='kwl')return [note(60,60,470,120,'K — ĐÃ BIẾT'),note(565,60,470,120,'W — MUỐN BIẾT'),note(1070,60,470,120,'L — ĐÃ HỌC'),base('line',{x1:545,y1:40,x2:545,y2:860}),base('line',{x1:1050,y1:40,x2:1050,y2:860})];
 if(kind==='swot')return [note(80,70,650,110,'ĐIỂM MẠNH'),note(870,70,650,110,'ĐIỂM YẾU'),note(80,490,650,110,'CƠ HỘI'),note(870,490,650,110,'THÁCH THỨC'),base('line',{x1:800,y1:40,x2:800,y2:860}),base('line',{x1:40,y1:450,x2:1560,y2:450})];
 if(kind==='exit')return [note(100,80,1400,110,'3 điều em học được'),note(100,350,1400,110,'2 câu hỏi em còn băn khoăn'),note(100,620,1400,110,'1 cách em có thể áp dụng')];
 return [note(490,70,620,120,'Ý TƯỞNG TRUNG TÂM'),note(80,300,400,120,'Ý tưởng 1'),note(600,300,400,120,'Ý tưởng 2'),note(1120,300,400,120,'Ý tưởng 3'),note(340,610,400,120,'Ý tưởng 4'),note(860,610,400,120,'Ý tưởng 5')];
}
function applyTemplate(kind){
 if(!room?.board?.can_manage)return;const items=templateObjects(kind);
 for(const o of items)objects.set(o.id,o);sendOps(items.map(object=>({kind:'put',object})));for(const o of items)remember({kind:'put',object:o});scheduleRender();$('board-template-modal')?.classList.add('hidden');
}
function renderPageControls(){
 const select=$('board-page-select');if(!select||!room)return;
 const pages=room.pages||[];
 select.innerHTML=pages.map(p=>'<option value="'+esc(p.id)+'">'+esc((p.page_no||'')+'. '+(p.title||'Trang'))+'</option>').join('');
 select.value=currentPageId||pages[0]?.id||'';applyPageBackground();
 const idx=pages.findIndex(p=>String(p.id)===String(select.value));
 if($('board-page-prev'))$('board-page-prev').disabled=idx<=0;
 if($('board-page-next'))$('board-page-next').disabled=idx<0||idx>=pages.length-1;
 $('board-add-page')?.classList.toggle('hidden',!room.board.can_manage);
 $('board-edit-page')?.classList.toggle('hidden',!room.board.can_manage);
 $('board-delete-page')?.classList.toggle('hidden',!room.board.can_manage||pages.length<=1);
}
function openPageEditor(){
 if(!room?.board?.can_manage)return;
 const page=(room.pages||[]).find(p=>String(p.id)===String(currentPageId)),f=$('board-page-form');if(!page||!f)return;
 f.elements.namedItem('id').value=page.id;f.elements.namedItem('revision').value=page.revision||1;
 f.elements.namedItem('title').value=page.title||'';f.elements.namedItem('background_type').value=page.background_type||'white';
 $('board-page-modal')?.classList.remove('hidden');f.elements.namedItem('title').focus();
}
function closePageEditor(){$('board-page-modal')?.classList.add('hidden');}
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
function hitVotable(point){
 const [x,y]=point,items=[...objects.values()].reverse();
 for(const o of items){if(o.pageId!==currentPageId||!['note','text'].includes(o.type))continue;if(x>=o.x&&x<=o.x+(o.w||220)&&y>=o.y&&y<=o.y+(o.h||120))return o;}
 return null;
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
 participantsCache=Array.isArray(items)?items:participantsCache;
 const currentItems=participantsCache;
 const counts=new Map();
 for(const o of objects.values())if(o.pageId===currentPageId&&o.creatorId)counts.set(String(o.creatorId),(counts.get(String(o.creatorId))||0)+1);
 $('board-online-count').textContent=currentItems.length+' người';
 $('board-participants').innerHTML=currentItems.map(p=>{
   const roleLabel=p.role==='teacher'?'Giáo viên':p.role==='admin'?'Admin':'Học sinh';
   const canModerate=room?.board?.can_manage&&p.role==='student'&&String(p.userId)!==myId();
   const contributionCount=counts.get(String(p.userId))||0;
   return '<div class="rounded-lg bg-white border px-3 py-2 space-y-1"><div class="flex items-center justify-between gap-2"><div class="min-w-0"><p class="font-bold truncate">'+esc(p.displayName)+'</p><p class="text-[11px] text-slate-500">'+esc(roleLabel)+(p.blocked?' • đang khóa':'')+(p.role==='student'?' • '+contributionCount+' đóng góp':'')+'</p></div>'+(canModerate?'<div class="flex gap-1"><button data-board-user-clear="'+esc(p.userId)+'" class="shrink-0 rounded-md bg-rose-50 text-rose-700 px-2 py-1 text-[11px] font-bold">Xóa nét</button><button data-board-user-lock="'+esc(p.userId)+'" data-blocked="'+(p.blocked?'1':'0')+'" class="shrink-0 rounded-md px-2 py-1 text-[11px] font-bold '+(p.blocked?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-800')+'">'+(p.blocked?'Mở':'Khóa')+'</button></div>':'')+'</div></div>';
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
 const now=Date.now();
 for(const [id,l] of remoteLasers){if(l.expires<=now){remoteLasers.delete(id);continue;}ctx.save();ctx.fillStyle='#ef4444';ctx.beginPath();ctx.arc(l.x,l.y,7,0,Math.PI*2);ctx.fill();ctx.font='16px sans-serif';ctx.fillText(l.name,l.x+12,l.y-10);ctx.restore();}
}
function drawObject(ctx,o){
 if(!o)return;ctx.save();ctx.strokeStyle=o.color||'#111827';ctx.fillStyle=o.color||'#111827';ctx.lineWidth=o.width||3;ctx.lineCap='round';ctx.lineJoin='round';
 if(o.type==='stroke'&&o.points?.length){ctx.beginPath();o.points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.stroke();}
 else if(o.type==='note'||o.type==='text'){ctx.fillStyle='#fff7c2';ctx.strokeStyle='#eab308';ctx.lineWidth=1.5;ctx.fillRect(o.x,o.y,o.w||220,o.h||120);ctx.strokeRect(o.x,o.y,o.w||220,o.h||120);ctx.fillStyle=o.color||'#111827';ctx.font=(o.fontSize||20)+'px sans-serif';wrapText(ctx,o.text||'',o.x+12,o.y+28,(o.w||220)-24,26);const votes=Math.max(0,Number(o.voteCount)||0);if(votes){ctx.font='bold 18px sans-serif';ctx.fillStyle='#475569';ctx.fillText('👍 '+votes,o.x+(o.w||220)-62,o.y+(o.h||120)-14);}}
 else if(o.type==='line'||o.type==='arrow'){ctx.beginPath();ctx.moveTo(o.x1,o.y1);ctx.lineTo(o.x2,o.y2);ctx.stroke();if(o.type==='arrow'){const a=Math.atan2(o.y2-o.y1,o.x2-o.x1),len=16+Math.min(16,(o.width||3)*2);ctx.beginPath();ctx.moveTo(o.x2,o.y2);ctx.lineTo(o.x2-len*Math.cos(a-Math.PI/6),o.y2-len*Math.sin(a-Math.PI/6));ctx.moveTo(o.x2,o.y2);ctx.lineTo(o.x2-len*Math.cos(a+Math.PI/6),o.y2-len*Math.sin(a+Math.PI/6));ctx.stroke();}}
 else if(o.type==='rect'){ctx.strokeRect(Math.min(o.x1,o.x2),Math.min(o.y1,o.y2),Math.abs(o.x2-o.x1),Math.abs(o.y2-o.y1));}
 else if(o.type==='ellipse'){const cx=(o.x1+o.x2)/2,cy=(o.y1+o.y2)/2,rx=Math.abs(o.x2-o.x1)/2,ry=Math.abs(o.y2-o.y1)/2;ctx.beginPath();ctx.ellipse(cx,cy,Math.max(1,rx),Math.max(1,ry),0,0,Math.PI*2);ctx.stroke();}
 ctx.restore();
}
function wrapText(ctx,text,x,y,maxWidth,lineHeight){const words=String(text).split(/\s+/);let line='';for(const word of words){const test=line?line+' '+word:word;if(ctx.measureText(test).width>maxWidth&&line){ctx.fillText(line,x,y);line=word;y+=lineHeight;}else line=test;}if(line)ctx.fillText(line,x,y);}
function noteText(){return ($('board-note-text')?.value||$('board-note-text-mobile')?.value||'').trim().slice(0,500);}
function canEdit(){if(snapshotLoading)return false;return room?.board?.can_manage||(!locked&&!userLocked&&room?.board?.student_permission!=='view');}
function pointerDown(e){
 if(!room)return;const p=logicalPoint(e);canvas().setPointerCapture?.(e.pointerId);
 if(tool==='pan'){const stage=$('board-stage-scroll');panDrag={clientX:e.clientX,clientY:e.clientY,left:stage?.scrollLeft||0,top:stage?.scrollTop||0};return;}
 if(tool==='vote'){if(locked||userLocked)return;const target=hitVotable(p);if(target)sendOps([{kind:'vote_toggle',pageId:currentPageId,objectId:target.id}]);return;}
 if(!canEdit())return;
 if(tool==='laser'){return;}
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
 if(tool==='pan'&&panDrag){const stage=$('board-stage-scroll');if(stage){stage.scrollLeft=panDrag.left-(e.clientX-panDrag.clientX);stage.scrollTop=panDrag.top-(e.clientY-panDrag.clientY);}return;}
 if(tool==='laser'&&room?.board?.can_manage){
   const now=Date.now();if(now-lastLaserSent>=60){lastLaserSent=now;sendOps([{kind:'laser',pageId:currentPageId,x:p[0],y:p[1]}]);}
   return;
 }
 if(dragState){
   const dx=p[0]-dragState.start[0],dy=p[1]-dragState.start[1],moved=translateObject(dragState.before,dx,dy);
   objects.set(moved.id,moved);scheduleRender();return;
 }
 if(!drawing)return;
 if(drawing.type!=='stroke'){drawing.x2=p[0];drawing.y2=p[1];scheduleRender();return;}
 const last=drawing.points[drawing.points.length-1];if(Math.hypot(p[0]-last[0],p[1]-last[1])<2)return;drawing.points.push(p);if(drawing.points.length-lastSegmentIndex>=8){const pts=drawing.points.slice(lastSegmentIndex);lastSegmentIndex=drawing.points.length-1;sendOps([{kind:'stroke_segment',pageId:drawing.pageId,objectId:drawing.id,points:pts,color:drawing.color,width:drawing.width}]);}scheduleRender();
}
function pointerUp(){
 if(panDrag){panDrag=null;return;}
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
 roomTokenExpiresAt=0;tokenRefreshAttempts=0;currentPageId='';userLocked=false;snapshotLoading=false;participantsCache=[];pendingReliable.clear();dragState=null;panDrag=null;remoteLasers.clear();zoomLevel=1;aiResultText='';aiClusterPlan=null;timerState=null;followTeacher=true;if(timerTick){clearInterval(timerTick);timerTick=null;}undoStack=[];redoStack=[];objects.clear();remoteStrokes.clear();drawing=null;$('board-room')?.classList.add('hidden');$('boards-home')?.classList.remove('hidden');
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
   for(const o of objects.values())if(o.pageId===currentPageId)drawObject(ctx,o);
   out.toBlob(blob=>{if(!blob)return;const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(room?.board?.name||'bang-tuong-tac').replace(/[^\p{L}\p{N}._-]+/gu,'-')+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);},'image/png');
 });
 $('board-bring-here')?.addEventListener('click',()=>{if(room?.board?.can_manage)sendOps([{kind:'present_page',pageId:currentPageId}]);});
 $('board-follow-teacher')?.addEventListener('click',()=>{followTeacher=!followTeacher;const btn=$('board-follow-teacher');if(btn)btn.textContent='Theo GV: '+(followTeacher?'Bật':'Tắt');});
 $('board-export-pdf')?.addEventListener('click',exportBoardPdf);
 $('board-ai')?.addEventListener('click',()=>{if(!room?.board?.can_manage)return;aiResultText='';aiClusterPlan=null;$('board-ai-result').textContent='Chưa có kết quả.';$('board-ai-insert')?.classList.add('hidden');$('board-ai-modal')?.classList.remove('hidden');});
 $('board-ai-close')?.addEventListener('click',()=>$('board-ai-modal')?.classList.add('hidden'));
 $('board-ai-run')?.addEventListener('click',runBoardAi);
 $('board-ai-insert')?.addEventListener('click',()=>aiClusterPlan?applyAiCluster():insertAiResult());
 $('board-template')?.addEventListener('click',()=>{if(room?.board?.can_manage)$('board-template-modal')?.classList.remove('hidden');});
 $('board-template-close')?.addEventListener('click',()=>$('board-template-modal')?.classList.add('hidden'));
 $('board-template-modal')?.addEventListener('click',e=>{const btn=e.target.closest('[data-board-template]');if(btn)applyTemplate(btn.dataset.boardTemplate);});
 $('board-timer')?.addEventListener('click',()=>{if(room?.board?.can_manage)$('board-timer-modal')?.classList.remove('hidden');});
 $('board-timer-cancel')?.addEventListener('click',()=>$('board-timer-modal')?.classList.add('hidden'));
 $('board-timer-stop')?.addEventListener('click',()=>{if(room?.board?.can_manage){sendOps([{kind:'timer_stop'}]);$('board-timer-modal')?.classList.add('hidden');}});
 $('board-timer-form')?.addEventListener('submit',e=>{e.preventDefault();if(!room?.board?.can_manage)return;const fd=new FormData(e.currentTarget),minutes=Math.max(1,Math.min(99,Number(fd.get('minutes'))||5)),label=String(fd.get('label')||'').trim().slice(0,80);sendOps([{kind:'timer_start',durationSec:minutes*60,label}]);$('board-timer-modal')?.classList.add('hidden');});
 $('board-zoom-in')?.addEventListener('click',()=>setZoom(zoomLevel+.1));
 $('board-zoom-out')?.addEventListener('click',()=>setZoom(zoomLevel-.1));
 $('board-zoom-label')?.addEventListener('click',resetView);
 $('board-fullscreen')?.addEventListener('click',async()=>{const roomEl=$('board-room');try{if(!document.fullscreenElement)await roomEl?.requestFullscreen?.();else await document.exitFullscreen?.();}catch{window.showToast?.('Trình duyệt không cho phép toàn màn hình.','info');}});
 $('board-stage-scroll')?.addEventListener('wheel',e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();setZoom(zoomLevel+(e.deltaY<0?.1:-.1));},{passive:false});
 $('board-lock')?.addEventListener('click',()=>{if(room?.board?.can_manage)sendOps([{kind:locked?'unlock':'lock'}]);});
 $('board-clear')?.addEventListener('click',()=>{if(!room?.board?.can_manage)return;window.showConfirmModal?.('Xóa toàn bộ nội dung đang có trên trang bảng này?',()=>{sendOps([{kind:'clear_page',pageId:currentPageId}]);undoStack=[];redoStack=[];syncHistoryButtons();});});
 $('board-edit-page')?.addEventListener('click',openPageEditor);
 $('board-page-cancel')?.addEventListener('click',closePageEditor);
 $('board-page-form')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,fd=new FormData(f);const body={id:fd.get('id'),revision:Number(fd.get('revision'))||1,title:fd.get('title'),background_type:fd.get('background_type')};const btn=f.querySelector('[type=submit]');btn.disabled=true;try{const result=await api('PUT','/api/board/pages',body);room.pages=(room.pages||[]).map(p=>String(p.id)===String(result.data.id)?{...p,...result.data}:p);closePageEditor();renderPageControls();}catch(err){window.showToast?.(err.message||'Không thể cập nhật trang.','error');}finally{btn.disabled=false;}});
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
 const boardShortcutHandler=e=>{
   if(!$('board-room')||$('board-room').classList.contains('hidden'))return;
   const tag=String(e.target?.tagName||'').toLowerCase();if(['input','textarea','select'].includes(tag))return;
   const mod=e.ctrlKey||e.metaKey;
   if(mod&&String(e.key).toLowerCase()==='z'){e.preventDefault();undo();return;}
   if(mod&&String(e.key).toLowerCase()==='y'){e.preventDefault();redo();return;}
   if(e.key==='+'||e.key==='='){e.preventDefault();setZoom(zoomLevel+.1);return;}
   if(e.key==='-'){e.preventDefault();setZoom(zoomLevel-.1);return;}
   if(e.key==='0'){e.preventDefault();resetView();return;}
 };
 window.addEventListener('keydown',boardShortcutHandler);
  $('board-undo')?.addEventListener('click',undo);$('board-redo')?.addEventListener('click',redo);syncHistoryButtons();
}
