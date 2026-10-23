/**
 * Presentation-only focus for a confirmed question-bank save.
 * Never changes grades, question content, ownership or persisted records.
 */
export function planRecentQuestionView(records = []) {
    const valid = (Array.isArray(records) ? records : []).filter(q =>
        q && q.id !== undefined && q.id !== null && String(q.id).trim());
    const ids = [...new Set(valid.map(q => String(q.id)))];
    const lessonCounts = new Map();
    const types = new Set();
    for (const q of valid) {
        const lesson = String(q.lesson || 'CHUNG').trim();
        lessonCounts.set(lesson, (lessonCounts.get(lesson) || 0) + 1);
        const type = String(q.type || '').trim();
        if (type) types.add(type);
    }
    let primaryLesson = '';
    let maxCount = 0;
    for (const [lesson, count] of lessonCounts) {
        if (count > maxCount) {
            primaryLesson = lesson;
            maxCount = count;
        }
    }
    return {
        ids,
        total: ids.length,
        primaryLesson,
        lessonCount: lessonCounts.size,
        typeFilter: types.size === 1 ? [...types][0] : 'ALL'
    };
}

/**
 * The transactional Word importer derives IDs as wi-${importKey}-NNNN.
 * Use the verified server receipt; preview question IDs are NOT stored IDs.
 * Never guess identifiers if the receipt is incomplete.
 */
export function resolveWordImportedQuestionIds(records, importKey) {
    if (!Array.isArray(records) || !/^[0-9a-f]{40}$/i.test(String(importKey || ''))) {
        return [];
    }
    return records.map((q, index) => ({
        ...q,
        id: 'wi-' + String(importKey).toLowerCase() + '-' + String(index + 1).padStart(4, '0')
    }));
}
