import { isAccountEnabled } from './security-session';
import { ExamResultsDeletionError } from './exam-results-delete-policy';

/**
 * Node tokens contain a signed account snapshot. Before deleting real results,
 * refresh both the account AND its linked teacher profile; a profile demotion
 * must never keep the old teacher audience embedded in the JWT.
 */
const enabled = (raw: unknown) => raw == null ||
  !['0', 'false', 'disabled'].includes(String(raw).trim().toLowerCase());

function unexpired(raw: unknown, now: number): boolean {
  if (raw == null || raw === '') return true;
  const value = String(raw).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value + 'T23:59:59.999+07:00' : value;
  const expires = Date.parse(normalized);
  return Number.isFinite(expires) && expires >= now;
}

export function resolveLiveExamResultsActor(claims: any, live: any, now = Date.now()) {
  if (!claims?.id || !live?.id || String(live.id) !== String(claims.id) ||
      !isAccountEnabled(live) || !unexpired(live.expiry_date, now)) {
    throw new ExamResultsDeletionError(
      'Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.',
      401, 'AUTH_REQUIRED'
    );
  }
  if (!enabled(live.profile_active) || !unexpired(live.profile_expiry_date, now)) {
    throw new ExamResultsDeletionError(
      'Hồ sơ giáo viên không còn hoạt động hoặc đã hết hạn.',
      403, 'EXAM_RESULTS_FORBIDDEN'
    );
  }

  const role = String(live.role || '').trim();
  // NEVER use claims.target_audience as a fallback: it may be stale.
  const target_audience = String(live.target_audience || '').trim() ||
    (['teacher', 'giáo viên'].includes(role.toLowerCase()) ? 'Giáo viên' :
      role.toLowerCase() === 'admin' ? 'Quản trị viên' : 'Học sinh');
  return {
    id: live.id,
    user_id: live.user_id || live.id,
    role,
    target_audience
  };
}
