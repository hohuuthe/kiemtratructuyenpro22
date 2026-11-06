const BULK_EXPIRY_INPUT_ID = 'bulk-account-expiry-vn';
let bulkExpiryDate = '';
let bulkExpiryMounted = false;

function textOf(node) {
  return String(node?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function findBulkAccountContainer() {
  const candidates = [...document.querySelectorAll('[role="dialog"], form, [id*="modal" i], [class*="modal" i]')];
  return candidates
    .filter(node => {
      const text = textOf(node);
      return text.includes('tạo tài khoản đồng loạt') ||
        text.includes('tao tai khoan dong loat') ||
        text.includes('tạo tài khoản hàng loạt') ||
        text.includes('tao tai khoan hang loat');
    })
    .sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)[0] || null;
}

function ensureBulkExpiryField() {
  const container = findBulkAccountContainer();
  if (!container) return;
  if (container.querySelector('#' + BULK_EXPIRY_INPUT_ID)) {
    bulkExpiryMounted = true;
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'bulk-account-expiry-vn-field';
  wrap.innerHTML = `
    <label for="${BULK_EXPIRY_INPUT_ID}">Thời hạn tài khoản</label>
    <input id="${BULK_EXPIRY_INPUT_ID}" type="date" inputmode="numeric">
    <div class="bulk-account-expiry-vn-help">
      Theo giờ Việt Nam (UTC+7). Để trống = vô thời hạn. Nếu chọn ngày, tài khoản hết hạn lúc 23:59:59 của ngày đó.
    </div>
  `;

  const actions = [...container.querySelectorAll('button')].find(button => {
    const text = textOf(button);
    return text.includes('tạo tài khoản') || text.includes('tao tai khoan') || text.includes('tạo đồng loạt');
  });
  if (actions?.parentElement) actions.parentElement.before(wrap);
  else (container.querySelector('form') || container).append(wrap);

  const input = wrap.querySelector('input');
  input.value = bulkExpiryDate;
  input.addEventListener('change', () => {
    bulkExpiryDate = input.value || '';
  });
  input.addEventListener('input', () => {
    bulkExpiryDate = input.value || '';
  });
  bulkExpiryMounted = true;
}

function ensureStyle() {
  if (document.getElementById('bulk-account-expiry-vn-style')) return;
  const style = document.createElement('style');
  style.id = 'bulk-account-expiry-vn-style';
  style.textContent = `
    .bulk-account-expiry-vn-field{margin:12px 0;padding:11px 12px;border:1px solid #dbeafe;border-radius:12px;background:#f8fbff}
    .bulk-account-expiry-vn-field label{display:block;margin-bottom:6px;font-size:12px;font-weight:800;color:#1e3a8a}
    .bulk-account-expiry-vn-field input{width:100%;box-sizing:border-box;border:1px solid #bfdbfe;border-radius:9px;padding:9px 10px;background:#fff;color:#0f172a;font-size:13px;outline:none}
    .bulk-account-expiry-vn-field input:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.12)}
    .bulk-account-expiry-vn-help{margin-top:6px;color:#64748b;font-size:10.5px;line-height:1.45}
  `;
  document.head.append(style);
}

function installBulkExpiryFetchBridge() {
  if (window.__bulkAccountExpiryFetchBridge) return;
  window.__bulkAccountExpiryFetchBridge = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    try {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      const method = String(init?.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
      if (bulkExpiryMounted && method === 'POST' && /\/api\/accounts(?:\?.*)?$/.test(url) && typeof init?.body === 'string') {
        const payload = JSON.parse(init.body);
        if (payload && Array.isArray(payload.accounts)) {
          const value = bulkExpiryDate || null;
          payload.accounts = payload.accounts.map(account => ({
            ...account,
            expiry_date: value
          }));
          init = { ...init, body: JSON.stringify(payload) };
        }
      }
    } catch (error) {
      console.warn('Không thể gắn thời hạn vào yêu cầu tạo tài khoản đồng loạt:', error);
    }
    return originalFetch(input, init);
  };
}

function boot() {
  ensureStyle();
  installBulkExpiryFetchBridge();
  ensureBulkExpiryField();

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      ensureBulkExpiryField();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
