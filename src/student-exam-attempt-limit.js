/**
 * Common, transport-safe model for exam attempt-limit rejection.
 * The server is authoritative. Cached client counts are advisory only.
 */
export const EXAM_ATTEMPT_LIMIT_CODE = 'EXAM_ATTEMPT_LIMIT_REACHED';

function nonnegativeInteger(raw) {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  if (typeof raw === 'string' && /^(?:0|[1-9][0-9]*)$/.test(raw.trim())) {
    const n = Number(raw.trim());
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

export function makeExamAttemptLimitError(used, maximum) {
  const attemptsUsed = nonnegativeInteger(used);
  const maxAttempts = nonnegativeInteger(maximum);
  if (attemptsUsed === null || maxAttempts === null || maxAttempts < 1) {
    throw new Error('Invalid exam attempt-limit counters');
  }
  return {
    code: EXAM_ATTEMPT_LIMIT_CODE,
    error: `Bạn đã sử dụng ${attemptsUsed}/${maxAttempts} lượt làm bài và đã đạt giới hạn của đề thi. Không thể bắt đầu lượt mới. Vui lòng liên hệ giáo viên phụ trách nếu cần hỗ trợ.`,
    attempts_used: attemptsUsed,
    max_attempts: maxAttempts,
    remaining_attempts: 0
  };
}

export function readExamAttemptLimitRejection(status, body) {
  if (Number(status) !== 403 || !body || typeof body !== 'object') return null;
  const error = String(body.error || body.message || '');
  const structured = body.code === EXAM_ATTEMPT_LIMIT_CODE;
  // Older deployed backends used only a Vietnamese error sentence.
  if (!structured && !/đã đạt giới hạn số lần làm bài|đã đạt giới hạn lượt làm bài|đã hết lượt làm bài/i.test(error)) return null;
  return {
    attemptsUsed: nonnegativeInteger(body.attempts_used),
    maxAttempts: nonnegativeInteger(body.max_attempts),
    code: EXAM_ATTEMPT_LIMIT_CODE
  };
}

/**
 * Local precheck never grants permission. For authenticated students only
 * exact matching account/profile IDs count, not other students with the same
 * name. Older result rows lacking exam_id fall back to exam_name.
 */
export function countCachedStudentExamAttempts(rows, {examId, examName, studentName, userIds = []}) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const id = String(examId ?? '').trim();
  const title = String(examName ?? '').trim().toLocaleLowerCase('vi-VN');
  const person = String(studentName ?? '').trim().toLocaleLowerCase('vi-VN');
  const identities = new Set(userIds.map(v => String(v ?? '').trim()).filter(Boolean));
  const usedIds = new Set();
  let matches = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const rowExamId = String(row.exam_id ?? row.examId ?? '').trim();
    const rowExamName = String(row.exam_name ?? row.examName ?? '').trim().toLocaleLowerCase('vi-VN');
    if (rowExamId ? rowExamId !== id : !title || rowExamName !== title) continue;
    const rowUserId = String(row.user_id ?? row.userId ?? '').trim();
    const rowName = String(row.student_name ?? row.studentName ?? '').trim().toLocaleLowerCase('vi-VN');
    if (identities.size ? !identities.has(rowUserId) : !person || rowName !== person) continue;
    const resultId = String(row.id ?? '').trim();
    if (resultId) {
      if (usedIds.has(resultId)) continue;
      usedIds.add(resultId);
    }
    matches++;
  }
  return matches;
}
