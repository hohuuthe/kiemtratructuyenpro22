/**
 * Ownership of historical exam records must be checked using the live,
 * verified account identity (account.id) or its linked profile (account.user_id).
 * Never grant ownership through exam title, username or display name.
 */
export function canManageExamConfig(user: any, creatorId: unknown, isAdmin: boolean): boolean {
    const accountId = user?.id == null ? '' : String(user.id).trim();
    if (!accountId) return false;
    if (isAdmin) return true; // Admin alone may manage orphaned legacy exams.
    const role = String(user.role ?? '').trim().toLowerCase();
    const audience = String(user.target_audience ?? '').trim().toLowerCase();
    const isTeacher = role === 'teacher' || role === 'giáo viên' || audience === 'giáo viên';
    if (!isTeacher) return false;
    const owner = creatorId == null ? '' : String(creatorId).trim();
    if (!owner) return false;
    const profileId = user.user_id == null ? '' : String(user.user_id).trim();
    return owner === accountId || (!!profileId && owner === profileId);
}

/**
 * Guard the delete itself with the previously read immutable creator_id
 * (including historical NULL) and against new result submissions. This is
 * intentionally NOT a cascade delete of submissions.
 */
export function examConfigGuardedDeleteStatement(id: string, creatorId: unknown) {
    return {
        sql: 'DELETE FROM exam_configs WHERE id = ? AND creator_id IS NOT DISTINCT FROM ? AND NOT EXISTS (SELECT 1 FROM results WHERE exam_id = ?)',
        params: [id, creatorId == null ? null : creatorId, id]
    };
}
