/**
 * Authorized question-bank author identity.
 * questions.creator_id historically stores either accounts.id or users.id.
 * The caller must authenticate and scope the question list BEFORE exposing these fields.
 * Never resolve authors by question text, lesson name or a client-supplied account list.
 */
export const QUESTION_CREATOR_JOIN_SQL =
  " LEFT JOIN accounts author_account ON author_account.id = q.creator_id" +
  " LEFT JOIN users author_profile ON author_profile.id = COALESCE(NULLIF(author_account.user_id, ''), q.creator_id)";

export const QUESTION_CREATOR_NAME_SQL =
  "COALESCE(NULLIF(BTRIM(author_profile.full_name), '')," +
  " NULLIF(BTRIM(author_account.username), '')," +
  " (SELECT NULLIF(BTRIM(a.username), '') FROM accounts a WHERE a.user_id = q.creator_id ORDER BY a.id LIMIT 1), '')";

const clean = value => typeof value === 'string' ? value.trim() : '';
const idOf = question => clean(question?.creatorId ?? question?.creator_id);

/** Full name supplied by the verified API, never inferred from a question's content. */
export function verifiedQuestionAuthorName(question) {
  return clean(question?.creator_name) || clean(question?.creatorName) || '';
}

export function questionAuthorDisplayName(question, accountsById = {}, currentUser = null) {
  const verified = verifiedQuestionAuthorName(question);
  if (verified) return verified;
  const id = idOf(question);
  if (!id) return 'Chưa có mã tác giả';
  const fromCache = clean(accountsById?.[id]);
  if (fromCache) return fromCache;
  if (currentUser && [currentUser.id,currentUser.user_id].some(value => value != null && String(value) === id)) {
    const name = clean(currentUser.full_name) || clean(currentUser.username);
    if (name) return name;
  }
  // Explicit diagnostic state; never substitute another teacher or "Hệ thống".
  return 'Chưa liên kết hồ sơ tác giả';
}
