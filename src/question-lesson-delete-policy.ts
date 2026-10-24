/**
 * Bulk deletion policy shared by Cloudflare Pages and local Node APIs.
 *
 * The user-entered "123" is an explicit destructive-action confirmation,
 * NOT an authentication credential. The server still verifies the live login
 * and scopes all reads/writes to the current teacher (or an administrator).
 */
export class QuestionLessonDeleteError extends Error {
    constructor(message: string, public status = 400, public code = 'INVALID_LESSON_DELETE') {
        super(message);
        this.name = 'QuestionLessonDeleteError';
    }
}

export function requiredQuestionLesson(raw: unknown): string {
    // Exact-match semantics: do NOT trim the lesson used in SQL, otherwise
    // lessons with leading/trailing spaces could be accidentally conflated.
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 300 || raw.includes('\0')) {
        throw new QuestionLessonDeleteError('Phải chọn một bài học cụ thể, không được chọn "Tất cả bài".');
    }
    return raw;
}

export function questionLessonDeleteScope(lesson: string, userId: unknown, isAdmin: boolean) {
    const exactLesson = requiredQuestionLesson(lesson);
    const uid = typeof userId === 'string' ? userId.trim() : String(userId ?? '').trim();
    if (!uid) throw new QuestionLessonDeleteError('Không xác định được tài khoản đang đăng nhập.', 403, 'INVALID_OWNER');
    return {
        lesson: exactLesson,
        where: isAdmin ? 'lesson = ?' : 'lesson = ? AND creator_id = ?',
        params: isAdmin ? [exactLesson] : [exactLesson, uid],
        scope: isAdmin ? 'all' : 'own'
    };
}

export function requireQuestionLessonConfirmation(code: unknown, expectedCount: unknown): number {
    if (code !== '123') {
        throw new QuestionLessonDeleteError('Mã xác nhận không đúng. Vui lòng nhập chính xác 123.', 400, 'INVALID_CONFIRMATION');
    }
    if (typeof expectedCount !== 'number' || !Number.isSafeInteger(expectedCount) || expectedCount < 1) {
        throw new QuestionLessonDeleteError('Số câu hỏi xác nhận không hợp lệ. Vui lòng tải lại số lượng câu hỏi.', 400, 'INVALID_EXPECTED_COUNT');
    }
    return expectedCount;
}

export function questionLessonCountQuery(scope: ReturnType<typeof questionLessonDeleteScope>) {
    return {
        sql: 'SELECT COUNT(*) AS total FROM questions WHERE ' + scope.where,
        params: scope.params
    };
}

/**
 * The server compares the previously previewed count inside the DELETE SQL
 * statement, so an ordinary stale page cannot delete a changed lesson batch.
 * One SQL statement is atomic on PostgreSQL and does not use a client ID list.
 */
export function questionLessonDeleteQuery(
    scope: ReturnType<typeof questionLessonDeleteScope>, expectedCount: number
) {
    return {
        sql: 'DELETE FROM questions WHERE ' + scope.where +
            ' AND (SELECT COUNT(*) FROM questions WHERE ' + scope.where + ') = ?',
        params: [...scope.params, ...scope.params, expectedCount]
    };
}
