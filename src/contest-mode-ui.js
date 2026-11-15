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
      contestTab.appendChild(element);
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
  findEl('exam-interface')&&findEl('exam-results')
);
window.__contestOnExamStarted=function(){
  if(!relocateExamWidgets(true)){
    throw new Error('Không thể thiết lập giao diện cuộc thi an toàn.');
  }
  window.__activeStudentExamTab='contest';
  findEl('contest-registration')?.classList.add('hidden');
  window.switchTab?.('contest');
};
window.__contestOnExamReset=function(){
  relocateExamWidgets(false);
  window.__activeStudentExamTab=null;
  findEl('contest-registration')?.classList.remove('hidden');
};
window.__contestShowEntry=function(){
  const isContest=window.__activeStudentExamTab==='contest';
  const examVisible=!findEl('exam-interface')?.classList.contains('hidden');
  const resultsVisible=!findEl('exam-results')?.classList.contains('hidden');
  findEl('contest-registration')?.classList.toggle('hidden',Boolean(isContest&&(examVisible||resultsVisible)));
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
  await reloadPublishedContests();

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
      const cancel=findEl('exam-start-ready-cancel');
      cancel?.addEventListener('click',()=>{
        window.__contestTicket=null;
        findEl('contest-registration')?.classList.remove('hidden');
      },{once:true});
    }catch(e){
      window.__contestTicket=null;
      showError(e?.message||'Không thể bắt đầu cuộc thi, vui lòng thử lại.');
    }finally{
      if(startButton){startButton.disabled=false;startButton.textContent='🚀 Đăng ký và bắt đầu làm bài';}
    }
  });
}
async function initializeContestMode() {
  // Both tabs stay available regardless of the Admin's landing preference.
  // Rendering is never an authorization decision.
  if(!await waitForForm())return;
  findEl('contest-registration')?.classList.remove('hidden');
  try{
    const boot=await fetchJson('/api/bootstrap');
    setupSettings(boot?.data?.application_mode==='contest'?'contest':'school');
  }catch(error){
    console.warn('[contest-ui] Default landing setting unavailable:',error?.message);
    setupSettings('school');
  }
  await runContestEntry();
  window.__contestShowEntry?.();
}
void initializeContestMode();
