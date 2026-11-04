const TEACHER_BATCH_STEPS = Object.freeze([
  { key: 'results', label: 'Kết quả bài làm và dữ liệu nộp bài' },
  { key: 'questions', label: 'Câu hỏi do giáo viên tạo' },
  { key: 'exams', label: 'Đề kiểm tra do giáo viên tạo' },
  { key: 'related', label: 'Dữ liệu liên quan (lớp, tài liệu, bảng, QR)' },
  { key: 'accounts', label: 'Tài khoản đăng nhập' },
  { key: 'user', label: 'Hồ sơ giáo viên' }
]);

const STUDENT_BATCH_STEPS = Object.freeze([
  { key: 'results', label: 'Kết quả và các lần làm bài' },
  { key: 'submissions', label: 'Dữ liệu phiên/nộp bài chống nộp trùng' },
  { key: 'participation', label: 'Dữ liệu tham gia quét thẻ và bảng tương tác' },
  { key: 'accounts', label: 'Tài khoản đăng nhập' },
  { key: 'user', label: 'Hồ sơ học sinh' }
]);

function stepsForEntry(entry) {
  return entry?.isStudent ? STUDENT_BATCH_STEPS : TEACHER_BATCH_STEPS;
}

const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const normalize = value => String(value ?? '').trim().toLocaleLowerCase('vi');

function tenantStorageKey(name) {
  try {
    return typeof window.tenantStorageKey === 'function' ? window.tenantStorageKey(name) : name;
  } catch {
    return name;
  }
}

function linkedAccountFor(userId) {
  const list = Array.isArray(window.accounts) ? window.accounts :
    (typeof accounts !== 'undefined' && Array.isArray(accounts) ? accounts : []);
  return list.find(a => String(a?.user_id ?? '') === String(userId) || String(a?.id ?? '') === String(userId)) || null;
}

function currentUsers() {
  if (Array.isArray(window.usersList)) return window.usersList;
  try {
    if (typeof usersList !== 'undefined' && Array.isArray(usersList)) return usersList;
  } catch {}
  return [];
}

function classifyUser(user) {
  const account = linkedAccountFor(user?.id);
  const audience = normalize(user?.target_audience);
  const role = normalize(user?.role || user?.account_role || account?.role);
  const username = normalize(account?.username || user?.username);
  const accountId = normalize(account?.id);

  const isAdmin = audience === 'quản trị viên' || role === 'admin' ||
    username === 'admin' || username === 'adminhht' ||
    accountId === 'admin' || accountId === 'adminhht';

  const isTeacher = audience === 'giáo viên' || role === 'teacher' || role === 'giáo viên';
  const isStudent = audience === 'học sinh' || audience === 'student';

  return { user, account, isAdmin, isTeacher, isStudent };
}

function selectedEntries() {
  const ids = window.selectedUserIds ? Array.from(window.selectedUserIds).map(String) : [];
  const users = currentUsers();
  return ids.map(id => {
    const user = users.find(u => String(u?.id) === id) || { id, full_name: id };
    return classifyUser(user);
  });
}

function ensureModal() {
  let modal = document.getElementById('batch-teacher-delete-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'batch-teacher-delete-modal';
  modal.className = 'hidden fixed inset-0 z-[100001] items-center justify-center bg-slate-950/60 p-2 sm:p-4 backdrop-blur-[2px]';
  modal.innerHTML = `
    <div class="w-full max-w-6xl max-h-[94vh] overflow-hidden rounded-2xl border border-white/20 bg-slate-50 shadow-2xl" role="dialog" aria-modal="true">
      <div class="flex items-start justify-between gap-3 border-b border-rose-100 bg-gradient-to-r from-rose-700 to-red-600 px-4 py-3 text-white">
        <div>
          <h3 class="text-sm sm:text-base font-black">Xóa nhiều hồ sơ người dùng và toàn bộ dữ liệu liên quan</h3>
          <p class="mt-0.5 text-[11px] text-rose-50">Xử lý tuần tự từng hồ sơ. Mỗi người dùng là một giao dịch nguyên tử riêng: lỗi ở đâu sẽ rollback toàn bộ người dùng đó.</p>
        </div>
        <div id="batch-delete-header-count" class="shrink-0 rounded-full bg-white/15 px-3 py-1 text-xs font-black">0 hồ sơ</div>
      </div>

      <div class="max-h-[78vh] overflow-y-auto p-3 sm:p-4">
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div class="rounded-xl border border-slate-200 bg-white p-2.5">
            <div class="text-[10px] font-bold uppercase tracking-wide text-slate-500">Cần xóa</div>
            <div id="batch-delete-total" class="mt-0.5 text-xl font-black text-slate-900">0</div>
          </div>
          <div class="rounded-xl border border-blue-200 bg-blue-50 p-2.5">
            <div class="text-[10px] font-bold uppercase tracking-wide text-blue-600">Đang xử lý</div>
            <div id="batch-delete-current-count" class="mt-0.5 text-xl font-black text-blue-800">0</div>
          </div>
          <div class="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5">
            <div class="text-[10px] font-bold uppercase tracking-wide text-emerald-600">Thành công</div>
            <div id="batch-delete-success-count" class="mt-0.5 text-xl font-black text-emerald-800">0</div>
          </div>
          <div class="rounded-xl border border-red-200 bg-red-50 p-2.5">
            <div class="text-[10px] font-bold uppercase tracking-wide text-red-600">Lỗi / rollback</div>
            <div id="batch-delete-fail-count" class="mt-0.5 text-xl font-black text-red-800">0</div>
          </div>
        </div>

        <div id="batch-delete-protected-note" class="mt-3 hidden rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800"></div>

        <div class="mt-3 grid gap-3 lg:grid-cols-3">
          <section class="rounded-xl border border-slate-200 bg-white">
            <div class="border-b border-slate-100 px-3 py-2">
              <h4 class="text-xs font-black text-slate-800">Danh sách hồ sơ cần xóa</h4>
            </div>
            <div id="batch-delete-queue" class="max-h-52 overflow-y-auto p-2 space-y-1.5"></div>
          </section>

          <section class="rounded-xl border border-emerald-200 bg-white">
            <div class="border-b border-emerald-100 px-3 py-2">
              <h4 class="text-xs font-black text-emerald-800">Danh sách đã xóa thành công</h4>
            </div>
            <div id="batch-delete-success-list" class="max-h-52 overflow-y-auto p-2 space-y-1.5">
              <div class="py-4 text-center text-[11px] italic text-slate-400">Chưa có hồ sơ nào hoàn tất.</div>
            </div>
          </section>

          <section class="rounded-xl border border-red-200 bg-white">
            <div class="border-b border-red-100 px-3 py-2">
              <h4 class="text-xs font-black text-red-800">Lỗi / đã rollback</h4>
            </div>
            <div id="batch-delete-fail-list" class="max-h-52 overflow-y-auto p-2 space-y-1.5">
              <div class="py-4 text-center text-[11px] italic text-slate-400">Không có lỗi.</div>
            </div>
          </section>
        </div>

        <section class="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
            <div>
              <h4 class="text-xs font-black text-slate-800">Trình tự xóa người dùng hiện tại</h4>
              <div id="batch-delete-current-name" class="mt-0.5 text-[11px] font-semibold text-blue-700">Chưa bắt đầu</div>
            </div>
            <div id="batch-delete-transaction-note" class="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">Chờ xác nhận</div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[620px] text-xs">
              <thead class="bg-slate-50 text-slate-600">
                <tr>
                  <th class="w-12 px-3 py-2 text-center">STT</th>
                  <th class="px-3 py-2 text-left">Nhóm dữ liệu xóa tuần tự</th>
                  <th class="w-36 px-3 py-2 text-center">Trạng thái</th>
                  <th class="w-28 px-3 py-2 text-right">Đã xóa</th>
                </tr>
              </thead>
              <tbody id="batch-delete-step-body"></tbody>
              <tfoot class="border-t border-slate-200 bg-slate-50">
                <tr>
                  <td colspan="3" class="px-3 py-2 text-right text-[11px] font-black text-slate-600">Tổng cộng của hồ sơ hiện tại</td>
                  <td id="batch-delete-current-total" class="px-3 py-2 text-right font-black text-slate-900">0</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <div id="batch-delete-final-message" class="mt-3 hidden rounded-xl border p-3 text-xs font-bold"></div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-3">
        <div class="text-[10px] leading-relaxed text-slate-500">
          Không chạy song song. Người dùng tiếp theo chỉ bắt đầu sau khi người dùng hiện tại đã commit hoặc rollback xong.
        </div>
        <div class="flex items-center gap-2">
          <button id="batch-delete-cancel" type="button" class="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Hủy</button>
          <button id="batch-delete-start" type="button" class="rounded-xl bg-red-600 px-3 py-2 text-xs font-black text-white shadow-sm hover:bg-red-700">Xóa toàn bộ đã chọn</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

function renderStepTable(modal, steps) {
  const tbody = modal.querySelector('#batch-delete-step-body');
  if (!tbody) return;
  tbody.innerHTML = steps.map((step, index) => `
    <tr data-batch-step="${step.key}" class="border-t border-slate-100">
      <td class="px-3 py-2 text-center font-bold text-slate-400">${index + 1}</td>
      <td class="px-3 py-2 font-semibold text-slate-700">${esc(step.label)}</td>
      <td data-step-status class="px-3 py-2 text-center"><span class="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">Chờ xử lý</span></td>
      <td data-step-count class="px-3 py-2 text-right font-black text-slate-500">-</td>
    </tr>
  `).join('');
}

function setStep(modal, key, state, count = null) {
  const row = modal.querySelector(`[data-batch-step="${key}"]`);
  if (!row) return;
  const status = row.querySelector('[data-step-status]');
  const countEl = row.querySelector('[data-step-count]');
  const label = {
    waiting: ['Chờ xử lý', 'bg-slate-100 text-slate-500'],
    running: ['Đang xử lý', 'bg-blue-100 text-blue-700'],
    done: ['Hoàn tất', 'bg-emerald-100 text-emerald-700'],
    rollback: ['Rollback', 'bg-red-100 text-red-700']
  }[state] || ['Chờ xử lý', 'bg-slate-100 text-slate-500'];

  status.innerHTML = `<span class="rounded-full px-2 py-1 text-[10px] font-black ${label[1]}">${label[0]}</span>`;
  countEl.textContent = count == null ? '-' : Number(count || 0).toLocaleString('vi-VN');
  row.classList.toggle('bg-blue-50/50', state === 'running');
  row.classList.toggle('bg-emerald-50/40', state === 'done');
  row.classList.toggle('bg-red-50/50', state === 'rollback');
}

function resetSteps(modal, steps) {
  renderStepTable(modal, steps);
  steps.forEach(s => setStep(modal, s.key, 'waiting'));
  const total = modal.querySelector('#batch-delete-current-total');
  if (total) total.textContent = '0';
}

function isTruthy(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

function normalizeServerSteps(payload, steps) {
  const source = Array.isArray(payload?.data?.steps) ? payload.data.steps : [];
  if (source.length) {
    const map = new Map(source.map(s => [s.key, { ...s, count: Number(s.count || 0) }]));
    return steps.map(step => ({
      key: step.key,
      label: step.label,
      count: Number(map.get(step.key)?.count || 0)
    }));
  }

  // User thường không có chuỗi dữ liệu giáo viên; vẫn thể hiện đúng kết quả API.
  const accountCount = Number(payload?.data?.deletedAccountsCount || 0);
  return steps.map(step => ({
    key: step.key,
    label: step.label,
    count: step.key === 'accounts' ? accountCount : (step.key === 'user' ? 1 : 0)
  }));
}

function summaryText(serverSteps) {
  return serverSteps.map(s => `${Number(s.count || 0)} ${s.label.toLocaleLowerCase('vi')}`).join(' · ');
}

function queueRow(entry, index) {
  const u = entry.user || {};
  const type = entry.isStudent ? 'Học sinh' : (entry.isTeacher ? 'Giáo viên' : 'Người dùng');
  return `
    <div data-queue-id="${esc(u.id)}" class="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="truncate text-[11px] font-black text-slate-800">${index + 1}. ${esc(u.full_name || u.id)}</div>
          <div class="truncate text-[10px] text-slate-500">ID: ${esc(u.id)} · ${type}</div>
        </div>
        <span data-queue-state class="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[9px] font-black text-slate-600">Chờ</span>
      </div>
    </div>
  `;
}

function setQueueState(modal, id, state) {
  const row = modal.querySelector(`[data-queue-id="${CSS.escape(String(id))}"]`);
  if (!row) return;
  const badge = row.querySelector('[data-queue-state]');
  const config = {
    waiting: ['Chờ', 'bg-slate-200 text-slate-600'],
    running: ['Đang xóa', 'bg-blue-100 text-blue-700'],
    done: ['Đã xóa', 'bg-emerald-100 text-emerald-700'],
    failed: ['Lỗi', 'bg-red-100 text-red-700']
  }[state];
  if (!config || !badge) return;
  badge.className = 'shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black ' + config[1];
  badge.textContent = config[0];
}

function addSuccess(modal, entry, serverSteps) {
  const box = modal.querySelector('#batch-delete-success-list');
  if (!box) return;
  if (box.dataset.hasItems !== '1') {
    box.innerHTML = '';
    box.dataset.hasItems = '1';
  }
  const u = entry.user || {};
  const div = document.createElement('div');
  div.className = 'rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2';
  div.innerHTML = `
    <div class="text-[11px] font-black text-emerald-900">✓ ${esc(u.full_name || u.id)}</div>
    <div class="mt-0.5 text-[10px] text-emerald-700">${esc(summaryText(serverSteps))}</div>
  `;
  box.appendChild(div);
}

function addFailure(modal, entry, message) {
  const box = modal.querySelector('#batch-delete-fail-list');
  if (!box) return;
  if (box.dataset.hasItems !== '1') {
    box.innerHTML = '';
    box.dataset.hasItems = '1';
  }
  const u = entry.user || {};
  const div = document.createElement('div');
  div.className = 'rounded-lg border border-red-200 bg-red-50 px-2.5 py-2';
  div.innerHTML = `
    <div class="text-[11px] font-black text-red-900">✕ ${esc(u.full_name || u.id)}</div>
    <div class="mt-0.5 text-[10px] leading-relaxed text-red-700">${esc(message || 'Không thể xóa hồ sơ này. Giao dịch đã rollback toàn bộ.')}</div>
  `;
  box.appendChild(div);
}

function setCurrentHeader(modal, entry, index, total) {
  const u = entry.user || {};
  const name = modal.querySelector('#batch-delete-current-name');
  if (name) name.textContent = `[${index + 1}/${total}] ${u.full_name || u.id} — ID: ${u.id}`;
  const note = modal.querySelector('#batch-delete-transaction-note');
  if (note) {
    note.className = 'rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-black text-blue-700';
    note.textContent = entry.isStudent ? 'Đang xóa đúng dữ liệu Học sinh' : (entry.isTeacher ? 'Đang xóa dữ liệu Giáo viên' : 'Đang xóa hồ sơ người dùng');
  }
}

async function refreshAfterBatch(token) {
  try {
    if (typeof window.refreshUsersData === 'function') {
      await window.refreshUsersData();
    } else if (typeof window.renderUsers === 'function') {
      await window.renderUsers();
    }
  } catch (e) {
    console.warn('Không thể làm mới bảng hồ sơ sau xóa hàng loạt:', e);
  }

  try {
    const response = await fetch('/api/accounts', {
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
    });
    const json = await response.json();
    if (response.ok && Array.isArray(json?.data)) {
      try { accounts = json.data; } catch {}
      window.accounts = json.data;
      if (typeof window.renderAccounts === 'function') window.renderAccounts();
      else {
        try { if (typeof renderAccounts === 'function') renderAccounts(); } catch {}
      }
    }
  } catch (e) {
    console.warn('Không thể làm mới tài khoản sau xóa hàng loạt:', e);
  }
}

async function deleteOne(modal, entry, index, total, token) {
  const stepsConfig = stepsForEntry(entry);
  resetSteps(modal, stepsConfig);
  setCurrentHeader(modal, entry, index, total);
  setQueueState(modal, entry.user.id, 'running');

  let visualIndex = 0;
  setStep(modal, stepsConfig[0].key, 'running');
  const activity = setInterval(() => {
    if (visualIndex < stepsConfig.length - 1) {
      setStep(modal, stepsConfig[visualIndex].key, 'waiting');
      visualIndex += 1;
      setStep(modal, stepsConfig[visualIndex].key, 'running');
    }
  }, 650);

  try {
    const response = await fetch('/api/users/' + encodeURIComponent(entry.user.id), {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
      throw new Error(payload?.error || ('Máy chủ trả về lỗi ' + response.status));
    }

    clearInterval(activity);
    const steps = normalizeServerSteps(payload, stepsConfig);
    let totalDeleted = 0;
    for (const step of steps) {
      totalDeleted += Number(step.count || 0);
      setStep(modal, step.key, 'done', step.count);
    }
    const totalEl = modal.querySelector('#batch-delete-current-total');
    if (totalEl) totalEl.textContent = totalDeleted.toLocaleString('vi-VN');
    setQueueState(modal, entry.user.id, 'done');
    return { ok: true, payload, steps, totalDeleted };
  } catch (error) {
    clearInterval(activity);
    stepsConfig.forEach((step, idx) => {
      setStep(modal, step.key, idx <= visualIndex ? 'rollback' : 'waiting');
    });
    const totalEl = modal.querySelector('#batch-delete-current-total');
    if (totalEl) totalEl.textContent = '0';
    setQueueState(modal, entry.user.id, 'failed');
    return { ok: false, error: error?.message || String(error) };
  }
}

async function runBatch(modal, deletable, protectedEntries) {
  if (modal.dataset.busy === '1') return;
  modal.dataset.busy = '1';

  const cancel = modal.querySelector('#batch-delete-cancel');
  const start = modal.querySelector('#batch-delete-start');
  if (cancel) {
    cancel.disabled = true;
    cancel.classList.add('opacity-50', 'cursor-not-allowed');
  }
  if (start) {
    start.disabled = true;
    start.classList.add('opacity-60', 'cursor-wait');
    start.textContent = 'Đang xóa tuần tự...';
  }

  const token = localStorage.getItem(tenantStorageKey('auth_token')) || '';
  let successCount = 0;
  let failCount = 0;
  const failedIds = [];

  for (let index = 0; index < deletable.length; index++) {
    const entry = deletable[index];
    const currentCount = modal.querySelector('#batch-delete-current-count');
    if (currentCount) currentCount.textContent = String(index + 1);

    const result = await deleteOne(modal, entry, index, deletable.length, token);
    if (result.ok) {
      successCount += 1;
      addSuccess(modal, entry, result.steps);
      window.selectedUserIds?.delete?.(String(entry.user.id));
      const successEl = modal.querySelector('#batch-delete-success-count');
      if (successEl) successEl.textContent = String(successCount);

      // Loại khỏi cache ngay để bảng không hiển thị lại trong lúc chờ refresh.
      if (Array.isArray(window.usersList)) {
        window.usersList = window.usersList.filter(u => String(u?.id) !== String(entry.user.id));
      }
      try {
        if (typeof usersList !== 'undefined' && Array.isArray(usersList)) {
          usersList = usersList.filter(u => String(u?.id) !== String(entry.user.id));
        }
      } catch {}
    } else {
      failCount += 1;
      failedIds.push(String(entry.user.id));
      addFailure(modal, entry, result.error);
      const failEl = modal.querySelector('#batch-delete-fail-count');
      if (failEl) failEl.textContent = String(failCount);
    }
  }

  // Chỉ giữ lựa chọn của các hồ sơ lỗi để Admin có thể bấm thử lại.
  window.selectedUserIds = new Set(failedIds);
  await refreshAfterBatch(token);
  if (typeof window.updateSelectedUsersUI === 'function') window.updateSelectedUsersUI();

  const note = modal.querySelector('#batch-delete-transaction-note');
  if (note) {
    note.className = 'rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-600';
    note.textContent = 'Đã kết thúc';
  }

  const final = modal.querySelector('#batch-delete-final-message');
  if (final) {
    final.classList.remove('hidden', 'border-emerald-200', 'bg-emerald-50', 'text-emerald-800', 'border-amber-200', 'bg-amber-50', 'text-amber-800');
    if (failCount === 0) {
      final.classList.add('border-emerald-200', 'bg-emerald-50', 'text-emerald-800');
      final.textContent = `Hoàn tất: đã xóa thành công ${successCount}/${deletable.length} hồ sơ. Tất cả hồ sơ đã qua kiểm toán chống dữ liệu mồ côi.`;
    } else {
      final.classList.add('border-amber-200', 'bg-amber-50', 'text-amber-800');
      final.textContent = `Đã xóa thành công ${successCount}/${deletable.length}; ${failCount} hồ sơ lỗi đã rollback toàn bộ và được giữ lại trong trạng thái chọn để có thể thử lại.`;
    }
  }

  modal.dataset.busy = '0';
  if (cancel) {
    cancel.disabled = false;
    cancel.classList.remove('opacity-50', 'cursor-not-allowed');
    cancel.textContent = 'Đóng';
  }
  if (start) {
    start.disabled = true;
    start.classList.remove('cursor-wait');
    start.textContent = failCount ? 'Hoàn tất có lỗi' : 'Đã hoàn tất';
  }

  if (typeof window.showToast === 'function') {
    const extra = protectedEntries.length ? ` Bỏ qua ${protectedEntries.length} hồ sơ Admin được bảo vệ.` : '';
    window.showToast(
      failCount === 0
        ? `✅ Đã xóa tuần tự thành công ${successCount} hồ sơ.${extra}`
        : `⚠️ Thành công ${successCount}, lỗi/rollback ${failCount}.${extra}`,
      failCount === 0 ? 'success' : 'warning'
    );
  }
}

function openBatchModal(entries) {
  const modal = ensureModal();
  const protectedEntries = entries.filter(e => e.isAdmin);
  const deletable = entries.filter(e => !e.isAdmin);

  modal.dataset.busy = '0';
  modal.querySelector('#batch-delete-header-count').textContent = `${deletable.length} hồ sơ`;
  modal.querySelector('#batch-delete-total').textContent = String(deletable.length);
  modal.querySelector('#batch-delete-current-count').textContent = '0';
  modal.querySelector('#batch-delete-success-count').textContent = '0';
  modal.querySelector('#batch-delete-fail-count').textContent = '0';
  modal.querySelector('#batch-delete-current-name').textContent = 'Chưa bắt đầu';
  modal.querySelector('#batch-delete-current-total').textContent = '0';

  const successList = modal.querySelector('#batch-delete-success-list');
  if (successList) {
    successList.dataset.hasItems = '0';
    successList.innerHTML = '<div class="py-4 text-center text-[11px] italic text-slate-400">Chưa có hồ sơ nào hoàn tất.</div>';
  }
  const failList = modal.querySelector('#batch-delete-fail-list');
  if (failList) {
    failList.dataset.hasItems = '0';
    failList.innerHTML = '<div class="py-4 text-center text-[11px] italic text-slate-400">Không có lỗi.</div>';
  }

  const queue = modal.querySelector('#batch-delete-queue');
  if (queue) queue.innerHTML = deletable.map(queueRow).join('');

  const protectedNote = modal.querySelector('#batch-delete-protected-note');
  if (protectedNote) {
    if (protectedEntries.length) {
      protectedNote.classList.remove('hidden');
      protectedNote.innerHTML = `⚠️ Có <strong>${protectedEntries.length}</strong> hồ sơ Quản trị viên được hệ thống tự động bảo vệ và không đưa vào quy trình xóa.`;
    } else {
      protectedNote.classList.add('hidden');
      protectedNote.textContent = '';
    }
  }

  renderStepTable(modal, deletable.length ? stepsForEntry(deletable[0]) : TEACHER_BATCH_STEPS);
  const final = modal.querySelector('#batch-delete-final-message');
  if (final) final.classList.add('hidden');

  const cancel = modal.querySelector('#batch-delete-cancel');
  const start = modal.querySelector('#batch-delete-start');
  if (cancel) {
    cancel.disabled = false;
    cancel.textContent = 'Hủy';
    cancel.classList.remove('opacity-50', 'cursor-not-allowed');
    cancel.onclick = () => {
      if (modal.dataset.busy === '1') return;
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    };
  }
  if (start) {
    start.disabled = deletable.length === 0;
    start.textContent = deletable.length ? `Xóa tuần tự ${deletable.length} hồ sơ` : 'Không có hồ sơ có thể xóa';
    start.classList.remove('opacity-60', 'cursor-wait');
    start.onclick = () => runBatch(modal, deletable, protectedEntries);
  }

  modal.onclick = event => {
    if (event.target === modal && modal.dataset.busy !== '1') {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
  };

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function installOverride() {
  const original = window.confirmDeleteSelectedUsers;
  if (typeof original !== 'function' || original.__batchTeacherDeleteWrapped) return false;

  const wrapped = function() {
    const entries = selectedEntries();
    if (!entries.length) return original();

    const deletable = entries.filter(e => !e.isAdmin);
    if (!deletable.length) return original();

    // Mỗi loại hồ sơ dùng đúng quy trình riêng: Học sinh chỉ xóa dữ liệu học sinh,
    // Giáo viên xóa dữ liệu sở hữu của giáo viên; Admin luôn được bảo vệ.
    openBatchModal(entries);
  };

  wrapped.__batchTeacherDeleteWrapped = true;
  wrapped.__original = original;
  window.confirmDeleteSelectedUsers = wrapped;
  return true;
}

if (!installOverride()) {
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (installOverride() || attempts > 120) clearInterval(timer);
  }, 100);
}
