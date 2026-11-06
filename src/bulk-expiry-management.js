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
    const count = document.querySelector(`[data-bulk-expiry-count="${scope}"]`);
    if (count) count.textContent = String(ids.length);
    if (button) {
      button.disabled = ids.length === 0;
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
    .bulk-expiry-tools{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 14px;padding:11px 13px;border:1px solid #bae6fd;border-radius:14px;background:#f0f9ff}
    .bulk-expiry-tools strong{display:block;color:#0c4a6e;font-size:13px}.bulk-expiry-tools small{display:block;margin-top:2px;color:#64748b;font-size:11px}
    .bulk-expiry-open{border:0;border-radius:10px;padding:9px 13px;background:#0284c7;color:#fff;font-weight:800;font-size:12px;cursor:pointer;white-space:nowrap}
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
    @media(max-width:640px){.bulk-expiry-tools{align-items:stretch;flex-direction:column}.bulk-expiry-open{width:100%}.bulk-expiry-actions{display:grid;grid-template-columns:1fr 1fr}}
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

    // Đồng bộ snapshot cục bộ để giao diện không hiển thị hạn cũ trong lúc chờ lần tải kế tiếp.
    if (scope === 'accounts' && Array.isArray(window.accounts)) {
      window.accounts.forEach(row => {
        if (ids.includes(String(row?.id || ''))) row.expiry_date = payload.data.expiry_date;
      });
      if (typeof window.renderAccounts === 'function') window.renderAccounts();
    } else if (scope === 'users' && Array.isArray(window.users)) {
      window.users.forEach(row => {
        if (ids.includes(String(row?.id || ''))) row.expiry_date = payload.data.expiry_date;
      });
      if (typeof window.renderUsers === 'function') window.renderUsers();
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

function makeTools(scope) {
  const tools = document.createElement('div');
  tools.id = `bulk-expiry-tools-${scope}`;
  tools.className = 'bulk-expiry-tools';
  tools.innerHTML = `
    <div>
      <strong>Cập nhật hạn dùng hàng loạt · Đã chọn <span data-bulk-expiry-count="${scope}">0</span> ${scopeLabel(scope)}</strong>
      <small>Chọn một hoặc nhiều dòng để đặt ngày hết hạn mới hoặc chuyển sang vô thời hạn.</small>
    </div>
    <button type="button" class="bulk-expiry-open" data-bulk-expiry-open="${scope}" disabled>📅 Cập nhật hạn dùng</button>`;
  tools.querySelector('button').addEventListener('click', () => openModal(scope));
  return tools;
}

function ensureTools() {
  const accountTab = document.getElementById('tab-accounts');
  if (accountTab && accountTab.children.length && !document.getElementById('bulk-expiry-tools-accounts')) {
    const passwordTools = document.getElementById('account-password-reset-tools');
    if (passwordTools?.parentElement === accountTab) passwordTools.after(makeTools('accounts'));
    else accountTab.prepend(makeTools('accounts'));
  }

  const userTab = document.getElementById('tab-users');
  if (userTab && userTab.children.length && !document.getElementById('bulk-expiry-tools-users')) {
    userTab.prepend(makeTools('users'));
  }

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
