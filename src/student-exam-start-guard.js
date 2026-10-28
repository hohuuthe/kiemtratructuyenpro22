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
    ? 'Đề thi <strong class="text-slate-800">' + escapeExamText(title) + '</strong> đã đạt giới hạn lượt làm bài được phép.'
    : 'Bạn đã đạt giới hạn lượt làm bài được phép của đề thi này.';
  const countMarkup = hasCount
    ? '<div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-slate-700 mb-4 text-left">'
      + '<div class="flex justify-between gap-4"><span>Đã làm:</span><strong>' + count + ' lượt</strong></div>'
      + '<div class="flex justify-between gap-4 mt-2"><span>Tối đa:</span><strong>' + limit + ' lượt</strong></div>'
      + '<div class="flex justify-between gap-4 mt-2 pt-2 border-t border-amber-200"><span>Còn lại:</span><strong>0 lượt</strong></div>'
      + '</div>'
    : '';
  return '<div role="alertdialog" aria-modal="true" aria-labelledby="exam-attempt-limit-heading" '
    + 'aria-describedby="exam-attempt-limit-description" class="p-5 sm:p-6 text-center w-full mx-auto">'
    + '<div class="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-100 text-3xl flex items-center justify-center mx-auto mb-3" aria-hidden="true">🔒</div>'
    + '<h3 id="exam-attempt-limit-heading" class="text-lg sm:text-xl font-bold text-slate-900 mb-2">Bạn đã hết lượt làm bài</h3>'
    + '<p id="exam-attempt-limit-description" class="text-sm text-slate-600 mb-4">' + examMessage + '</p>'
    + countMarkup
    + '<p class="text-xs sm:text-sm text-slate-500 mb-5">Bạn không thể bắt đầu thêm lượt thi. Nếu cần được làm lại, vui lòng liên hệ giáo viên phụ trách.</p>'
    + '<button type="button" id="exam-attempt-limit-confirm" '
    + 'class="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2">Đã hiểu</button>'
    + '</div>';
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
      controller.abort();
      const error = new Error('Kết nối máy chủ quá thời gian cho phép. Vui lòng thử lại.');
      error.code = 'EXAM_START_TIMEOUT';
      reject(error);
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
