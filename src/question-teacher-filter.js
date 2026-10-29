import {verifiedQuestionAuthorName} from './question-creator-identity.js';
/**
 * Teacher filtering in the question bank is a view-only operation over the
 * server-authorized questions already loaded for the current login session.
 * This module never authorizes reading, editing, or deleting questions.
 */
export function questionCreatorId(question) {
    const id = question?.creatorId ?? question?.creator_id;
    return id === null || id === undefined ? '' : String(id);
}

export function matchesQuestionTeacher(question, teacherId = '') {
    return !teacherId || questionCreatorId(question) === String(teacherId);
}

export function questionTeacherOptions(questions, accounts, currentUser, isAdmin) {
    if (!isAdmin) return [];
    const accountById = new Map();
    for (const account of Array.isArray(accounts) ? accounts : []) {
        const id = account?.id == null ? '' : String(account.id);
        if (id) accountById.set(id, account);
        const userId = account?.user_id == null ? '' : String(account.user_id);
        if (userId && !accountById.has(userId)) accountById.set(userId, account);
    }
    if (currentUser?.id != null && !accountById.has(String(currentUser.id))) {
        accountById.set(String(currentUser.id), currentUser);
    }
    const rows=Array.isArray(questions)?questions:[];
    const ids = [...new Set(rows.map(questionCreatorId).filter(Boolean))];
    const options = ids.map(id => {
        const account = accountById.get(id);
        const fromQuestion=rows.find(q=>questionCreatorId(q)===id && verifiedQuestionAuthorName(q));
        const name = verifiedQuestionAuthorName(fromQuestion) || String(account?.full_name || account?.username || '').trim();
        const username = String(account?.username || '').trim();
        return { id, label: name || `Người tạo (mã: ${id})`, username };
    });
    const nameCounts = new Map();
    for (const entry of options) {
        const key = entry.label.toLocaleLowerCase('vi');
        nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
    }
    for (const entry of options) {
        if (nameCounts.get(entry.label.toLocaleLowerCase('vi')) > 1) {
            entry.label += ` (${entry.username && entry.username !== entry.label ? entry.username : entry.id})`;
        }
    }
    return options.map(({id, label}) => ({id, label}))
        .sort((a,b) => a.label.localeCompare(b.label,'vi') || a.id.localeCompare(b.id));
}
