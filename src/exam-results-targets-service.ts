import { canManageExamConfig } from './exam-config-deletion-policy';
import {
  ExamResultsDeletionError, isExamResultsAdministrator,
  mayDeleteExamResults
} from './exam-results-delete-policy';

type TargetDb = {
  all: (sql: string, params: unknown[]) => Promise<any[]>;
  first: (sql: string, params: unknown[]) => Promise<any>;
};

function safeCount(raw: unknown): number {
  if (raw == null || raw === '') throw new ExamResultsDeletionError(
    'Không xác minh được số bài làm.', 503, 'INVALID_RESULT_COUNT');
  const count = Number(raw);
  if (!Number.isSafeInteger(count) || count < 0) throw new ExamResultsDeletionError(
    'Không xác minh được số bài làm.', 503, 'INVALID_RESULT_COUNT');
  return count;
}

function validExamId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 &&
    value.length <= 256 && !value.includes('\0');
}

/**
 * Resolve the ranking NAME filter to exact exam IDs on the current tenant.
 * Includes renamed exams (historical result.exam_name) and, for admins only,
 * results for deleted exam configurations which still have an exam_id.
 *
 * Teacher candidates are restricted with the live account/profile creator IDs
 * in SQL and checked a second time by canManageExamConfig.
 * Legacy submissions without any exam_id are intentionally never deleted by
 * name, because different exam IDs can have the same title.
 */
export async function listExamResultsDeletionTargets(db: TargetDb, user: any, examName: unknown) {
  if (!user?.id) throw new ExamResultsDeletionError(
    'Vui lòng đăng nhập lại.', 401, 'AUTH_REQUIRED');
  if (!mayDeleteExamResults(user)) throw new ExamResultsDeletionError(
    'Bạn không có quyền xóa kết quả.', 403, 'EXAM_RESULTS_FORBIDDEN');
  if (typeof examName !== 'string' || !examName.trim() || examName.length > 512 ||
      examName.includes('\0')) {
    throw new ExamResultsDeletionError(
      'Vui lòng chọn đúng một đề thi trong bộ lọc.', 400, 'EXAM_NAME_REQUIRED');
  }
  if (!db || typeof db.all !== 'function' || typeof db.first !== 'function') {
    throw new ExamResultsDeletionError(
      'Máy chủ chưa hỗ trợ tra cứu mã đề thi.', 503, 'TARGET_LOOKUP_UNAVAILABLE');
  }

  const isAdmin = isExamResultsAdministrator(user);
  const params: unknown[] = [examName, examName];
  let query = `SELECT ec.id, ec.name, ec.creator_id,
      (SELECT COUNT(*) FROM results r WHERE r.exam_id = ec.id) AS attempt_count
    FROM exam_configs ec
    WHERE (ec.name = ? OR EXISTS
       (SELECT 1 FROM results r WHERE r.exam_id = ec.id AND r.exam_name = ?))`;
  if (!isAdmin) {
    query += ' AND ec.creator_id IN (?, ?)';
    params.push(user.id, user.user_id || user.id);
  }
  query += ' ORDER BY ec.id LIMIT 501';
  const rows = await db.all(query, params);
  if (rows.length > 500) throw new ExamResultsDeletionError(
    'Có quá nhiều mã đề cùng tên. Vui lòng liên hệ quản trị viên.', 409, 'TOO_MANY_TARGETS');

  const targets = new Map<string, {
    id: string; name: string; orphaned: boolean; attemptCount: number
  }>();
  for (const row of rows) {
    if (!validExamId(row?.id)) continue;
    if (!canManageExamConfig(user, row.creator_id, isAdmin)) continue;
    targets.set(row.id, {
      id: row.id,
      name: String(row.name ?? examName),
      orphaned: false,
      attemptCount: safeCount(row.attempt_count)
    });
  }

  if (isAdmin) {
    const orphaned = await db.all(
      `SELECT r.exam_id AS id, MIN(r.exam_name) AS name,
             COUNT(*) AS attempt_count
       FROM results r
       WHERE r.exam_name = ? AND r.exam_id IS NOT NULL
         AND TRIM(r.exam_id) <> ''
         AND NOT EXISTS (SELECT 1 FROM exam_configs ec WHERE ec.id = r.exam_id)
       GROUP BY r.exam_id ORDER BY r.exam_id LIMIT 501`,
      [examName]
    );
    if (orphaned.length > 500) throw new ExamResultsDeletionError(
      'Có quá nhiều mã đề cũ cần tra cứu.', 409, 'TOO_MANY_TARGETS');
    for (const row of orphaned) {
      if (!validExamId(row?.id) || targets.has(row.id)) continue;
      targets.set(row.id, {
        id: row.id,
        name: String(row.name ?? examName),
        orphaned: true,
        attemptCount: safeCount(row.attempt_count)
      });
    }
  }

  const countMissing = isAdmin ? await db.first(
    `SELECT COUNT(*) AS total FROM results
     WHERE exam_name = ? AND (exam_id IS NULL OR TRIM(exam_id) = '')`,
    [examName]
  ) : null;
  return {
    success: true,
    action: 'targets',
    examName,
    targets: [...targets.values()].sort((a,b) => a.id.localeCompare(b.id, 'vi')),
    unlinkedCount: isAdmin ? safeCount(countMissing?.total) : 0
  };
}
