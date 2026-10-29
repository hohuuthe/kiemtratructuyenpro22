/**
 * Shared, server-owned exam readiness checks.
 * Never return question text, answer, options, or question IDs from a preflight.
 */
export const EXAM_QUESTION_INVENTORY_SQL =
  "SELECT type, level, lesson, COUNT(DISTINCT id) AS available FROM questions "
  + "WHERE (creator_id = ? OR creator_id IN (SELECT user_id FROM accounts WHERE id = ?) "
  + "OR creator_id IN (SELECT id FROM accounts WHERE user_id = ?)) "
  + "AND id IS NOT NULL AND TRIM(COALESCE(content, '')) <> '' "
  + "GROUP BY type, level, lesson";

export function normalizeExamQuestionType(type) {
  const t = String(type || '').trim().toLowerCase();
  if (['4-1', 'trac_nghiem', 'mcq'].includes(t)) return '4-1';
  if (['tf4', 'dung_sai', 'true_false'].includes(t)) return 'TF4';
  if (['sq', 'tra_loi_ngan', 'short_answer'].includes(t)) return 'SQ';
  if (['tl', 'tu_luan', 'essay'].includes(t)) return 'TL';
  return '';
}

export function normalizeExamLesson(value) {
  return String(value || '').normalize('NFD').toLowerCase()
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

const categories = [
  ['4-1', 'Trắc nghiệm 4 lựa chọn', 'count41', 'count41'],
  ['TF4', 'Đúng / Sai', 'countTF4', 'countTF4'],
  ['SQ', 'Trả lời ngắn', 'countSQ', 'countSQ'],
  ['TL', 'Tự luận', 'countTL', 'countTL']
];
const levels = [['NB', 'Nhận biết'], ['TH', 'Thông hiểu'], ['VD', 'Vận dụng']];

function invalid(error, code = 'EXAM_QUESTION_BANK_INSUFFICIENT') {
  return { ready: false, code, error };
}
function integerCount(value) {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) && number >= 0 && number <= 10000 ? number : null;
}

/** rows: aggregated metadata for exactly one teacher, never the question bank. */
export function validateExamQuestionInventory(rows, exam) {
  if (!exam || !Array.isArray(rows)) return invalid('Không thể xác thực ngân hàng câu hỏi.', 'EXAM_QUESTION_CHECK_UNAVAILABLE');
  const lessons = Array.isArray(exam.selectedLessons) ? exam.selectedLessons : [];
  const allowed = new Set(lessons.map(normalizeExamLesson).filter(Boolean));
  if (!allowed.size) return invalid('Đề thi chưa cấu hình bài học hoặc chuyên đề.', 'EXAM_QUESTION_CONFIG_INVALID');

  const availableCounts = Object.create(null);
  for (const row of rows) {
    const type = normalizeExamQuestionType(row.type);
    const level = String(row.level || '').trim().toUpperCase();
    const lesson = normalizeExamLesson(row.lesson);
    const count = integerCount(row.available);
    if (!type || !['NB', 'TH', 'VD'].includes(level) || !allowed.has(lesson)) continue;
    if (count === null) return invalid('Metadata câu hỏi không hợp lệ.', 'EXAM_QUESTION_CHECK_UNAVAILABLE');
    const key = type + '-' + level;
    availableCounts[key] = (availableCounts[key] || 0) + count;
  }

  let total = 0;
  const detail = exam.countsDetail && typeof exam.countsDetail === 'object' ? exam.countsDetail : {};
  for (const [type, label, countKey, detailPrefix] of categories) {
    const requested = integerCount(exam[countKey]);
    if (requested === null) return invalid('Số lượng câu hỏi cấu hình không hợp lệ.', 'EXAM_QUESTION_CONFIG_INVALID');
    total += requested;
    const gradeTargets = {};
    let gradeTotal = 0;
    for (const [level] of levels) {
      const value = integerCount(detail[detailPrefix + level]);
      if (value === null) return invalid('Cấu hình số câu theo mức độ không hợp lệ.', 'EXAM_QUESTION_CONFIG_INVALID');
      gradeTargets[level] = value;
      gradeTotal += value;
    }
    if (gradeTotal > requested) {
      return invalid('Cấu hình [' + label + '] có tổng số câu theo mức độ lớn hơn số câu của dạng bài.',
        'EXAM_QUESTION_CONFIG_INVALID');
    }
    const availableTotal = levels.reduce((sum, [level]) => sum + (availableCounts[type + '-' + level] || 0), 0);
    if (requested > availableTotal) {
      return invalid('Ngân hàng thiếu câu hỏi [' + label + ']: cần ' + requested
        + ', hiện có ' + availableTotal + '.');
    }
    for (const [level, levelLabel] of levels) {
      const required = gradeTargets[level];
      const present = availableCounts[type + '-' + level] || 0;
      if (present < required) {
        return invalid('Ngân hàng thiếu câu hỏi [' + label + '] mức ' + levelLabel
          + ': cần ' + required + ', hiện có ' + present + '.');
      }
    }
  }
  if (!total || total > 10000) {
    return invalid('Đề thi chưa có số lượng câu hỏi hợp lệ.', 'EXAM_QUESTION_CONFIG_INVALID');
  }
  return { ready: true, code: 'EXAM_READY', totalQuestions: total, availableCounts };
}

/** The configured exam schedule must be enforced at the server, not by device time. */
export function checkExamStartWindow(exam, nowMs = Date.now()) {
  const aclRaw = exam?.access_control ?? exam?.accessControl;
  let acl = aclRaw;
  if (typeof aclRaw === 'string') {
    try { acl = JSON.parse(aclRaw); } catch { return invalid('Cấu hình thời gian đề thi không hợp lệ.', 'EXAM_TIME_CONFIG_INVALID'); }
  }
  if (!acl || typeof acl !== 'object') acl = {};
  const enabled = acl.enabled === true || acl.enabled === 1 || acl.enabled === '1' || acl.enabled === 'true';
  if (!enabled) return { ready: true };
  const startRaw = exam?.tg_bd || acl.startTime || '';
  const endRaw = exam?.tg_kt || acl.endTime || '';
  const asTime = (raw) => {
    if (!raw) return null;
    const n = new Date(raw).getTime();
    return Number.isFinite(n) ? n : NaN;
  };
  const start = asTime(startRaw), end = asTime(endRaw);
  if (Number.isNaN(start) || Number.isNaN(end) || (start !== null && end !== null && start > end)) {
    return invalid('Thời gian cấu hình đề thi không hợp lệ.', 'EXAM_TIME_CONFIG_INVALID');
  }
  if (start !== null && nowMs < start) return invalid('Đề thi chưa đến thời gian bắt đầu.', 'EXAM_NOT_STARTED');
  if (end !== null && nowMs > end) return invalid('Đề thi đã hết thời gian cho phép làm bài.', 'EXAM_CLOSED');
  return { ready: true };
}
