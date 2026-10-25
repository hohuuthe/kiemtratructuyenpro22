import { canManageExamConfig } from './exam-config-deletion-policy';
import {
  ExamResultsDeletionError, isExamResultsAdministrator, mayDeleteExamResults,
  requiredExamResultsId, requireExamResultsConfirmation, examResultsCountQuery,
  examResultsGuardedDeleteStatement
} from './exam-results-delete-policy';

type CleanupDb = {
  first: (sql: string, params: unknown[]) => Promise<any>;
  run: (sql: string, params: unknown[]) => Promise<{ changes: number }>;
};

function safeCount(raw: any): number {
  // PostgreSQL COUNT(*) is an int8 string through Neon.
  const count = Number(raw);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new ExamResultsDeletionError('Không thể xác nhận chính xác số bài làm trong cơ sở dữ liệu.', 503, 'INVALID_RESULT_COUNT');
  }
  return count;
}

/**
 * Shared business handler for both Cloudflare Pages and the Node server.
 * There is never a fallback to exam_name, student_name, or a client-supplied
 * list of result IDs. The database adapter always operates in the request tenant.
 */
export async function processExamResultsDeletion(db: CleanupDb, user: any, body: any) {
  if (!user?.id) {
    throw new ExamResultsDeletionError('Vui lòng đăng nhập lại để quản lý kết quả thi.', 401, 'AUTH_REQUIRED');
  }
  if (!mayDeleteExamResults(user)) {
    throw new ExamResultsDeletionError('Tài khoản không có quyền xóa kết quả thi.', 403, 'EXAM_RESULTS_FORBIDDEN');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ExamResultsDeletionError('Dữ liệu yêu cầu không hợp lệ.', 400, 'INVALID_BODY');
  }

  const examId = requiredExamResultsId(body.examId);
  if (body.action !== 'preview' && body.action !== 'delete') {
    throw new ExamResultsDeletionError('Thao tác không hợp lệ.', 400, 'INVALID_ACTION');
  }
  const exam: any = await db.first(
    'SELECT id, name, creator_id FROM exam_configs WHERE id = ?', [examId]
  );
  if (!exam) {
    throw new ExamResultsDeletionError('Đề thi không còn tồn tại.', 404, 'EXAM_NOT_FOUND');
  }
  const isAdmin = isExamResultsAdministrator(user);
  if (!canManageExamConfig(user, exam.creator_id, isAdmin)) {
    throw new ExamResultsDeletionError('Bạn không có quyền xóa kết quả của đề thi này.', 403, 'EXAM_RESULTS_FORBIDDEN');
  }

  const query = examResultsCountQuery(examId);
  const initial = await db.first(query.sql, query.params);
  const currentCount = safeCount(initial?.total);

  if (body.action === 'preview') {
    return {
      success: true, action: 'preview', examId, examName: String(exam.name || 'Đề thi không tên'),
      count: currentCount, scope: isAdmin ? 'admin' : 'owner'
    };
  }

  const expectedCount = requireExamResultsConfirmation(body.confirmation, body.expectedCount);
  if (currentCount !== expectedCount) {
    throw new ExamResultsDeletionError(
      'Số bài làm của đề thi đã thay đổi. Vui lòng đóng và mở lại hộp thoại để xác nhận số liệu mới.',
      409, 'RESULT_COUNT_CHANGED'
    );
  }

  const statement = examResultsGuardedDeleteStatement(examId, exam.creator_id, expectedCount);
  const deletion = await db.run(statement.sql, statement.params);
  const deletedCount = Number(deletion?.changes);
  if (!Number.isSafeInteger(deletedCount) || deletedCount < 0) {
    throw new ExamResultsDeletionError('Máy chủ không xác minh được số kết quả đã xóa.', 503, 'DELETE_COUNT_UNVERIFIED');
  }
  if (deletedCount !== expectedCount) {
    if (deletedCount !== 0) {
      throw new ExamResultsDeletionError(
        'Đã có ' + deletedCount + ' kết quả bị xóa, nhưng số lượng không khớp. Cần tải lại để kiểm tra.',
        409, 'DELETE_COUNT_MISMATCH'
      );
    }
    throw new ExamResultsDeletionError(
      'Kết quả hoặc quyền quản lý đề đã thay đổi. Không xóa dữ liệu nào, hãy xem lại trước khi thử lại.',
      409, 'RESULT_COUNT_CHANGED'
    );
  }

  // A new student submission that commits immediately after the deletion can
  // legitimately create a new result; report it explicitly instead of saying 0.
  const after = await db.first(query.sql, query.params);
  const remainingCount = safeCount(after?.total);
  return {
    success: true, action: 'delete', examId, deletedCount, remainingCount,
    message: remainingCount === 0
      ? 'Đã xóa ' + deletedCount + ' kết quả của đề thi.'
      : 'Đã xóa ' + deletedCount + ' kết quả; có ' + remainingCount + ' kết quả mới hoặc đồng thời còn lại.'
  };
}
