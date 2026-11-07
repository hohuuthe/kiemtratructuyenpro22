
const GUARD_MODAL_ID = 'invalid-exam-pool-modal';

function authToken() {
  try {
    const key = typeof window.tenantStorageKey === 'function'
      ? window.tenantStorageKey('auth_token')
      : 'auth_token';
    return localStorage.getItem(key) || '';
  } catch {
    return localStorage.getItem('auth_token') || '';
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}

function closeGuardModal() {
  document.getElementById(GUARD_MODAL_ID)?.remove();
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {}
  }
  return {};
}

function countValue(data, ...keys) {
  for (const key of keys) {
    const n = Number(data?.[key]);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return 0;
}

const TYPE_SPECS = [
  {key:'41', label:'Trắc nghiệm [4-1]', totalKeys:['count_41','count41','num_trac_nghiem'], apiKey:'count_41', type:'4-1'},
  {key:'TF4', label:'Đúng/Sai [TF4]', totalKeys:['count_tf4','countTF4','num_dung_sai'], apiKey:'count_tf4', type:'TF4'},
  {key:'SQ', label:'Trả lời ngắn [SQ]', totalKeys:['count_sq','countSQ','num_tra_loi_ngan'], apiKey:'count_sq', type:'SQ'},
  {key:'TL', label:'Tự luận [TL]', totalKeys:['count_tl','countTL','num_tuluan'], apiKey:'count_tl', type:'TL'}
];

function buildRepairRows(data, validity) {
  const detail = parseObject(data.counts_detail ?? data.countsDetail);
  return TYPE_SPECS.map(spec => {
    const available = validity?.availableByType?.[spec.type] ?? 0;
    const byLevel = validity?.availableByTypeLevel?.[spec.type] || {};
    const existing = {
      NB: countValue(detail, 'count' + spec.key + 'NB'),
      TH: countValue(detail, 'count' + spec.key + 'TH'),
      VD: countValue(detail, 'count' + spec.key + 'VD')
    };
    const detailSum = existing.NB + existing.TH + existing.VD;
    const total = countValue(data, ...spec.totalKeys);
    return {
      ...spec, total, available, byLevel, existing, hasDetail: detailSum > 0
    };
  });
}

function showInvalidExamModal(payload, examId) {
  closeGuardModal();
  const data = payload?.data || {};
  const validity = payload?.question_pool_validity || {};
  const shortages = Array.isArray(validity.shortages) ? validity.shortages : [];
  const rows = buildRepairRows(data, validity);
  const modal = document.createElement('div');
  modal.id = GUARD_MODAL_ID;
  modal.className = 'fixed inset-0 z-[10050] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm';
  modal.innerHTML = `
    <div class="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-red-200">
      <div class="p-5 border-b border-red-100 bg-red-50">
        <div class="flex items-start gap-3">
          <div class="text-3xl">⚠️</div>
          <div class="min-w-0 flex-1">
            <h3 class="text-lg font-black text-red-800">Đề thi không còn hợp lệ</h3>
            <p class="mt-1 text-sm text-red-700">${escapeHtml(validity.message || 'Ngân hàng câu hỏi trên cơ sở dữ liệu không còn đủ theo cấu hình đã lưu.')}</p>
          </div>
          <button type="button" data-action="close" class="rounded-lg px-2.5 py-1.5 text-slate-500 hover:bg-white font-bold">✕</button>
        </div>
      </div>

      <div class="p-5 space-y-4">
        <div>
          <div class="font-bold text-slate-800">Đề: ${escapeHtml(data.name || examId)}</div>
          <div class="text-xs text-slate-500 mt-1">Hệ thống vừa đối chiếu trực tiếp với cơ sở dữ liệu, không dựa vào cache trên trình duyệt.</div>
        </div>

        ${shortages.length ? `
          <div class="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div class="font-bold text-amber-900 mb-2">Các phần đang thiếu</div>
            <div class="space-y-1 text-sm text-amber-900">
              ${shortages.map(s => `<div>• ${escapeHtml(s.typeLabel)} – ${escapeHtml(s.levelLabel)}: cần <b>${s.required}</b>, hiện có <b>${s.available}</b>, thiếu <b>${s.missing}</b>.</div>`).join('')}
            </div>
          </div>` : ''}

        <div class="rounded-xl border border-blue-200 bg-blue-50 p-3">
          <div class="font-bold text-blue-900">Cách xử lý an toàn</div>
          <div class="mt-1 text-sm text-blue-800">Bạn có thể giảm số lượng câu về mức ngân hàng hiện có rồi lưu lại. Hệ thống sẽ kiểm tra lại trực tiếp DB trước khi chấp nhận. Hoặc xóa đề và tạo đề khác.</div>
        </div>

        <details class="rounded-xl border border-slate-200 bg-slate-50" open>
          <summary class="cursor-pointer p-3 font-bold text-slate-800">Chỉnh giảm số lượng câu hỏi</summary>
          <div class="p-3 pt-0 space-y-3">
            ${rows.map(row => `
              <div class="rounded-xl bg-white border border-slate-200 p-3" data-repair-type="${row.type}">
                <div class="flex items-center justify-between gap-3 mb-2">
                  <div class="font-bold text-slate-800">${row.label}</div>
                  <div class="text-xs text-slate-500">Tổng có trên DB: <b>${row.available}</b></div>
                </div>
                ${row.hasDetail ? `
                  <div class="grid grid-cols-3 gap-2">
                    ${['NB','TH','VD'].map(level => `
                      <label class="text-xs font-semibold text-slate-600">
                        ${level} <span class="font-normal">(có ${Number(row.byLevel[level] || 0)})</span>
                        <input data-level="${level}" type="number" min="0" max="${Number(row.byLevel[level] || 0)}"
                          value="${Math.min(row.existing[level], Number(row.byLevel[level] || 0))}"
                          class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                      </label>`).join('')}
                  </div>`
                : `
                  <label class="text-xs font-semibold text-slate-600">Tổng số câu
                    <input data-total type="number" min="0" max="${row.available}" value="${Math.min(row.total, row.available)}"
                      class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                  </label>`}
              </div>`).join('')}
            <button type="button" data-action="repair" class="w-full rounded-xl bg-emerald-600 px-4 py-3 font-black text-white hover:bg-emerald-700">
              Lưu cấu hình đã giảm và kiểm tra lại
            </button>
          </div>
        </details>

        <div class="flex flex-col sm:flex-row gap-2">
          <button type="button" data-action="delete" class="flex-1 rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 font-bold text-red-700 hover:bg-red-100">🗑️ Xóa đề này</button>
          <button type="button" data-action="close" class="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 font-bold text-slate-700 hover:bg-slate-50">Đóng</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  modal.querySelectorAll('[data-action="close"]').forEach(btn => btn.addEventListener('click', closeGuardModal));
  modal.addEventListener('click', e => {
    if (e.target === modal) e.stopPropagation();
  });

  modal.querySelector('[data-action="repair"]')?.addEventListener('click', async () => {
    const button = modal.querySelector('[data-action="repair"]');
    if (button) { button.disabled = true; button.textContent = 'Đang kiểm tra và lưu...'; }
    try {
      const updated = {...data};
      const countsDetail = parseObject(data.counts_detail ?? data.countsDetail);
      for (const row of rows) {
        const box = modal.querySelector('[data-repair-type="' + row.type + '"]');
        if (!box) continue;
        if (row.hasDetail) {
          let total = 0;
          for (const level of ['NB','TH','VD']) {
            const input = box.querySelector('[data-level="' + level + '"]');
            const max = Number(row.byLevel[level] || 0);
            const value = Math.max(0, Math.min(max, Math.floor(Number(input?.value) || 0)));
            countsDetail['count' + row.key + level] = value;
            total += value;
          }
          updated[row.apiKey] = total;
        } else {
          const input = box.querySelector('[data-total]');
          updated[row.apiKey] = Math.max(0, Math.min(row.available, Math.floor(Number(input?.value) || 0)));
        }
      }
      updated.counts_detail = countsDetail;
      updated.expected_updated_at = data.updated_at ?? data.expected_updated_at ?? null;

      const token = authToken();
      const response = await fetch('/api/exams', {
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer ' + token},
        body:JSON.stringify(updated)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || 'Cấu hình vẫn chưa hợp lệ nên chưa được lưu.');
      }
      closeGuardModal();
      if (typeof window.showToast === 'function') {
        window.showToast('✅ Đã sửa cấu hình. Hệ thống đã xác minh ngân hàng câu hỏi trên cơ sở dữ liệu.', 'success');
      }
      if (typeof window.updateExamNamesList === 'function') await window.updateExamNamesList(true);
      if (typeof window.refreshExamsData === 'function') await window.refreshExamsData();
      setTimeout(() => window.loadExamConfigById?.(examId), 50);
    } catch (error) {
      if (typeof window.showToast === 'function') window.showToast(error?.message || 'Không thể sửa cấu hình đề.', 'error');
      else console.error(error);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Lưu cấu hình đã giảm và kiểm tra lại'; }
    }
  });

  modal.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
    const performDelete = async () => {
      try {
        const token = authToken();
        const response = await fetch('/api/exams?id=' + encodeURIComponent(examId), {
          method:'DELETE',
          headers:{'Authorization':'Bearer ' + token}
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result?.success) throw new Error(result?.error || 'Không thể xóa đề thi.');
        closeGuardModal();
        if (typeof window.showToast === 'function') window.showToast('🗑️ Đã xóa đề thi không còn hợp lệ.', 'success');
        if (typeof window.updateExamNamesList === 'function') await window.updateExamNamesList(true);
        if (typeof window.switchTab === 'function') window.switchTab('exams');
      } catch (error) {
        if (typeof window.showToast === 'function') window.showToast(error?.message || 'Không thể xóa đề thi.', 'error');
      }
    };
    if (typeof window.showConfirmModal === 'function') {
      window.showConfirmModal('Xóa đề thi không còn hợp lệ này? Đề đã có bài làm của học sinh sẽ không được phép xóa để bảo toàn lịch sử kết quả.', performDelete);
    } else {
      performDelete();
    }
  });
}

async function inspectExam(examId) {
  const token = authToken();
  if (!token) return null;
  const response = await fetch('/api/exams?id=' + encodeURIComponent(examId), {
    cache:'no-store',
    headers:{'Authorization':'Bearer ' + token, 'Cache-Control':'no-cache'}
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

function installGuard() {
  if (window.__invalidExamPoolGuardInstalled) return;
  const original = window.loadExamConfigById;
  if (typeof original !== 'function') {
    setTimeout(installGuard, 100);
    return;
  }
  window.__invalidExamPoolGuardInstalled = true;
  window.loadExamConfigById = async function guardedLoadExamConfigById(examId, ...args) {
    try {
      const payload = await inspectExam(examId);
      const validity = payload?.question_pool_validity;
      if (validity && validity.valid === false) {
        showInvalidExamModal(payload, examId);
        return;
      }
    } catch (error) {
      console.error('Không thể xác minh tình trạng ngân hàng câu hỏi trước khi nạp đề:', error);
      if (typeof window.showToast === 'function') {
        window.showToast('Không thể xác minh ngân hàng câu hỏi trên cơ sở dữ liệu. Đề chưa được nạp để tránh sai lệch.', 'error');
      }
      return;
    }
    return original.call(this, examId, ...args);
  };
}

installGuard();
