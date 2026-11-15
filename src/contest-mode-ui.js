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
  const picker=findEl('settings-application-mode');
  if(picker)picker.value=mode;
  window.saveApplicationMode=async function(){
    const modeChoice=findEl('settings-application-mode')?.value;
    const button=findEl('save-application-mode');
    if(button)button.disabled=true;
    setText('application-mode-status','Đang lưu cấu hình...');
    try{
      const token=localStorage.getItem(window.tenantStorageKey('auth_token'))||'';
      const body=await fetchJson('/api/settings',{
        method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
        body:JSON.stringify({application_mode:modeChoice})
      });
      if(body?.data?.success!==true)throw new Error('Máy chủ chưa xác nhận lưu cấu hình.');
      setText('application-mode-status','Đã lưu thành công. Đang áp dụng giao diện...');
      window.location.reload();
    }catch(e){
      setText('application-mode-status',e?.message||'Không thể lưu chế độ.');
      if(button)button.disabled=false;
    }
  };
}
async function runContestEntry(){
  const form=findEl('contest-registration-form');
  const select=findEl('contest-exam-picker');
  if(!form||!select)return;
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
  try{
    const response=await fetchJson('/api/contest/exams');
    select.replaceChildren(new Option('-- Chọn cuộc thi muốn tham gia --',''));
    for(const row of response.data||[]){
      if(!row?.id||!row?.creator_id)continue;
      entries.set(String(row.id),row);
      select.add(new Option(String(row.name),String(row.id)));
    }
    if(!entries.size){
      select.add(new Option('Hiện chưa có cuộc thi được công bố',''));
      select.disabled=true;
      if(meta)meta.textContent='Hiện chưa có cuộc thi mở để đăng ký. Vui lòng quay lại sau.';
    }else select.disabled=false;
  }catch(e){
    showError(e?.message||'Không thể tải danh sách cuộc thi.');
    select.replaceChildren(new Option('Không tải được danh sách cuộc thi',''));
    select.disabled=true;
  }

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
      window.__contestTicket=enrollment.data.ticket;
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
      await window.startExam?.(startButton);
      if(!window.currentExamToken)throw new Error('Máy chủ chưa phát hành phiên thi. Vui lòng kiểm tra và thử lại.');
      findEl('contest-registration')?.classList.add('hidden');
    }catch(e){
      window.__contestTicket=null;
      showError(e?.message||'Không thể bắt đầu cuộc thi, vui lòng thử lại.');
    }finally{
      if(startButton){startButton.disabled=false;startButton.textContent='🚀 Đăng ký và bắt đầu làm bài';}
    }
  });
}
async function initializeContestMode() {
  if(!await waitForForm())return;
  // All public configuration comes from the authoritative tenant endpoint.
  try{
    const boot=await fetchJson('/api/bootstrap');
    const mode=boot?.data?.application_mode==='contest'?'contest':'school';
    setupSettings(mode);
    if(mode!=='contest')return;
    document.body.dataset.applicationMode='contest';
    const style=document.createElement('style');
    style.textContent=`body[data-application-mode="contest"] #exam-form{display:none!important}
      body[data-application-mode="contest"] #contest-registration{width:100%;max-width:1024px}
      @media(max-width:640px){body[data-application-mode="contest"] main{padding:8px!important}}
      body[data-application-mode="contest"] #contest-registration input,
      body[data-application-mode="contest"] #contest-registration select {font-size:16px;box-sizing:border-box}`;
    document.head.appendChild(style);
    findEl('contest-registration')?.classList.remove('hidden');
    await runContestEntry();
  }catch(error){
    console.warn('[contest-ui] Cannot load authoritative mode; retaining existing school interface',error?.message);
  }
}
void initializeContestMode();
