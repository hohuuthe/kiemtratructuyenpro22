/**
 * Read-only enhancement for the exam management table.
 * The server owns counting and authorization; never fetch student answer records
 * or compute counts from a student's name or an exam title.
 */
export function getExamAttemptCount(exams, examId) {
  const id = typeof examId === 'string' ? examId.trim() : '';
  if (!id || !Array.isArray(exams)) return null;
  const exam = exams.find(item => String(item?.id ?? '').trim() === id);
  const raw = exam?.attempt_count;
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  if (typeof raw === 'string' && /^(0|[1-9][0-9]*)$/.test(raw)) {
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

export function syncExamAttemptCountCells(root, exams) {
  const body = root?.querySelector('#exam-configs-table-body');
  if (!body) return;
  for (const row of body.querySelectorAll('tr')) {
    const idElement = row.querySelector('.exam-config-id-value');
    if (!idElement) {
      const placeholder = row.querySelector('td[colspan]');
      if (placeholder && placeholder.getAttribute('colspan') !== '11') {
        placeholder.setAttribute('colspan', '11');
      }
      continue;
    }
    const examId = (idElement.getAttribute('title') || idElement.textContent || '').trim();
    const count = getExamAttemptCount(exams, examId);
    let cell = row.querySelector('td.exam-attempt-count-cell');
    if (!cell) {
      cell = row.ownerDocument.createElement('td');
      cell.className = 'exam-attempt-count-cell';
      cell.setAttribute('data-exam-id', examId);
      // Existing last cell contains all edit/export/delete actions.
      row.insertBefore(cell, row.lastElementChild);
    }
    const value = count === null ? '—' : count.toLocaleString('vi-VN');
    const title = count === null
      ? 'Chưa có số liệu hoặc không có quyền xem thống kê.'
      : 'Tổng lượt nộp bài đã lưu cho mã đề này, kể cả các lượt làm lại.';
    if (cell.textContent !== value) cell.textContent = value;
    if (cell.title !== title) cell.title = title;
  }
}

function installAttemptCountColumn() {
  const root = document.getElementById('tab-exams');
  if (!root || typeof MutationObserver === 'undefined') return;
  let pending = false;
  const update = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      syncExamAttemptCountCells(root, window.allExamConfigsList);
    });
  };
  const observer = new MutationObserver(update);
  observer.observe(root, {childList: true, subtree: true});
  update();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installAttemptCountColumn, {once: true});
  } else {
    installAttemptCountColumn();
  }
}
