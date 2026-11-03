import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { buildQrCardPayload, parseQrCardPayload, answerFromQrLocation } from './qr-card-orientation.js';

const $ = id => document.getElementById(id);
let actor = null;
let wired = false;
let bootstrapData = { classes: [], exams: [], default_donvi: '' };
let roster = [];
let session = null;
let questionIndex = 0;
let stream = null;
let cameraFacing = 'environment';
let scanActive = false;
let scanTimer = null;
let frameBusy = false;
let offscreen = null;
let offctx = null;
let tracking = new Map();
let questionAnswers = new Map();
let pendingRecords = new Map();
let flushTimer = null;
let showMissingOnly = false;
let lastDetections = [];
let pendingVisualAnswers = new Map();
let lastSaveError = '';
let saveInFlight = false;
let retryCounts = new Map();
let activeSessions = [];
let deviceRole = '';
let syncTimer = null;
let syncBusy = false;
let lastSyncVersion = '';
let stateRevision = 0;
let collectionState = 'collecting';
let lastStateAt = 0;
let mobileScannerMode = false;
let barcodeDetector = null;
let nativeQrSupported = false;
let scanCycle = 0;
let lastFrameDuration = 0;
let cameraTrack = null;
let tileCanvas = null;
let tileCtx = null;
let presenterQuestionFontSize = 24;
let presenterAnswerFontSize = 20;
let scanWorker = null;
let scanWorkerBusy = false;
let fallbackFrameId = 0;
let lastFallbackDuration = 0;
let scanMode = 'auto';
let cameraCapabilities = {};
let currentZoom = 1;
let torchEnabled = false;
let detectionMemory = new Map();
let cameraEpoch = 0;

function isMobileScannerViewport(){
  return window.matchMedia?.('(max-width: 767px)')?.matches || window.innerWidth <= 767;
}
function detectionArea(location){
  if(!location)return 0;
  const a=location.topLeftCorner,b=location.topRightCorner,d=location.bottomLeftCorner;
  if(!a||!b||!d)return 0;
  return Math.abs((b.x-a.x)*(d.y-a.y)-(b.y-a.y)*(d.x-a.x));
}
function rememberDetections(items,ttl=520){
  const now=performance.now();
  for(const d of items||[])if(d?.cardToken)detectionMemory.set(String(d.cardToken),{d,at:now});
  for(const [key,value] of detectionMemory)if(now-Number(value.at||0)>ttl)detectionMemory.delete(key);
  return dedupeDetections([...detectionMemory.values()].map(x=>x.d));
}
function scanRemainingCount(){
  const q=currentQuestion();
  const saved=q?answersForQuestion(q.id).size:0;
  return Math.max(0,Number(session?.students?.length||0)-saved);
}
function ensureScanWorker(){
  if(scanWorker)return scanWorker;
  try{
    scanWorker=new Worker(new URL('./qr-scan-worker.js',import.meta.url),{type:'module'});
    scanWorker.onmessage=e=>{
      const msg=e.data||{};
      scanWorkerBusy=false;
      if(msg.type!=='decoded'||!scanActive||deviceRole!=='scanner')return;
      if(Number(msg.cameraEpoch)!==cameraEpoch)return;
      if(String(msg.sessionId||'')!==String(session?.id||''))return;
      if(String(msg.questionId||'')!==String(currentQuestion()?.id||''))return;
      if(Number(msg.stateRevision)!==Number(stateRevision))return;
      if(collectionState!=='collecting')return;
      lastFallbackDuration=Math.max(0,Number(msg.durationMs)||0);
      const video=$('qr-card-video');
      if(!video?.videoWidth)return;
      const sx=video.videoWidth/Math.max(1,Number(msg.width)||1),sy=video.videoHeight/Math.max(1,Number(msg.height)||1);
      const mapped=(msg.detections||[]).map(d=>({...d,location:{
        topLeftCorner:{x:d.location.topLeftCorner.x*sx,y:d.location.topLeftCorner.y*sy},
        topRightCorner:{x:d.location.topRightCorner.x*sx,y:d.location.topRightCorner.y*sy},
        bottomRightCorner:{x:d.location.bottomRightCorner.x*sx,y:d.location.bottomRightCorner.y*sy},
        bottomLeftCorner:{x:d.location.bottomLeftCorner.x*sx,y:d.location.bottomLeftCorner.y*sy}
      }}));
      if(mapped.length)processDetections(mapped,Number(msg.cycle)||0);
      const merged=rememberDetections(mapped);
      drawOverlay(merged,video.videoWidth,video.videoHeight);
      updateScannerPerfBadge(merged.length);
    };
    scanWorker.onerror=()=>{scanWorkerBusy=false;try{scanWorker?.terminate();}catch{}scanWorker=null;};
  }catch{scanWorker=null;}
  return scanWorker;
}
function updateScannerPerfBadge(count=0){
  const el=$('qr-card-fps-status');if(!el)return;
  const video=$('qr-card-video'),settings=cameraTrack?.getSettings?.()||{};
  const width=Number(settings.width||video?.videoWidth||0),height=Number(settings.height||video?.videoHeight||0);
  const engine=nativeQrSupported?'Hybrid':'jsQR';
  const ms=Math.round(Math.max(lastFrameDuration,lastFallbackDuration)||0);
  el.textContent=count+' thẻ · '+engine+(ms?' · '+ms+'ms':'')+(width&&height?' · '+width+'×'+height:'')+(currentZoom>1.01?' · '+currentZoom.toFixed(1)+'×':'');
}
function setScanMode(mode){
  scanMode=mode==='far'?'far':'auto';
  $('qr-card-mode-auto')?.classList.toggle('is-active',scanMode==='auto');
  $('qr-card-mode-far')?.classList.toggle('is-active',scanMode==='far');
  if(scanMode==='far'&&cameraCapabilities?.zoom?.max){
    const min=Number(cameraCapabilities.zoom.min||1),max=Number(cameraCapabilities.zoom.max||1);
    const target=Math.min(max,Math.max(min,1.45));
    void applyCameraZoom(target);
  }else if(scanMode==='auto'&&cameraCapabilities?.zoom?.min){
    void applyCameraZoom(Math.max(1,Number(cameraCapabilities.zoom.min||1)));
  }
}
async function applyCameraZoom(value){
  if(!cameraTrack||!cameraCapabilities?.zoom)return;
  const cap=cameraCapabilities.zoom,min=Number(cap.min||1),max=Number(cap.max||1);
  const next=Math.max(min,Math.min(max,Number(value)||min));
  try{
    await cameraTrack.applyConstraints({advanced:[{zoom:next}]});
    currentZoom=Number(cameraTrack.getSettings?.().zoom||next);
    const slider=$('qr-card-zoom'),label=$('qr-card-zoom-value');
    if(slider)slider.value=String(currentZoom);
    if(label)label.textContent=currentZoom.toFixed(1)+'×';
    updateScannerPerfBadge(lastDetections.length);
  }catch{}
}
async function toggleTorch(){
  if(!cameraTrack||!cameraCapabilities?.torch)return;
  try{
    torchEnabled=!torchEnabled;
    await cameraTrack.applyConstraints({advanced:[{torch:torchEnabled}]});
    const btn=$('qr-card-torch');
    if(btn){btn.classList.toggle('is-active',torchEnabled);btn.textContent=torchEnabled?'🔦 Đèn bật':'🔦 Đèn';}
  }catch{torchEnabled=false;}
}
function applyMobileScannerMode(){
  mobileScannerMode=isMobileScannerViewport();
  const root=$('tab-qr-cards');
  root?.classList.toggle('qr-mobile-scanner-mode',mobileScannerMode);
  document.querySelectorAll('.qr-mobile-only').forEach(el=>el.classList.toggle('hidden',!mobileScannerMode));
  document.querySelectorAll('.qr-desktop-only').forEach(el=>el.classList.toggle('hidden',mobileScannerMode));
}
function authToken() {
  return localStorage.getItem(window.tenantStorageKey ? window.tenantStorageKey('auth_token') : 'auth_token') || '';
}
async function api(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(authToken() ? { Authorization: 'Bearer ' + authToken() } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store'
  });
  const data = await response.json().catch(() => ({ error: 'Máy chủ không trả JSON hợp lệ.' }));
  if (!response.ok) {
    const err = Error(data.error || 'Không thể thực hiện thao tác.');
    err.code = data.code;
    err.status = response.status;
    throw err;
  }
  return data;
}
function feedback(message, error = false) {
  const el = $('qr-card-feedback');
  if (!el) return;
  el.textContent = message;
  el.className = 'rounded-xl p-3 text-sm ' + (error ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800');
}
function selectedClass() {
  const select = $('qr-card-class');
  const option = select?.selectedOptions?.[0];
  return {
    className: String(option?.dataset.className || ''),
    donvi: String(option?.dataset.donvi || '')
  };
}
function currentQuestion() {
  return session?.questions?.[questionIndex] || null;
}
function stopSyncLoop(){
  if(syncTimer){clearTimeout(syncTimer);syncTimer=null;}
  syncBusy=false;
  lastSyncVersion='';
}
function scheduleSync(delay=450){
  if(!session||!deviceRole)return;
  if(syncTimer)clearTimeout(syncTimer);
  syncTimer=setTimeout(syncSessionState,delay);
}
function setSyncBadge(ok=true){
  const ids=deviceRole==='presenter'?['qr-presenter-sync']:['qr-scanner-sync'];
  for(const id of ids){
    const el=$(id);if(!el)continue;
    el.textContent=ok?'Đã đồng bộ':'Đang kết nối lại…';
    el.className='rounded-full px-3 py-1.5 text-xs font-black '+(ok?'bg-emerald-100 text-emerald-800':'bg-amber-100 text-amber-800');
  }
}
function applyRemoteState(state){
  if(!state||state.unchanged)return;
  lastStateAt=Date.now();
  stateRevision=Number(state.state_revision||0);
  collectionState=String(state.collection_state||'collecting');
  const nextIndex=Math.max(0,Number(state.current_question_index||0));
  const changed=nextIndex!==questionIndex||String(state.current_question_id||'')!==String(currentQuestion()?.id||'');
  questionIndex=nextIndex;
  if(session){
    session.current_question_index=nextIndex;
    session.current_question_id=state.current_question_id;
    session.collection_state=collectionState;
    session.state_revision=stateRevision;
    session.response_revision=Number(state.response_revision||0);
  }
  if(changed){
    tracking.clear();
    detectionMemory.clear();
    lastDetections=[];
    pendingRecords.clear();
    pendingVisualAnswers.clear();
    retryCounts.clear();
    clearPersistedPendingQueue();
    setPhoneSaveState(collectionState==='locked'?'locked':'idle');
  }
  const q=state.current_question||currentQuestion();
  if(q){
    const map=answersForQuestion(q.id);map.clear();
    for(const row of state.responses||[]){
      const uid=String(row.user_id),answer=String(row.answer||'').toUpperCase();
      map.set(uid,answer);
      pendingVisualAnswers.delete(pendingAnswerKey(q.id,uid));
    }
  }
  if(deviceRole==='presenter')renderPresenterState(state);
  if(deviceRole==='scanner')renderScannerState(state);
}
async function syncSessionState(){
  if(!session||!deviceRole||syncBusy)return scheduleSync(500);
  syncBusy=true;
  try{
    const url='/api/qr-cards?action=session-state&id='+encodeURIComponent(session.id)+(lastSyncVersion?'&since='+encodeURIComponent(lastSyncVersion):'');
    const result=await api('GET',url);
    const data=result.data||{};
    if(data.version)lastSyncVersion=String(data.version);
    if(data.status&&data.status!=='open'){
      stopCamera();stopSyncLoop();deviceRole='';
      feedback(data.status==='finalized'?'Phiên quét đã được chốt và lưu kết quả.':'Phiên quét đang kết thúc.');
      return;
    }
    applyRemoteState(data);
    setSyncBadge(true);
  }catch(e){
    console.warn('QR session sync failed',e);
    setSyncBadge(false);
  }finally{
    syncBusy=false;
    if(session&&deviceRole)scheduleSync(document.hidden?1200:450);
  }
}
function optionText(options, key) {
  if (!options) return '';
  if (Array.isArray(options)) {
    const idx = ['A','B','C','D'].indexOf(key);
    const value = options[idx];
    return typeof value === 'object' ? String(value?.text ?? value?.content ?? '') : String(value ?? '');
  }
  const value = options[key] ?? options[key.toLowerCase()] ?? options['option' + key] ?? '';
  return typeof value === 'object' ? String(value?.text ?? value?.content ?? '') : String(value ?? '');
}
function optionData(options,key) {
  if (!options) return { text:'', image:'' };
  let value;
  if (Array.isArray(options)) {
    const idx=['A','B','C','D'].indexOf(key);
    value=options[idx];
  } else value=options[key] ?? options[key.toLowerCase()] ?? options['option'+key] ?? '';
  if (value && typeof value === 'object') {
    return { text:String(value.text ?? value.content ?? ''), image:String(value.image ?? '') };
  }
  return { text:String(value ?? ''), image:'' };
}
function rich(value) {
  const raw = String(value ?? '');
  try {
    if (typeof window.renderScientificContent === 'function') return window.renderScientificContent(raw);
  } catch {}
  const div = document.createElement('div');
  div.textContent = raw;
  return div.innerHTML;
}
function queueScientificMath(root){
  try {
    if (root && typeof window.queueMathJax === 'function') window.queueMathJax(root);
  } catch {}
}
function presenterOptionGridClass(q){
  const keys=['A','B','C','D'];
  let hasImage=false,maxLen=0;
  for(const key of keys){
    const d=optionData(q?.options,key);
    if(d.image)hasImage=true;
    const len=String(d.text||'').replace(/<[^>]*>?/gm,'').replace(/&nbsp;/g,' ').length;
    if(len>maxLen)maxLen=len;
  }
  if(hasImage)return 'grid-cols-1';
  const visualLength=maxLen*(presenterAnswerFontSize/20);
  if(visualLength<25)return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';
  if(visualLength<80)return 'grid-cols-1 sm:grid-cols-2';
  return 'grid-cols-1';
}
function applyPresenterTypography(){
  const root=$('qr-card-presenter-workspace');
  if(!root)return;
  root.style.setProperty('--qr-presenter-q-size',presenterQuestionFontSize+'px');
  root.style.setProperty('--qr-presenter-a-size',presenterAnswerFontSize+'px');
  const qv=$('qr-presenter-question-size-value'),av=$('qr-presenter-answer-size-value');
  if(qv)qv.textContent=presenterQuestionFontSize+'px';
  if(av)av.textContent=presenterAnswerFontSize+'px';
  const qs=$('qr-presenter-question-size'),as=$('qr-presenter-answer-size');
  if(qs&&Number(qs.value)!==presenterQuestionFontSize)qs.value=String(presenterQuestionFontSize);
  if(as&&Number(as.value)!==presenterAnswerFontSize)as.value=String(presenterAnswerFontSize);
}
function populateBootstrap() {
  const classSelect = $('qr-card-class');
  const examSelect = $('qr-card-exam');
  if (classSelect) {
    classSelect.innerHTML = '<option value="">-- Chọn lớp --</option>' + (bootstrapData.classes || []).map((c, i) =>
      '<option value="' + i + '" data-class-name="' + esc(c.class_name) + '" data-donvi="' + esc(c.donvi || '') + '">' +
      esc((c.donvi ? c.donvi + ' · ' : '') + c.class_name) + '</option>'
    ).join('');
  }
  if (examSelect) {
    examSelect.innerHTML = '<option value="">-- Chọn đề thi --</option>' + (bootstrapData.exams || []).map(e =>
      '<option value="' + esc(e.id) + '">' + esc(e.name || e.id) + '</option>'
    ).join('');
  }
}
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
async function loadBootstrap() {
  applyMobileScannerMode();
  if(mobileScannerMode){
    bootstrapData={classes:[],exams:[],default_donvi:''};
    await loadActiveSessions();
    return;
  }
  const result = await api('GET', '/api/qr-cards?action=bootstrap');
  bootstrapData = result.data || { classes: [], exams: [] };
  populateBootstrap();
  await loadActiveSessions();
}
async function loadActiveSessions() {
  try {
    const result = await api('GET','/api/qr-cards?action=active-sessions');
    activeSessions = result.data || [];
    const select=$('qr-card-active-session');
    if(select){
      const current=select.value;
      select.innerHTML='<option value="">-- Chọn phiên đang mở --</option>'+activeSessions.map(x =>
        '<option value="'+esc(x.id)+'" data-code="'+esc(x.join_code||'')+'">'+
        esc((x.join_code?x.join_code+' · ':'')+(x.class_name||'')+' · '+(x.exam_name||''))+'</option>'
      ).join('');
      if(current&&activeSessions.some(x=>String(x.id)===String(current)))select.value=current;
      else if(activeSessions.length===1)select.value=String(activeSessions[0].id);
    }
  } catch(e) {
    console.warn('Cannot load active QR sessions',e);
  }
}
async function loadSession(sessionId) {
  const result=await api('GET','/api/qr-cards?action=session&id='+encodeURIComponent(sessionId));
  session=result.data||null;
  if(!session)throw Error('Không tải được phiên quét.');
  questionIndex=Math.max(0,Number(session.current_question_index||0));
  stateRevision=Number(session.state_revision||0);
  collectionState=String(session.collection_state||'collecting');
  questionAnswers.clear();
  for(const row of session.responses||[]){
    const qid=String(row.question_id||''),uid=String(row.user_id||'');
    if(!qid||!uid)continue;
    answersForQuestion(qid).set(uid,String(row.answer||'').toUpperCase());
  }
  return session;
}
async function loadRoster() {
  const { className, donvi } = selectedClass();
  if (!className) {
    roster = [];
    renderRoster();
    return;
  }
  try {
    const result = await api('GET', '/api/qr-cards?action=cards&class=' + encodeURIComponent(className) + '&donvi=' + encodeURIComponent(donvi));
    roster = result.data || [];
    renderRoster();
  } catch (e) {
    roster = [];
    renderRoster();
    feedback(e.message, true);
  }
}
function renderRoster() {
  const root = $('qr-card-roster');
  const count = $('qr-card-roster-count');
  if (count) count.textContent = roster.length + ' học sinh';
  if (!root) return;
  if (!roster.length) {
    root.innerHTML = '<div class="col-span-full text-center py-4 text-slate-500">Chưa có danh sách học sinh/thẻ trong lớp này.</div>';
    return;
  }
  root.innerHTML = roster.map(s => {
    const ready = !!s.card_token && Number(s.card_active ?? 1) !== 0;
    return '<div class="rounded-xl border bg-white p-3 flex items-center gap-3 min-w-0">' +
      '<span class="w-9 h-9 shrink-0 rounded-lg grid place-items-center font-black ' + (ready ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800') + '">' + (ready ? '✓' : '!') + '</span>' +
      '<div class="min-w-0 flex-1"><p class="font-bold text-slate-900 truncate">' + esc(s.full_name || '') + '</p>' +
      '<p class="text-xs text-slate-500 truncate">Mã HS: ' + esc(s.student_code || s.id) + '</p></div>' +
      '<span class="text-[11px] font-bold ' + (ready ? 'text-emerald-700' : 'text-amber-700') + '">' + (ready ? 'Đã có thẻ' : 'Chưa có thẻ') + '</span></div>';
  }).join('');
}
async function ensureCards() {
  const { className, donvi } = selectedClass();
  if (!className) return feedback('Hãy chọn lớp trước.', true);
  const btn = $('qr-card-sync');
  if (btn) btn.disabled = true;
  try {
    const result = await api('POST', '/api/qr-cards', { action: 'ensure-cards', className, donvi });
    roster = result.data || [];
    renderRoster();
    feedback('Đã tạo/đồng bộ thẻ QR cho ' + roster.length + ' học sinh.');
  } catch (e) {
    feedback(e.message, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function ensureRosterForPrint() {
  const { className } = selectedClass();
  if (!className) throw Error('Hãy chọn lớp trước.');
  if (!roster.length || roster.some(s => !s.card_token)) await ensureCards();
  if (!roster.length || roster.some(s => !s.card_token)) throw Error('Không thể tạo đủ thẻ cho lớp.');
}
async function printCards() {
  const popup = window.open('', '_blank');
  if (!popup) return feedback('Trình duyệt đang chặn cửa sổ in. Hãy cho phép popup rồi thử lại.', true);
  try { popup.opener = null; } catch {}
  try {
    popup.document.write('<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Đang tạo thẻ...</title></head><body style="font-family:Arial,sans-serif;padding:30px;text-align:center"><h2>Đang tạo bộ thẻ QR…</h2><p>Không đóng cửa sổ này.</p></body></html>');
    popup.document.close();
    await ensureRosterForPrint();
    const { className, donvi } = selectedClass();
    const prepared = await Promise.all(roster.map(async s => {
      const payload = buildQrCardPayload(s.card_token);
      const dataUrl = await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 4, width: 640, color: { dark: '#000000', light: '#ffffff' } });
      return { ...s, dataUrl };
    }));
    const cards = prepared.map(s => `
      <article class="card">
        <div class="answer top">A</div><div class="answer right">B</div><div class="answer bottom">C</div><div class="answer left">D</div>
        <div class="identity"><strong>${escapePrint(s.full_name || '')}</strong><span>Mã HS: ${escapePrint(s.student_code || s.id)}</span><span>${escapePrint(className)}${donvi ? ' · ' + escapePrint(donvi) : ''}</span></div>
        <img class="qr" src="${s.dataUrl}" alt="QR ${escapePrint(s.student_code || s.id)}">
        <div class="brand">KTTT · Giơ thẻ với đáp án A/B/C/D quay lên trên</div>
      </article>`).join('');
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Thẻ trả lời ${escapePrint(className)}</title>
      <style>
      @page{size:A4 portrait;margin:8mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#0f172a}
      .sheet{display:grid;grid-template-columns:1fr 1fr;gap:6mm}.card{height:132mm;border:1.3mm solid #0f172a;border-radius:4mm;position:relative;overflow:hidden;break-inside:avoid;background:#fff}
      .qr{position:absolute;width:82mm;height:82mm;left:50%;top:54%;transform:translate(-50%,-50%);image-rendering:pixelated}
      .answer{position:absolute;font-size:14mm;font-weight:900;line-height:1;color:#0f172a;z-index:2}.top{top:4mm;left:50%;transform:translateX(-50%)}.bottom{bottom:4mm;left:50%;transform:translateX(-50%) rotate(180deg)}
      .left{left:3mm;top:50%;transform:translateY(-50%) rotate(-90deg)}.right{right:3mm;top:50%;transform:translateY(-50%) rotate(90deg)}
      .identity{position:absolute;top:13mm;left:17mm;right:17mm;text-align:center;z-index:3;background:#fff;padding:1.5mm;border-radius:2mm}.identity strong{display:block;font-size:4.5mm;text-transform:uppercase}.identity span{display:block;font-size:3.2mm;margin-top:.8mm}
      .brand{position:absolute;bottom:14mm;left:18mm;right:18mm;text-align:center;font-size:2.7mm;font-weight:700;background:#fff;padding:1mm;z-index:3}
      @media print{button{display:none}} .toolbar{grid-column:1/-1;text-align:center;margin-bottom:2mm}.toolbar button{font-size:16px;padding:10px 20px}
      </style></head><body><div class="sheet"><div class="toolbar"><button onclick="window.print()">🖨️ In thẻ A4</button></div>${cards}</div></body></html>`);
    popup.document.close();
  } catch (e) {
    try { popup.close(); } catch {}
    feedback(e.message, true);
  }
}
function escapePrint(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
async function startSession() {
  const { className, donvi } = selectedClass();
  const examId = $('qr-card-exam')?.value || '';
  if (!className || !examId) return feedback('Hãy chọn đúng lớp và đề thi trước khi bắt đầu.', true);
  const btn = $('qr-card-start');
  if (btn) btn.disabled = true;
  try {
    const result = await api('POST', '/api/qr-cards', { action: 'start-session', className, donvi, examId });
    session = result.data;
    questionIndex = 0;
    stateRevision=Number(session.state_revision||1);
    collectionState=String(session.collection_state||'collecting');
    tracking.clear();
    questionAnswers.clear();
    pendingRecords.clear();
    await enterPresenter(session);
    await loadActiveSessions();
    feedback('Đã tạo phiên '+(session.join_code||'')+'. Máy tính đang ở chế độ trình chiếu; mở điện thoại và chọn phiên này để quét.');
  } catch (e) {
    feedback(e.message, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function attachSelectedSession(role){
  const id=$('qr-card-active-session')?.value||'';
  if(!id)return feedback('Hãy chọn một phiên đang mở.',true);
  try{
    await loadSession(id);
    if(role==='presenter')await enterPresenter(session);
    else await enterScanner(session);
  }catch(e){feedback(e.message,true);}
}
async function enterPresenter(data){
  stopCamera();stopSyncLoop();deviceRole='presenter';session=data;
  $('qr-card-scan-workspace')?.classList.add('hidden');
  $('qr-card-presenter-workspace')?.classList.remove('hidden');
  lastSyncVersion='';
  renderPresenterBase();
  await syncSessionState();
  $('qr-card-presenter-workspace')?.scrollIntoView({behavior:'smooth',block:'start'});
}
async function enterScanner(data){
  stopSyncLoop();deviceRole='scanner';session=data;
  applyMobileScannerMode();
  $('qr-card-presenter-workspace')?.classList.add('hidden');
  $('qr-card-scan-workspace')?.classList.remove('hidden');
  if(mobileScannerMode){
    $('qr-card-session-picker')?.classList.add('hidden');
    $('qr-card-feedback')?.classList.add('hidden');
  }
  lastSyncVersion='';
  renderQuestion();
  renderScannerHeader();
  restorePendingQueue();
  if(pendingRecords.size){setPhoneSaveState('pending','Khôi phục '+pendingRecords.size+' đáp án chưa ACK');queueFlush();}
  await syncSessionState();
  $('qr-card-scan-workspace')?.scrollIntoView({behavior:'smooth',block:'start'});
}
function renderPresenterBase(){
  if(!session)return;
  if($('qr-presenter-exam'))$('qr-presenter-exam').textContent=session.exam_name||'Đề kiểm tra';
  if($('qr-presenter-class'))$('qr-presenter-class').textContent=(session.donvi?session.donvi+' · ':'')+(session.class_name||'');
  if($('qr-presenter-code'))$('qr-presenter-code').textContent=session.join_code||'------';
}
function renderScannerHeader(){
  if(!session)return;
  if($('qr-scanner-session-title'))$('qr-scanner-session-title').textContent=(session.class_name||'')+' · '+(session.exam_name||'');
  if($('qr-scanner-session-code'))$('qr-scanner-session-code').textContent='Mã phiên: '+(session.join_code||'------');
}
function renderPresenterQuestion(q,index,total){
  if($('qr-presenter-question-counter'))$('qr-presenter-question-counter').textContent='Câu '+(index+1)+'/'+Math.max(1,total);
  const content=$('qr-presenter-question-content');
  if(content)content.innerHTML='<span class="qr-presenter-question-prefix">Câu '+(index+1)+'/'+Math.max(1,total)+':</span> '+rich(q?.content||'')+
    (q?.image?'<div class="flex justify-center mt-3"><img src="'+esc(q.image)+'" alt="Question image" class="max-w-full h-auto rounded-xl shadow-md max-h-64 border border-gray-200"></div>':'');
  const options=$('qr-presenter-options');
  if(options){
    options.className='mt-5 grid '+presenterOptionGridClass(q)+' gap-2 w-full';
    options.innerHTML=['A','B','C','D'].map(key=>{
      const d=optionData(q?.options,key);
      return '<div class="qr-presenter-option group">'+
        '<div class="qr-presenter-option-content">'+
          '<span class="qr-presenter-option-label">'+key+'.</span>'+
          '<span class="qr-presenter-option-text">'+rich(d.text)+'</span>'+
          (d.image?'<div class="qr-presenter-option-image-wrap"><img src="'+esc(d.image)+'" alt="Option '+key+'" class="qr-presenter-option-image"></div>':'')+
        '</div></div>';
    }).join('');
  }
  applyPresenterTypography();
  queueScientificMath($('qr-card-presenter-workspace'));
}
function renderPresenterMonitor(state){
  const root=$('qr-presenter-response-list');
  const badge=$('qr-presenter-response-count');
  if(!root)return;
  const responses=Array.isArray(state?.responses)?state.responses:[];
  const students=Array.isArray(session?.students)?session.students:[];
  const responseByUser=new Map(responses.map(row=>[String(row.user_id||''),row]));
  const rows=students.length?students:responses.map(row=>({
    id:row.user_id,
    full_name:row.full_name,
    student_code:row.student_code
  }));
  if(badge)badge.textContent=responses.length+'/'+rows.length+' đã ghi nhận';
  if(!rows.length){
    root.innerHTML='<div class="qr-presenter-monitor-empty">Không có học sinh trong danh sách lớp.</div>';
    return;
  }
  root.innerHTML=rows.map((student,index)=>{
    const row=responseByUser.get(String(student.id||student.user_id||''));
    const recorded=Boolean(row);
    const answer=String(row?.answer||'').toUpperCase();
    const time=row?.updated_at?new Date(row.updated_at).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'';
    const fullName=String(student.full_name||row?.full_name||student.student_code||student.id||'Học sinh');
    const nameSize=fullName.length>30?9.5:(fullName.length>25?10.5:(fullName.length>20?11.5:12));
    return '<div class="qr-presenter-response-row '+(recorded?'is-recorded':'is-waiting')+'">'+
      '<span class="qr-presenter-student-order">'+String(index+1)+'</span>'+
      '<div class="qr-presenter-student-info min-w-0 flex-1"><p class="qr-presenter-student-name font-bold text-slate-900" style="font-size:'+nameSize+'px">'+esc(fullName)+'</p>'+
      '<p class="qr-presenter-student-meta text-[10px] '+(recorded?'text-emerald-700':'text-slate-500')+'">'+esc(student.student_code||row?.student_code||'')+(time?' · '+esc(time):'')+'</p></div>'+
      (recorded?'<span class="qr-presenter-answer-pill">'+esc(answer||'?')+'</span>':'')+
      (recorded?'<span class="qr-presenter-saved-pill">Đã ghi nhận</span>':'')+'</div>';
  }).join('');
}
function renderPresenterState(state){
  if(!session)return;
  renderPresenterBase();
  renderPresenterQuestion(state.current_question||currentQuestion(),Number(state.current_question_index||0),Number(state.question_count||session.questions?.length||0));
  const locked=String(state.collection_state||'collecting')==='locked';
  collectionState=locked?'locked':'collecting';
  const stateEl=$('qr-presenter-state');
  if(stateEl){
    stateEl.textContent=locked?'🔒 Đã khóa câu':'● Đang nhận đáp án';
    stateEl.className='rounded-full border px-3 py-1.5 text-sm font-black '+(locked?'bg-amber-100 border-amber-200 text-amber-800':'bg-emerald-100 border-emerald-200 text-emerald-800');
  }
  const answeredCount=Number(state.answered_count||0);
  const studentCount=Number(session.students?.length||0);
  if($('qr-presenter-progress'))$('qr-presenter-progress').textContent=String(answeredCount)+'/'+String(studentCount);
  const lockBtn=$('qr-presenter-lock');if(lockBtn)lockBtn.textContent=locked?'🔓 Mở lại câu':'🔒 Khóa câu';
  if($('qr-presenter-prev'))$('qr-presenter-prev').disabled=Number(state.current_question_index||0)<=0;
  if($('qr-presenter-next'))$('qr-presenter-next').disabled=Number(state.current_question_index||0)>=Number(state.question_count||1)-1;
  $('qr-presenter-after-lock')?.classList.toggle('hidden',!locked);
  if($('qr-presenter-missing-count'))$('qr-presenter-missing-count').textContent=String(Math.max(0,studentCount-answeredCount))+' học sinh chưa trả lời';
  for(const k of ['A','B','C','D']){const el=$('qr-presenter-count-'+k.toLowerCase());if(el)el.textContent=String(state.counts?.[k]||0);}
  renderPresenterMonitor(state);
}
function renderScannerState(state){
  if(!session)return;
  applyMobileScannerMode();
  renderScannerHeader();
  collectionState=String(state.collection_state||'collecting');
  const idx=Number(state.current_question_index||0);
  if(idx!==questionIndex)questionIndex=idx;
  renderQuestion();
  const badge=$('qr-scanner-collection-state');
  if(badge){
    const locked=collectionState==='locked';
    badge.textContent=locked?'ĐÃ KHÓA':'ĐANG NHẬN';
    badge.className='rounded-full px-3 py-1.5 text-xs font-black '+(locked?'bg-amber-500 text-slate-950':'bg-emerald-700 text-white');
  }
  if($('qr-card-progress'))$('qr-card-progress').textContent='Đã nhận '+String(state.answered_count||0)+'/'+String(session.students?.length||0);
  for(const k of ['A','B','C','D']){const el=$('qr-card-count-'+k.toLowerCase());if(el)el.textContent=String(state.counts?.[k]||0);}
  if(collectionState==='locked'){
    if($('qr-card-camera-status'))$('qr-card-camera-status').textContent='CÂU ĐÃ KHÓA · camera chỉ xem, không lưu';
    setPhoneSaveState('locked','Câu đã khóa trên máy tính · không lưu đáp án');
  }else{
    if(stream&&$('qr-card-camera-status'))$('qr-card-camera-status').textContent=
      cameraFacing==='environment'?'Camera sau · đang quét & lưu':'Camera trước · đang quét & lưu';
    if(!pendingRecords.size&&!saveInFlight)setPhoneSaveState('idle');
  }
  renderStudentStatus();
}
async function setCollectionState(next){
  if(!session||deviceRole!=='presenter')return;
  const result=await api('POST','/api/qr-cards',{action:'set-collection-state',sessionId:session.id,collectionState:next,expectedRevision:stateRevision});
  collectionState=next;
  stateRevision=Number(result.data?.state_revision||stateRevision+1);
  if(session){session.collection_state=next;session.state_revision=stateRevision;}
  lastSyncVersion='';scheduleSync(0);return result;
}
async function presenterNavigate(delta){
  if(!session||deviceRole!=='presenter')return;
  try{
    if(collectionState!=='locked')await setCollectionState('locked');
    const next=Math.max(0,Math.min((session.questions?.length||1)-1,questionIndex+delta));
    if(next===questionIndex)return;
    const result=await api('POST','/api/qr-cards',{action:'set-current-question',sessionId:session.id,index:next,expectedRevision:stateRevision});
    questionIndex=next;collectionState='collecting';
    stateRevision=Number(result.data?.state_revision||stateRevision+1);
    if(session){session.current_question_index=next;session.current_question_id=result.data?.current_question_id||session.questions?.[next]?.id;session.collection_state='collecting';session.state_revision=stateRevision;}
    lastSyncVersion='';scheduleSync(0);
  }catch(e){feedback(e.message,true);lastSyncVersion='';await syncSessionState();}
}
function answersForQuestion(questionId) {
  if (!questionAnswers.has(String(questionId))) questionAnswers.set(String(questionId), new Map());
  return questionAnswers.get(String(questionId));
}
function pendingAnswerKey(questionId,userId){return String(questionId)+'|'+String(userId);}
function pendingQueueStorageKey(sessionId){
  const base='qr_pending_ack_'+String(sessionId||'');
  return window.tenantStorageKey ? window.tenantStorageKey(base) : base;
}
function persistPendingQueue(){
  if(!session?.id)return;
  try{
    const payload=[...pendingRecords.entries()].map(([key,record])=>({key,record,retry:retryCounts.get(key)||0}));
    localStorage.setItem(pendingQueueStorageKey(session.id),JSON.stringify(payload));
  }catch{}
}
function restorePendingQueue(){
  if(!session?.id)return;
  try{
    const raw=localStorage.getItem(pendingQueueStorageKey(session.id));
    const list=JSON.parse(raw||'[]');
    if(!Array.isArray(list))return;
    const currentId=String(session.current_question_id||currentQuestion()?.id||'');
    for(const item of list){
      const record=item?.record;
      if(!record||String(record.questionId)!==currentId)continue;
      const student=session.students?.find(st=>String(st.card_token)===String(record.cardToken));
      if(!student)continue;
      const key=pendingAnswerKey(record.questionId,student.id);
      pendingRecords.set(key,record);
      pendingVisualAnswers.set(key,{answer:String(record.answer||'').toUpperCase(),at:Date.now()});
      retryCounts.set(key,Number(item?.retry||0));
    }
  }catch{}
}
function clearPersistedPendingQueue(){
  if(!session?.id)return;
  try{localStorage.removeItem(pendingQueueStorageKey(session.id));}catch{}
}
function setPhoneSaveState(state,message=''){
  const el=$('qr-card-save-status');if(!el)return;
  const styles={
    idle:'bg-slate-100 text-slate-700',
    pending:'bg-amber-100 text-amber-800',
    saving:'bg-blue-100 text-blue-800',
    saved:'bg-emerald-100 text-emerald-800',
    error:'bg-rose-100 text-rose-800',
    locked:'bg-amber-100 text-amber-900'
  };
  const labels={
    idle:'Chưa có đáp án mới',
    pending:'Đang chờ lưu…',
    saving:'Đang lưu lên server…',
    saved:'Đã lưu & đồng bộ',
    error:'Lưu thất bại',
    locked:'Câu đã khóa'
  };
  el.textContent=message||labels[state]||labels.idle;
  el.className='rounded-full px-3 py-1.5 text-xs font-black '+(styles[state]||styles.idle);
}
function clearPendingVisualForQuestion(questionId){
  const prefix=String(questionId)+'|';
  for(const key of [...pendingVisualAnswers.keys()])if(key.startsWith(prefix))pendingVisualAnswers.delete(key);
}
function renderQuestion() {
  const q = currentQuestion();
  if (!q || !session) return;
  const counter = $('qr-card-question-counter');
  if (counter) counter.textContent = 'Câu ' + (questionIndex + 1) + '/' + session.questions.length;
  const content = $('qr-card-question-content');
  if (content) content.innerHTML = rich(q.content || '');
  const options = $('qr-card-options');
  if (options) options.innerHTML = ['A','B','C','D'].map(key =>
    '<div class="rounded-xl border bg-white p-3 flex gap-2"><span class="shrink-0 w-8 h-8 rounded-lg bg-indigo-100 text-indigo-800 grid place-items-center font-black">' + key + '</span><div class="min-w-0 text-sm sm:text-base">' + rich(optionText(q.options, key)) + '</div></div>'
  ).join('');
  tracking.clear();
  updateStats();
  renderStudentStatus();
  updateNavButtons();
}
function updateNavButtons() {
  if ($('qr-card-prev-question')) $('qr-card-prev-question').disabled = questionIndex <= 0;
  if ($('qr-card-next-question')) $('qr-card-next-question').disabled = !session || questionIndex >= session.questions.length - 1;
}
function updateStats() {
  const q = currentQuestion();
  const map = q ? answersForQuestion(q.id) : new Map();
  const counts = { A:0, B:0, C:0, D:0 };
  for (const answer of map.values()) if (counts[answer] !== undefined) counts[answer]++;
  for (const k of ['A','B','C','D']) {
    const el = $('qr-card-count-' + k.toLowerCase());
    if (el) el.textContent = String(counts[k]);
  }
  if ($('qr-card-progress')) $('qr-card-progress').textContent = 'Đã nhận ' + map.size + '/' + (session?.students?.length || 0);
}
function renderStudentStatus() {
  const root = $('qr-card-student-status');
  if (!root || !session) return;
  const q = currentQuestion();
  const map = q ? answersForQuestion(q.id) : new Map();
  const rows = (session.students || []).filter(s => !showMissingOnly || !map.has(String(s.id)));
  if (!rows.length) {
    root.innerHTML = '<div class="rounded-xl bg-emerald-50 text-emerald-800 p-3 text-center font-bold">Đã nhận đủ học sinh.</div>';
    return;
  }
  root.innerHTML = rows.map(s => {
    const answer = map.get(String(s.id));
    const pending = pendingVisualAnswers.get(pendingAnswerKey(q?.id||'',s.id))?.answer || '';
    const shown=answer||pending;
    return '<div class="rounded-xl border bg-white p-2.5 flex items-center gap-2 min-w-0">' +
      '<span class="w-9 h-9 rounded-lg grid place-items-center shrink-0 font-black ' + (answer ? 'bg-emerald-100 text-emerald-800' : (pending ? 'bg-blue-100 text-blue-800':'bg-slate-100 text-slate-500')) + '">' + (shown || '…') + '</span>' +
      '<div class="min-w-0 flex-1"><p class="font-bold truncate">' + esc(s.full_name) + '</p><p class="text-xs text-slate-500 truncate">' + esc(s.student_code) + '</p></div>' +
      '<span class="shrink-0 text-[11px] font-bold '+(answer?'text-emerald-700':(pending?'text-blue-700':'text-slate-400'))+'">'+(answer?'Đã lưu':(pending?'Đang lưu':'Chưa nhận'))+'</span>'+
      (answer && collectionState==='collecting' ? '<button type="button" data-qr-clear="' + esc(s.id) + '" class="shrink-0 rounded-lg border px-2 py-1 text-xs text-slate-500">Sửa</button>' : '') + '</div>';
  }).join('');
}
async function initNativeQrDetector(){
  if(barcodeDetector || nativeQrSupported)return nativeQrSupported;
  try{
    if(!('BarcodeDetector' in window))return false;
    const formats=await window.BarcodeDetector.getSupportedFormats?.();
    if(Array.isArray(formats)&&!formats.includes('qr_code'))return false;
    barcodeDetector=new window.BarcodeDetector({formats:['qr_code']});
    nativeQrSupported=true;
    return true;
  }catch{
    barcodeDetector=null;
    nativeQrSupported=false;
    return false;
  }
}
function nativePoint(p){return p?{x:Number(p.x)||0,y:Number(p.y)||0}:null;}
function nativeLocation(code){
  const pts=Array.isArray(code?.cornerPoints)?code.cornerPoints.map(nativePoint).filter(Boolean):[];
  if(pts.length<4)return null;
  return {
    topLeftCorner:pts[0],
    topRightCorner:pts[1],
    bottomRightCorner:pts[2],
    bottomLeftCorner:pts[3]
  };
}
function dedupeDetections(items){
  const byToken=new Map();
  for(const d of items||[]){
    const token=String(d?.cardToken||'');
    if(!token)continue;
    const loc=d.location;
    const area=loc?Math.abs(
      (loc.topRightCorner.x-loc.topLeftCorner.x)*(loc.bottomLeftCorner.y-loc.topLeftCorner.y)-
      (loc.topRightCorner.y-loc.topLeftCorner.y)*(loc.bottomLeftCorner.x-loc.topLeftCorner.x)
    ):0;
    const prev=byToken.get(token);
    if(!prev||area>prev._area)byToken.set(token,{...d,_area:area});
  }
  return [...byToken.values()].map(({_area,...d})=>d);
}
function mapCropLocation(location,x0,y0,scale){
  if(!location)return null;
  const conv=p=>({x:x0+(Number(p.x)||0)/scale,y:y0+(Number(p.y)||0)/scale});
  return {
    topLeftCorner:conv(location.topLeftCorner),
    topRightCorner:conv(location.topRightCorner),
    bottomRightCorner:conv(location.bottomRightCorner),
    bottomLeftCorner:conv(location.bottomLeftCorner)
  };
}
function ensureTileCanvas(width,height){
  if(!tileCanvas){
    tileCanvas=document.createElement('canvas');
    tileCtx=tileCanvas.getContext('2d',{willReadFrequently:true});
  }
  if(tileCanvas.width!==width)tileCanvas.width=width;
  if(tileCanvas.height!==height)tileCanvas.height=height;
  tileCtx.imageSmoothingEnabled=false;
}
function cropCanvasImageData(sourceCanvas,x0,y0,w,h,upscale=1){
  const tw=Math.max(1,Math.round(w*upscale));
  const th=Math.max(1,Math.round(h*upscale));
  ensureTileCanvas(tw,th);
  tileCtx.clearRect(0,0,tw,th);
  tileCtx.drawImage(sourceCanvas,x0,y0,w,h,0,0,tw,th);
  return tileCtx.getImageData(0,0,tw,th);
}
function decodeJsQrTiles(sourceCanvas,imageData,maxCodes=32){
  const all=[];
  const full=decodeMultiple(imageData,Math.min(16,maxCodes));
  all.push(...full);
  if(all.length>=maxCodes)return dedupeDetections(all).slice(0,maxCodes);

  const cols=imageData.width>=1200?3:2;
  const rows=imageData.height>=700?3:2;
  const overlap=.20;
  const tileW=imageData.width/cols;
  const tileH=imageData.height/rows;
  const total=cols*rows;
  // Process a rotating subset each frame. This preserves coverage while keeping UI responsive.
  const perFrame=nativeQrSupported?3:Math.min(total,6);
  const offset=(scanCycle*perFrame)%total;
  for(let n=0;n<perFrame&&all.length<maxCodes;n++){
    const idx=(offset+n)%total;
    const ry=Math.floor(idx/cols),cx=idx%cols;
    const x0=Math.max(0,Math.floor(cx*tileW-tileW*overlap/2));
    const y0=Math.max(0,Math.floor(ry*tileH-tileH*overlap/2));
    const x1=Math.min(imageData.width,Math.ceil((cx+1)*tileW+tileW*overlap/2));
    const y1=Math.min(imageData.height,Math.ceil((ry+1)*tileH+tileH*overlap/2));
    const w=x1-x0,h=y1-y0;
    const upscale=imageData.width>=1400?1.8:1.45;
    const tile=cropCanvasImageData(sourceCanvas,x0,y0,w,h,upscale);
    const found=decodeMultiple(tile,6);
    for(const d of found){
      all.push({...d,location:mapCropLocation(d.location,x0,y0,upscale)});
    }
  }
  return dedupeDetections(all).slice(0,maxCodes);
}
async function decodeNative(video,scaleX=1,scaleY=1){
  if(!await initNativeQrDetector())return [];
  try{
    const codes=await barcodeDetector.detect(video);
    const out=[];
    for(const code of codes||[]){
      const parsed=parseQrCardPayload(code.rawValue||'');
      const loc=nativeLocation(code);
      if(!parsed||!loc)continue;
      const scaled={
        topLeftCorner:{x:loc.topLeftCorner.x*scaleX,y:loc.topLeftCorner.y*scaleY},
        topRightCorner:{x:loc.topRightCorner.x*scaleX,y:loc.topRightCorner.y*scaleY},
        bottomRightCorner:{x:loc.bottomRightCorner.x*scaleX,y:loc.bottomRightCorner.y*scaleY},
        bottomLeftCorner:{x:loc.bottomLeftCorner.x*scaleX,y:loc.bottomLeftCorner.y*scaleY}
      };
      out.push({data:code.rawValue,location:scaled,cardToken:parsed.cardToken});
    }
    return dedupeDetections(out);
  }catch{return [];}
}
async function tuneCameraTrack(track){
  if(!track)return;
  try{
    const caps=track.getCapabilities?.()||{};
    cameraCapabilities=caps||{};
    const advanced=[];
    if(Array.isArray(caps.focusMode)&&caps.focusMode.includes('continuous'))advanced.push({focusMode:'continuous'});
    if(caps.exposureMode&&Array.isArray(caps.exposureMode)&&caps.exposureMode.includes('continuous'))advanced.push({exposureMode:'continuous'});
    if(caps.whiteBalanceMode&&Array.isArray(caps.whiteBalanceMode)&&caps.whiteBalanceMode.includes('continuous'))advanced.push({whiteBalanceMode:'continuous'});
    if(advanced.length)await track.applyConstraints({advanced});
    const zoomWrap=$('qr-card-zoom-wrap'),zoom=$('qr-card-zoom'),torch=$('qr-card-torch'),tools=$('qr-camera-smart-tools');
    tools?.classList.remove('hidden');
    if(caps.zoom&&zoom&&zoomWrap){
      const min=Math.max(1,Number(caps.zoom.min||1)),max=Math.max(min,Number(caps.zoom.max||min)),step=Math.max(.05,Number(caps.zoom.step||.1));
      zoom.min=String(min);zoom.max=String(max);zoom.step=String(step);
      currentZoom=Number(track.getSettings?.().zoom||min);
      zoom.value=String(currentZoom);$('qr-card-zoom-value').textContent=currentZoom.toFixed(1)+'×';
      zoomWrap.classList.remove('hidden');
    }else zoomWrap?.classList.add('hidden');
    if(caps.torch)torch?.classList.remove('hidden');else torch?.classList.add('hidden');
  }catch{}
}
function stopCamera() {
  scanActive = false;
  cameraEpoch++;
  if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
  if (stream) {
    for (const track of stream.getTracks()) try { track.stop(); } catch {}
    stream = null;
  }
  cameraTrack=null;
  cameraCapabilities={};currentZoom=1;torchEnabled=false;detectionMemory.clear();scanWorkerBusy=false;
  const tools=$('qr-camera-smart-tools');tools?.classList.add('hidden');
  const video = $('qr-card-video');
  if (video) video.srcObject = null;
  $('qr-card-stop-camera')?.classList.add('hidden');
  $('qr-card-stop-camera-mobile')?.classList.add('hidden');
  if ($('qr-card-camera-status')) $('qr-card-camera-status').textContent = 'Camera đã dừng';
  if ($('qr-card-camera-empty')) $('qr-card-camera-empty').classList.remove('hidden');
  clearOverlay();
}
async function acquireCameraStream(){
  const profiles=[
    {width:{ideal:2560},height:{ideal:1440},frameRate:{ideal:30,max:60}},
    {width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,max:30}},
    {width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:30}}
  ];
  let lastError=null;
  for(const profile of profiles){
    try{
      return await navigator.mediaDevices.getUserMedia({
        audio:false,
        video:{facingMode:{ideal:cameraFacing},...profile}
      });
    }catch(e){lastError=e;}
  }
  throw lastError||new Error('Không thể mở camera.');
}
async function openCamera() {
  if(deviceRole!=='scanner'||!session)return feedback('Hãy kết nối điện thoại vào một phiên đang mở trước.',true);
  if (!navigator.mediaDevices?.getUserMedia) return feedback('Trình duyệt này không hỗ trợ camera web.', true);
  stopCamera();
  try {
    stream = await acquireCameraStream();
    cameraTrack=stream.getVideoTracks?.()[0]||null;
    await tuneCameraTrack(cameraTrack);
    await initNativeQrDetector();
    const video = $('qr-card-video');
    video.srcObject = stream;
    await video.play();
    scanActive = true;
    ensureScanWorker();
    setScanMode(scanMode);
    $('qr-card-stop-camera')?.classList.remove('hidden');
    if(mobileScannerMode)$('qr-card-stop-camera-mobile')?.classList.remove('hidden');
    $('qr-card-camera-empty')?.classList.add('hidden');
    if ($('qr-card-camera-status')) $('qr-card-camera-status').textContent =
      collectionState==='collecting'
        ? (cameraFacing === 'environment' ? 'Camera sau · đang quét & lưu' : 'Camera trước · đang quét & lưu')
        : 'CÂU ĐÃ KHÓA · camera chỉ xem, không lưu';
    scheduleScan(0);
  } catch (e) {
    feedback('Không thể mở camera: ' + (e?.message || 'hãy kiểm tra quyền camera.'), true);
  }
}
function scheduleScan(delay) {
  if (!scanActive) return;
  const adaptive=Number.isFinite(delay)?delay:
    nativeQrSupported?Math.max(34,Math.min(75,lastFrameDuration*.65)):
    Math.max(55,Math.min(130,lastFrameDuration*.8||75));
  scanTimer=setTimeout(scanFrame,adaptive);
}
function ensureOffscreen(width, height) {
  if (!offscreen) {
    offscreen = document.createElement('canvas');
    offctx = offscreen.getContext('2d', { willReadFrequently: true });
  }
  if (offscreen.width !== width) offscreen.width = width;
  if (offscreen.height !== height) offscreen.height = height;
}
function decodeMultiple(imageData, maxCodes = 16) {
  const detections = [];
  const working = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  for (let i = 0; i < maxCodes; i++) {
    const qr = jsQR(working.data, working.width, working.height, { inversionAttempts: 'dontInvert' });
    if (!qr?.data || !qr?.location) break;
    const parsed = parseQrCardPayload(qr.data);
    if (parsed) detections.push({ ...qr, cardToken: parsed.cardToken });
    const pts = [qr.location.topLeftCorner, qr.location.topRightCorner, qr.location.bottomRightCorner, qr.location.bottomLeftCorner].filter(Boolean);
    if (!pts.length) break;
    const pad = 12;
    const minX = Math.max(0, Math.floor(Math.min(...pts.map(p => p.x)) - pad));
    const maxX = Math.min(working.width - 1, Math.ceil(Math.max(...pts.map(p => p.x)) + pad));
    const minY = Math.max(0, Math.floor(Math.min(...pts.map(p => p.y)) - pad));
    const maxY = Math.min(working.height - 1, Math.ceil(Math.max(...pts.map(p => p.y)) + pad));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const idx = (y * working.width + x) * 4;
      working.data[idx] = working.data[idx+1] = working.data[idx+2] = 255;
      working.data[idx+3] = 255;
    }
  }
  return detections;
}
async function scanFrame() {
  if (!scanActive || frameBusy || !session || !currentQuestion()) return scheduleScan();
  const video=$('qr-card-video');
  if(!video||video.readyState<2||!video.videoWidth)return scheduleScan();
  frameBusy=true;
  const started=performance.now();
  try{
    scanCycle++;
    let native=[];
    native=await decodeNative(video,1,1);
    if(native.length)processDetections(native,scanCycle);
    let detections=rememberDetections(native);

    // Heavy multi-scale decoding runs in a Worker so the camera/UI stays smooth.
    // Run more aggressively in Far mode or while students are still missing.
    const remaining=scanRemainingCount();
    const needFallback=scanMode==='far'||!native.length||remaining>Math.max(4,Math.floor((session.students?.length||0)*.12))||scanCycle%3===0;
    if(needFallback&&!scanWorkerBusy){
      const targetW=scanMode==='far'?Math.min(2200,video.videoWidth):(nativeQrSupported?1600:1920);
      const scale=Math.min(1,targetW/video.videoWidth);
      const w=Math.max(720,Math.round(video.videoWidth*scale));
      const h=Math.max(405,Math.round(video.videoHeight*scale));
      ensureOffscreen(w,h);
      offctx.imageSmoothingEnabled=false;
      offctx.drawImage(video,0,0,w,h);
      const image=offctx.getImageData(0,0,w,h);
      const worker=ensureScanWorker();
      if(worker){
        scanWorkerBusy=true;
        fallbackFrameId++;
        worker.postMessage({
          type:'decode',
          frameId:fallbackFrameId,
          cycle:scanCycle,
          mode:scanMode,
          cameraEpoch,
          sessionId:String(session.id||''),
          questionId:String(currentQuestion()?.id||''),
          stateRevision:Number(stateRevision)||0,
          maxCodes:Math.min(80,Math.max(32,Number(session.students?.length||50))),
          width:w,height:h,buffer:image.data.buffer
        },[image.data.buffer]);
      }else{
        const js=decodeJsQrTiles(offscreen,image,50);
        const inv=1/scale;
        const mapped=js.map(d=>({...d,location:{
          topLeftCorner:{x:d.location.topLeftCorner.x*inv,y:d.location.topLeftCorner.y*inv},
          topRightCorner:{x:d.location.topRightCorner.x*inv,y:d.location.topRightCorner.y*inv},
          bottomRightCorner:{x:d.location.bottomRightCorner.x*inv,y:d.location.bottomRightCorner.y*inv},
          bottomLeftCorner:{x:d.location.bottomLeftCorner.x*inv,y:d.location.bottomLeftCorner.y*inv}
        }}));
        if(mapped.length)processDetections(mapped,scanCycle);
        detections=rememberDetections([...native,...mapped]);
      }
    }
    lastDetections=detections;
    drawOverlay(detections,video.videoWidth,video.videoHeight);
    updateScannerPerfBadge(detections.length);
  }catch(e){
    console.warn('QR scan frame error',e);
  }finally{
    lastFrameDuration=Math.max(1,performance.now()-started);
    frameBusy=false;
    scheduleScan();
  }
}
function processDetections(detections,observationCycle=scanCycle) {
  const q = currentQuestion();
  if (!q || !session || deviceRole!=='scanner' || collectionState!=='collecting') return;
  const validStudents = new Map((session.students || []).map(s => [String(s.card_token), s]));
  const seen = new Set();
  const now = performance.now();
  for (const d of detections) {
    const student = validStudents.get(String(d.cardToken));
    if (!student) continue;
    const area=detectionArea(d.location);
    const tolerance=area<1800?40:(area<5000?38:34);
    const orientation = answerFromQrLocation(d.location,tolerance);
    if (!orientation) continue;
    const key = String(q.id) + '|' + String(d.cardToken);
    seen.add(key);
    const prev = tracking.get(key);
    if(prev&&Number(prev.observationCycle||0)>=Number(observationCycle||0)){
      if(Number(observationCycle||0)===Number(prev.observationCycle||0)){
        tracking.set(key,{...prev,lastSeen:now,location:d.location,area:Math.max(Number(prev.area||0),area)});
      }
      continue;
    }
    const gap=now-Number(prev?.lastSeen||0);
    const same=prev?.answer===orientation.answer&&gap<950;
    const hits=same?Number(prev.hits||0)+1:1;
    const confidence=Math.max(0,1-(Number(orientation.distance||0)/Math.max(1,tolerance)));
    const score=same?Number(prev.score||0)+confidence:confidence;
    const next={answer:orientation.answer,hits,score,lastSeen:now,observationCycle:Number(observationCycle)||0,studentId:String(student.id),cardToken:d.cardToken,location:d.location,area};
    tracking.set(key,next);

    // Large/clear cards can confirm immediately with strong orientation.
    // Small/far cards need two observations or accumulated confidence to avoid answer flips.
    const instant=area>=9000&&confidence>=.82;
    const stable=instant||hits>=2||score>=1.55;
    if(stable)acceptStableAnswer(q.id,student,orientation.answer,Math.max(3,hits));
  }
  for (const [key, value] of tracking) {
    if (!seen.has(key) && now - Number(value.lastSeen || 0) > 900) tracking.delete(key);
  }
}
function acceptStableAnswer(questionId, student, answer, hits) {
  if(collectionState!=='collecting')return;
  const map = answersForQuestion(questionId);
  const uid = String(student.id);
  const key=pendingAnswerKey(questionId,uid);
  const confirmed = map.get(uid);
  const pending = pendingVisualAnswers.get(key);
  if (confirmed === answer || pending?.answer === answer) return;
  pendingVisualAnswers.set(key,{answer,at:Date.now()});
  pendingRecords.set(key, {
    questionId: String(questionId),
    cardToken: String(student.card_token),
    answer,
    stableHits: Math.max(3, hits)
  });
  persistPendingQueue();
  setPhoneSaveState('pending','Đã nhận '+String(student.full_name||student.student_code)+' · '+answer+' · chờ lưu');
  renderStudentStatus();
  queueFlush();
}
function queueFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flushPending, 80);
}
async function flushPending() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if(saveInFlight){
    setTimeout(queueFlush,120);
    return false;
  }
  if (!session || !pendingRecords.size) return true;
  if(collectionState!=='collecting'){
    setPhoneSaveState('locked','Câu đã khóa · hàng đợi tạm dừng');
    return false;
  }

  const batchEntries=[...pendingRecords.entries()].slice(0,40);
  const records=batchEntries.map(([,record])=>record);
  saveInFlight=true;lastSaveError='';setPhoneSaveState('saving','Đang lưu '+records.length+' đáp án lên server…');

  try{
    const result=await api('POST','/api/qr-cards',{action:'record-batch',sessionId:session.id,records});
    const acceptedRows=result.data?.accepted||[];
    const rejectedRows=result.data?.rejected||[];
    const acceptedKeys=new Set();

    for(const row of acceptedRows){
      const student=session.students.find(st=>String(st.id)===String(row.user_id) || String(st.card_token)===String(row.card_token||''));
      if(!student)continue;
      const key=pendingAnswerKey(row.question_id,student.id);
      acceptedKeys.add(key);
      pendingRecords.delete(key);
      retryCounts.delete(key);
      pendingVisualAnswers.delete(key);
      answersForQuestion(row.question_id).set(String(student.id),String(row.answer||'').toUpperCase());
    }

    const rejectedByKey=new Map();
    for(const row of rejectedRows){
      let key='';
      if(row.user_id) key=pendingAnswerKey(row.question_id,row.user_id);
      else if(row.card_token){
        const student=session.students.find(st=>String(st.card_token)===String(row.card_token));
        if(student)key=pendingAnswerKey(row.question_id,student.id);
      }
      if(key)rejectedByKey.set(key,row);
    }

    for(const [key,record] of batchEntries){
      if(acceptedKeys.has(key))continue;
      const rejection=rejectedByKey.get(key);
      const reason=String(rejection?.reason||'NO_ACK');
      if(reason==='STALE_QUESTION'||reason==='INVALID_RECORD'||reason==='CARD_NOT_IN_CLASS'){
        pendingRecords.delete(key);
        retryCounts.delete(key);
        pendingVisualAnswers.delete(key);
        continue;
      }
      if(reason==='STATE_CHANGED'){
        const tries=(retryCounts.get(key)||0)+1;
        retryCounts.set(key,tries);
        if(tries>=8){
          pendingRecords.delete(key);
          pendingVisualAnswers.delete(key);
          retryCounts.delete(key);
        }
        continue;
      }
      // NO_ACK / unknown rejection: keep record in queue for retry.
      retryCounts.set(key,(retryCounts.get(key)||0)+1);
    }

    persistPendingQueue();
    tracking.clear();
    lastSyncVersion='';
    updateStats();
    renderStudentStatus();

    if(acceptedRows.length){
      setPhoneSaveState('saved','Đã lưu '+acceptedRows.length+' đáp án · còn '+pendingRecords.size+' chờ');
      scheduleSync(0);
    }

    const serverState=String(result.data?.collection_state||collectionState);
    if(serverState==='locked'){
      collectionState='locked';
      setPhoneSaveState('locked','Câu vừa khóa · '+pendingRecords.size+' đáp án chưa ACK');
      scheduleSync(0);
      return pendingRecords.size===0;
    }

    if(pendingRecords.size){
      setPhoneSaveState('pending','Còn '+pendingRecords.size+' đáp án đang chờ ACK');
      setTimeout(queueFlush,220);
      return false;
    }

    setPhoneSaveState('saved','Tất cả đáp án đã lưu & đồng bộ');
    return true;
  }catch(e){
    lastSaveError=String(e?.message||'Không thể lưu đáp án.');
    if(e?.code==='QUESTION_LOCKED'||e?.code==='STALE_QUESTION'){
      collectionState='locked';
      setPhoneSaveState('locked','Câu đã khóa · dừng gửi đáp án mới');
      lastSyncVersion='';scheduleSync(0);
      return false;
    }
    persistPendingQueue();
    setPhoneSaveState('error','Mất kết nối · giữ '+pendingRecords.size+' đáp án và tự gửi lại');
    feedback('Chưa lưu được đáp án. Hàng đợi vẫn được giữ và sẽ tự gửi lại.',true);
    setTimeout(queueFlush,650);
    return false;
  }finally{
    saveInFlight=false;
  }
}
async function flushAllPending() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  let rounds = 0;
  while (pendingRecords.size && rounds < 10) {
    rounds++;
    const ok = await flushPending();
    if (!ok) throw Error('Chưa thể đồng bộ hết đáp án lên máy chủ. Hãy kiểm tra mạng rồi chốt lại.');
  }
  if (pendingRecords.size) throw Error('Còn đáp án chưa được đồng bộ; chưa thể chốt kết quả an toàn.');
}
function fitOverlay(sourceW, sourceH) {
  const wrap = $('qr-card-camera-wrap');
  const canvas = $('qr-card-overlay');
  if (!wrap || !canvas) return null;
  const rect = wrap.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = Math.max(1, rect.width), cssH = Math.max(1, rect.height);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const video=$('qr-card-video');
  const objectFit=video?getComputedStyle(video).objectFit:'contain';
  const scale=objectFit==='cover'
    ? Math.max(cssW/sourceW,cssH/sourceH)
    : Math.min(cssW/sourceW,cssH/sourceH);
  const drawnW=sourceW*scale,drawnH=sourceH*scale;
  return {ctx,scale,ox:(cssW-drawnW)/2,oy:(cssH-drawnH)/2,cssW,cssH};
}
function drawOverlay(detections, sourceW, sourceH) {
  const fit = fitOverlay(sourceW, sourceH);
  if (!fit || !session) return;
  const { ctx, scale, ox, oy } = fit;
  const q = currentQuestion();
  const map = q ? answersForQuestion(q.id) : new Map();
  const students = new Map((session.students || []).map(s => [String(s.card_token), s]));
  ctx.lineWidth = 3;
  ctx.font = '700 13px system-ui,sans-serif';
  for (const d of detections) {
    const student = students.get(String(d.cardToken));
    if (!student) continue;
    const orientation = answerFromQrLocation(d.location);
    const answer = orientation?.answer || '?';
    const uid=String(student.id),key=pendingAnswerKey(q?.id||'',uid);
    const locked=collectionState!=='collecting';
    const confirmed = !locked && map.get(uid) === answer;
    const pending = !locked && pendingVisualAnswers.get(key)?.answer === answer;
    const points = [d.location.topLeftCorner,d.location.topRightCorner,d.location.bottomRightCorner,d.location.bottomLeftCorner];
    ctx.strokeStyle = locked ? '#94a3b8' : (confirmed ? '#22c55e' : (pending ? '#3b82f6' : '#f59e0b'));
    ctx.fillStyle = locked ? 'rgba(100,116,139,.15)' : (confirmed ? 'rgba(34,197,94,.16)' : (pending ? 'rgba(59,130,246,.15)' : 'rgba(245,158,11,.13)'));
    ctx.beginPath();
    points.forEach((p,i) => {
      const x = ox + p.x * scale, y = oy + p.y * scale;
      if (i) ctx.lineTo(x,y); else ctx.moveTo(x,y);
    });
    ctx.closePath();ctx.fill();ctx.stroke();
    const x = ox + d.location.topLeftCorner.x * scale;
    const y = Math.max(18, oy + d.location.topLeftCorner.y * scale - 8);
    const label = String(student.full_name || student.student_code) + ' · ' + answer;
    const width = Math.min(260, ctx.measureText(label).width + 14);
    ctx.fillStyle = locked ? 'rgba(71,85,105,.92)' : (confirmed ? 'rgba(21,128,61,.92)' : (pending ? 'rgba(29,78,216,.92)' : 'rgba(180,83,9,.92)'));
    ctx.fillRect(x, y - 17, width, 20);
    ctx.fillStyle = '#fff';
    const suffix=locked?' · ĐÃ KHÓA, KHÔNG LƯU':(pending&&!confirmed?' · đang lưu':'');
    ctx.fillText(label+suffix, x + 7, y - 3, width - 10);
  }
}
function clearOverlay() {
  const canvas = $('qr-card-overlay');
  if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
}
async function clearStudentAnswer(userId) {
  const q = currentQuestion();
  if (!q || !session) return;
  const uid = String(userId);
  try {
    await api('POST', '/api/qr-cards', { action: 'clear-answer', sessionId: session.id, questionId: String(q.id), userId: uid });
    const map = answersForQuestion(q.id);
    map.delete(uid);
    pendingRecords.delete(String(q.id) + '|' + uid);
    retryCounts.delete(String(q.id) + '|' + uid);
    pendingVisualAnswers.delete(String(q.id) + '|' + uid);
    persistPendingQueue();
    tracking.clear();
    updateStats();
    renderStudentStatus();
  } catch (e) {
    feedback(e.message, true);
  }
}
async function finalize() {
  if (!session) return;
  const run = async () => {
    const btn = $('qr-presenter-finalize');
    if (btn) btn.disabled = true;
    try {
      if(deviceRole==='presenter'&&collectionState!=='locked')await setCollectionState('locked');
      if(deviceRole==='scanner')await flushAllPending();
      const result = await api('POST', '/api/qr-cards', { action: 'finalize', sessionId: session.id, confirmFinalize: true });
      stopCamera();
      feedback('Đã lưu ' + (result.data?.total_results || 0) + ' bài quét vào Quản lý kết quả.');
      window.showToast?.('Đã chốt kết quả quét thẻ thành công.', 'success');
      clearPersistedPendingQueue();
      stopSyncLoop();
      session = null;deviceRole='';
      $('qr-card-scan-workspace')?.classList.add('hidden');
      $('qr-card-presenter-workspace')?.classList.add('hidden');
      await loadActiveSessions();
    } catch (e) {
      feedback(e.message, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  };
  if (typeof window.showConfirmModal === 'function') {
    window.showConfirmModal('Chốt phiên quét và lưu kết quả cho các học sinh đã có đáp án? Học sinh chưa quét sẽ không bị tạo bài 0 điểm.', run);
  } else {
    await run();
  }
}
function bind() {
  if (wired || !$('qr-card-class')) return;
  wired = true;
  $('qr-card-class')?.addEventListener('change', loadRoster);
  $('qr-card-sync')?.addEventListener('click', ensureCards);
  $('qr-card-print')?.addEventListener('click', printCards);
  $('qr-card-start')?.addEventListener('click', startSession);
  $('qr-card-refresh-sessions')?.addEventListener('click', loadActiveSessions);
  $('qr-card-open-presenter')?.addEventListener('click',()=>attachSelectedSession('presenter'));
  $('qr-card-open-scanner')?.addEventListener('click',()=>attachSelectedSession('scanner'));
  $('qr-card-open-camera')?.addEventListener('click', openCamera);
  $('qr-card-stop-camera')?.addEventListener('click', stopCamera);
  $('qr-card-switch-camera')?.addEventListener('click', async () => { cameraFacing = cameraFacing === 'environment' ? 'user' : 'environment'; await openCamera(); });
  $('qr-card-mode-auto')?.addEventListener('click',()=>setScanMode('auto'));
  $('qr-card-mode-far')?.addEventListener('click',()=>setScanMode('far'));
  $('qr-card-torch')?.addEventListener('click',toggleTorch);
  $('qr-card-zoom')?.addEventListener('input',e=>applyCameraZoom(e.target.value));
  $('qr-card-stop-camera-mobile')?.addEventListener('click',stopCamera);
  $('qr-card-show-missing')?.addEventListener('click', () => {
    showMissingOnly = !showMissingOnly;
    $('qr-card-show-missing').textContent = showMissingOnly ? 'Hiện tất cả' : 'Chưa nhận';
    renderStudentStatus();
  });
  $('qr-card-student-status')?.addEventListener('click', e => {
    const btn = e.target.closest?.('[data-qr-clear]');
    if (btn) void clearStudentAnswer(btn.dataset.qrClear);
  });
  $('qr-card-leave-scanner')?.addEventListener('click',()=>{stopCamera();stopSyncLoop();clearPersistedPendingQueue();deviceRole='';session=null;$('qr-card-scan-workspace')?.classList.add('hidden');$('qr-card-session-picker')?.classList.remove('hidden');loadActiveSessions();});
  $('qr-presenter-lock')?.addEventListener('click',async()=>{try{await setCollectionState(collectionState==='locked'?'collecting':'locked');}catch(e){feedback(e.message,true);lastSyncVersion='';scheduleSync(0);}});
  $('qr-presenter-prev')?.addEventListener('click',()=>presenterNavigate(-1));
  $('qr-presenter-next')?.addEventListener('click',()=>presenterNavigate(1));
  $('qr-presenter-finalize')?.addEventListener('click',finalize);
  $('qr-presenter-settings')?.addEventListener('click',()=>{
    applyPresenterTypography();
    const modal=$('qr-presenter-settings-modal');
    modal?.classList.remove('hidden');modal?.classList.add('flex');
  });
  const closePresenterSettings=()=>{const modal=$('qr-presenter-settings-modal');modal?.classList.add('hidden');modal?.classList.remove('flex');};
  $('qr-presenter-settings-close')?.addEventListener('click',closePresenterSettings);
  $('qr-presenter-settings-done')?.addEventListener('click',closePresenterSettings);
  $('qr-presenter-settings-reset')?.addEventListener('click',()=>{
    presenterQuestionFontSize=24;presenterAnswerFontSize=20;applyPresenterTypography();renderPresenterQuestion(currentQuestion(),questionIndex,session?.questions?.length||1);
  });
  $('qr-presenter-question-size')?.addEventListener('input',e=>{
    presenterQuestionFontSize=Math.max(18,Math.min(56,Number(e.target.value)||24));applyPresenterTypography();
  });
  $('qr-presenter-answer-size')?.addEventListener('input',e=>{
    presenterAnswerFontSize=Math.max(16,Math.min(48,Number(e.target.value)||20));applyPresenterTypography();renderPresenterQuestion(currentQuestion(),questionIndex,session?.questions?.length||1);
  });
  $('qr-presenter-fullscreen')?.addEventListener('click',async()=>{
    const el=$('qr-card-presenter-workspace');if(!el)return;
    try{if(document.fullscreenElement)await document.exitFullscreen();else await el.requestFullscreen();}catch{}
  });
  window.addEventListener('resize',applyMobileScannerMode,{passive:true});
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if(deviceRole==='scanner') stopCamera(); }
    else if(session&&deviceRole){ lastSyncVersion='';scheduleSync(0); }
  });
  window.addEventListener('pagehide',()=>{stopCamera();stopSyncLoop();});
}
export async function initQrAnswerCards(user) {
  actor = user || null;
  applyMobileScannerMode();
  bind();
  try {
    await loadBootstrap();
    feedback('Máy tính: tạo phiên & trình chiếu. Điện thoại: chọn phiên đang mở rồi bấm Kết nối máy quét.');
  } catch (e) {
    feedback(e.message, true);
  }
}
export function connectQrAnswerCards() { bind(); }
export function resetQrAnswerCards() {
  stopCamera();stopSyncLoop();
  actor = null;
  roster = [];
  session = null;deviceRole='';activeSessions=[];stateRevision=0;collectionState='collecting';lastSyncVersion='';
  questionIndex = 0;
  tracking.clear();
  questionAnswers.clear();
  pendingRecords.clear();
  pendingVisualAnswers.clear();
  retryCounts.clear();
  lastSaveError='';
  saveInFlight=false;
  showMissingOnly = false;
  presenterQuestionFontSize=24;
  presenterAnswerFontSize=20;
  scanMode='auto';cameraCapabilities={};currentZoom=1;torchEnabled=false;detectionMemory.clear();scanWorkerBusy=false;cameraEpoch++;
}
