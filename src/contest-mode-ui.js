import './contest-mobile-performance.css';
// Public contest experience is strictly opt-in per tenant.
// Uses existing student exam engine (selection, READY, START, scoring) unchanged.
function findEl(id){ return document.getElementById(id); }
async function waitForForm() {
  if (findEl('contest-registration-form')) return true;
  return new Promise(resolve => {
    let finished = false;
    const done = value => {if(finished)return; finished=true; observer.disconnect(); clearTimeout(timeout); resolve(value);};
    const observer = new MutationObserver(()=>{if(findEl('contest-registration-form'))done(true);});
    observer.observe(document.documentElement,{childList:true,subtree:true});
    const timeout = setTimeout(()=>done(false),15000);
  });
}
// A contest attempt uses the original grading UI and server token. Never clone
// question widgets or scoring logic: move the already-tested DOM nodes safely.
const examHomes = new Map();
function relocateExamWidgets(toContest) {
  const contestTab=findEl('tab-contest'),schoolTab=findEl('tab-exam');
  if(!contestTab || !schoolTab)return false;
  for(const id of ['exam-interface','exam-results']){
    const element=findEl(id);
    if(!element)return false;
    if(toContest){
      if(!examHomes.has(id)){
        const marker=document.createComment('Original '+id+' location');
        element.parentNode?.insertBefore(marker,element);
        examHomes.set(id,marker);
      }
      // Moving the fullscreen element causes an automatic browser fullscreen exit.
      // Prepare the destination BEFORE the user requests fullscreen.
      if(element.parentElement!==contestTab){
        if(document.fullscreenElement && (document.fullscreenElement.contains(element) || element.contains(document.fullscreenElement)))return false;
        contestTab.appendChild(element);
      }
    }else{
      const marker=examHomes.get(id);
      if(marker?.parentNode){marker.parentNode.insertBefore(element,marker);marker.remove();}
      examHomes.delete(id);
    }
  }
  return true;
}
window.__contestCanShowExam=()=>Boolean(
  findEl('tab-contest')&&findEl('tab-exam')&&
  findEl('exam-interface')&&findEl('exam-results')&&
  findEl('tab-contest').contains(findEl('exam-interface'))&&
  findEl('tab-contest').contains(findEl('exam-results'))
);
// Stage the already-hidden exam UI before the READY confirmation click.
// Never move an element between tabs while it is in fullscreen.
window.__contestPrepareForReady=function(){
  if(document.fullscreenElement || !relocateExamWidgets(true)){
    throw new Error('Không thể chuẩn bị phòng thi ổn định. Vui lòng thử lại.');
  }
  window.__contestReadyPrepared=true;
  return true;
};
window.__contestBeforeFullscreen=function(){
  const root=findEl('exam-interface'),tab=findEl('tab-contest');
  if(!window.__contestReadyPrepared || !root || !tab?.contains(root))return false;
  // Ensure the parent tab is rendered before requestFullscreen.
  // Otherwise the hidden ancestor makes fullscreen fail on mobile.
  if(!tab.classList.contains('active'))window.switchTab?.('contest');
  if(!tab.classList.contains('active'))return false;
  // requestFullscreen() rejects display:none. Reveal a blank container only
  // after explicit READY acceptance; no question or timer exists yet.
  root.classList.remove('hidden');
  findEl('contest-registration')?.classList.add('hidden');
  window.__contestStartPending=true;
  return true;
};
window.__contestAfterStartRejected=function(){
  if(window.__activeStudentExamTab==='contest')return;
  window.__contestStartPending=false;
  findEl('exam-interface')?.classList.add('hidden');
  findEl('contest-registration')?.classList.remove('hidden');
};
window.__contestOnReadyCancelled=function(){
  window.__contestAfterStartRejected?.();
  if(!document.fullscreenElement)relocateExamWidgets(false);
  window.__contestReadyPrepared=false;
  window.__contestTicket=null;
  for(const id of ['guest_data_1','guest_data_lop','guest_data_donvi']){
    const field=findEl(id);
    if(field && !window.currentUser)field.value='';
  }
};
window.__contestOnExamStarted=function(){
  if(!window.__contestReadyPrepared || !window.__contestCanShowExam?.()){
    throw new Error('Giao diện cuộc thi chưa được đặt cố định trước khi tính giờ.');
  }
  window.__contestReadyPrepared=false;
  window.__contestStartPending=false;
  window.__activeStudentExamTab='contest';
  findEl('contest-registration')?.classList.add('hidden');
  // Re-switching the already-active tab can briefly set its display:none,
  // which browsers interpret as leaving fullscreen.
  if(!findEl('tab-contest')?.classList.contains('active'))window.switchTab?.('contest');
};
// Resume belongs to an already server-verified ACTIVE attempt and has no
// registration ticket. Prepare its DOM before requesting fullscreen on click.
window.__contestOnExamResumed=function(){
  if(document.fullscreenElement)return false;
  if(!relocateExamWidgets(true))return false;
  window.__activeStudentExamTab='contest';
  const tab=findEl('tab-contest');
  if(!tab?.classList.contains('active'))window.switchTab?.('contest');
  if(!tab?.classList.contains('active'))return false;
  findEl('contest-registration')?.classList.add('hidden');
  findEl('exam-interface')?.classList.remove('hidden');
  window.__contestReadyPrepared=false;
  window.__contestStartPending=false;
  return true;
};
window.__contestOnExamReset=function(){
  window.__contestReadyPrepared=false;
  window.__contestStartPending=false;
  relocateExamWidgets(false);
  window.__activeStudentExamTab=null;
  findEl('contest-registration')?.classList.remove('hidden');
};
// The owner flag alone can become stale after async component hydration.
// The DOM location of the verified attempt/result is a second, independent
// signal: never show personal registration above a contest result.
function contestResultIsVisible() {
  const result=findEl('exam-results');
  return Boolean(result && !result.classList.contains('hidden') &&
    findEl('tab-contest')?.contains(result));
}
window.__contestShowEntry=function(){
  const tab=findEl('tab-contest');
  const exam=findEl('exam-interface');
  const result=findEl('exam-results');
  const examVisible=Boolean(exam && !exam.classList.contains('hidden'));
  const resultsVisible=Boolean(result && !result.classList.contains('hidden'));
  const ownsVisibleExam=Boolean(
    (examVisible && tab?.contains(exam)) ||
    (resultsVisible && tab?.contains(result))
  );
  const shouldHide=ownsVisibleExam ||
    (window.__activeStudentExamTab==='contest' && (examVisible || resultsVisible));
  const registration=findEl('contest-registration');
  registration?.classList.toggle('hidden',Boolean(shouldHide));
  registration?.setAttribute('aria-hidden',String(Boolean(shouldHide)));
};
window.__contestOnExamSubmitted=function(){
  // Called only after /api/exam/grade confirms a durable result.
  if(!contestResultIsVisible())return;
  window.__contestShowEntry?.();
  // The signed registration ticket is no longer needed after a durable result.
  // Release its JS reference without touching the already persisted attempt.
  window.__contestTicket=null;
  // Discard registration PII from the DOM after it has served its purpose.
  // Do not clear the authenticated student's separate verified profile.
  findEl('contest-registration-form')?.reset();
  // Registered students retain ONLY their verified school profile.
  // The guest contestant's declared identity must never survive in school form.
  const profile=window.currentUser;
  const restore={
    guest_data_1:profile ? String(profile.full_name||'') : '',
    guest_data_lop:profile ? String(profile.lop||'') : '',
    guest_data_donvi:profile ? String(profile.donvi||profile.address||'') : ''
  };
  for(const [id,value] of Object.entries(restore)){
    const field=findEl(id);
    if(field)field.value=value;
  }
};
const noStore = {cache:'no-store'};
async function fetchJson(url,options={}) {
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(),15000);
  try {
    const response = await fetch(url,{...noStore,...options,signal:controller.signal});
    const body = await response.json().catch(()=>({}));
    if(!response.ok || body?.error)throw new Error(body?.error||'Yêu cầu không thành công.');
    return body;
  } finally {clearTimeout(timeout);}
}
function setText(id,value) {const el=findEl(id);if(el)el.textContent=value;}
function showError(message) {
  const el=findEl('contest-error');
  if(!el)return;
  el.textContent=String(message||'Không thể tiếp tục. Vui lòng thử lại.');
  el.classList.remove('hidden');
}
function hideError(){findEl('contest-error')?.classList.add('hidden');}
function setupSettings(mode) {
  // Components load independently; initialize the settings selector after it exists.
  function syncPicker(){
    const picker=findEl('settings-application-mode');
    if(!picker)return false;
    if(picker.dataset.contestInitialized!=='1'){
      picker.value=mode;
      picker.dataset.contestInitialized='1';
    }
    return true;
  }
  if(!syncPicker()){
    const observer=new MutationObserver(()=>{if(syncPicker())observer.disconnect();});
    observer.observe(document.documentElement,{childList:true,subtree:true});
    setTimeout(()=>observer.disconnect(),15000);
  }
  window.saveApplicationMode=async function(){
    const modeChoice=findEl('settings-application-mode')?.value;
    if(!['school','contest'].includes(modeChoice))return;
    const button=findEl('save-application-mode');
    if(button)button.disabled=true;
    setText('application-mode-status','Đang lưu tab mặc định...');
    try{
      const token=localStorage.getItem(window.tenantStorageKey('auth_token'))||'';
      const body=await fetchJson('/api/settings',{
        method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
        body:JSON.stringify({application_mode:modeChoice})
      });
      if(body?.data?.success!==true)throw new Error('Máy chủ chưa xác nhận lưu cấu hình.');
      setText('application-mode-status','Đã lưu tab mặc định. Lựa chọn không ảnh hưởng đến cuộc thi đang mở.');
      // Do not reload the app while any student may have an active attempt.
    }catch(e){
      setText('application-mode-status',e?.message||'Không thể lưu chế độ.');
    }finally{
      // Every save attempt must release the control, including successful saves.
      if(button)button.disabled=false;
    }
  };
}
async function runContestEntry(){
  const form=findEl('contest-registration-form');
  const select=findEl('contest-exam-picker');
  if(!form||!select || form.dataset.contestBound==='true')return;
  form.dataset.contestBound='true';
  const meta=findEl('contest-exam-meta');
  const startButton=findEl('contest-register-submit');
  const entries=new Map();
  function describe(){
    const row=entries.get(select.value);
    if(!row){if(meta)meta.textContent='Chọn cuộc thi để xem thông tin.';return;}
    const open=row.bat_dau?new Date(row.bat_dau).toLocaleString('vi-VN'):'Theo thể lệ';
    const close=row.ket_thuc?new Date(row.ket_thuc).toLocaleString('vi-VN'):'Theo thể lệ';
    if(meta)meta.textContent=`${row.so_cau} câu hỏi · ${row.time_limit} phút · ${Number(row.max_attempts)===0?'Không giới hạn':row.max_attempts+' lượt'} · Bắt đầu: ${open} · Kết thúc: ${close}`;
  }
  select.addEventListener('change',describe);
  const refresh=findEl('contest-reload-exams');
  let loadingContests=false;
  async function reloadPublishedContests(){
    if(loadingContests)return;
    loadingContests=true;
    if(refresh){refresh.disabled=true;refresh.textContent='Đang tải...';}
    const lastId=select.value;
    select.disabled=true;
    select.replaceChildren(new Option('Đang tải danh sách cuộc thi...',''));
    hideError();
    try{
      const response=await fetchJson('/api/contest/exams');
      entries.clear();
      select.replaceChildren(new Option('-- Chọn cuộc thi muốn tham gia --',''));
      for(const row of response.data||[]){
        if(!row?.id||!row?.creator_id)continue;
        entries.set(String(row.id),row);
        select.add(new Option(String(row.name),String(row.id)));
      }
      if(!entries.size){
        select.add(new Option('Chưa có cuộc thi được công bố',''));
        select.disabled=true;
        if(meta)meta.textContent='Chưa có cuộc thi được công bố. Admin cần mở đề, chọn Đã công bố rồi Lưu cấu hình đề thi.';
      } else {
        select.disabled=false;
        if(entries.has(lastId))select.value=lastId;
        describe();
      }
    }catch(e){
      showError(e?.message||'Không thể tải danh sách cuộc thi.');
      select.replaceChildren(new Option('Không tải được danh sách cuộc thi',''));
      select.disabled=true;
    }finally{
      loadingContests=false;
      if(refresh){refresh.disabled=false;refresh.textContent='Tải lại danh sách';}
    }
  }
  refresh?.addEventListener('click',reloadPublishedContests);
  // Bind submit before the first network request completes. Slow connections
  // must never let the browser navigate away with a native form submission.
  form.addEventListener('submit',async event=>{
    event.preventDefault();hideError();
    const chosen=entries.get(select.value);
    if(!chosen){showError('Vui lòng chọn cuộc thi hợp lệ.');return;}
    if(startButton){startButton.disabled=true;startButton.textContent='Đang xác minh thông tin và chuẩn bị đề thi...';}
    try{
      const values=Object.fromEntries(new FormData(form).entries());
      const enrollment=await fetchJson('/api/contest/register',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...values,dong_y:values.dong_y==='on'})
      });
      if(!enrollment?.data?.ticket)throw new Error('Máy chủ chưa xác nhận đăng ký.');
      // Reuse the already-tested exam engine's exact DOM IDs, with the teacher
      // selected from server metadata (never required from the participant).
      const inputName=findEl('guest_data_1'),inputUnit=findEl('guest_data_donvi'),inputClass=findEl('guest_data_lop');
      if(!inputName||!inputUnit||!inputClass)throw new Error('Giao diện làm bài chưa tải đầy đủ.');
      inputName.value=String(values.ho_ten||'');
      inputUnit.value=String(values.don_vi||'');
      inputClass.value='';
      const teacher=findEl('student-teacher-filter'),exam=findEl('student-exam-name-filter');
      if(!teacher||!exam)throw new Error('Không tìm thấy bộ chọn đề thi trong ứng dụng.');
      teacher.replaceChildren(new Option('Đơn vị tổ chức',String(chosen.creator_id)));
      teacher.disabled=false;
      teacher.value=String(chosen.creator_id);
      exam.replaceChildren(new Option(String(chosen.name),String(chosen.id)));
      exam.disabled=false;
      exam.value=String(chosen.id);
      await window.onStudentExamNameChange?.();
      const loaded=window._studentExamLoadStatus;
      if(!loaded || loaded.status!=='ready' || String(loaded.examId)!==String(chosen.id))
        throw new Error(loaded?.message||'Không xác minh được cấu hình đề thi. Vui lòng thử lại.');
      window.__contestTicket=enrollment.data.ticket;
      await window.startExam?.(startButton);
      // READY does not mean the clock has started. Keep the registration tab
      // visible until /api/exam/start accepts and __contestOnExamStarted fires.
      const readyButton=findEl('exam-start-ready-confirm');
      if(!window.currentExamToken || !readyButton)
        throw new Error('Máy chủ chưa chuẩn bị được đề thi hợp lệ. Vui lòng thử lại.');
      window.__contestPrepareForReady();
      const cancel=findEl('exam-start-ready-cancel');
      cancel?.addEventListener('click',()=>{
        window.__contestOnReadyCancelled?.();
      },{once:true});
    }catch(e){
      if(window.__activeStudentExamTab!=='contest')window.__contestOnReadyCancelled?.();
      showError(e?.message||'Không thể bắt đầu cuộc thi, vui lòng thử lại.');
    }finally{
      if(startButton){startButton.disabled=false;startButton.textContent='🚀 Đăng ký và bắt đầu làm bài';}
    }
  });
  // Populate public exam choices after all interactions have been wired.
  await reloadPublishedContests();
}
async function initializeContestMode() {
  // Both tabs stay available regardless of the Admin's landing preference.
  // Rendering is never an authorization decision.
  if(!await waitForForm())return;
  // Respect an existing server-confirmed contest attempt on delayed hydration.
  window.__contestShowEntry?.();
  // The published contest list is independent of the default landing setting.
  // Start both reads concurrently so a slow bootstrap cannot hold the form idle.
  const entryPromise=runContestEntry();
  try{
    const boot=await fetchJson('/api/bootstrap');
    setupSettings(boot?.data?.application_mode==='contest'?'contest':'school');
  }catch(error){
    console.warn('[contest-ui] Default landing setting unavailable:',error?.message);
    setupSettings('school');
  }
  await entryPromise;
  window.__contestShowEntry?.();
}
void initializeContestMode();
