/**
 * Pure, read-only sorting for the 10 meaningful data columns in the
 * 12-column exam management table. STT is the current view's sequential
 * number and Thao tác contains buttons, so neither is a sortable data field.
 *
 * Filtering and authorization are performed before sorting; this helper
 * never changes the source list or an exam's properties.
 */
import { parseExamCreatedAt } from './exam-created-at-vn.js';
import { parseExamAttemptCount } from './exam-attempt-counts-ui.js';

export const EXAM_CONFIG_SORT_COLUMNS = Object.freeze({
    id: {label: 'Mã đề', direction: 'asc'},
    name: {label: 'Tên đề thi', direction: 'asc'},
    creator: {label: 'Người tạo', direction: 'asc'},
    createdAt: {label: 'Thời gian tạo', direction: 'desc'},
    mode: {label: 'Chế độ', direction: 'asc'},
    scope: {label: 'Áp dụng Lớp/Trường', direction: 'asc'},
    duration: {label: 'Thời gian', direction: 'desc'},
    questions: {label: 'Cấu trúc câu hỏi', direction: 'desc'},
    features: {label: 'Tính năng khác', direction: 'desc'},
    attempts: {label: 'Số bài đã làm', direction: 'desc'}
});
export const DEFAULT_EXAM_CONFIG_SORT = Object.freeze({key:'createdAt',direction:'desc'});

const collator = new Intl.Collator('vi', {numeric:true,sensitivity:'base'});
const text = value => String(value ?? '').trim();
const numeric = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};
const countField = (exam, snake, camel) => numeric(exam?.[snake] || exam?.[camel] || 0);
const isRestrictedUnit = mode => mode === 'Đề cho đơn vị' || mode === 'Đề thi cho đơn vị';

export function examConfigSortValue(exam, key, creatorLookup = {}) {
    if (!exam || typeof exam !== 'object') return null;
    switch (key) {
        case 'id': return text(exam.id) || null;
        case 'name': return text(exam.name) || null;
        case 'creator': {
            const owner = text(exam.creator_id ?? exam.creatorId);
            return text(exam.creatorName || exam.creator_name || creatorLookup?.[owner] || 'Hệ thống');
        }
        case 'createdAt': {
            const created = parseExamCreatedAt(exam.created_at ?? exam.createdAt);
            return created ? created.getTime() : null;
        }
        case 'mode': return text(exam.chedodethi || 'Đề công khai');
        case 'scope': {
            const mode = exam.chedodethi || 'Đề công khai';
            if (!isRestrictedUnit(mode)) return null;
            const school = text(exam.target_donvi ?? exam.targetDonvi ?? exam.donvi);
            const classes = exam.target_lop ?? exam.targetLop ?? exam.lop;
            const classroom = Array.isArray(classes) ? classes.map(text).join(', ') : text(classes);
            return (school + ' ' + classroom).trim() || null;
        }
        case 'duration': return numeric(exam.time_limit || exam.timeLimit || 45);
        case 'questions': {
            return countField(exam,'count_41','count41') + countField(exam,'count_tf4','countTF4') +
                countField(exam,'count_sq','countSQ') + countField(exam,'count_tl','countTL');
        }
        case 'features': {
            const shared = !!exam.is_shared_results;
            const timed = !!(exam.access_control && (exam.access_control.enabled || exam.tg_bd || exam.tg_kt));
            const attempts = numeric(exam.max_attempts || exam.maxAttempts || 0) > 0;
            const warnings = numeric(exam.max_cheat_warnings || exam.maxCheatWarnings || 5) > 0;
            return Number(shared) + Number(timed) + Number(attempts) + Number(warnings);
        }
        case 'attempts': return parseExamAttemptCount(exam.attempt_count);
        default: return null;
    }
}

export function nextExamConfigSort(current, clickedKey) {
    if (!Object.hasOwn(EXAM_CONFIG_SORT_COLUMNS, clickedKey)) return {...DEFAULT_EXAM_CONFIG_SORT};
    if (current?.key === clickedKey) return {
        key: clickedKey, direction: current.direction === 'asc' ? 'desc' : 'asc'
    };
    return {key: clickedKey, direction: EXAM_CONFIG_SORT_COLUMNS[clickedKey].direction};
}

function compareValues(a,b) {
    if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
    return collator.compare(text(a),text(b));
}

export function sortExamConfigs(rows, sort = DEFAULT_EXAM_CONFIG_SORT, creatorLookup = {}) {
    const source = Array.isArray(rows) ? rows : [];
    const key = Object.hasOwn(EXAM_CONFIG_SORT_COLUMNS, sort?.key) ? sort.key : DEFAULT_EXAM_CONFIG_SORT.key;
    const direction = sort?.direction === 'asc' || sort?.direction === 'desc'
        ? sort.direction : EXAM_CONFIG_SORT_COLUMNS[key].direction;
    const dated = source.map((exam, index) => ({
        exam, index,
        value: examConfigSortValue(exam,key,creatorLookup),
        created: examConfigSortValue(exam,'createdAt',creatorLookup)
    }));
    dated.sort((a,b)=>{
        // Missing timestamps/counts go last for either direction.
        const missingA = a.value === null || a.value === undefined || a.value === '';
        const missingB = b.value === null || b.value === undefined || b.value === '';
        if (missingA !== missingB) return missingA ? 1 : -1;
        if (!missingA) {
            const result=compareValues(a.value,b.value);
            if (result !== 0) return direction === 'asc' ? result : -result;
        }
        // Stable global tie-breaker, consistent across API pages and refreshes.
        const dateA=a.created, dateB=b.created;
        if (dateA !== null && dateB === null) return -1;
        if (dateA === null && dateB !== null) return 1;
        if (dateA !== null && dateB !== null && dateA !== dateB) return dateB-dateA;
        const byId = collator.compare(text(a.exam?.id),text(b.exam?.id));
        return byId || a.index-b.index;
    });
    return dated.map(item=>item.exam);
}
