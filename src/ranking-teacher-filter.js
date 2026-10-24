import { questionTeacherOptions } from './question-teacher-filter.js';

/**
 * Only the exam's immutable ID can identify the teacher of an exam result.
 * A name match is unsafe because independent teachers may reuse exam names.
 * The server returns exam_creator_id for authenticated admin list queries.
 */
export function resultExamCreatorId(row) {
    const raw = row?.examCreatorId ?? row?.exam_creator_id;
    return raw == null ? '' : String(raw);
}

export function matchesRankingTeacher(row, teacherId = '') {
    return !teacherId || resultExamCreatorId(row) === String(teacherId);
}

export function rankingTeacherOptions(results, accounts, currentUser, isAdmin) {
    if (!isAdmin) return [];
    const candidateOwners = (Array.isArray(results) ? results : []).map(result =>
        ({creatorId: resultExamCreatorId(result)}));
    return questionTeacherOptions(candidateOwners, accounts, currentUser, true);
}
