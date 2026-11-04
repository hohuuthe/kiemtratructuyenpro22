import { buildStudentAttemptHistoryMarkup } from './student-results-ui.js';

function authToken() {
    try {
        const key = typeof window.tenantStorageKey === 'function' ? window.tenantStorageKey('auth_token') : 'auth_token';
        return localStorage.getItem(key) || '';
    } catch { return ''; }
}

function sharedModalElements() {
    const container = document.getElementById('modal-container');
    const modal = document.getElementById('modal-content');
    return { container, modal };
}

function closeAttemptHistory() {
    if (typeof window.closeModal === 'function') {
        window.closeModal();
        return;
    }
    const { container, modal } = sharedModalElements();
    container?.classList.add('hidden');
    if (container) container.style.display = 'none';
    if (modal) modal.innerHTML = '';
}

function openAttemptHistoryMarkup(markup) {
    const { container, modal } = sharedModalElements();
    if (!container || !modal) throw new Error('Không tìm thấy form dùng chung của hệ thống.');
    modal.className = 'bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto relative z-10 student-attempt-history-modal';
    modal.innerHTML = markup;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'absolute top-3 right-3 z-20 text-gray-400 hover:text-gray-700 bg-white border border-gray-200 rounded-full w-9 h-9 grid place-items-center shadow-sm';
    close.title = 'Đóng';
    close.setAttribute('aria-label','Đóng');
    close.textContent = '×';
    close.addEventListener('click', closeAttemptHistory);
    modal.appendChild(close);
    modal.querySelector('.student-attempt-close')?.addEventListener('click', closeAttemptHistory);
    container.classList.remove('hidden');
    container.style.display = 'flex';
    modal.scrollTop = 0;
}

function formatDate(value) {
    if (typeof window.formatVNTime === 'function') return window.formatVNTime(value);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Chưa xác định';
    return date.toLocaleString('vi-VN');
}

function formatDuration(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const whole = Math.floor(seconds);
    return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2,'0');
}

async function showStudentAttemptHistory(examId, examName) {
    const id = String(examId || '').trim();
    if (!id) return;
    const token = authToken();
    if (!token) {
        window.showToast?.('Phiên đăng nhập không hợp lệ.', 'error');
        return;
    }
    try {
        const response = await fetch('/api/results/me?examId=' + encodeURIComponent(id), {
            headers: { Authorization: 'Bearer ' + token },
            cache: 'no-store'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Không thể tải các lần làm bài.');
        const rows = Array.isArray(payload.data) ? payload.data : [];
        openAttemptHistoryMarkup(buildStudentAttemptHistoryMarkup(rows, {
            examName: examName || rows[0]?.exam_name || 'Bài thi',
            formatDate,
            formatDuration
        }));
    } catch (error) {
        window.showToast?.(error?.message || 'Không thể tải các lần làm bài.', 'error');
    }
}

window.addEventListener('student-result-attempts-request', event => {
    const detail = event?.detail || {};
    void showStudentAttemptHistory(detail.examId, detail.examName);
});

window.showStudentAttemptHistory = showStudentAttemptHistory;
