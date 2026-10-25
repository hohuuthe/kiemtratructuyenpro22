/**
 * Destructive per-exam result cleanup. The numeric "1234" is a confirmation
 * phrase, never an authorization secret: authorization is bound to the live
 * account and the exact exam ID on every server request.
 */
export class ExamResultsDeletionError extends Error {
  constructor(message: string, public status = 400, public code = 'EXAM_RESULTS_DELETE_INVALID') {
    super(message);
    this.name = 'ExamResultsDeletionError';
  }
}

const normalizeRole = (raw: unknown) => String(raw ?? '').trim().toLowerCase();

/** Only verified account admins have global deletion rights. */
export function isExamResultsAdministrator(user: any): boolean {
  const role = normalizeRole(user?.role);
  return !!user?.id && (role === 'admin' || role === 'quản trị viên');
}

/**
 * Teachers may delete results of their OWN exams only. Old teacher accounts
 * having a teacher profile audience are supported, but can never act globally.
 */
export function mayDeleteExamResults(user: any): boolean {
  if (!user?.id) return false;
  if (isExamResultsAdministrator(user)) return true;
  const role = normalizeRole(user.role);
  const audience = normalizeRole(user.target_audience);
  return role === 'teacher' || role === 'giáo viên' || audience === 'giáo viên';
}

export function requiredExamResultsId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || value.includes('\0')) {
    throw new ExamResultsDeletionError('Phải chọn đúng một đề thi cụ thể để xóa kết quả.', 400, 'EXAM_ID_REQUIRED');
  }
  // Never trim the actual SQL key: spaces can be significant in historical IDs.
  return value;
}

export function requireExamResultsConfirmation(value: unknown, count: unknown): number {
  if (value !== '1234') {
    throw new ExamResultsDeletionError('Mã xác nhận không chính xác. Vui lòng nhập đúng 1234.', 400, 'INVALID_CONFIRMATION');
  }
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) {
    throw new ExamResultsDeletionError('Số kết quả cần xóa không hợp lệ. Vui lòng mở lại hộp thoại.', 400, 'INVALID_EXPECTED_COUNT');
  }
  return count;
}

export function examResultsCountQuery(examId: string) {
  return { sql: 'SELECT COUNT(*) AS total FROM results WHERE exam_id = ?', params: [examId] };
}

/**
 * One atomic SQL statement. It checks the current row count AND that the exam
 * still exists with its original creator. If submissions or ownership changed
 * since preview, the statement deletes zero rows rather than an unexpected set.
 */
export function examResultsGuardedDeleteStatement(examId: string, creatorId: unknown, expectedCount: number) {
  return {
    sql: 'DELETE FROM results WHERE exam_id = ? ' +
      'AND EXISTS (SELECT 1 FROM exam_configs e WHERE e.id = ? AND e.creator_id IS NOT DISTINCT FROM ?) ' +
      'AND (SELECT COUNT(*) FROM results WHERE exam_id = ?) = ?',
    params: [examId, examId, creatorId == null ? null : creatorId, examId, expectedCount]
  };
}
