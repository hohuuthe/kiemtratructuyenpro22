/**
 * Single, deterministic source of truth for Question Bank -> Word export.
 * UI availability, selected lesson/type totals and the actual question IDs
 * all come from the same immutable inventory; no silent partial exports.
 * No database mutations.
 */
const TYPE_ORDER = ['4-1', 'TF4', 'SQ', 'TL'];

export function normalizeWordBankType(value) {
    const raw = String(value ?? '').trim();
    const key = raw.toLowerCase().replace(/\s+/g, '_');
    if (['4-1', 'trac_nghiem', 'mcq', 'multiple_choice'].includes(key)) return '4-1';
    if (['tf4', 'tf-4', 'dung_sai', 'true_false'].includes(key)) return 'TF4';
    if (['sq', 'tra_loi_ngan', 'short_answer'].includes(key)) return 'SQ';
    if (['tl', 'tu_luan', 'essay'].includes(key)) return 'TL';
    return raw || 'Khác';
}

export function normalizeWordBankLesson(value) {
    return String(value ?? '').trim() || 'Chung';
}

const keyFor = (lesson, type) => JSON.stringify([lesson, type]);
const typeRank = (type) => {
    const index = TYPE_ORDER.indexOf(type);
    return index < 0 ? TYPE_ORDER.length : index;
};
const naturalCompare = (a, b) => String(a).localeCompare(String(b), 'vi', { numeric: true, sensitivity: 'base' });

/**
 * Only questions actually owned by the signed-in teacher. IDs are required
 * because otherwise completeness and uniqueness cannot be verified.
 */
export function buildQuestionBankExportInventory(allQuestions, creatorId) {
    if (!Array.isArray(allQuestions)) throw new Error('Danh sách câu hỏi chưa được tải đầy đủ.');
    const owner = String(creatorId ?? '').trim();
    if (!owner) throw new Error('Không xác định được tài khoản giáo viên.');
    const groupsMap = new Map();
    const seenIds = new Set();
    const owned = [];
    for (const original of allQuestions) {
        if (!original || String(original.creatorId ?? original.creator_id ?? '').trim() !== owner) continue;
        const id = String(original.id ?? '').trim();
        if (!id) throw new Error('Có câu hỏi thiếu ID trong ngân hàng. Hãy tải lại hoặc kiểm tra dữ liệu.');
        if (seenIds.has(id)) throw new Error('Phát hiện ID câu hỏi trùng: ' + id + '. Không thể xuất chính xác.');
        seenIds.add(id);
        const lesson = normalizeWordBankLesson(original.lesson);
        const type = normalizeWordBankType(original.type);
        const question = { ...original, id, lesson, type };
        owned.push(question);
        const key = keyFor(lesson, type);
        if (!groupsMap.has(key)) groupsMap.set(key, { key, lesson, type, questions: [], available: 0 });
        const group = groupsMap.get(key);
        group.questions.push(question);
        group.available++;
    }
    const groups = [...groupsMap.values()].sort((a, b) =>
        naturalCompare(a.lesson, b.lesson) || typeRank(a.type) - typeRank(b.type) ||
        naturalCompare(a.type, b.type)
    );
    const byType = Object.create(null);
    for (const item of owned) byType[item.type] = (byType[item.type] || 0) + 1;
    const lessonKeys = [...new Set(groups.map(g => g.lesson))];
    return { questions: owned, groups, lessonKeys, byType, totalAvailable: owned.length };
}

/**
 * choices are the checked UI rows with a nonnegative integer count.
 * Throws, rather than silently truncating, if the selection is no longer
 * available or a form input is malformed.
 */
export function buildQuestionBankExportPlan(inventory, choices, sortMode = 'by_type') {
    if (!inventory || !Array.isArray(inventory.groups) || !Array.isArray(choices)) {
        throw new Error('Dữ liệu thống kê xuất Word không hợp lệ.');
    }
    if (!['by_type', 'by_lesson'].includes(sortMode)) throw new Error('Thứ tự sắp xếp không hợp lệ.');
    const groupMap = new Map(inventory.groups.map(g => [g.key, g]));
    const seen = new Set();
    const picked = [];
    const perType = Object.create(null);
    const lessons = new Set();
    const selectedGroups = [];
    let requestedCount = 0;

    for (const choice of choices) {
        const lesson = normalizeWordBankLesson(choice?.lesson);
        const type = normalizeWordBankType(choice?.type);
        const key = keyFor(lesson, type);
        if (seen.has(key)) throw new Error('Nhóm bài học và dạng câu bị chọn lặp lại: ' + lesson + ' / ' + type);
        seen.add(key);
        const group = groupMap.get(key);
        if (!group) throw new Error('Nhóm câu hỏi không còn tồn tại: ' + lesson + ' / ' + type);
        const count = choice.count;
        if (!Number.isSafeInteger(count) || count < 0 || count > group.available) {
            throw new Error('Số câu của bài ' + lesson + ' (' + type + ') phải là số nguyên từ 0 đến ' + group.available + '.');
        }
        if (count === 0) continue;
        requestedCount += count;
        lessons.add(lesson);
        perType[type] = (perType[type] || 0) + count;
        selectedGroups.push({ lesson, type, count, available: group.available });
        picked.push(...group.questions.slice(0, count));
    }
    if (picked.length !== requestedCount) throw new Error('Số câu đã chọn không khớp số câu sẽ xuất.');
    const selectedIds = new Set(picked.map(q => q.id));
    if (selectedIds.size !== picked.length) throw new Error('Phát hiện câu hỏi bị xuất trùng ID.');
    const sorted = picked.slice().sort((a, b) => sortMode === 'by_lesson'
        ? naturalCompare(a.lesson, b.lesson) || typeRank(a.type) - typeRank(b.type)
        : typeRank(a.type) - typeRank(b.type) || naturalCompare(a.lesson, b.lesson));
    return {
        questions: sorted, requestedCount,
        totalSelected: sorted.length,
        selectedLessons: lessons.size,
        selectedGroups,
        perType,
        ids: sorted.map(q => q.id)
    };
}
