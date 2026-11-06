const BULK_EXPIRY_MAX = 500;
const ACCOUNT_API = '/api/accounts/bulk-expiry';
const USER_API = '/api/users/bulk-expiry';

function authToken() {
  const key = typeof window.tenantStorageKey === 'function'
    ? window.tenantStorageKey('auth_token')
    : 'auth_token';
  return localStorage.getItem(key) || localStorage.getItem('auth_token') || '';
}

function toast(message, type = 'info') {
  if (typeof window.showToast === 'function') {
    window.showToast(message, type);
    return;
  }
  console[type === 'error' ? 'error' : 'log'](message);
}

function accountMap() {
  const rows = Array.isArray(window.accounts) ? window.accounts : [];
  return new Map(rows.map(row => [String(row?.id || ''), row]).filter(([id]) => id));
}

function isSelectAllCheckbox(box) {
  const marker = [
    box.id, box.name, box.className,
    box.getAttribute('data-action'),
    box.getAttribute('aria-label'),
    box.getAttribute('title')
  ].map(v => String(v || '').toLowerCase()).join(' ');
  return /select.?all|check.?all|chọn tất|chon tat/.test(marker);
}

function accountIdFromCheckbox(box) {
  const map = accountMap();
  const values = [];
  const push = value => {
    const v = String(value ?? '').trim();
    if (v && !['on','true','false','1','0','all'].includes(v.toLowerCase())) values.push(v);
  };
  push(box.getAttribute('data-account-id'));
  push(box.getAttribute('data-id'));
  push(box.value);

  const row = box.closest('[data-account-id],[data-id],tr,article,.account-card,.account-item');
  if (row) {
    push(row.getAttribute('data-account-id'));
    push(row.getAttribute('data-id'));
    row.querySelectorAll('[data-account-id],[data-id]').forEach(node => {
      push(node.getAttribute('data-account-id'));
      push(node.getAttribute('data-id'));
    });
  }

  for (const id of values) if (!map.size || map.has(id)) return id;

  if (row && map.size) {
    const text = String(row.textContent || '').toLowerCase();
    const matches = [...map.entries()].filter(([, account]) => {
      const username = String(account?.username || '').trim().toLowerCase();
      return username && text.includes(username);
    });
    if (matches.length === 1) return matches[0][0];
  }
  return '';
}

function selectedAccountIds() {
  const tab = document.getElementById('tab-accounts');
  if (!tab) return [];
  return [...new Set(
    [...tab.querySelectorAll('input[type="checkbox"]')]
      .filter(box => box.checked && !isSelectAllCheckbox(box))
      .map(accountIdFromCheckbox)
      .filter(Boolean)
  )];
}

function selectedUserIds() {
  if (window.selectedUserIds instanceof Set) {
    return [...window.selectedUserIds].map(id => String(id || '').trim()).filter(Boolean);
  }
  const tab = document.getElementById('tab-users');
  if (!tab) return [];
  const ids = [];
  for (const box of tab.querySelectorAll('input[type="checkbox"]:checked')) {
    if (isSelectAllCheckbox(box)) continue;
    const row = box.closest('[data-user-id],[data-id],tr,article,.user-card,.user-item');
    const candidates = [
      box.getAttribute('data-user-id'),
      box.getAttribute('data-id'),
      box.value,
      row?.getAttribute('data-user-id'),
      row?.getAttribute('data-id')
    ];
    const id = candidates.map(v => String(v ?? '').trim())
      .find(v => v && !['on','true','false','1','0','all'].includes(v.toLowerCase()));
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

function selectedIds(scope) {
  return scope === 'accounts' ? selectedAccountIds() : selectedUserIds();
}

function scopeLabel(scope) {
  return scope === 'accounts' ? 'tài khoản' : 'người dùng';
}

function updateButtons() {
  for (const scope of ['accounts', 'users']) {
    const ids = selectedIds(scope);
    const button = document.querySelector(`[data-bulk-expiry-open="${scope}"]`);
    if (button) {
      button.disabled = ids.length === 0;
      button.innerHTML = ids.length
        ? `📅 Hạn dùng <span class="management-action-count">(${ids.length})</span>`
        : '📅 Hạn dùng';
      button.title = ids.length
        ? `Cập nhật hạn dùng cho ${ids.length} ${scopeLabel(scope)} đã chọn`
        : `Hãy chọn ít nhất một ${scopeLabel(scope)}`;
    }
  }
}

function ensureStyles() {
  if (document.getElementById('bulk-expiry-style')) return;
  const style = document.createElement('style');
  style.id = 'bulk-expiry-style';
  style.textContent = `
    .management-native-actions{display:flex!important;flex-wrap:nowrap!important;align-items:center!important;gap:8px!important;overflow-x:auto!important;overflow-y:hidden!important;padding-bottom:3px;scrollbar-width:thin;-webkit-overflow-scrolling:touch}
    .management-native-actions>button,.management-native-actions>label{flex:0 0 auto!important}
    .bulk-expiry-open{border:0;border-radius:10px;padding:9px 13px;background:#0284c7;color:#fff;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap;box-shadow:0 2px 6px rgba(2,132,199,.18)}
    .bulk-expiry-open:disabled{opacity:.45;cursor:not-allowed}
    .bulk-expiry-modal{position:fixed;inset:0;z-index:1000010;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.58);backdrop-filter:blur(5px)}
    .bulk-expiry-modal.hidden{display:none!important}
    .bulk-expiry-card{width:min(470px,calc(100vw - 24px));border-radius:18px;background:#fff;border:1px solid #e2e8f0;box-shadow:0 28px 80px rgba(15,23,42,.32);padding:16px;color:#0f172a}
    .bulk-expiry-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding-bottom:12px;border-bottom:1px solid #eef2f7}
    .bulk-expiry-head h3{margin:0;font-size:17px;font-weight:900}.bulk-expiry-head p{margin:4px 0 0;color:#64748b;font-size:11px;line-height:1.45}
    .bulk-expiry-head>button{width:32px;height:32px;border:1px solid #e2e8f0;border-radius:9px;background:#f8fafc;color:#64748b;font-size:21px}
    .bulk-expiry-field{padding-top:13px}.bulk-expiry-field label{display:block;margin-bottom:6px;font-size:12px;font-weight:800;color:#334155}
    .bulk-expiry-field input{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:10px;padding:10px 11px;font-size:14px;outline:none}
    .bulk-expiry-field input:focus{border-color:#0ea5e9;box-shadow:0 0 0 3px rgba(14,165,233,.12)}
    .bulk-expiry-note{margin-top:10px;padding:9px 10px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;font-size:10.5px;line-height:1.5}
    .bulk-expiry-unlimited{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;font-weight:700;color:#334155}
    .bulk-expiry-unlimited input{width:17px;height:17px}
    .bulk-expiry-status{min-height:20px;padding-top:7px;color:#b45309;font-size:11px;font-weight:700}
    .bulk-expiry-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:8px}
    .bulk-expiry-actions button{border-radius:10px;padding:9px 13px;font-size:12px;font-weight:800}
    .bulk-expiry-cancel{border:1px solid #cbd5e1;background:#fff;color:#475569}.bulk-expiry-submit{border:0;background:#0284c7;color:#fff}
    .bulk-expiry-submit:disabled{opacity:.55;cursor:wait}
    @media(max-width:640px){.bulk-expiry-open{width:auto}.bulk-expiry-actions{display:grid;grid-template-columns:1fr 1fr}}
  `;
  document.head.append(style);
}

function closeModal() {
  const modal = document.getElementById('bulk-expiry-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.dataset.scope = '';
  modal.dataset.ids = '[]';
  const status = modal.querySelector('[data-bulk-expiry-status]');
  if (status) status.textContent = '';
}

function openModal(scope) {
  const ids = selectedIds(scope);
  if (!ids.length) return toast(`Hãy chọn ít nhất một ${scopeLabel(scope)} cần cập nhật hạn dùng.`, 'warning');
  if (ids.length > BULK_EXPIRY_MAX) {
    return toast(`Mỗi lần chỉ được cập nhật tối đa ${BULK_EXPIRY_MAX} ${scopeLabel(scope)}.`, 'warning');
  }

  const modal = document.getElementById('bulk-expiry-modal');
  if (!modal) return;
  modal.dataset.scope = scope;
  modal.dataset.ids = JSON.stringify(ids);
  modal.querySelector('[data-bulk-expiry-kind]').textContent = scopeLabel(scope);
  modal.querySelector('[data-bulk-expiry-selected]').textContent = String(ids.length);
  const input = modal.querySelector('input[name="expiry_date"]');
  const unlimited = modal.querySelector('input[name="unlimited"]');
  input.value = '';
  input.disabled = false;
  unlimited.checked = false;
  modal.classList.remove('hidden');
  setTimeout(() => input.focus(), 0);
}

async function submitExpiry(event) {
  event.preventDefault();
  const modal = document.getElementById('bulk-expiry-modal');
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const status = form.querySelector('[data-bulk-expiry-status]');
  const scope = modal?.dataset.scope || '';
  let ids = [];
  try { ids = JSON.parse(modal?.dataset.ids || '[]'); } catch {}

  if (!['accounts','users'].includes(scope) || !Array.isArray(ids) || !ids.length) {
    if (status) status.textContent = 'Danh sách được chọn không hợp lệ.';
    return;
  }

  const data = new FormData(form);
  const unlimited = data.get('unlimited') === 'on';
  const expiryDate = unlimited ? null : String(data.get('expiry_date') || '').trim();
  if (!unlimited && !expiryDate) {
    if (status) status.textContent = 'Hãy chọn ngày hết hạn hoặc chọn Vô thời hạn.';
    return;
  }

  const token = authToken();
  if (!token) {
    if (status) status.textContent = 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.';
    return;
  }

  submit.disabled = true;
  submit.dataset.originalText = submit.textContent;
  submit.textContent = 'Đang cập nhật...';
  if (status) status.textContent = `Đang cập nhật và xác nhận ${ids.length} ${scopeLabel(scope)}...`;

  try {
    const endpoint = scope === 'accounts' ? ACCOUNT_API : USER_API;
    const idField = scope === 'accounts' ? 'account_ids' : 'user_ids';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      cache: 'no-store',
      body: JSON.stringify({ [idField]: ids, expiry_date: expiryDate })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.data?.success) {
      throw new Error(payload?.error || `Cập nhật hạn dùng thất bại (HTTP ${response.status}).`);
    }

    const verified = Number(payload.data.verified) || ids.length;
    const label = payload.data.unlimited ? 'Vô thời hạn' : expiryDate;
    closeModal();

    // Xóa trạng thái chọn cũ trước khi tải lại để tránh selection trỏ vào DOM/dữ liệu cũ.
    if (scope === 'accounts' && window.selectedAccountIds instanceof Set) {
      window.selectedAccountIds.clear();
    }
    if (scope === 'users' && window.selectedUserIds instanceof Set) {
      window.selectedUserIds.clear();
    }

    // Bắt buộc tải lại dữ liệu thật từ server sau khi cập nhật thành công.
    // Không chỉ sửa snapshot cục bộ, để hạn dùng hiển thị đúng ngay trên danh sách.
    if (scope === 'accounts') {
      if (typeof window.refreshAccountsData === 'function') {
        await window.refreshAccountsData();
      } else if (typeof window.fetchAllAccountsChunked === 'function') {
        window.accounts = await window.fetchAllAccountsChunked();
        if (typeof window.renderAccounts === 'function') await window.renderAccounts();
      } else {
        window.location.reload();
        return;
      }
    } else {
      if (typeof window.refreshUsersData === 'function') {
        await window.refreshUsersData();
      } else if (typeof window.fetchAllUsersChunked === 'function') {
        window.usersList = await window.fetchAllUsersChunked();
        if (typeof window.renderUsers === 'function') await window.renderUsers();
      } else {
        window.location.reload();
        return;
      }
    }

    updateButtons();
    toast(`✅ Đã cập nhật hạn dùng cho ${verified} ${scopeLabel(scope)}: ${label}.`, 'success');
  } catch (error) {
    if (status) status.textContent = error?.message || 'Không thể cập nhật hạn dùng.';
  } finally {
    submit.disabled = false;
    submit.textContent = submit.dataset.originalText || 'Cập nhật';
  }
}

function ensureModal() {
  if (document.getElementById('bulk-expiry-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'bulk-expiry-modal';
  modal.className = 'bulk-expiry-modal hidden';
  modal.innerHTML = `
    <div class="bulk-expiry-card" role="dialog" aria-modal="true" aria-labelledby="bulk-expiry-title">
      <div class="bulk-expiry-head">
        <div>
          <h3 id="bulk-expiry-title">Cập nhật hạn dùng</h3>
          <p>Áp dụng cho <strong data-bulk-expiry-selected>0</strong> <strong data-bulk-expiry-kind>đối tượng</strong> đang chọn.</p>
        </div>
        <button type="button" data-bulk-expiry-close aria-label="Đóng">×</button>
      </div>
      <form>
        <div class="bulk-expiry-field">
          <label for="bulk-expiry-date">Ngày hết hạn</label>
          <input id="bulk-expiry-date" name="expiry_date" type="date" inputmode="numeric">
        </div>
        <label class="bulk-expiry-unlimited">
          <input name="unlimited" type="checkbox">
          <span>Vô thời hạn</span>
        </label>
        <div class="bulk-expiry-note">
          Ngày được tính theo giờ Việt Nam (UTC+7). Nếu chọn ngày, hạn dùng kết thúc lúc 23:59:59.999 của ngày đó. Chọn “Vô thời hạn” sẽ xóa ngày hết hạn hiện tại.
        </div>
        <div class="bulk-expiry-status" data-bulk-expiry-status aria-live="polite"></div>
        <div class="bulk-expiry-actions">
          <button type="button" data-bulk-expiry-close class="bulk-expiry-cancel">Hủy</button>
          <button type="submit" class="bulk-expiry-submit">Cập nhật</button>
        </div>
      </form>
    </div>`;
  document.body.append(modal);

  modal.querySelectorAll('[data-bulk-expiry-close]').forEach(button => button.addEventListener('click', closeModal));
  const unlimited = modal.querySelector('input[name="unlimited"]');
  const date = modal.querySelector('input[name="expiry_date"]');
  unlimited.addEventListener('change', () => {
    date.disabled = unlimited.checked;
    if (unlimited.checked) date.value = '';
  });
  modal.querySelector('form').addEventListener('submit', submitExpiry);
}

function actionBarForScope(scope, tab) {
  const preferredIds = scope === 'accounts'
    ? ['btn-delete-selected-accounts', 'account-password-reset-open']
    : ['btn-delete-selected-users', 'btn-batch-create-accounts', 'btn-import-users-excel', 'btn-add-user', 'btn-open-teacher-assignment-app'];

  for (const id of preferredIds) {
    const anchor = document.getElementById(id);
    if (anchor?.parentElement && tab.contains(anchor)) return anchor.parentElement;
  }

  const buttons = [...tab.querySelectorAll('button')];
  const anchor = buttons.find(button => {
    const label = String(button.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return label.includes('xuất excel') || label.includes('nhập excel') ||
      label.includes('thêm người dùng') || label.includes('thêm tài khoản');
  });
  return anchor?.parentElement || null;
}

function createExpiryButton(scope) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bulk-expiry-open';
  button.dataset.bulkExpiryOpen = scope;
  button.disabled = true;
  button.textContent = '📅 Hạn dùng';
  button.addEventListener('click', () => openModal(scope));
  return button;
}

function mountExpiryButton(scope, tab) {
  // Xóa khối lớn của phiên bản cũ nếu nó còn tồn tại trên DOM.
  document.getElementById(`bulk-expiry-tools-${scope}`)?.remove();

  const actionBar = actionBarForScope(scope, tab);
  if (!actionBar) return;
  actionBar.classList.add('management-native-actions');

  let button = document.querySelector(`[data-bulk-expiry-open="${scope}"]`);
  if (!button) button = createExpiryButton(scope);

  if (button.parentElement !== actionBar) {
    if (scope === 'accounts') {
      const passwordButton = document.getElementById('account-password-reset-open');
      if (passwordButton?.parentElement === actionBar) passwordButton.after(button);
      else actionBar.append(button);
    } else {
      const batchButton = document.getElementById('btn-batch-create-accounts');
      if (batchButton?.parentElement === actionBar) batchButton.after(button);
      else actionBar.append(button);
    }
  }
}

function ensureTools() {
  const accountTab = document.getElementById('tab-accounts');
  if (accountTab?.children.length) mountExpiryButton('accounts', accountTab);

  const userTab = document.getElementById('tab-users');
  if (userTab?.children.length) mountExpiryButton('users', userTab);

  updateButtons();
}

function boot() {
  ensureStyles();
  ensureModal();
  ensureTools();

  document.addEventListener('change', event => {
    if (event.target?.matches?.('input[type="checkbox"]')) {
      queueMicrotask(updateButtons);
    }
  }, true);

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      ensureTools();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
