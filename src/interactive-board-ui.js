const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let actor=null,manage=false,canCreateBoard=false,list=[],page=1,total=0,generation=0,wired=false,pendingBoard=null;
let ws=null,room=null,objects=new Map(),remoteStrokes=new Map(),tool='pen',drawing=null,lastSegmentIndex=0,locked=false;
let activeBoard=null,activeAccessCode='',manualExit=false,reconnectTimer=null,reconnectAttempts=0,heartbeatTimer=null,lastPongAt=0;
let roomTokenExpiresAt=0,tokenRefreshAttempts=0,currentPageId='';
let undoStack=[],redoStack=[],renderQueued=false,lastRateNotice=0,userLocked=false;
let pendingReliable=new Map(),dragState=null,snapshotLoading=false,participantsCache=[],blockedUsers=[];
let remoteLasers=new Map(),lastLaserSent=0,imageCache=new Map(),pendingBoardImageMode='object';
let zoomLevel=1,panDrag=null,panPointers=new Map(),pinchStart=null,timerState=null,timerTick=null,aiResultText='',aiClusterPlan=null,followTeacher=true,mobileGesture=false,selectedObjectId='',resizeState=null;

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
function vipFlag(value){if(value===true||value===1)return true;const v=String(value??'').trim().toLowerCase();return v==='1'||v==='true'||v==='yes';}

const BOARD_BUTTON_HELP={
 'boards-new':'Tạo một Bảng tương tác thông minh mới.',
 'boards-reload':'Tải lại danh sách bảng theo dữ liệu mới nhất.',
 'boards-prev':'Xem trang danh sách bảng trước.',
 'boards-next':'Xem trang danh sách bảng tiếp theo.',
 'board-add-page':'Thêm một trang trắng mới vào bảng hiện tại.',
 'board-edit-page':'Đổi tên hoặc kiểu nền của trang hiện tại.',
 'board-delete-page':'Xóa trang hiện tại khỏi bảng.',
 'board-bring-here':'Yêu cầu học sinh đang theo giáo viên chuyển tới trang này.',
 'board-insert-image':'Tải ảnh lên và chèn ảnh như một đối tượng để học sinh xem, thảo luận và vẽ đè lên.',
 'board-background-image':'Tải ảnh lên và dùng làm hình nền cố định cho trang hiện tại.',
 'board-clear-background-image':'Gỡ hình nền ảnh của trang hiện tại.',
 'board-follow-teacher':'Bật/tắt tự động chuyển trang theo giáo viên.',
 'board-lock':'Khóa hoặc mở quyền tương tác của toàn bộ học sinh.',
 'board-ai':'Mở trợ lý AI để tóm tắt, gom nhóm hoặc rút ý từ nội dung bảng.',
 'board-template':'Chèn nhanh một mẫu hoạt động lớp học vào trang hiện tại.',
 'board-timer':'Tạo hoặc quản lý đồng hồ đếm ngược cho hoạt động.',
 'board-export-pdf':'Xuất toàn bộ các trang của bảng thành file PDF.',
 'board-export-image':'Xuất trang hiện tại thành ảnh PNG.',
 'board-fullscreen':'Bật hoặc thoát chế độ toàn màn hình.',
 'board-clear':'Xóa toàn bộ nội dung trên trang hiện tại.',
 'board-exit':'Rời Bảng tương tác và quay về danh sách.',
 'board-undo':'Hoàn tác thao tác gần nhất (Ctrl/Cmd + Z).',
 'board-redo':'Làm lại thao tác vừa hoàn tác (Ctrl/Cmd + Y).',
 'board-duplicate-selected':'Nhân bản đối tượng đang chọn và đặt lệch nhẹ để dễ kéo tiếp.',
 'board-image-layer-up':'Đưa ảnh đang chọn lên trên một ảnh khác.',
 'board-image-layer-down':'Đưa ảnh đang chọn xuống dưới một ảnh khác.',
 'board-lock-selected':'Khóa hoặc mở khóa đối tượng để tránh di chuyển, resize hoặc xóa nhầm.',
 'board-delete-selected':'Xóa đối tượng đang chọn nếu bạn có quyền chỉnh sửa.',
 'board-page-prev':'Chuyển sang trang trước của bảng.',
 'board-page-next':'Chuyển sang trang tiếp theo của bảng.',
 'board-zoom-out':'Thu nhỏ vùng bảng để xem rộng hơn.',
 'board-zoom-label':'Đưa mức thu phóng về 100% và về đầu trang.',
 'board-zoom-in':'Phóng to vùng bảng để thao tác chi tiết hơn.',
 'board-edit-close':'Đóng cửa sổ cấu hình bảng mà không lưu.',
 'board-edit-cancel':'Hủy thay đổi và đóng cửa sổ cấu hình bảng.',
 'board-page-cancel':'Hủy thay đổi cấu hình trang.',
 'board-ai-close':'Đóng cửa sổ Trợ lý AI.',
 'board-ai-insert':'Chèn kết quả AI vừa tạo lên trang hiện tại.',
 'board-ai-run':'Gửi nội dung chữ của trang hiện tại cho AI phân tích.',
 'board-template-close':'Đóng danh sách mẫu lớp học.',
 'board-timer-stop':'Dừng đồng hồ đang chạy.',
 'board-timer-cancel':'Đóng cửa sổ hẹn giờ mà không thay đổi.',
 'board-code-cancel':'Hủy nhập mã và quay lại danh sách bảng.'
};
const BOARD_TOOL_HELP={
 pan:'Kéo để di chuyển khung nhìn trên bảng.',
 select:'Chọn và kéo đối tượng do bạn có quyền chỉnh sửa.',
 laser:'Dùng con trỏ laser để chỉ vị trí cho cả lớp.',
 pen:'Vẽ tự do bằng màu và độ dày nét đang chọn.',
 note:'Đặt một ghi chú chữ tại vị trí bạn chạm.',
 vote:'Bấm vào ghi chú để bình chọn hoặc bỏ bình chọn.',
 eraser:'Chạm vào đối tượng để xóa nếu bạn có quyền.',
 line:'Kéo để vẽ một đoạn thẳng.',
 arrow:'Kéo để vẽ mũi tên chỉ hướng.',
 rect:'Kéo để vẽ hình chữ nhật.',
 ellipse:'Kéo để vẽ hình elip.'
};
const BOARD_TEMPLATE_HELP={
 brainstorm:'Chèn mẫu Động não để thu thập và gom ý tưởng.',
 kwl:'Chèn bảng KWL: Đã biết · Muốn biết · Đã học.',
 swot:'Chèn ma trận SWOT bốn nhóm nội dung.',
 exit:'Chèn mẫu Phiếu 3-2-1 để tổng kết hoạt động.'
};
const BOARD_TEXT_HELP={
 'Lưu bảng':'Lưu toàn bộ cấu hình của bảng tương tác.',
 'Lưu':'Lưu tên và kiểu nền của trang.',
 'Hủy':'Đóng cửa sổ hiện tại mà không lưu thay đổi.',
 'Vào bảng':'Kiểm tra quyền truy cập và kết nối realtime vào bảng.',
 'Phân tích bằng AI':'Phân tích nội dung chữ trên trang hiện tại bằng AI.',
 'Chèn lên bảng':'Đưa kết quả AI vào trang hiện tại.',
 'Bắt đầu':'Bắt đầu đồng hồ đếm ngược với thời gian đã chọn.',
 'Dừng':'Dừng đồng hồ đếm ngược hiện tại.'
};
function boardButtonText(btn){return String(btn?.textContent||'').replace(/\s+/g,' ').trim();}
function resolveBoardButtonHelp(btn){
 if(!btn)return '';
 if(btn.dataset.boardEnter!==undefined)return 'Mở bảng này và kết nối phiên làm việc realtime.';
 if(btn.dataset.boardEdit!==undefined)return 'Chỉnh sửa thông tin, quyền truy cập và thời gian của bảng.';
 if(btn.dataset.boardDelete!==undefined)return 'Xóa bảng này sau khi xác nhận.';
 if(btn.dataset.boardUserClear!==undefined)return 'Xóa toàn bộ đóng góp của học sinh này trên trang hiện tại.';
 if(btn.dataset.boardUserLock!==undefined)return btn.dataset.blocked==='1'?'Mở lại quyền tương tác cho học sinh này.':'Tạm khóa quyền tương tác của học sinh này.';
 if(btn.dataset.boardUserBlock!==undefined)return 'Chặn tài khoản học sinh khỏi bảng này cho tới khi giáo viên mở lại.';
 if(btn.dataset.boardUserUnblock!==undefined)return 'Cho phép học sinh này tham gia lại bảng.';
 if(btn.dataset.boardTool)return BOARD_TOOL_HELP[btn.dataset.boardTool]||'Chọn công cụ thao tác trên bảng.';
 if(btn.dataset.boardTemplate)return BOARD_TEMPLATE_HELP[btn.dataset.boardTemplate]||'Chèn mẫu hoạt động này lên bảng.';
 if(btn.id==='board-lock')return locked?'Mở lại quyền tương tác cho toàn bộ học sinh.':'Tạm khóa quyền tương tác của toàn bộ học sinh.';
 if(btn.id==='board-follow-teacher')return followTeacher?'Đang tự theo trang giáo viên; bấm để tắt.':'Đang tự do chuyển trang; bấm để theo giáo viên.';
 return BOARD_BUTTON_HELP[btn.id]||BOARD_TEXT_HELP[boardButtonText(btn)]||(boardButtonText(btn)?'Thực hiện thao tác: '+boardButtonText(btn)+'.':'Thực hiện chức năng của nút này.');
}
function refreshBoardButtonHelp(root=$('tab-boards')||document){
 root?.querySelectorAll?.('button').forEach(btn=>{
   const help=resolveBoardButtonHelp(btn);if(!help)return;
   // Chỉ dùng tooltip mặc định của trình duyệt (nền sáng/trắng), không tạo tooltip tùy biến màu đen.
   btn.title=help;btn.setAttribute('aria-description',help);
   const visible=boardButtonText(btn);
   if(!btn.getAttribute('aria-label')&&(!visible||!/[À-ɏ\p{L}\p{N}]/u.test(visible)))btn.setAttribute('aria-label',help);
 });
 const color=$('board-color');if(color)color.title='Chọn màu cho bút, đường và hình vẽ.';
 const width=$('board-width');if(width)width.title='Điều chỉnh độ dày của nét vẽ.';
 const pageSelect=$('board-page-select');if(pageSelect)pageSelect.title='Chọn nhanh trang muốn mở trong bảng.';
}
function installBoardButtonHelp(){
 const root=$('tab-boards');if(!root||root.dataset.boardHelpReady==='1')return;
 root.dataset.boardHelpReady='1';refreshBoardButtonHelp(root);
}
function renderList(){
 const root=$('boards-list');if(!root)return;
 if(!list.length){root.innerHTML='<div class="col-span-full rounded-xl bg-slate-50 p-8 text-center text-slate-500">Chưa có bảng tương tác phù hợp.</div>';return;}
 root.innerHTML=list.map(b=>'<article class="rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3 min-w-0">'+
  '<div class="flex justify-between gap-2"><div class="min-w-0"><h3 class="font-black text-slate-900 truncate">'+esc(b.name)+'</h3><p class="text-xs text-slate-500 truncate">'+esc(b.creator_name||'')+'</p></div><span class="shrink-0 text-xs rounded-full bg-slate-100 px-2 py-1">'+esc(statusLabel(b.status))+'</span></div>'+
  '<p class="text-sm text-slate-600 min-h-10 line-clamp-2">'+esc(b.description||'Không có mô tả')+'</p>'+
  '<div class="flex flex-wrap gap-1 text-[11px]"><span class="rounded bg-blue-50 text-blue-800 px-2 py-1">'+esc(modeLabel(b.access_mode))+'</span><span class="rounded bg-emerald-50 text-emerald-800 px-2 py-1">'+esc(b.student_permission==='draw'?'Vẽ + ghi':b.student_permission==='comment'?'Ghi chú':'Chỉ xem')+'</span>'+(b.target_lop?'<span class="rounded bg-amber-50 text-amber-900 px-2 py-1">'+esc(b.target_lop)+'</span>':'')+'</div>'+
  '<div class="flex flex-wrap gap-2 pt-2 border-t"><button data-board-enter="'+esc(b.id)+'" class="flex-1 rounded-xl bg-emerald-700 text-white py-2.5 px-3 font-bold text-sm">Vào bảng</button>'+
  (b.can_manage?'<button data-board-edit="'+esc(b.id)+'" class="rounded-xl bg-blue-50 text-blue-700 py-2.5 px-3 font-bold text-sm">Sửa</button><button data-board-delete="'+esc(b.id)+'" class="rounded-xl bg-rose-50 text-rose-700 py-2.5 px-3 font-bold text-sm">Xóa</button>':'')+'</div></article>').join('');
 const pages=Math.max(1,Math.ceil(total/20)),p=$('boards-pagination');if(p){p.innerHTML='<button id="boards-prev" class="rounded-lg border px-3 py-2" '+(page<=1?'disabled':'')+'>‹ Trước</button><span>Trang '+page+' / '+pages+'</span><button id="boards-next" class="rounded-lg border px-3 py-2" '+(page>=pages?'disabled':'')+'>Sau ›</button>';}
 refreshBoardButtonHelp(root?.closest?.('#tab-boards')||$('tab-boards'));
}
async function load(){
 const seq=++generation;const root=$('boards-list');if(root)root.innerHTML='<div class="col-span-full text-center p-8 text-slate-500">Đang tải danh sách bảng...</div>';
 try{const result=await api('GET','/api/boards?page='+page+'&limit=20'+(manage?'&manage=1':''));if(seq!==generation)return;list=result.data||[];total=Number(result.total)||0;if(manage&&typeof result.can_create==='boolean')canCreateBoard=result.can_create;$('boards-new')?.classList.toggle('hidden',!manage);renderList();}
 catch(e){if(seq!==generation)return;list=[];renderList();feedback(e.message,true);}
}
function toggleAccessFields(){
 const mode=$('board-edit-form')?.elements.namedItem('access_mode')?.value;
 $('board-unit-fields')?.classList.toggle('hidden',mode!=='unit');
 $('board-code-field')?.classList.toggle('hidden',mode!=='protected');
}
function openEdit(id=''){
 if(!manage)return;
 const b=id?list.find(x=>x.id===id):null;
 if(id&&!b?.can_manage){window.showToast?.('Bạn chỉ được sửa bảng do mình tạo.','warning');return;}
 if(!id&&!canCreateBoard){window.showToast?.('Tạo Bảng tương tác thông minh là chức năng VIP. Hãy liên hệ 0935 078 895 để nâng cấp tài khoản.','warning');return;}const f=$('board-edit-form');if(!f)return;f.reset();
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
  renderPageControls();syncLockUi();
  $('boards-home')?.classList.add('hidden');$('board-room')?.classList.remove('hidden');$('board-room-title').textContent=room.board.name;
  $('board-lock')?.classList.toggle('hidden',!room.board.can_manage);$('board-clear')?.classList.toggle('hidden',!room.board.can_manage);$('board-laser-tool')?.classList.toggle('hidden',!room.board.can_manage);
  for(const id of ['board-ai','board-template','board-timer','board-export-pdf','board-bring-here','board-insert-image','board-background-image'])$(id)?.classList.toggle('hidden',!room.board.can_manage);
  $('board-clear-background-image')?.classList.toggle('hidden',!room.board.can_manage||!(room.pages||[]).some(p=>String(p.id)===String(currentPageId)&&p.background_image_url));
  $('board-follow-teacher')?.classList.toggle('hidden',!!room.board.can_manage);applyBoardDeviceDefaults();
  if(room.board.can_manage)loadBlockedUsers();else{blockedUsers=[];renderBlockedUsers();}
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
function stopHeartbeat(){if(heartbeatTimer){clearInterval(heartbeatTimer);heartbeatTimer=null;}}
function startHeartbeat(socket){
 stopHeartbeat();lastPongAt=Date.now();
 heartbeatTimer=setInterval(()=>{
   if(ws!==socket||socket.readyState!==WebSocket.OPEN){stopHeartbeat();return;}
   if(Date.now()-lastPongAt>45000){try{socket.close(4000,'Heartbeat timeout')}catch{};return;}
   try{socket.send('ping')}catch{}
 },15000);
}
function connectSocket(pageId=currentPageId){
 if(ws)try{ws.onclose=null;ws.close()}catch{};if(!room)return;
 const base=room.realtime_base_path||room.realtime_path;
 const url=new URL(wsUrl(base));url.searchParams.set('pageId',pageId||currentPageId);
 const socket=new WebSocket(url.href);ws=socket;
 $('board-room-status').textContent=reconnectAttempts?'Đang kết nối lại...':'Đang kết nối realtime...';
 socket.onopen=()=>{reconnectAttempts=0;if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}startHeartbeat(socket);$('board-room-status').textContent='Đã kết nối realtime';syncBoardPermissionUi();for(const payload of pendingReliable.values()){try{socket.send(payload)}catch{}}};
 socket.onclose=()=>{if(ws===socket)stopHeartbeat();if(ws!==socket||manualExit)return;$('board-room-status').textContent='Mất kết nối — đang thử kết nối lại...';syncBoardPermissionUi();scheduleReconnect();};
 socket.onerror=()=>{$('board-room-status').textContent='Kết nối realtime không ổn định';syncBoardPermissionUi();};
 socket.onmessage=e=>{if(e.data==='pong'){lastPongAt=Date.now();return;}let m;try{m=JSON.parse(e.data)}catch{return;}handleMessage(m);};
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
 if(m.type==='snapshot_begin'){objects.clear();remoteStrokes.clear();selectedObjectId='';dragState=null;resizeState=null;snapshotLoading=true;locked=!!m.locked;userLocked=!!m.userLocked;timerState=m.timer||null;renderParticipants(m.participants||[]);syncLockUi();syncTimerUi();applyPageBackground();syncSelectionButtons();$('board-room-status').textContent='Đang đồng bộ bảng...';return;}
 if(m.type==='snapshot_chunk'){for(const o of m.objects||[])objects.set(o.id,o);scheduleRender();return;}
 if(m.type==='snapshot_end'){snapshotLoading=false;scheduleRender();renderParticipants(participantsCache);$('board-room-status').textContent='Đã kết nối realtime';return;}
 if(m.type==='put'&&m.object){objects.set(m.object.id,m.object);remoteStrokes.delete(m.object.id);scheduleRender();renderParticipants(participantsCache);return;}
 if(m.type==='delete'){objects.delete(m.objectId);remoteStrokes.delete(m.objectId);if(String(selectedObjectId)===String(m.objectId))selectedObjectId='';syncSelectionButtons();scheduleRender();renderParticipants(participantsCache);return;}
 if(m.type==='clear_page'){for(const [id,o] of objects)if(o.pageId===m.pageId)objects.delete(id);remoteStrokes.clear();drawing=null;dragState=null;resizeState=null;selectedObjectId='';syncSelectionButtons();scheduleRender();renderParticipants(participantsCache);return;}
 if(m.type==='stroke_segment'){let s=remoteStrokes.get(m.objectId);if(!s){s={id:m.objectId,pageId:m.pageId,type:'stroke',points:[],color:m.color,width:m.width};remoteStrokes.set(m.objectId,s);}s.points.push(...(m.points||[]));scheduleRender();return;}
 if(m.type==='page_updated'&&m.page){room.pages=(room.pages||[]).map(p=>String(p.id)===String(m.page.id)?{...p,...m.page}:p);renderPageControls();return;}
 if(m.type==='page_created'&&m.page){if(!room.pages.some(p=>String(p.id)===String(m.page.id))){room.pages=[...room.pages,m.page].sort((a,b)=>(a.page_no||0)-(b.page_no||0));renderPageControls();}return;}
 if(m.type==='page_deleted'){room.pages=(room.pages||[]).filter(p=>String(p.id)!==String(m.pageId));renderPageControls();if(String(m.pageId)===String(currentPageId)){const next=room.pages[0];if(next)switchPage(next.id);else exitRoom();}return;}
 if(m.type==='op_ack'&&m.clientOpId){pendingReliable.delete(String(m.clientOpId));return;}
 if(m.type==='token_expired'){roomTokenExpiresAt=0;if(ws)try{ws.close(4001,'refresh token')}catch{};return;}
 if(m.type==='resync_required'){setTimeout(()=>{if(room&&!manualExit)connectSocket(currentPageId)},120);return;}
 if(m.type==='clear_user_objects'){for(const id of m.objectIds||[])objects.delete(id);if((m.objectIds||[]).some(id=>String(id)===String(selectedObjectId)))selectedObjectId='';syncSelectionButtons();scheduleRender();renderParticipants(participantsCache);return;}
 if(m.type==='laser'){remoteLasers.set(String(m.userId),{x:m.x,y:m.y,name:m.displayName||'Giáo viên',expires:Date.now()+900});scheduleRender();setTimeout(()=>{const v=remoteLasers.get(String(m.userId));if(v&&v.expires<=Date.now()){remoteLasers.delete(String(m.userId));scheduleRender();}},950);return;}
 if(m.type==='stroke_cancel'){remoteStrokes.delete(m.objectId);scheduleRender();return;}
 if(m.type==='user_blocked'){manualExit=true;window.showToast?.('Giáo viên đã chặn tài khoản của bạn khỏi bảng này.','warning');exitRoom();return;}
 if(m.type==='user_lock_state'){userLocked=!!m.blocked;if(userLocked){drawing=null;dragState=null;resizeState=null;selectedObjectId='';syncSelectionButtons();scheduleRender();}syncLockUi();window.showToast?.(userLocked?'Giáo viên đã tạm khóa quyền tương tác của bạn.':'Giáo viên đã mở lại quyền tương tác cho bạn.','info');return;}
 if(m.type==='page_focus'){if(followTeacher&&!room?.board?.can_manage&&m.pageId&&String(m.pageId)!==String(currentPageId))switchPage(String(m.pageId));return;}
 if(m.type==='vote_state'){const o=objects.get(String(m.objectId));if(o){o.voteCount=Math.max(0,Number(m.voteCount)||0);objects.set(o.id,o);scheduleRender();}return;}
 if(m.type==='timer_state'){timerState=m.timer||null;syncTimerUi();return;}
 if(m.type==='rate_limited'){const now=Date.now();if(now-lastRateNotice>5000){lastRateNotice=now;window.showToast?.('Thao tác quá nhanh, hệ thống đang giảm nhịp để bảo vệ lớp học.','info');}const opId=String(m.clientOpId||''),payload=pendingReliable.get(opId);if(opId&&payload){setTimeout(()=>{if(pendingReliable.has(opId)&&ws?.readyState===WebSocket.OPEN)try{ws.send(payload)}catch{}},Math.max(250,Math.min(10000,Number(m.retryAfterMs)||1000)));}return;}
 if(m.type==='presence'){renderParticipants(m.participants||[]);return;}
 if(m.type==='lock_state'){locked=!!m.locked;if(locked&&!room?.board?.can_manage){drawing=null;dragState=null;resizeState=null;scheduleRender();}syncLockUi();return;}
 if(m.type==='policy_changed'){locked=!!m.locked;roomTokenExpiresAt=0;syncLockUi();$('board-room-status').textContent='Cấu hình bảng vừa thay đổi — đang xác thực lại...';return;}
 if(m.type==='board_unavailable'){manualExit=true;window.showToast?.('Bảng đã đóng hoặc tạm ngừng truy cập.','info');exitRoom();return;}
 if(m.type==='board_deleted'){manualExit=true;window.showToast?.('Bảng này đã được giáo viên xóa.','info');exitRoom();return;}
}
function sendOps(ops){
 if(!ops.length)return;
 if(ws?.readyState!==WebSocket.OPEN&&!ops.every(op=>op.kind==='laser'||op.kind==='stroke_segment'||op.kind==='stroke_cancel')){window.showToast?.('Đang mất kết nối realtime. Hệ thống sẽ đồng bộ lại trước khi tiếp tục chỉnh sửa.','info');return;}
 const transient=ops.every(op=>op.kind==='stroke_segment'||op.kind==='stroke_cancel'||op.kind==='laser');
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
function selectedObject(){return selectedObjectId?objects.get(selectedObjectId)||null:null;}
function syncSelectionButtons(){
 const o=selectedObject(),baseEditable=!!o&&canEdit()&&(room?.board?.can_manage||String(o.creatorId||'')===myId()),editable=baseEditable&&!o?.locked;
 renderSelectedOwner(o);
 if($('board-duplicate-selected'))$('board-duplicate-selected').disabled=!editable;
 const lockBtn=$('board-lock-selected');if(lockBtn){const canLock=!!o&&!!room?.board?.can_manage;lockBtn.classList.toggle('hidden',!canLock);lockBtn.disabled=!canLock;lockBtn.textContent=o?.locked?'🔓 Mở khóa đối tượng':'🔒 Khóa đối tượng';}
 const imageEditable=editable&&o?.type==='image'&&!!room?.board?.can_manage;
 let imageIndex=-1,imageCount=0;if(imageEditable){const layers=sortImagesForLayer([...objects.values()].filter(x=>x.pageId===currentPageId));imageIndex=layers.findIndex(x=>x.id===o.id);imageCount=layers.length;}
 const up=$('board-image-layer-up'),down=$('board-image-layer-down');
 if(up){up.classList.toggle('hidden',!imageEditable);up.disabled=!imageEditable||imageIndex<0||imageIndex>=imageCount-1;}
 if(down){down.classList.toggle('hidden',!imageEditable);down.disabled=!imageEditable||imageIndex<=0;}
 if($('board-delete-selected'))$('board-delete-selected').disabled=!editable;
}
function renderSelectedOwner(o){
 const box=$('board-object-owner');if(!box)return;
 if(!o||!room?.board?.can_manage){box.classList.add('hidden');box.innerHTML='';return;}
 const creatorId=String(o.creatorId||''),name=o.creatorName||'Không xác định',cls=o.creatorClass||'',unit=o.creatorUnit||'';
 box.classList.remove('hidden');
 box.innerHTML='<p class="font-black text-sky-950">Người tạo đối tượng</p><p class="mt-1 font-bold">'+esc(name)+'</p><p class="text-xs text-slate-600">'+esc([cls,unit].filter(Boolean).join(' • ')||('ID: '+creatorId))+'</p>'+(creatorId&&creatorId!==myId()&&String(o.creatorRole||'student')==='student'?'<button type="button" data-board-user-block="'+esc(creatorId)+'" class="mt-2 rounded-lg bg-rose-100 px-3 py-2 text-xs font-black text-rose-800">⛔ Chặn khỏi bảng</button>':'');
 refreshBoardButtonHelp(box);
}
async function loadBlockedUsers(){
 if(!room?.board?.can_manage)return;
 try{const result=await api('GET','/api/board/moderation?boardId='+encodeURIComponent(room.board.id));blockedUsers=result.data||[];renderBlockedUsers();}catch(e){console.warn('[BOARD BLOCK LIST]',e);}
}
function renderBlockedUsers(){
 const section=$('board-blocked-section'),root=$('board-blocked-users'),count=$('board-blocked-count');if(!section||!root)return;
 const show=!!room?.board?.can_manage;section.classList.toggle('hidden',!show);if(!show)return;
 if(count)count.textContent=String(blockedUsers.length);
 root.innerHTML=blockedUsers.length?blockedUsers.map(u=>'<div class="rounded-lg border bg-white p-2"><p class="font-bold truncate">'+esc(u.display_name||u.user_id)+'</p><p class="text-[11px] text-slate-500">'+esc([u.lop,u.donvi].filter(Boolean).join(' • ')||'Đã chặn')+'</p>'+(u.reason?'<p class="mt-1 text-[11px] text-rose-700">'+esc(u.reason)+'</p>':'')+'<button type="button" data-board-user-unblock="'+esc(u.user_id)+'" class="mt-2 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-800">Mở chặn</button></div>').join(''):'<p class="text-xs text-slate-500">Chưa chặn học sinh nào.</p>';
 refreshBoardButtonHelp(section);
}
async function setPersistentBlock(targetUserId,blocked){
 if(!room?.board?.can_manage||!targetUserId)return;
 let reason='';
 if(blocked){reason=String(window.prompt?.('Lý do chặn học sinh khỏi bảng (có thể để trống):','')||'').trim().slice(0,300);}
 try{
  await api('POST','/api/board/moderation',{boardId:room.board.id,targetUserId,action:blocked?'block':'unblock',reason});
  window.showToast?.(blocked?'Đã chặn học sinh khỏi bảng.':'Đã mở chặn học sinh.','success');
  await loadBlockedUsers();
 }catch(e){window.showToast?.(e.message||'Không thể cập nhật quyền tham gia.','error');}
}
function clearSelection(){selectedObjectId='';syncSelectionButtons();scheduleRender();}
function syncHistoryButtons(){if($('board-undo'))$('board-undo').disabled=!undoStack.length;if($('board-redo'))$('board-redo').disabled=!redoStack.length;syncSelectionButtons();}
function safeFileName(value){return String(value||'bang-tuong-tac').normalize('NFC').replace(/[^\p{L}\p{N}._-]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,100)||'bang-tuong-tac';}
function imageProxyUrl(url){return '/api/proxy-image?url='+encodeURIComponent(String(url||''));}
function ensureBoardImage(url){
 const key=String(url||'');if(!key)return null;
 let entry=imageCache.get(key);if(entry)return entry;
 const img=new Image();entry={img,ready:false,error:false};imageCache.set(key,entry);
 img.onload=()=>{entry.ready=true;scheduleRender();};
 img.onerror=()=>{entry.error=true;scheduleRender();};
 img.src=imageProxyUrl(key);return entry;
}
async function fileToBoardImageBase64(file){
 if(!file||!/^image\/(jpeg|png|webp)$/i.test(file.type))throw Error('Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.');
 if(file.size>8*1024*1024)throw Error('Ảnh vượt 8 MB. Hãy chọn ảnh nhỏ hơn.');
 const bitmap=await createImageBitmap(file),maxW=1600,maxH=1200,scale=Math.min(1,maxW/bitmap.width,maxH/bitmap.height);
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
 const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
 const outputType=file.type==='image/png'?'image/png':file.type==='image/webp'?'image/webp':'image/jpeg';
 return {base64:canvas.toDataURL(outputType,outputType==='image/jpeg'?.88:.9),width:canvas.width,height:canvas.height};
}
async function uploadBoardImage(file){
 const prepared=await fileToBoardImageBase64(file);
 const result=await api('POST','/api/upload-image',{base64:prepared.base64});
 const url=String(result.url||'');
 if(!/^https:\/\//i.test(url))throw Error('Kho ảnh R2 chưa sẵn sàng. Cần cấu hình Cloudflare R2 để dùng ảnh trên Bảng tương tác.');
 return {...prepared,url};
}
async function setPageBackgroundImage(url){
 const pageInfo=(room?.pages||[]).find(p=>String(p.id)===String(currentPageId));if(!pageInfo||!room?.board?.can_manage)return;
 const result=await api('PUT','/api/board/pages',{id:pageInfo.id,revision:Number(pageInfo.revision)||1,title:pageInfo.title||'',background_type:pageInfo.background_type||'white',background_image_url:url||''});
 room.pages=(room.pages||[]).map(p=>String(p.id)===String(result.data.id)?{...p,...result.data}:p);
 renderPageControls();scheduleRender();
}
async function handleBoardImageFile(file,mode){
 const input=$('board-image-input');if(input)input.disabled=true;
 try{
   const uploaded=await uploadBoardImage(file);
   if(mode==='background'){await setPageBackgroundImage(uploaded.url);window.showToast?.('Đã đặt ảnh làm hình nền của trang.','success');return;}
   const maxW=1200,maxH=700,scale=Math.min(1,maxW/uploaded.width,maxH/uploaded.height);
   const w=Math.max(120,Math.round(uploaded.width*scale)),h=Math.max(80,Math.round(uploaded.height*scale));
   const topZ=Math.max(0,...[...objects.values()].filter(x=>x.pageId===currentPageId&&x.type==='image').map(x=>Number(x.z)||0));
   const o={id:crypto.randomUUID(),pageId:currentPageId,type:'image',x:Math.round((1600-w)/2),y:Math.round((900-h)/2),w,h,url:uploaded.url,fit:'contain',z:topZ+10,creatorId:myId()};
   objects.set(o.id,o);sendOps([{kind:'put',object:o}]);remember({kind:'put',object:o});selectedObjectId=o.id;ensureBoardImage(o.url);syncSelectionButtons();scheduleRender();
   window.showToast?.('Đã chèn ảnh. Học sinh có thể vẽ và ghi chú trực tiếp trên ảnh.','success');
 }catch(e){window.showToast?.(e.message||'Không thể thêm ảnh.','error');}
 finally{if(input){input.value='';input.disabled=false;}}
}
function setZoom(value){
 zoomLevel=Math.max(.5,Math.min(2,Math.round(Number(value)*10)/10));
 const wrap=$('board-canvas-wrap');if(wrap){wrap.style.width=(zoomLevel*100)+'%';wrap.style.maxWidth=zoomLevel===1?'100%':'none';}
 if($('board-zoom-label'))$('board-zoom-label').textContent=Math.round(zoomLevel*100)+'%';
 applyPageBackground();
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
async function renderBackgroundToCanvas(ctx,pageInfo){
 ctx.fillStyle='#fff';ctx.fillRect(0,0,1600,900);
 if(pageInfo?.background_image_url){try{const img=await loadBoardImageForExport(pageInfo.background_image_url);drawImageContain(ctx,img,0,0,1600,900,'cover');}catch{}}
 if(pageInfo?.background_type==='grid'){ctx.strokeStyle='#e5e7eb';ctx.lineWidth=1;for(let x=0;x<=1600;x+=32){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,900);ctx.stroke();}for(let y=0;y<=900;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1600,y);ctx.stroke();}}
 if(pageInfo?.background_type==='lined'){ctx.strokeStyle='#dbeafe';ctx.lineWidth=1;for(let y=32;y<=900;y+=32){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1600,y);ctx.stroke();}}
 if(pageInfo?.background_type==='dots'){ctx.fillStyle='#cbd5e1';for(let y=12;y<900;y+=24)for(let x=12;x<1600;x+=24){ctx.beginPath();ctx.arc(x,y,1.5,0,Math.PI*2);ctx.fill();}}
}
function drawImageContain(ctx,img,x,y,w,h,fit='contain'){
 const ir=img.naturalWidth/img.naturalHeight,br=w/h;let dw=w,dh=h,dx=x,dy=y;
 if((fit==='cover'&&ir>br)||(fit!=='cover'&&ir<br)){dh=h;dw=h*ir;dx=x+(w-dw)/2;}
 else{dw=w;dh=w/ir;dy=y+(h-dh)/2;}
 if(fit==='cover'){ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.drawImage(img,dx,dy,dw,dh);ctx.restore();}else ctx.drawImage(img,dx,dy,dw,dh);
}
function loadBoardImageForExport(url){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=imageProxyUrl(url);});}
function imageLayerValue(o){return Number.isFinite(Number(o?.z))?Number(o.z):0;}
function sortImagesForLayer(items){return [...items].filter(x=>x.type==='image').sort((a,b)=>imageLayerValue(a)-imageLayerValue(b)||String(a.id).localeCompare(String(b.id)));}
async function renderObjectsToCanvas(pageInfo,pageObjects){
 const out=document.createElement('canvas');out.width=1600;out.height=900;const ctx=out.getContext('2d');await renderBackgroundToCanvas(ctx,pageInfo);
 const items=[...(pageObjects||[])];for(const o of sortImagesForLayer(items)){try{const img=await loadBoardImageForExport(o.url);drawImageContain(ctx,img,o.x,o.y,o.w||640,o.h||360,o.fit||'contain');}catch{}}
 for(const o of items.filter(x=>x.type!=='image'))drawObject(ctx,o);return out;
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
async function fetchPageSnapshot(pageId,retried=false){
 await ensureFreshRoomToken(pageId);
 if(!room?.realtime_base_path)throw Error('Phiên realtime chưa sẵn sàng.');
 const url=new URL(room.realtime_base_path,location.href);url.searchParams.set('snapshot','1');url.searchParams.set('pageId',String(pageId));
 const response=await fetch(url.href,{cache:'no-store'});
 if(response.status===403&&!retried){
   roomTokenExpiresAt=0;
   await ensureFreshRoomToken(currentPageId||pageId);
   return fetchPageSnapshot(pageId,true);
 }
 if(!response.ok)throw Error(response.status===410?'Trang đã bị xóa.':'Không thể đọc dữ liệu trang.');
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
     const snap=await fetchPageSnapshot(pages[i].id),canvas=await renderObjectsToCanvas(pages[i],snap.objects||[]);
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
 select.value=currentPageId||pages[0]?.id||'';applyPageBackground();refreshBoardButtonHelp($('tab-boards'));
 const idx=pages.findIndex(p=>String(p.id)===String(select.value));
 const current=pages[idx];$('board-clear-background-image')?.classList.toggle('hidden',!room.board.can_manage||!current?.background_image_url);
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
   ws=null;stopHeartbeat();objects.clear();remoteStrokes.clear();drawing=null;dragState=null;resizeState=null;selectedObjectId='';syncSelectionButtons();scheduleRender();
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
 else if(n.type==='note'||n.type==='text'||n.type==='image'){n.x+=dx;n.y+=dy;}
 else {n.x1+=dx;n.y1+=dy;n.x2+=dx;n.y2+=dy;}
 return n;
}
function hitVotable(point){
 const [x,y]=point,items=[...objects.values()].reverse();
 for(const o of items){if(o.pageId!==currentPageId||!['note','text'].includes(o.type))continue;if(x>=o.x&&x<=o.x+(o.w||220)&&y>=o.y&&y<=o.y+(o.h||120))return o;}
 return null;
}
function imageResizeHandles(o){
 if(!o||o.type!=='image')return [];
 const x=Number(o.x)||0,y=Number(o.y)||0,w=Math.max(40,Number(o.w)||640),h=Math.max(40,Number(o.h)||360);
 return [
  {name:'nw',x,y,anchorX:x+w,anchorY:y+h},
  {name:'ne',x:x+w,y,anchorX:x,anchorY:y+h},
  {name:'se',x:x+w,y:y+h,anchorX:x,anchorY:y},
  {name:'sw',x,y:y+h,anchorX:x+w,anchorY:y}
 ];
}
function hitImageResizeHandle(point){
 const o=selectedObject();if(!o||o.type!=='image'||o.locked||!room?.board?.can_manage)return null;
 const [x,y]=point,radius=isCoarseBoardPointer()?26:18;
 return imageResizeHandles(o).find(h=>Math.hypot(x-h.x,y-h.y)<=radius)||null;
}
function hitObject(point){
 const [x,y]=point;
 const images=sortImagesForLayer([...objects.values()].filter(o=>o.pageId===currentPageId)).reverse();
 const others=[...objects.values()].filter(o=>o.pageId===currentPageId&&o.type!=='image').reverse();
 const items=[...others,...images];
 for(const o of items){
  if(o.pageId!==currentPageId)continue;
  if(!room?.board?.can_manage && String(o.creatorId||'')!==myId())continue;
  if((o.type==='note'||o.type==='text'||o.type==='image')&&x>=o.x&&x<=o.x+(o.w||220)&&y>=o.y&&y<=o.y+(o.h||120))return o;
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
 $('board-online-count').textContent=currentItems.length+' người';if($('board-participants-toggle-count'))$('board-participants-toggle-count').textContent=String(currentItems.length);
 $('board-participants').innerHTML=currentItems.map(p=>{
   const roleLabel=p.role==='teacher'?'Giáo viên':p.role==='admin'?'Admin':'Học sinh';
   const canModerate=room?.board?.can_manage&&p.role==='student'&&String(p.userId)!==myId();
   const contributionCount=counts.get(String(p.userId))||0;
   const identity=[p.studentClass,p.studentUnit].filter(Boolean).join(' • ');
   return '<div class="rounded-lg bg-white border px-3 py-2 space-y-1"><div class="flex items-start justify-between gap-2"><div class="min-w-0"><p class="font-bold truncate">'+esc(p.displayName)+'</p><p class="text-[11px] text-slate-500">'+esc(roleLabel)+(identity?' • '+esc(identity):'')+(p.blocked?' • đang khóa':'')+(String(p.userId)!==myId()?' • '+contributionCount+' đóng góp':'')+'</p></div>'+(canModerate?'<div class="flex flex-wrap justify-end gap-1"><button data-board-user-clear="'+esc(p.userId)+'" class="shrink-0 rounded-md bg-rose-50 text-rose-700 px-2 py-1 text-[11px] font-bold">Xóa nét</button><button data-board-user-lock="'+esc(p.userId)+'" data-blocked="'+(p.blocked?'1':'0')+'" class="shrink-0 rounded-md px-2 py-1 text-[11px] font-bold '+(p.blocked?'bg-emerald-50 text-emerald-700':'bg-amber-50 text-amber-800')+'">'+(p.blocked?'Mở khóa':'Khóa viết')+'</button><button data-board-user-block="'+esc(p.userId)+'" class="shrink-0 rounded-md bg-slate-900 text-white px-2 py-1 text-[11px] font-bold">Chặn</button></div>':'')+'</div></div>';
 }).join('');refreshBoardButtonHelp($('board-participants'));
}
function syncLockUi(){
 const manager=!!room?.board?.can_manage,restricted=!manager&&(locked||userLocked);
 const overlay=$('board-locked-overlay');overlay?.classList.toggle('hidden',!restricted);
 const label=overlay?.querySelector('span');if(label)label.textContent=userLocked?'Giáo viên đang khóa quyền tương tác của bạn':(locked?'Bảng đang khóa tương tác của học sinh':'');
 const btn=$('board-lock');if(btn&&!btn.classList.contains('hidden'))btn.textContent=locked?'🔓 Mở cho HS':'🔒 Khóa HS';
 syncBoardPermissionUi();refreshBoardButtonHelp($('tab-boards'));
}
function canvas(){return $('board-canvas');}
function logicalPointFromClient(clientX,clientY){const c=canvas(),r=c.getBoundingClientRect();return [Math.round((clientX-r.left)*1600/r.width),Math.round((clientY-r.top)*900/r.height)];}
function logicalPoint(ev){return logicalPointFromClient(ev.clientX,ev.clientY);}
function coalescedLogicalPoints(ev){
 const events=typeof ev.getCoalescedEvents==='function'?ev.getCoalescedEvents():[];
 const source=events.length?events:[ev],out=[];let last=null;
 for(const item of source){
   const p=logicalPointFromClient(item.clientX,item.clientY);
   if(!last||Math.hypot(p[0]-last[0],p[1]-last[1])>=1){out.push(p);last=p;}
 }
 return out;
}
function scheduleRender(){if(renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{renderQueued=false;render();});}
function applyPageBackground(){
 const wrap=$('board-canvas-wrap'),page=(room?.pages||[]).find(p=>String(p.id)===String(currentPageId));if(!wrap)return;
 const type=page?.background_type||'white';wrap.style.backgroundColor='#ffffff';wrap.style.backgroundImage='';wrap.style.backgroundSize='';wrap.style.backgroundPosition='center';wrap.style.backgroundRepeat='no-repeat';
 const scale=Math.max(.5,Math.min(2,Number(zoomLevel)||1));
 if(type==='grid')wrap.style.backgroundImage='linear-gradient(#e5e7eb 1px, transparent 1px),linear-gradient(90deg,#e5e7eb 1px,transparent 1px)',wrap.style.backgroundSize=(32*scale)+'px '+(32*scale)+'px';
 if(type==='lined')wrap.style.backgroundImage='repeating-linear-gradient(to bottom,transparent 0,transparent '+(31*scale)+'px,#dbeafe '+(32*scale)+'px)';
 if(type==='dots')wrap.style.backgroundImage='radial-gradient(#cbd5e1 1.5px,transparent 1.5px)',wrap.style.backgroundSize=(24*scale)+'px '+(24*scale)+'px';
 if(page?.background_image_url){wrap.style.backgroundImage='url("'+imageProxyUrl(page.background_image_url).replace(/"/g,'%22')+'")';wrap.style.backgroundSize='cover';wrap.style.backgroundPosition='center';}
}
function render(){
 const c=canvas();if(!c)return;const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);ctx.lineCap='round';ctx.lineJoin='round';
 const all=[...objects.values(),...remoteStrokes.values()];
 for(const o of sortImagesForLayer(all))drawObject(ctx,o);
 for(const o of all.filter(x=>x.type!=='image'))drawObject(ctx,o);
 if(drawing)drawObject(ctx,drawing);
 const selected=selectedObject();
 if(selected&&selected.pageId===currentPageId){
   ctx.save();ctx.strokeStyle='#0f766e';ctx.lineWidth=2;ctx.setLineDash([8,6]);
   if(selected.type==='note'||selected.type==='text'||selected.type==='image')ctx.strokeRect(selected.x-6,selected.y-6,(selected.w||220)+12,(selected.h||120)+12);
   if(selected.type==='image'&&room?.board?.can_manage){
     ctx.setLineDash([]);ctx.fillStyle='#ffffff';ctx.strokeStyle='#0f766e';ctx.lineWidth=3;
     for(const h of imageResizeHandles(selected)){ctx.beginPath();ctx.arc(h.x,h.y,isCoarseBoardPointer()?12:9,0,Math.PI*2);ctx.fill();ctx.stroke();}
   }
   else if(selected.type==='stroke'&&selected.points?.length){
     const xs=selected.points.map(p=>p[0]),ys=selected.points.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
     ctx.strokeRect(minX-8,minY-8,Math.max(16,maxX-minX+16),Math.max(16,maxY-minY+16));
   }else if(['rect','ellipse','line','arrow'].includes(selected.type)){
     const minX=Math.min(selected.x1,selected.x2),minY=Math.min(selected.y1,selected.y2),maxX=Math.max(selected.x1,selected.x2),maxY=Math.max(selected.y1,selected.y2);
     ctx.strokeRect(minX-8,minY-8,Math.max(16,maxX-minX+16),Math.max(16,maxY-minY+16));
   }
   ctx.restore();
 }
 const now=Date.now();
 for(const [id,l] of remoteLasers){if(l.expires<=now){remoteLasers.delete(id);continue;}ctx.save();ctx.fillStyle='#ef4444';ctx.beginPath();ctx.arc(l.x,l.y,7,0,Math.PI*2);ctx.fill();ctx.font='16px sans-serif';ctx.fillText(l.name,l.x+12,l.y-10);ctx.restore();}
}
function drawObject(ctx,o){
 if(!o)return;ctx.save();ctx.strokeStyle=o.color||'#111827';ctx.fillStyle=o.color||'#111827';ctx.lineWidth=o.width||3;ctx.lineCap='round';ctx.lineJoin='round';
 if(o.type==='image'){const entry=ensureBoardImage(o.url);if(entry?.ready)drawImageContain(ctx,entry.img,o.x,o.y,o.w||640,o.h||360,o.fit||'contain');else{ctx.fillStyle='#f8fafc';ctx.fillRect(o.x,o.y,o.w||640,o.h||360);ctx.strokeStyle='#cbd5e1';ctx.strokeRect(o.x,o.y,o.w||640,o.h||360);ctx.fillStyle='#64748b';ctx.font='18px sans-serif';ctx.fillText(entry?.error?'Không tải được ảnh':'Đang tải ảnh...',o.x+16,o.y+30);} }
 else if(o.type==='stroke'&&o.points?.length){
   const pts=o.points;ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);
   if(pts.length===2){ctx.lineTo(pts[1][0],pts[1][1]);}
   else for(let i=1;i<pts.length-1;i++){const p=pts[i],n=pts[i+1],mx=(p[0]+n[0])/2,my=(p[1]+n[1])/2;ctx.quadraticCurveTo(p[0],p[1],mx,my);}
   if(pts.length>2){const last=pts[pts.length-1];ctx.lineTo(last[0],last[1]);}
   ctx.stroke();
 }
 else if(o.type==='note'||o.type==='text'){ctx.fillStyle='#fff7c2';ctx.strokeStyle='#eab308';ctx.lineWidth=1.5;ctx.fillRect(o.x,o.y,o.w||220,o.h||120);ctx.strokeRect(o.x,o.y,o.w||220,o.h||120);ctx.fillStyle=o.color||'#111827';ctx.font=(o.fontSize||20)+'px sans-serif';wrapText(ctx,o.text||'',o.x+12,o.y+28,(o.w||220)-24,26);const votes=Math.max(0,Number(o.voteCount)||0);if(votes){ctx.font='bold 18px sans-serif';ctx.fillStyle='#475569';ctx.fillText('👍 '+votes,o.x+(o.w||220)-62,o.y+(o.h||120)-14);}}
 else if(o.type==='line'||o.type==='arrow'){ctx.beginPath();ctx.moveTo(o.x1,o.y1);ctx.lineTo(o.x2,o.y2);ctx.stroke();if(o.type==='arrow'){const a=Math.atan2(o.y2-o.y1,o.x2-o.x1),len=16+Math.min(16,(o.width||3)*2);ctx.beginPath();ctx.moveTo(o.x2,o.y2);ctx.lineTo(o.x2-len*Math.cos(a-Math.PI/6),o.y2-len*Math.sin(a-Math.PI/6));ctx.moveTo(o.x2,o.y2);ctx.lineTo(o.x2-len*Math.cos(a+Math.PI/6),o.y2-len*Math.sin(a+Math.PI/6));ctx.stroke();}}
 else if(o.type==='rect'){ctx.strokeRect(Math.min(o.x1,o.x2),Math.min(o.y1,o.y2),Math.abs(o.x2-o.x1),Math.abs(o.y2-o.y1));}
 else if(o.type==='ellipse'){const cx=(o.x1+o.x2)/2,cy=(o.y1+o.y2)/2,rx=Math.abs(o.x2-o.x1)/2,ry=Math.abs(o.y2-o.y1)/2;ctx.beginPath();ctx.ellipse(cx,cy,Math.max(1,rx),Math.max(1,ry),0,0,Math.PI*2);ctx.stroke();}
 ctx.restore();
}
function wrapText(ctx,text,x,y,maxWidth,lineHeight){const words=String(text).split(/\s+/);let line='';for(const word of words){const test=line?line+' '+word:word;if(ctx.measureText(test).width>maxWidth&&line){ctx.fillText(line,x,y);line=word;y+=lineHeight;}else line=test;}if(line)ctx.fillText(line,x,y);}
function noteText(){
 const desktop=$('board-note-text'),mobile=$('board-note-text-mobile');
 const desktopVisible=desktop&&getComputedStyle(desktop).display!=='none';
 const mobileVisible=mobile&&getComputedStyle(mobile).display!=='none';
 const value=desktopVisible?desktop?.value:(mobileVisible?mobile?.value:(desktop?.value||mobile?.value||''));
 return String(value||'').trim().slice(0,500);
}
function syncBoardToolButtons(){
 document.querySelectorAll('[data-board-tool]').forEach(btn=>{
   const active=btn.dataset.boardTool===tool;
   btn.classList.toggle('bg-emerald-700',active);
   btn.classList.toggle('text-white',active);
   btn.classList.toggle('bg-slate-100',!active);
   btn.setAttribute('aria-pressed',active?'true':'false');
 });
 const c=canvas();if(c)c.style.cursor=tool==='pan'?'grab':tool==='select'?'default':tool==='eraser'?'cell':tool==='laser'?'crosshair':'crosshair';
}
function selectBoardTool(name){
 tool=name||'pen';syncBoardToolButtons();
 const active=document.querySelector('[data-board-tool="'+CSS.escape(tool)+'"]');active?.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'smooth'});
}
function isCoarseBoardPointer(){return window.matchMedia?.('(pointer: coarse)')?.matches||navigator.maxTouchPoints>0;}
function applyBoardDeviceDefaults(){
 const width=$('board-width');if(width&&isCoarseBoardPointer()&&Number(width.value)<5)width.value='5';
 const panel=$('board-participants-panel');if(panel&&window.innerWidth<1024)panel.classList.add('is-mobile-collapsed');
 const toggle=$('board-participants-toggle');if(toggle)toggle.setAttribute('aria-expanded','false');
 syncBoardToolButtons();
}
function canEdit(){if(snapshotLoading||ws?.readyState!==WebSocket.OPEN)return false;return room?.board?.can_manage||(!locked&&!userLocked&&room?.board?.student_permission!=='view');}
function boardToolAllowed(name){
 if(name==='pan')return true;
 if(!room||ws?.readyState!==WebSocket.OPEN)return false;
 if(room.board?.can_manage)return true;
 if(locked||userLocked)return false;
 const permission=String(room.board?.student_permission||'view');
 if(permission==='draw')return name!=='laser';
 if(permission==='comment')return ['note','select','eraser','vote'].includes(name);
 return false;
}
function syncBoardPermissionUi(){
 document.querySelectorAll('[data-board-tool]').forEach(btn=>{
   const allowed=boardToolAllowed(btn.dataset.boardTool);
   btn.disabled=!allowed;btn.setAttribute('aria-disabled',allowed?'false':'true');
 });
 if(!boardToolAllowed(tool))selectBoardTool('pan');
 const manager=!!room?.board?.can_manage,permission=String(room?.board?.student_permission||'view');
 const canComment=manager||(!locked&&!userLocked&&['draw','comment'].includes(permission));
 const canDraw=manager||(!locked&&!userLocked&&permission==='draw');
 for(const id of ['board-note-text','board-note-text-mobile'])if($(id))$(id).disabled=!canComment;
 if($('board-color'))$('board-color').disabled=!canComment;
 if($('board-width'))$('board-width').disabled=!canDraw;
 syncSelectionButtons();
}
function pointerDown(e){
 if(!room)return;const p=logicalPoint(e);canvas().setPointerCapture?.(e.pointerId);
 const touchGesture=e.pointerType==='touch'&&(tool==='pan'||panPointers.size>0);
 if(e.pointerType==='touch'){
   panPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
   if(panPointers.size===2){
     mobileGesture=true;
     if(drawing?.type==='stroke')sendOps([{kind:'stroke_cancel',pageId:drawing.pageId,objectId:drawing.id}]);
     drawing=null;dragState=null;resizeState=null;
     const pts=[...panPointers.values()],dist=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y),stage=$('board-stage-scroll');
     pinchStart={distance:Math.max(1,dist),zoom:zoomLevel,centerX:(pts[0].x+pts[1].x)/2,centerY:(pts[0].y+pts[1].y)/2,left:stage?.scrollLeft||0,top:stage?.scrollTop||0};panDrag=null;return;
   }
 }
 if(tool==='pan'||touchGesture){
   const stage=$('board-stage-scroll');
   if(panPointers.size<=1)panDrag={pointerId:e.pointerId,clientX:e.clientX,clientY:e.clientY,left:stage?.scrollLeft||0,top:stage?.scrollTop||0};
   return;
 }
 if(tool==='vote'){const canVote=room.board.can_manage||(!locked&&!userLocked&&room.board.student_permission!=='view');if(!canVote)return;const target=hitVotable(p);if(target)sendOps([{kind:'vote_toggle',pageId:currentPageId,objectId:target.id}]);return;}
 if(!canEdit())return;
 if(tool==='laser'){if(room?.board?.can_manage)sendOps([{kind:'laser',pageId:currentPageId,x:p[0],y:p[1]}]);return;}
 if(tool==='select'){
   const handle=hitImageResizeHandle(p);
   if(handle){
     const target=selectedObject(),before=cloneObject(target);
     resizeState={id:target.id,handle:handle.name,anchorX:handle.anchorX,anchorY:handle.anchorY,aspect:Math.max(.05,(Number(before.w)||640)/Math.max(1,Number(before.h)||360)),before};
     dragState=null;return;
   }
   const target=hitObject(p);if(!target){clearSelection();return;}
   if(!room.board.can_manage&&room.board.student_permission==='comment'&&!['note','text'].includes(target.type))return;
   selectedObjectId=target.id;syncSelectionButtons();scheduleRender();
   if(target.locked)return;
   dragState={id:target.id,start:p,before:cloneObject(target)};
   return;
 }
 if(tool==='note'){if(!room.board.can_manage&&room.board.student_permission==='view')return;const text=noteText();if(!text){window.showToast?.('Nhập nội dung ghi chú trước.','info');return;}const o={id:crypto.randomUUID(),pageId:currentPageId,type:'note',x:p[0],y:p[1],w:260,h:130,text,color:$('board-color').value,fontSize:20,creatorId:myId()};objects.set(o.id,o);sendOps([{kind:'put',object:o}]);remember({kind:'put',object:o});scheduleRender();return;}
 if(tool==='eraser'){const target=hitObject(p);if(target&&!target.locked){sendOps([{kind:'delete',pageId:target.pageId,objectId:target.id}]);objects.delete(target.id);remember({kind:'delete',object:target});scheduleRender();}return;}
 if(!room.board.can_manage&&room.board.student_permission!=='draw')return;
 if(['line','arrow','rect','ellipse'].includes(tool)){drawing={id:crypto.randomUUID(),pageId:currentPageId,type:tool,x1:p[0],y1:p[1],x2:p[0],y2:p[1],color:$('board-color').value,width:Number($('board-width').value)||3};return;}
 drawing={id:crypto.randomUUID(),pageId:currentPageId,type:'stroke',points:[p],color:$('board-color').value,width:Number($('board-width').value)||3};lastSegmentIndex=0;
}
function pointerMove(e){
 const p=logicalPoint(e);
 if(e.pointerType==='touch'&&panPointers.has(e.pointerId))panPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if((tool==='pan'||mobileGesture||panPointers.size>=2)){
   if(panPointers.size>=2&&pinchStart){
     const pts=[...panPointers.values()].slice(0,2),dist=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
     const cx=(pts[0].x+pts[1].x)/2,cy=(pts[0].y+pts[1].y)/2,stage=$('board-stage-scroll');
     setZoom(pinchStart.zoom*(dist/pinchStart.distance));
     if(stage){stage.scrollLeft=pinchStart.left-(cx-pinchStart.centerX);stage.scrollTop=pinchStart.top-(cy-pinchStart.centerY);}
     return;
   }
   if(panDrag){const stage=$('board-stage-scroll');if(stage){stage.scrollLeft=panDrag.left-(e.clientX-panDrag.clientX);stage.scrollTop=panDrag.top-(e.clientY-panDrag.clientY);}return;}
 }
 if(tool==='laser'&&room?.board?.can_manage){
   const now=Date.now();if(now-lastLaserSent>=60){lastLaserSent=now;sendOps([{kind:'laser',pageId:currentPageId,x:p[0],y:p[1]}]);}
   return;
 }
 if(resizeState){
   const rs=resizeState,aspect=rs.aspect,rawW=Math.max(1,Math.abs(p[0]-rs.anchorX)),rawH=Math.max(1,Math.abs(p[1]-rs.anchorY));
   let w=rawW,h=rawW/aspect;if(rawH>h){h=rawH;w=h*aspect;}
   const scale=Math.min(1,3000/Math.max(w,h));w=Math.max(40,Math.round(w*scale));h=Math.max(40,Math.round(h*scale));
   if(w/h>aspect){h=Math.max(40,Math.round(w/aspect));}else w=Math.max(40,Math.round(h*aspect));
   const right=rs.handle.includes('e'),bottom=rs.handle.includes('s');
   const resized={...cloneObject(rs.before),w,h,x:right?rs.anchorX:rs.anchorX-w,y:bottom?rs.anchorY:rs.anchorY-h};
   objects.set(resized.id,resized);scheduleRender();return;
 }
 if(dragState){
   const dx=p[0]-dragState.start[0],dy=p[1]-dragState.start[1],moved=translateObject(dragState.before,dx,dy);
   objects.set(moved.id,moved);scheduleRender();return;
 }
 if(!drawing)return;
 if(drawing.type!=='stroke'){drawing.x2=p[0];drawing.y2=p[1];scheduleRender();return;}
 const samples=coalescedLogicalPoints(e);let added=0;
 for(const point of samples){const last=drawing.points[drawing.points.length-1];if(Math.hypot(point[0]-last[0],point[1]-last[1])<1.5)continue;drawing.points.push(point);added++;}
 if(!added)return;
 if(drawing.points.length-lastSegmentIndex>=6){const pts=drawing.points.slice(lastSegmentIndex);lastSegmentIndex=drawing.points.length-1;sendOps([{kind:'stroke_segment',pageId:drawing.pageId,objectId:drawing.id,points:pts,color:drawing.color,width:drawing.width}]);}
 scheduleRender();
}
function cancelPointerInteraction(e){
 if(e?.pointerType==='touch')panPointers.delete(e.pointerId);
 if(drawing?.type==='stroke')sendOps([{kind:'stroke_cancel',pageId:drawing.pageId,objectId:drawing.id}]);
 drawing=null;dragState=null;resizeState=null;panDrag=null;pinchStart=null;
 if(panPointers.size===0)mobileGesture=false;
 scheduleRender();
}
function pointerUp(e){
 if(e?.pointerType==='touch')panPointers.delete(e.pointerId);
 if(tool==='pan'||mobileGesture){
   if(panPointers.size<2)pinchStart=null;
   if(panDrag?.pointerId===e?.pointerId)panDrag=null;
   if(panPointers.size===1&&tool==='pan'){const [id,p]=[...panPointers.entries()][0],stage=$('board-stage-scroll');panDrag={pointerId:id,clientX:p.x,clientY:p.y,left:stage?.scrollLeft||0,top:stage?.scrollTop||0};}
   if(panPointers.size===0)mobileGesture=false;
   return;
 }
 if(resizeState){
   const after=objects.get(resizeState.id),before=resizeState.before;resizeState=null;
   if(after&&JSON.stringify(after)!==JSON.stringify(before)){sendOps([{kind:'put',object:after}]);remember({kind:'update',before,after:cloneObject(after)});}
   scheduleRender();return;
 }
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
 manualExit=true;if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}tool='pen';
 if(ws)try{ws.onclose=null;ws.close(1000,'exit')}catch{};ws=null;room=null;activeBoard=null;activeAccessCode='';reconnectAttempts=0;
 stopHeartbeat();roomTokenExpiresAt=0;tokenRefreshAttempts=0;currentPageId='';userLocked=false;snapshotLoading=false;selectedObjectId='';participantsCache=[];blockedUsers=[];imageCache.clear();renderBlockedUsers();renderSelectedOwner(null);pendingReliable.clear();dragState=null;resizeState=null;panDrag=null;panPointers.clear();pinchStart=null;mobileGesture=false;remoteLasers.clear();zoomLevel=1;aiResultText='';aiClusterPlan=null;timerState=null;followTeacher=true;if(timerTick){clearInterval(timerTick);timerTick=null;}undoStack=[];redoStack=[];objects.clear();remoteStrokes.clear();drawing=null;const roomEl=$('board-room');roomEl?.classList.remove('board-pseudo-fullscreen');document.body.classList.remove('board-body-fullscreen');roomEl?.classList.add('hidden');$('boards-home')?.classList.remove('hidden');
}

export function resetInteractiveBoards(){generation++;list=[];actor=null;manage=false;canCreateBoard=false;page=1;total=0;exitRoom();}
export function initInteractiveBoards(user){
 actor=user||null;const role=String(actor?.role||'').toLowerCase(),aud=String(actor?.target_audience||'').toLowerCase();
 const isAdmin=role==='admin'||aud==='quản trị viên';
 const isTeacher=role==='teacher'||role==='giáo viên'||aud==='giáo viên';
 manage=isAdmin||isTeacher;
 canCreateBoard=isAdmin||(isTeacher&&vipFlag(actor?.is_vip));
 $('boards-new')?.classList.toggle('hidden',!manage);load();
}
export function connectInteractiveBoards(){
 if(wired||!$('boards-list'))return;wired=true;installBoardButtonHelp();
 $('boards-new')?.addEventListener('click',()=>openEdit());
 $('boards-reload')?.addEventListener('click',()=>load());
 $('boards-prev')?.addEventListener?.('click',()=>{});
 $('boards-pagination')?.addEventListener('click',e=>{if(e.target.id==='boards-prev'&&page>1){page--;load()}if(e.target.id==='boards-next'&&page*20<total){page++;load()}});
 $('boards-list')?.addEventListener('click',e=>{const enter=e.target.closest('[data-board-enter]'),edit=e.target.closest('[data-board-edit]'),del=e.target.closest('[data-board-delete]');if(enter){const b=list.find(x=>x.id===enter.dataset.boardEnter);if(b)join(b);}if(edit)openEdit(edit.dataset.boardEdit);if(del){const b=list.find(x=>x.id===del.dataset.boardDelete);if(!b)return;const go=async()=>{try{await api('DELETE','/api/boards?id='+encodeURIComponent(b.id));feedback('Đã xóa bảng.');load();}catch(err){feedback(err.message,true)}};window.showConfirmModal?.('Xóa bảng “'+b.name+'”?',go);}});
 $('board-edit-close')?.addEventListener('click',closeEdit);$('board-edit-cancel')?.addEventListener('click',closeEdit);
 $('board-edit-form')?.elements.namedItem('access_mode')?.addEventListener('change',toggleAccessFields);
 $('board-edit-form')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,fd=new FormData(f);const id=fd.get('id');const body={id,revision:Number(fd.get('revision'))||undefined,name:fd.get('name'),description:fd.get('description'),status:fd.get('status'),access_mode:fd.get('access_mode'),student_permission:fd.get('student_permission'),max_participants:Number(fd.get('max_participants'))||60,target_donvi:fd.get('target_donvi'),target_lop:fd.get('target_lop'),access_code:fd.get('access_code'),starts_at:fd.get('starts_at')?new Date(String(fd.get('starts_at'))).toISOString():null,ends_at:fd.get('ends_at')?new Date(String(fd.get('ends_at'))).toISOString():null};const btn=f.querySelector('[type=submit]');btn.disabled=true;try{await api(id?'PUT':'POST','/api/boards',body);closeEdit();feedback('Đã lưu bảng tương tác.');load();}catch(err){feedback(err.message,true)}finally{btn.disabled=false;}});
 $('board-code-cancel')?.addEventListener('click',closeCode);$('board-code-form')?.addEventListener('submit',e=>{e.preventDefault();const b=pendingBoard,code=e.currentTarget.elements.namedItem('access_code').value;closeCode();if(b)join(b,code);});
 document.querySelectorAll('[data-board-tool]').forEach(btn=>btn.addEventListener('click',()=>selectBoardTool(btn.dataset.boardTool)));syncBoardToolButtons();
 canvas()?.addEventListener('pointerdown',pointerDown);canvas()?.addEventListener('pointermove',pointerMove);canvas()?.addEventListener('pointerup',pointerUp);canvas()?.addEventListener('pointercancel',cancelPointerInteraction);
 $('board-exit')?.addEventListener('click',exitRoom);
 $('board-participants-toggle')?.addEventListener('click',()=>{
   const panel=$('board-participants-panel'),btn=$('board-participants-toggle');if(!panel||!btn)return;
   const collapsed=panel.classList.toggle('is-mobile-collapsed');btn.setAttribute('aria-expanded',collapsed?'false':'true');
   if(!collapsed)panel.scrollIntoView?.({behavior:'smooth',block:'nearest'});
 });
 $('board-insert-image')?.addEventListener('click',()=>{if(!room?.board?.can_manage)return;pendingBoardImageMode='object';$('board-image-input')?.click();});
 $('board-background-image')?.addEventListener('click',()=>{if(!room?.board?.can_manage)return;pendingBoardImageMode='background';$('board-image-input')?.click();});
 $('board-clear-background-image')?.addEventListener('click',()=>{if(!room?.board?.can_manage)return;window.showConfirmModal?.('Gỡ ảnh nền của trang hiện tại?',()=>setPageBackgroundImage(''));});
 $('board-image-input')?.addEventListener('change',e=>{const file=e.target.files?.[0];if(file)handleBoardImageFile(file,pendingBoardImageMode);});
 $('board-export-image')?.addEventListener('click',async()=>{
   const pageInfo=(room?.pages||[]).find(p=>String(p.id)===String(currentPageId));if(!pageInfo)return;
   const pageObjects=[...objects.values()].filter(o=>o.pageId===currentPageId);
   const out=await renderObjectsToCanvas(pageInfo,pageObjects);
   out.toBlob(blob=>{if(!blob)return;const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(room?.board?.name||'bang-tuong-tac').replace(/[^\p{L}\p{N}._-]+/gu,'-')+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);},'image/png');
 });
 $('board-bring-here')?.addEventListener('click',()=>{if(room?.board?.can_manage)sendOps([{kind:'present_page',pageId:currentPageId}]);});
 $('board-follow-teacher')?.addEventListener('click',()=>{followTeacher=!followTeacher;const btn=$('board-follow-teacher');if(btn)btn.textContent='Theo GV: '+(followTeacher?'Bật':'Tắt');refreshBoardButtonHelp($('tab-boards'));});
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
 $('board-fullscreen')?.addEventListener('click',async()=>{
 const roomEl=$('board-room');if(!roomEl)return;
 try{
  if(document.fullscreenElement){await document.exitFullscreen?.();roomEl.classList.remove('board-pseudo-fullscreen');document.body.classList.remove('board-body-fullscreen');return;}
  if(roomEl.requestFullscreen){await roomEl.requestFullscreen();return;}
  roomEl.classList.toggle('board-pseudo-fullscreen');
  document.body.classList.toggle('board-body-fullscreen',roomEl.classList.contains('board-pseudo-fullscreen'));
 }catch{
  roomEl.classList.toggle('board-pseudo-fullscreen');
  document.body.classList.toggle('board-body-fullscreen',roomEl.classList.contains('board-pseudo-fullscreen'));
 }
});
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
 $('board-participants-panel')?.addEventListener('click',e=>{
   const lockBtn=e.target.closest('[data-board-user-lock]'),clearBtn=e.target.closest('[data-board-user-clear]'),blockBtn=e.target.closest('[data-board-user-block]'),unblockBtn=e.target.closest('[data-board-user-unblock]');
   if(!room?.board?.can_manage)return;
   if(lockBtn)sendOps([{kind:'set_user_lock',targetUserId:lockBtn.dataset.boardUserLock,blocked:lockBtn.dataset.blocked!=='1'}]);
   if(clearBtn)window.showConfirmModal?.('Xóa toàn bộ đóng góp của học sinh này trên trang hiện tại?',()=>sendOps([{kind:'clear_user_objects',targetUserId:clearBtn.dataset.boardUserClear,pageId:currentPageId}]));
   if(blockBtn)window.showConfirmModal?.('Chặn tài khoản học sinh này khỏi bảng? Học sinh sẽ bị đưa ra khỏi bảng và không thể vào lại cho tới khi mở chặn.',()=>setPersistentBlock(blockBtn.dataset.boardUserBlock,true));
   if(unblockBtn)setPersistentBlock(unblockBtn.dataset.boardUserUnblock,false);
 });
 const boardShortcutHandler=e=>{
   if(!$('board-room')||$('board-room').classList.contains('hidden'))return;
   const tag=String(e.target?.tagName||'').toLowerCase();if(['input','textarea','select'].includes(tag))return;
   const mod=e.ctrlKey||e.metaKey;
   if(mod&&String(e.key).toLowerCase()==='z'){e.preventDefault();undo();return;}
   if(mod&&String(e.key).toLowerCase()==='y'){e.preventDefault();redo();return;}
   if((e.key==='Delete'||e.key==='Backspace')&&selectedObjectId){e.preventDefault();$('board-delete-selected')?.click();return;}
   if(mod&&String(e.key).toLowerCase()==='d'&&selectedObjectId){e.preventDefault();$('board-duplicate-selected')?.click();return;}
   if(e.key==='Escape'&&selectedObjectId){e.preventDefault();clearSelection();return;}
   if(e.key==='+'||e.key==='='){e.preventDefault();setZoom(zoomLevel+.1);return;}
   if(e.key==='-'){e.preventDefault();setZoom(zoomLevel-.1);return;}
   if(e.key==='0'){e.preventDefault();resetView();return;}
 };
 window.addEventListener('keydown',boardShortcutHandler);
  $('board-undo')?.addEventListener('click',undo);$('board-redo')?.addEventListener('click',redo);
  $('board-duplicate-selected')?.addEventListener('click',()=>{
    const original=selectedObject();if(!original||!canEdit())return;
    const copy=cloneObject(original);copy.id=crypto.randomUUID();copy.creatorId=myId();copy.voteCount=0;
    const shifted=translateObject(copy,28,28);objects.set(shifted.id,shifted);selectedObjectId=shifted.id;
    sendOps([{kind:'put',object:shifted}]);remember({kind:'put',object:shifted});scheduleRender();syncSelectionButtons();
  });
  function reorderSelectedImage(direction){
    const current=selectedObject();if(!current||current.type!=='image'||!room?.board?.can_manage)return;
    const images=sortImagesForLayer([...objects.values()].filter(o=>o.pageId===currentPageId));
    const idx=images.findIndex(o=>o.id===current.id),targetIdx=idx+(direction>0?1:-1);
    if(idx<0||targetIdx<0||targetIdx>=images.length)return;
    const target=images[targetIdx],beyondIdx=targetIdx+(direction>0?1:-1),beyond=images[beyondIdx]||null;
    const targetZ=imageLayerValue(target),beyondZ=beyond?imageLayerValue(beyond):null;
    let nextZ;
    if(direction>0)nextZ=beyond?targetZ+(beyondZ-targetZ)/2:targetZ+10;
    else nextZ=beyond?targetZ-(targetZ-beyondZ)/2:targetZ-10;
    if(!Number.isFinite(nextZ)||nextZ===imageLayerValue(current))nextZ=targetZ+(direction>0?.5:-.5);
    const before=cloneObject(current),after={...cloneObject(current),z:nextZ};
    objects.set(after.id,after);sendOps([{kind:'put',object:after}]);remember({kind:'update',before,after:cloneObject(after)});
    scheduleRender();syncSelectionButtons();
  }
  $('board-image-layer-up')?.addEventListener('click',()=>reorderSelectedImage(1));
  $('board-image-layer-down')?.addEventListener('click',()=>reorderSelectedImage(-1));
  $('board-lock-selected')?.addEventListener('click',()=>{
    const current=selectedObject();if(!current||!room?.board?.can_manage)return;
    const before=cloneObject(current),after={...cloneObject(current),locked:!Boolean(current.locked)};
    objects.set(after.id,after);sendOps([{kind:'put',object:after}]);remember({kind:'update',before,after:cloneObject(after)});
    dragState=null;resizeState=null;scheduleRender();syncSelectionButtons();
  });
  $('board-delete-selected')?.addEventListener('click',()=>{
    const target=selectedObject();if(!target||!canEdit()||target.locked)return;
    if(!room.board.can_manage&&String(target.creatorId||'')!==myId())return;
    sendOps([{kind:'delete',pageId:target.pageId,objectId:target.id}]);objects.delete(target.id);remember({kind:'delete',object:target});selectedObjectId='';syncSelectionButtons();scheduleRender();
  });
  syncHistoryButtons();
}
