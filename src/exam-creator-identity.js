/**
 * Canonical, server-verified creator identity for exam configuration and result lists.
 * exam_configs.creator_id may contain either accounts.id (normal) or users.id (legacy).
 * Never resolve identity from a non-unique exam title or from a preloaded account list.
 */
export const EXAM_CREATOR_JOIN_SQL =
  " LEFT JOIN accounts creator_account ON creator_account.id = ec.creator_id" +
  " LEFT JOIN users creator_profile ON creator_profile.id = COALESCE(NULLIF(creator_account.user_id, ''), ec.creator_id)";

export const EXAM_CREATOR_NAME_SQL =
  "COALESCE(NULLIF(BTRIM(creator_profile.full_name), '')," +
  " NULLIF(BTRIM(creator_account.username), '')," +
  " (SELECT NULLIF(BTRIM(a.username), '') FROM accounts a WHERE a.user_id = ec.creator_id ORDER BY a.id LIMIT 1), '')";

/** The only legitimate identity fallback is the exact verified creator ID. */
export function examCreatorDisplayName(row, accountsMap = {}, currentUser = null) {
  const cleaned = value => typeof value === 'string' ? value.trim() : '';
  for (const value of [
    row?.examCreatorName, row?.exam_creator_name,
    row?.creatorName, row?.creator_name, row?.examCreator
  ]) {
    if (cleaned(value)) return cleaned(value);
  }
  const id = cleaned(row?.examCreatorId ?? row?.exam_creator_id ??
    row?.creator_id ?? row?.creatorId);
  if (id && cleaned(accountsMap?.[id])) return cleaned(accountsMap[id]);
  if (id && currentUser && [currentUser.id, currentUser.user_id].some(
    value => value != null && String(value) === id
  )) {
    const name = cleaned(currentUser.full_name) || cleaned(currentUser.username);
    if (name) return name;
  }
  return id ? 'Chưa rõ tên người tạo (ID: ' + id + ')' :
    'Không xác định (đề thi đã xóa hoặc thiếu mã đề)';
}
