const RESET_API = '/api/accounts/reset-password';
const MAX_RESET = 500;

function escapeSelector(value) {
  if (globalThis.CSS && typeof globalThis.CSS.escape === 'function') return globalThis.CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

function accountMap() {
  const rows = Array.isArray(window.accounts) ? window.accounts : [];
  return new Map(rows.map(row => [String(row?.id || ''), row]).filter(([id]) => id));
}

function findAccountIdFromElement(element) {
  if (!(element instanceof Element)) return '';
  const map = accountMap();
  const candidates = [];
  const push = value => {
    const v = String(value ?? '').trim();
    if (v && !['on','true','false','1','0','all'].includes(v.toLowerCase())) candidates.push(v);
  };

  push(element.getAttribute('data-account-id'));
  push(element.getAttribute('data-id'));
  push(element.getAttribute('value'));

  const owner = element.closest('[data-account-id],[data-id],tr,article,.account-card,.account-item');
  if (owner) {
    push(owner.getAttribute('data-account-id'));
    push(owner.getAttribute('data-id'));
    owner.querySelectorAll('[data-account-id],[data-id]').forEach(node => {
      push(node.getAttribute('data-account-id'));
      push(node.getAttribute('data-id'));
    });
    owner.querySelectorAll('[onclick]').forEach(node => {
      const code = String(node.getAttribute('onclick') || '');
      const patterns = [
        /(?:edit|delete|view|toggle)[A-Za-z]*Account\s*\(\s*['"]([^'"]+)['"]/i,
        /(?:edit|delete|view|toggle)[A-Za-z]*\s*\(\s*['"]([^'"]+)['"]/i
      ];
      for (const pattern of patterns) {
        const match = code.match(pattern);
        if (match) push(match[1]);
      }
    });
  }

  if (map.size) {
    for (const id of candidates) if (map.has(id)) return id;

    // Last safe fallback: uniquely match the visible username in the row/card.
    if (owner) {
      const text = String(owner.textContent || '').toLowerCase();
      const matches = [...map.entries()].filter(([, row]) => {
        const username = String(row?.username || '').trim().toLowerCase();
        return username && text.includes(username);
      });
      if (matches.length === 1) return matches[0][0];
    }
    return '';
  }
  return candidates[0] || '';
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

function rowCheckboxes(tab) {
  return [...tab.querySelectorAll('input[type="checkbox"]')]
    .filter(box => !isSelectAllCheckbox(box))
    .map(box => ({ box, id: findAccountIdFromElement(box) }))
    .filter(item => item.id);
}

function selectedAccountIds(tab) {
  return [...new Set(rowCheckboxes(tab).filter(item => item.box.checked).map(item => item.id))];
}

function injectCheckboxesWhenMissing(tab) {
  if (rowCheckboxes(tab).length) return;
  const map = accountMap();
  if (!map.size) return;

  const rows = [...tab.querySelectorAll('tbody tr')];
  for (const row of rows) {
    if (row.querySelector('input[type="checkbox"]')) continue;
    const text = String(row.textContent || '').toLowerCase();
    const matches = [...map.entries()].filter(([, account]) => {
      const username = String(account?.username || '').trim().toLowerCase();
      return username && text.includes(username);
    });
    if (matches.length !== 1) continue;
    const [id] = matches[0];
    const cell = row.querySelector('td');
    if (!cell) continue;
    const wrap = document.createElement('label');
    wrap.className = 'account-reset-select';
    wrap.title = 'Chọn tài khoản để reset mật khẩu';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.accountId = id;
    box.className = 'account-reset-row-checkbox';
    box.setAttribute('aria-label', 'Chọn tài khoản để reset mật khẩu');
    wrap.append(box);
    cell.prepend(wrap);
  }
}

function toast(message, type = 'info') {
  if (typeof window.showToast === 'function') {
    window.showToast(message, type);
    return;
  }
  const status = document.getElementById('account-password-reset-status');
  if (status) status.textContent = message;
}

function authToken() {
  const key = typeof window.tenantStorageKey === 'function'
    ? window.tenantStorageKey('auth_token')
    : 'auth_token';
  return localStorage.getItem(key) || localStorage.getItem('auth_token') || '';
}

function clearAuthToken() {
  const key = typeof window.tenantStorageKey === 'function'
    ? window.tenantStorageKey('auth_token')
    : 'auth_token';
  localStorage.removeItem(key);
  if (key !== 'auth_token') localStorage.removeItem('auth_token');
}

function updateSelection(tab) {
  const ids = selectedAccountIds(tab);
  const count = document.getElementById('account-password-reset-count');
  const button = document.getElementById('account-password-reset-open');
  if (count) count.textContent = String(ids.length);
  if (button) {
    button.disabled = ids.length === 0;
    button.title = ids.length
      ? `Reset mật khẩu cho ${ids.length} tài khoản đã chọn`
      : 'Hãy chọn ít nhất một tài khoản';
  }
}

function closeModal() {
  const modal = document.getElementById('account-password-reset-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  const form = modal.querySelector('form');
  if (form) form.reset();
  const status = modal.querySelector('[data-reset-status]');
  if (status) status.textContent = '';
}

function openModal(tab) {
  const ids = selectedAccountIds(tab);
  if (!ids.length) return toast('Hãy chọn ít nhất một tài khoản cần reset mật khẩu.', 'warning');
  if (ids.length > MAX_RESET) return toast(`Mỗi lần chỉ được reset tối đa ${MAX_RESET} tài khoản.`, 'warning');

  const modal = document.getElementById('account-password-reset-modal');
  if (!modal) return;
  modal.dataset.accountIds = JSON.stringify(ids);
  const count = modal.querySelector('[data-reset-count]');
  if (count) count.textContent = String(ids.length);
  modal.classList.remove('hidden');
  const input = modal.querySelector('input[name="password"]');
  if (input) setTimeout(() => input.focus(), 0);
}

async function submitReset(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const modal = document.getElementById('account-password-reset-modal');
  const submit = form.querySelector('button[type="submit"]');
  const status = form.querySelector('[data-reset-status]');
  let ids = [];
  try { ids = JSON.parse(modal?.dataset.accountIds || '[]'); } catch {}
  const password = String(new FormData(form).get('password') || '');

  if (!Array.isArray(ids) || !ids.length) {
    if (status) status.textContent = 'Danh sách tài khoản đã chọn không hợp lệ.';
    return;
  }
  if (password.length < 6 || password.length > 128) {
    if (status) status.textContent = 'Mật khẩu phải từ 6 đến 128 ký tự.';
    return;
  }

  const token = authToken();
  if (!token) {
    if (status) status.textContent = 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.';
    return;
  }

  submit.disabled = true;
  submit.dataset.originalText = submit.textContent;
  submit.textContent = 'Đang reset...';
  if (status) status.textContent = 'Đang mã hóa và xác nhận mật khẩu trên máy chủ...';

  try {
    const response = await fetch(RESET_API, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      cache: 'no-store',
      body: JSON.stringify({ account_ids: ids, password })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.data?.success) {
      throw new Error(payload?.error || `Reset mật khẩu thất bại (HTTP ${response.status}).`);
    }

    const updated = Number(payload.data.updated) || ids.length;
    closeModal();

    const tab = document.getElementById('tab-accounts');
    if (tab) {
      for (const item of rowCheckboxes(tab)) {
        if (ids.includes(item.id)) item.box.checked = false;
      }
      updateSelection(tab);
    }

    toast(`✅ Đã reset mật khẩu thành công cho ${updated} tài khoản.`, 'success');

    // Password is part of the session fingerprint; self-reset intentionally logs Admin out.
    if (payload.data.self_reset) {
      clearAuthToken();
      toast('Mật khẩu tài khoản đang đăng nhập đã thay đổi. Vui lòng đăng nhập lại.', 'warning');
      setTimeout(() => window.location.reload(), 700);
    }
  } catch (error) {
    if (status) status.textContent = error?.message || 'Không thể reset mật khẩu.';
  } finally {
    submit.disabled = false;
    submit.textContent = submit.dataset.originalText || 'Reset mật khẩu';
  }
}

function ensureModal() {
  if (document.getElementById('account-password-reset-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'account-password-reset-modal';
  modal.className = 'account-password-reset-modal hidden';
  modal.innerHTML = `
    <div class="account-password-reset-card" role="dialog" aria-modal="true" aria-labelledby="account-password-reset-title">
      <div class="account-password-reset-head">
        <div>
          <h3 id="account-password-reset-title">Reset mật khẩu tài khoản</h3>
          <p>Áp dụng cùng một mật khẩu mặc định cho <strong data-reset-count>0</strong> tài khoản đã chọn.</p>
        </div>
        <button type="button" data-reset-close aria-label="Đóng">×</button>
      </div>
      <form autocomplete="off">
        <label class="account-password-reset-label" for="account-password-reset-input">Mật khẩu mặc định</label>
        <div class="account-password-reset-input-wrap">
          <input id="account-password-reset-input" name="password" type="password" minlength="6" maxlength="128"
                 autocomplete="new-password" spellcheck="false" required
                 placeholder="Nhập mật khẩu mặc định (tối thiểu 6 ký tự)">
          <button type="button" data-toggle-password aria-label="Hiện mật khẩu">Hiện</button>
        </div>
        <div class="account-password-reset-note">
          Mật khẩu được băm PBKDF2-SHA256 trên máy chủ trước khi lưu. Các phiên đăng nhập cũ của tài khoản được reset sẽ tự hết hiệu lực.
        </div>
        <div class="account-password-reset-status" data-reset-status aria-live="polite"></div>
        <div class="account-password-reset-actions">
          <button type="button" data-reset-close class="account-password-reset-cancel">Hủy</button>
          <button type="submit" class="account-password-reset-submit">Reset mật khẩu</button>
        </div>
      </form>
    </div>`;
  document.body.append(modal);

  modal.querySelectorAll('[data-reset-close]').forEach(btn => btn.addEventListener('click', closeModal));
  modal.querySelector('[data-toggle-password]')?.addEventListener('click', event => {
    const input = modal.querySelector('input[name="password"]');
    const button = event.currentTarget;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.textContent = show ? 'Ẩn' : 'Hiện';
    button.setAttribute('aria-label', show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
  });
  modal.querySelector('form')?.addEventListener('submit', submitReset);
}

function ensureStyles() {
  if (document.getElementById('account-password-reset-style')) return;
  const style = document.createElement('style');
  style.id = 'account-password-reset-style';
  style.textContent = `
    .account-password-reset-tools{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 14px;padding:12px 14px;border:1px solid #ddd6fe;border-radius:14px;background:#faf5ff}
    .account-password-reset-tools strong{display:block;color:#4c1d95;font-size:13px}.account-password-reset-tools small{display:block;margin-top:2px;color:#6b7280;font-size:11px}
    #account-password-reset-open{border:0;border-radius:10px;padding:9px 13px;background:#7c3aed;color:#fff;font-weight:800;font-size:12px;cursor:pointer}
    #account-password-reset-open:disabled{cursor:not-allowed;opacity:.45}
    .account-reset-select{display:inline-flex;align-items:center;margin-right:8px;vertical-align:middle}
    .account-reset-row-checkbox{width:17px;height:17px;accent-color:#7c3aed;cursor:pointer}
    .account-password-reset-modal{position:fixed;inset:0;z-index:1000005;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.58);backdrop-filter:blur(5px)}
    .account-password-reset-modal.hidden{display:none!important}
    .account-password-reset-card{width:min(470px,calc(100vw - 24px));border-radius:18px;background:#fff;border:1px solid #e2e8f0;box-shadow:0 28px 80px rgba(15,23,42,.32);padding:16px;color:#0f172a}
    .account-password-reset-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding-bottom:12px;border-bottom:1px solid #eef2f7}
    .account-password-reset-head h3{margin:0;font-size:17px;font-weight:900}.account-password-reset-head p{margin:4px 0 0;color:#64748b;font-size:11px;line-height:1.45}
    .account-password-reset-head>button{width:32px;height:32px;border:1px solid #e2e8f0;border-radius:9px;background:#f8fafc;color:#64748b;font-size:21px}
    .account-password-reset-card form{padding-top:13px}.account-password-reset-label{display:block;margin-bottom:6px;font-size:12px;font-weight:800;color:#334155}
    .account-password-reset-input-wrap{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px}
    .account-password-reset-input-wrap input{min-width:0;border:1px solid #cbd5e1;border-radius:10px;padding:10px 11px;font-size:14px;outline:none}
    .account-password-reset-input-wrap input:focus{border-color:#8b5cf6;box-shadow:0 0 0 3px rgba(139,92,246,.12)}
    .account-password-reset-input-wrap button{border:1px solid #ddd6fe;border-radius:10px;background:#f5f3ff;color:#6d28d9;padding:0 11px;font-weight:800;font-size:11px}
    .account-password-reset-note{margin-top:10px;padding:9px 10px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;font-size:10.5px;line-height:1.45}
    .account-password-reset-status{min-height:20px;padding-top:7px;color:#b45309;font-size:11px;font-weight:700}
    .account-password-reset-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:8px}
    .account-password-reset-actions button{border-radius:10px;padding:9px 13px;font-size:12px;font-weight:800}
    .account-password-reset-cancel{border:1px solid #cbd5e1;background:#fff;color:#475569}.account-password-reset-submit{border:0;background:#7c3aed;color:#fff}
    .account-password-reset-submit:disabled{opacity:.55;cursor:wait}
    @media(max-width:640px){.account-password-reset-tools{align-items:stretch;flex-direction:column}#account-password-reset-open{width:100%}.account-password-reset-actions{display:grid;grid-template-columns:1fr 1fr}}
  `;
  document.head.append(style);
}

function accountTabIsAvailable(tab) {
  const nav = document.querySelector('[data-sidebar-tab="accounts"]');
  if (nav && nav.classList.contains('hidden')) return false;
  return tab.children.length > 0;
}

function ensureTools() {
  const tab = document.getElementById('tab-accounts');
  if (!tab || !accountTabIsAvailable(tab)) return;
  injectCheckboxesWhenMissing(tab);

  if (!document.getElementById('account-password-reset-tools')) {
    const tools = document.createElement('div');
    tools.id = 'account-password-reset-tools';
    tools.className = 'account-password-reset-tools';
    tools.innerHTML = `
      <div>
        <strong>Reset mật khẩu hàng loạt · Đã chọn <span id="account-password-reset-count">0</span> tài khoản</strong>
        <small>Chọn một hoặc nhiều tài khoản trong danh sách rồi đặt mật khẩu mặc định mới.</small>
      </div>
      <button type="button" id="account-password-reset-open" disabled>🔑 Reset mật khẩu</button>`;
    tab.prepend(tools);
    tools.querySelector('#account-password-reset-open')?.addEventListener('click', () => openModal(tab));
  }

  if (!tab.dataset.passwordResetBound) {
    tab.dataset.passwordResetBound = '1';
    tab.addEventListener('change', event => {
      if (event.target?.matches?.('input[type="checkbox"]')) updateSelection(tab);
    });
  }
  updateSelection(tab);
}

function boot() {
  ensureStyles();
  ensureModal();
  ensureTools();
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

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
