/**
 * Hợp đồng lỗi khi học sinh đã sử dụng hết lượt thi.
 * Máy chủ là nguồn dữ liệu duy nhất được tin cậy để quyết định giới hạn.
 */
export const EXAM_ATTEMPT_LIMIT_REACHED = 'EXAM_ATTEMPT_LIMIT_REACHED';

function safeCount(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : null;
  }
  return null;
}

export function parseExamAttemptLimitError(status, payload) {
  if (status !== 403 || !payload || typeof payload !== 'object') return null;
  const code = String(payload.code || '');
  const message = String(payload.error || payload.message || '');
  const isLegacyLimitError = /đã đạt giới hạn số lần làm bài/i.test(message);
  if (code !== EXAM_ATTEMPT_LIMIT_REACHED && !isLegacyLimitError) return null;

  // Cho phép UI nhận lỗi từ bản API cũ trong thời gian cập nhật triển khai.
  const legacyNumbers = message.match(/(?:hoàn thành|đã làm)\s+(\d+)\s+lần[\s\S]*?tối đa\s+(\d+)\s+lần/i);
  const attemptCount = safeCount(payload.attemptCount) ?? safeCount(payload.attempt_count) ?? safeCount(legacyNumbers?.[1]);
  const maxAttempts = safeCount(payload.maxAttempts) ?? safeCount(payload.max_attempts) ?? safeCount(legacyNumbers?.[2]);
  return { attemptCount, maxAttempts: maxAttempts !== null && maxAttempts > 0 ? maxAttempts : null };
}

function escapeExamText(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function buildExamAttemptLimitModal(examName, details) {
  const title = String(examName || '').trim();
  const info = details || {};
  const count = safeCount(info.attemptCount);
  const limit = safeCount(info.maxAttempts);
  const hasCount = count !== null && limit !== null && limit > 0;
  const examMessage = title
    ? 'Đề thi <strong>' + escapeExamText(title) + '</strong> đã đạt giới hạn lượt làm bài được phép.'
    : 'Bạn đã đạt giới hạn lượt làm bài được phép của đề thi này.';
  const counts = hasCount
    ? '<div class="student-exam-dialog-stats" aria-label="Thống kê lượt thi">'
      + '<div><span>Đã làm:</span><strong>' + count + ' lượt</strong></div>'
      + '<div><span>Tối đa:</span><strong>' + limit + ' lượt</strong></div>'
      + '<div><span>Còn lại:</span><strong>0 lượt</strong></div>'
      + '</div>'
    : '';
  return '<section class="student-exam-compact-body" role="alertdialog" aria-modal="true"'
    + ' aria-labelledby="exam-attempt-limit-heading" aria-describedby="exam-attempt-limit-description">'
    + '<div class="student-exam-dialog-head">'
    + '<span class="student-exam-dialog-icon student-exam-dialog-icon-warning" aria-hidden="true">🔒</span>'
    + '<h3 class="student-exam-dialog-title" id="exam-attempt-limit-heading">Bạn đã hết lượt làm bài</h3>'
    + '</div>'
    + '<p class="student-exam-dialog-note" id="exam-attempt-limit-description">' + examMessage + '</p>'
    + counts
    + '<p class="student-exam-dialog-footnote">Nếu cần làm lại, vui lòng liên hệ giáo viên phụ trách.</p>'
    + '<div class="student-exam-dialog-actions"><button type="button" id="exam-attempt-limit-confirm"'
    + ' class="student-exam-dialog-primary">Đã hiểu</button></div>'
    + '</section>';
}

export function buildExamReadyModal() {
  return '<section class="student-exam-compact-body" role="dialog" aria-modal="true"'
    + ' aria-labelledby="exam-start-ready-heading" aria-describedby="exam-start-ready-description">'
    + '<div class="student-exam-dialog-head">'
    + '<span class="student-exam-dialog-icon student-exam-dialog-icon-ready" aria-hidden="true">✅</span>'
    + '<h3 class="student-exam-dialog-title" id="exam-start-ready-heading">Đề thi đã sẵn sàng</h3>'
    + '</div>'
    + '<p class="student-exam-dialog-note" id="exam-start-ready-description">'
    + 'Nhấn <strong>Vào phòng thi</strong> để mở toàn màn hình và bắt đầu tính giờ làm bài.'
    + '</p>'
    + '<div class="student-exam-dialog-actions">'
    + '<button type="button" id="exam-start-ready-confirm" class="student-exam-dialog-primary">Vào phòng thi</button>'
    + '<button type="button" id="exam-start-ready-cancel" class="student-exam-dialog-secondary">Quay lại chọn đề</button>'
    + '</div></section>';
}

/**
 * Bao gồm cả thời gian đọc nội dung phản hồi; nếu máy chủ không phản hồi, trả lại
 * quyền thao tác sau thời hạn và hủy yêu cầu đang chờ.
 */
export async function fetchExamStartResponse(fetcher, url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const deadline = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20000;
  let timerId;
  const timeout = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      const error = new Error('Kết nối máy chủ quá thời gian cho phép. Vui lòng thử lại.');
      error.code = 'EXAM_START_TIMEOUT';
      // Trả lỗi timeout trước khi abort kích hoạt rejection từ fetch.
      reject(error);
      controller.abort();
    }, deadline);
  });
  try {
    const response = await Promise.race([fetcher(url, { ...options, signal: controller.signal }), timeout]);
    const rawText = await Promise.race([response.text(), timeout]);
    let body = null;
    try { body = JSON.parse(rawText); } catch (_) {}
    return { ok: response.ok, status: response.status, body, rawText };
  } finally {
    clearTimeout(timerId);
  }
}
