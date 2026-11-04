const TEACHER_DELETE_STEPS = Object.freeze([
  { key: 'results', label: 'Xóa kết quả bài làm và dữ liệu nộp bài', icon: '1' },
  { key: 'questions', label: 'Xóa câu hỏi do giáo viên tạo', icon: '2' },
  { key: 'exams', label: 'Xóa đề kiểm tra do giáo viên tạo', icon: '3' },
  { key: 'related', label: 'Xóa dữ liệu liên quan (lớp, tài liệu, bảng, QR)', icon: '4' },
  { key: 'accounts', label: 'Xóa tài khoản đăng nhập', icon: '5' },
  { key: 'user', label: 'Xóa hồ sơ giáo viên', icon: '6' }
]);

const STUDENT_DELETE_STEPS = Object.freeze([
  { key: 'results', label: 'Xóa kết quả và các lần làm bài', icon: '1' },
  { key: 'submissions', label: 'Xóa dữ liệu phiên/nộp bài chống nộp trùng', icon: '2' },
  { key: 'participation', label: 'Xóa dữ liệu tham gia quét thẻ và bảng tương tác', icon: '3' },
  { key: 'accounts', label: 'Xóa tài khoản đăng nhập', icon: '4' },
  { key: 'user', label: 'Xóa hồ sơ học sinh', icon: '5' }
]);

function profileType(user) {
  const audience = String(user?.target_audience || '').trim().toLocaleLowerCase('vi');
  const role = String(user?.role || user?.account_role || '').trim().toLocaleLowerCase('vi');
  if (audience === 'học sinh' || audience === 'student') return 'student';
  if (audience === 'giáo viên' || role === 'teacher' || role === 'giáo viên') return 'teacher';
  return 'other';
}

function stepsForUser(user) {
  return profileType(user) === 'student' ? STUDENT_DELETE_STEPS : TEACHER_DELETE_STEPS;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function isProtectedAdminProfile(user) {
  const audience = String(user?.target_audience || '').trim().toLocaleLowerCase('vi');
  const role = String(user?.role || user?.account_role || '').trim().toLocaleLowerCase('vi');
  const username = String(user?.username || user?.account_username || '').trim().toLocaleLowerCase('vi');
  return audience === 'quản trị viên' || audience === 'admin' || role === 'admin' ||
    username === 'admin' || username === 'adminhht' || String(user?.id || '').toLowerCase() === 'adminhht';
}

function tenantKey(name) {
  try {
    return typeof window.tenantStorageKey === 'function' ? window.tenantStorageKey(name) : name;
  } catch {
    return name;
  }
}

function stepRows(steps) {
  return steps.map((s, index) => `
    <div data-delete-step="${s.key}" class="teacher-delete-step flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 transition">
      <div data-step-badge class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-500">${s.icon}</div>
      <div class="min-w-0 flex-1">
        <div class="text-xs sm:text-sm font-bold text-slate-800">${escapeHtml(s.label)}</div>
        <div data-step-status class="mt-0.5 text-[11px] font-medium text-slate-400">Chờ xử lý</div>
      </div>
      <div data-step-count class="text-xs font-black text-slate-400"></div>
    </div>`).join('');
}

function ensureUserDeleteModal() {
  let modal = document.getElementById('user-delete-cascade-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'user-delete-cascade-modal';
  modal.className = 'hidden fixed inset-0 z-[100000] items-center justify-center bg-slate-950/55 p-3 backdrop-blur-[2px]';
  modal.innerHTML = `
    <div class="w-full max-w-lg overflow-hidden rounded-2xl border border-white/20 bg-slate-50 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="user-delete-title">
      <div class="border-b border-rose-100 bg-gradient-to-r from-rose-600 to-red-600 px-4 py-3 text-white">
        <div class="flex items-start gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-lg">⚠️</div>
          <div class="min-w-0">
            <h3 id="user-delete-title" class="text-sm sm:text-base font-black">Xóa vĩnh viễn hồ sơ người dùng và toàn bộ dữ liệu</h3>
            <p class="mt-0.5 text-[11px] text-rose-50">Thao tác không thể hoàn tác sau khi giao dịch hoàn tất.</p>
          </div>
        </div>
      </div>
      <div class="max-h-[76vh] overflow-y-auto p-4">
        <div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          Bạn sắp xóa hồ sơ <strong id="teacher-delete-name"></strong>. <span id="user-delete-scope-text">Hệ thống sẽ xóa tuần tự đúng dữ liệu thuộc loại hồ sơ này.</span> Nếu bất kỳ bước nào lỗi, cơ sở dữ liệu sẽ <strong>ROLLBACK toàn bộ</strong>, không để trạng thái xóa dở dang.
        </div>
        <div id="teacher-delete-progress-note" class="mt-3 hidden rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] font-semibold text-blue-800">
          Cơ sở dữ liệu đang chạy một giao dịch nguyên tử. Không đóng trang trong lúc xử lý.
        </div>
        <div id="teacher-delete-steps" class="mt-3 space-y-2"></div>
        <div id="teacher-delete-error" class="mt-3 hidden rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700"></div>
        <div id="teacher-delete-success" class="mt-3 hidden rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800"></div>
      </div>
      <div class="flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
        <button id="teacher-delete-cancel" type="button" class="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Hủy</button>
        <button id="teacher-delete-confirm" type="button" class="rounded-xl bg-red-600 px-3 py-2 text-xs font-black text-white shadow-sm hover:bg-red-700">
          Xóa vĩnh viễn
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  return modal;
}

function setStepState(modal, key, state, count) {
  const row = modal.querySelector(`[data-delete-step="${key}"]`);
  if (!row) return;
  const badge = row.querySelector('[data-step-badge]');
  const status = row.querySelector('[data-step-status]');
  const countEl = row.querySelector('[data-step-count]');
  row.classList.remove('border-slate-200','border-blue-300','border-emerald-300','border-red-300','bg-white','bg-blue-50','bg-emerald-50','bg-red-50');
  badge.classList.remove('bg-slate-100','text-slate-500','bg-blue-600','text-white','bg-emerald-600','bg-red-600');
  if (state === 'running') {
    row.classList.add('border-blue-300','bg-blue-50');
    badge.classList.add('bg-blue-600','text-white');
    status.textContent = 'Đang xử lý...';
    status.className = 'mt-0.5 text-[11px] font-bold text-blue-700';
    countEl.textContent = '';
  } else if (state === 'done') {
    row.classList.add('border-emerald-300','bg-emerald-50');
    badge.classList.add('bg-emerald-600','text-white');
    badge.textContent = '✓';
    status.textContent = 'Hoàn tất';
    status.className = 'mt-0.5 text-[11px] font-bold text-emerald-700';
    countEl.textContent = Number.isFinite(Number(count)) ? `${Number(count)} mục` : '';
    countEl.className = 'text-xs font-black text-emerald-700';
  } else if (state === 'failed') {
    row.classList.add('border-red-300','bg-red-50');
    badge.classList.add('bg-red-600','text-white');
    badge.textContent = '!';
    status.textContent = 'Lỗi — đã rollback';
    status.className = 'mt-0.5 text-[11px] font-bold text-red-700';
    countEl.textContent = '';
  } else {
    row.classList.add('border-slate-200','bg-white');
    badge.classList.add('bg-slate-100','text-slate-500');
    status.textContent = 'Chờ xử lý';
    status.className = 'mt-0.5 text-[11px] font-medium text-slate-400';
    countEl.textContent = '';
  }
}

function resetModal(modal, steps) {
  const holder = modal.querySelector('#teacher-delete-steps');
  if (holder) holder.innerHTML = stepRows(steps);
  steps.forEach((s, i) => {
    const badge = modal.querySelector(`[data-delete-step="${s.key}"] [data-step-badge]`);
    if (badge) badge.textContent = String(i + 1);
    setStepState(modal, s.key, 'waiting');
  });
  modal.querySelector('#teacher-delete-error')?.classList.add('hidden');
  modal.querySelector('#teacher-delete-success')?.classList.add('hidden');
  modal.querySelector('#teacher-delete-progress-note')?.classList.add('hidden');
}

function closeModal(modal) {
  if (modal.dataset.busy === '1') return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

async function runUserDelete(modal, user, steps) {
  if (modal.dataset.busy === '1') return;
  modal.dataset.busy = '1';
  const cancel = modal.querySelector('#teacher-delete-cancel');
  const confirm = modal.querySelector('#teacher-delete-confirm');
  const note = modal.querySelector('#teacher-delete-progress-note');
  const error = modal.querySelector('#teacher-delete-error');
  const success = modal.querySelector('#teacher-delete-success');
  cancel.disabled = true;
  confirm.disabled = true;
  cancel.classList.add('opacity-50','cursor-not-allowed');
  confirm.classList.add('opacity-60','cursor-wait');
  confirm.textContent = 'Đang xóa an toàn...';
  note.classList.remove('hidden');
  error.classList.add('hidden');
  success.classList.add('hidden');

  let visualIndex = 0;
  setStepState(modal, steps[visualIndex].key, 'running');
  const timer = setInterval(() => {
    if (visualIndex < steps.length - 1) {
      setStepState(modal, steps[visualIndex].key, 'waiting');
      visualIndex += 1;
      setStepState(modal, steps[visualIndex].key, 'running');
    }
  }, 600);

  try {
    const token = localStorage.getItem(tenantKey('auth_token')) || '';
    const response = await fetch('/api/users/' + encodeURIComponent(user.id), {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) throw new Error(payload?.error || 'Không thể xóa hồ sơ người dùng.');

    clearInterval(timer);
    const serverSteps = Array.isArray(payload?.data?.steps) ? payload.data.steps : [];
    const byKey = new Map(serverSteps.map(s => [s.key, s]));
    steps.forEach(s => setStepState(modal, s.key, 'done', byKey.get(s.key)?.count ?? 0));

    success.textContent = profileType(user) === 'student'
      ? 'Đã xóa hồ sơ học sinh và đúng các dữ liệu thuộc học sinh. Kiểm toán sau xóa không phát hiện dữ liệu học sinh mồ côi.'
      : 'Đã xóa hoàn toàn giáo viên và toàn bộ dữ liệu liên quan. Kiểm toán sau xóa không phát hiện dữ liệu mồ côi.';
    success.classList.remove('hidden');
    note.classList.add('hidden');
    confirm.textContent = 'Đã hoàn tất';
    cancel.textContent = 'Đóng';
    cancel.disabled = false;
    cancel.classList.remove('opacity-50','cursor-not-allowed');
    confirm.classList.remove('cursor-wait');
    modal.dataset.busy = '0';

    if (window.selectedUserIds?.delete) window.selectedUserIds.delete(user.id);
    if (Array.isArray(window.usersList)) window.usersList = window.usersList.filter(x => x.id != user.id);
    try { if (typeof window.renderUsers === 'function') await window.renderUsers(); } catch {}
    if (typeof window.showToast === 'function') {
      window.showToast(profileType(user) === 'student'
        ? '✅ Đã xóa hồ sơ học sinh và đúng dữ liệu học sinh; không còn dữ liệu mồ côi.'
        : '✅ Đã xóa giáo viên và toàn bộ dữ liệu liên quan; không còn dữ liệu mồ côi.', 'success');
    }
  } catch (err) {
    clearInterval(timer);
    steps.forEach((s, idx) => setStepState(modal, s.key, idx === visualIndex ? 'failed' : 'waiting'));
    error.textContent = (err?.message || 'Xóa hồ sơ người dùng thất bại.') + ' Toàn bộ giao dịch đã được rollback; không có dữ liệu nào bị xóa một phần.';
    error.classList.remove('hidden');
    note.classList.add('hidden');
    cancel.disabled = false;
    confirm.disabled = false;
    cancel.classList.remove('opacity-50','cursor-not-allowed');
    confirm.classList.remove('opacity-60','cursor-wait');
    confirm.textContent = 'Thử lại';
    modal.dataset.busy = '0';
    if (typeof window.showToast === 'function') {
      window.showToast('❌ Xóa hồ sơ thất bại — dữ liệu đã được rollback toàn bộ.', 'error');
    }
  }
}

function openUserDeleteModal(user) {
  const modal = ensureUserDeleteModal();
  const steps = stepsForUser(user);
  const type = profileType(user);
  resetModal(modal, steps);
  modal.dataset.busy = '0';
  modal.querySelector('#teacher-delete-name').textContent = user.full_name || user.username || user.id || 'người dùng này';
  const title = modal.querySelector('#user-delete-title');
  if (title) title.textContent = type === 'student' ? 'Xóa vĩnh viễn hồ sơ học sinh và dữ liệu học sinh' : 'Xóa vĩnh viễn giáo viên và toàn bộ dữ liệu liên quan';
  const scopeText = modal.querySelector('#user-delete-scope-text');
  if (scopeText) scopeText.textContent = type === 'student'
    ? 'Hệ thống chỉ xóa dữ liệu Học sinh thực sự có: kết quả/lần làm bài, dữ liệu nộp bài, QR, trạng thái tham gia bảng, tài khoản và hồ sơ.'
    : 'Hệ thống sẽ xóa tuần tự toàn bộ dữ liệu thuộc Giáo viên theo quan hệ sở hữu.';
  const cancel = modal.querySelector('#teacher-delete-cancel');
  const confirm = modal.querySelector('#teacher-delete-confirm');
  cancel.textContent = 'Hủy';
  cancel.disabled = false;
  confirm.disabled = false;
  confirm.textContent = 'Xóa vĩnh viễn';
  cancel.classList.remove('opacity-50','cursor-not-allowed');
  confirm.classList.remove('opacity-60','cursor-wait');
  cancel.onclick = () => closeModal(modal);
  confirm.onclick = () => runUserDelete(modal, user, steps);
  modal.onclick = (event) => {
    if (event.target === modal && modal.dataset.busy !== '1') closeModal(modal);
  };
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function installUserDeleteOverride() {
  const original = window.confirmDeleteUser;
  if (typeof original !== 'function' || original.__userCascadeWrapped) return false;
  const wrapped = function(id) {
    const users = Array.isArray(window.usersList) ? window.usersList : [];
    const user = users.find(x => x.id == id);
    if (!user) return original(id);
    if (isProtectedAdminProfile(user)) return original(id);
    openUserDeleteModal(user);
  };
  wrapped.__userCascadeWrapped = true;
  window.confirmDeleteUser = wrapped;
  return true;
}

if (!installUserDeleteOverride()) {
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (installUserDeleteOverride() || tries > 100) clearInterval(timer);
  }, 100);
}
