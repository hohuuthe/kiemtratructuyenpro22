/**
 * Deleting saved submissions is distinct from permission to READ results.
 * Teachers can see class submissions, but may DELETE only submissions tied to
 * exam_configs.creator_id matching their verified account/profile identifiers.
 * Every mutation is authorized again on the server; UI checks are advisory.
 */
export function canDeleteRankingResult(result, currentUser, isAdmin, isTeacher) {
  if (!currentUser?.id) return false;
  if (isAdmin === true) return true;
  if (isTeacher !== true) return false;
  const owner = String(result?.examCreatorId ?? result?.exam_creator_id ?? '').trim();
  return !!owner && [currentUser.id,currentUser.user_id]
    .filter(value => value !== null && value !== undefined && String(value).trim())
    .some(value => String(value) === owner);
}

export class RankingResultDeleteError extends Error {
  constructor(message,status=400,code='INVALID_RESULT_DELETE') {
    super(message);
    this.name='RankingResultDeleteError';
    this.status=status;
    this.code=code;
  }
}
export function authorizedResultActor(user) {
  const id = String(user?.id ?? '').trim();
  if (!id) throw new RankingResultDeleteError('Cần đăng nhập để xóa kết quả.',401,'AUTH_REQUIRED');
  const role = String(user?.role ?? '').trim().toLowerCase();
  if (role === 'admin' || role === 'quản trị viên') return {admin:true, ids:[id]};
  const audience = String(user?.target_audience ?? '').trim().toLowerCase();
  if (!(role === 'teacher' || role === 'giáo viên' || audience === 'giáo viên'))
    throw new RankingResultDeleteError('Không có quyền xóa kết quả.',403,'ROLE_DENIED');
  const ids=[...new Set([id,String(user?.user_id ?? '').trim()].filter(Boolean))];
  return {admin:false,ids};
}
export function buildRankingResultsDeletion(ids,user) {
  const actor=authorizedResultActor(user);
  if (!Array.isArray(ids) || !ids.length || ids.length>200)
    throw new RankingResultDeleteError('Chọn từ 1 đến 200 kết quả cho mỗi lượt xóa.',400,'INVALID_SELECTION');
  if (ids.some(id => typeof id !== 'string' || !id.trim() || id.length>256 || id.includes('\0')))
    throw new RankingResultDeleteError('Danh sách mã kết quả không hợp lệ.',400,'INVALID_IDS');
  const unique=[...new Set(ids)];
  const marks=unique.map(()=>'?').join(',');
  const owned=actor.admin?'':` AND EXISTS (SELECT 1 FROM exam_configs e WHERE e.id = results.exam_id AND e.creator_id IN (${actor.ids.map(()=>'?').join(',')}))`;
  const verify=actor.admin?
    `SELECT COUNT(*) FROM results r WHERE r.id IN (${marks})`:
    `SELECT COUNT(DISTINCT r.id) FROM results r JOIN exam_configs e ON e.id=r.exam_id WHERE r.id IN (${marks}) AND e.creator_id IN (${actor.ids.map(()=>'?').join(',')})`;
  const sql=`DELETE FROM results WHERE id IN (${marks})${owned} AND (${verify}) = ?`;
  const params=actor.admin?[...unique,...unique,unique.length]:
    [...unique,...actor.ids,...unique,...actor.ids,unique.length];
  return {sql,params,count:unique.length,admin:actor.admin};
}
