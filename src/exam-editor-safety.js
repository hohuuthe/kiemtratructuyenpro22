
/**
 * Pure exam-editor state helpers.
 * IMPORTANT: Loading an exam may never inherit state from another exam.
 */
export function createEmptyExamDraft(user = null) {
  return {
    id: '', name: '', creatorId: user?.id || '', creatorName: user?.full_name || '',
    chedodethi: 'Đề công khai', mabaomatdethi: '', target_lop: '', targetLop: '',
    lop: '', target_donvi: '', donvi: '', timeLimit: 45, maxCheatWarnings: 5,
    maxAttempts: 0, max_attempts: 0,
    count41: 0, countTF4: 0, countSQ: 0, countTL: 0,
    count41NB: 0, count41TH: 0, count41VD: 0,
    countTF4NB: 0, countTF4TH: 0, countTF4VD: 0,
    countSQNB: 0, countSQTH: 0, countSQVD: 0,
    countTLNB: 0, countTLTH: 0, countTLVD: 0,
    selectedLessons: [], aiPrompt: '', aiGradingKey: '',
    points41: 1, pointsTF4: 1, pointsSQ: 1, pointsTL: 1,
    tf4ScoringMode: false,
    tf4Points: {1: 0.25, 2: 0.5, 3: 0.75, 4: 1},
    immediateFeedback: false, sqCaseSensitive: false, sqPunctuationSensitive: false,
    autoGradeEssay: false, showScore: true, showDetails: false,
    isSharedResults: false, sharedTeachers: [],
    accessControl: {enabled: false, startTime: '', endTime: ''},
    tgBd: null, tgKt: null, tieu_de_bai_thi: ''
  };
}

const parsedJson = (input, fallback) => {
  if (input == null || input === '') return fallback;
  if (typeof input !== 'string') return input;
  try { return JSON.parse(input); } catch { return fallback; }
};
export const examFlag = (input, fallback = false) => {
  if (input == null) return fallback;
  if (typeof input === 'string') {
    const value = input.trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(value);
  }
  return input === true || input === 1;
};
const number = (value, fallback) =>
  value == null || value === '' || !Number.isFinite(Number(value)) ? fallback : Number(value);
const nonNegative = (value, fallback = 0) => Math.max(0, number(value, fallback));
const text = value => value == null ? '' : String(value);
const points = input => {
  const defaults = {1: 0.25, 2: 0.5, 3: 0.75, 4: 1};
  const p = parsedJson(input, {});
  if (!p || typeof p !== 'object' || Array.isArray(p)) return defaults;
  return Object.fromEntries([1, 2, 3, 4].map(key => [key, nonNegative(p[key], defaults[key])]));
};

/** Construct an independent draft from one authoritative API response. */
export function mapStoredExamToDraft(row, {currentUser = null, accounts = [], accountsMap = {}} = {}) {
  if (!row || row.id == null || !text(row.id).trim()) {
    throw new Error('Invalid exam record: missing ID');
  }
  const defaults = createEmptyExamDraft();
  const detail = parsedJson(row.counts_detail, {});
  const counts = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : {};
  const access = parsedJson(row.access_control, {});
  const accessObj = access && typeof access === 'object' && !Array.isArray(access) ? access : {};
  const lessons = parsedJson(row.selected_lessons ?? row.selectedLessons, []);
  const sharing = parsedJson(row.shared_teachers ?? row.sharedTeachers, []);
  const creatorId = row.creator_id ?? row.creatorId ?? counts.creatorId ?? null;
  const creatorName = accounts.find(a => String(a.id) === String(creatorId))?.full_name
    || accountsMap[creatorId]
    || row.creator_name || row.creatorName
    || (String(currentUser?.id) === String(creatorId) ? currentUser.full_name : null)
    || 'Người dùng hệ thống';
  const mode = row.chedodethi || defaults.chedodethi;
  const targetLop = text(row.target_lop ?? row.targetLop ?? row.lop);
  const targetDonvi = text(row.target_donvi ?? row.targetDonvi ?? row.donvi);
  const startTime = text(row.tg_bd ?? accessObj.startTime);
  const endTime = text(row.tg_kt ?? accessObj.endTime);
  const publicMode = mode === 'Đề công khai';
  return {
    ...defaults,
    id: row.id,
    name: text(row.name),
    creatorId, creatorName,
    chedodethi: mode, mabaomatdethi: text(row.mabaomatdethi),
    target_lop: publicMode ? '' : targetLop,
    targetLop: publicMode ? '' : targetLop,
    lop: publicMode ? '' : targetLop,
    target_donvi: publicMode ? '' : targetDonvi,
    donvi: publicMode ? '' : targetDonvi,
    timeLimit: nonNegative(row.time_limit ?? row.timeLimit, 45),
    count41: nonNegative(row.count_41 ?? row.count41),
    countTF4: nonNegative(row.count_tf4 ?? row.countTF4),
    countSQ: nonNegative(row.count_sq ?? row.countSQ),
    countTL: nonNegative(row.count_tl ?? row.countTL),
    ...Object.fromEntries(
      ['41', 'TF4', 'SQ', 'TL'].flatMap(type =>
        ['NB', 'TH', 'VD'].map(level => {
          const name = 'count' + type + level;
          return [name, nonNegative(counts[name])];
        })
      )
    ),
    selectedLessons: Array.isArray(lessons) ? lessons.slice() : [],
    aiPrompt: text(row.ai_prompt ?? row.aiPrompt),
    aiGradingKey: text(row.ai_grading_key ?? row.aiGradingKey),
    points41: nonNegative(row.points_41 ?? row.points41, 1),
    pointsTF4: nonNegative(row.points_tf4 ?? row.pointsTF4, 1),
    pointsSQ: nonNegative(row.points_sq ?? row.pointsSQ, 1),
    pointsTL: nonNegative(row.points_tl ?? row.pointsTL, 1),
    tf4ScoringMode: examFlag(row.tf4_scoring_mode ?? row.tf4ScoringMode),
    tf4Points: points(row.tf4_points ?? row.tf4Points),
    immediateFeedback: examFlag(row.immediate_feedback ?? row.immediateFeedback),
    sqCaseSensitive: examFlag(row.sq_case_sensitive ?? row.sqCaseSensitive),
    sqPunctuationSensitive: examFlag(row.sq_punctuation_sensitive ?? row.sqPunctuationSensitive),
    autoGradeEssay: examFlag(row.auto_grade_essay ?? row.autoGradeEssay),
    showScore: examFlag(row.show_score ?? row.showScore, true),
    showDetails: examFlag(row.show_details ?? row.showDetails, true),
    isSharedResults: examFlag(row.is_shared_results ?? row.isSharedResults),
    sharedTeachers: Array.isArray(sharing) ? sharing.slice() : [],
    maxCheatWarnings: Math.max(1, number(row.max_cheat_warnings ?? row.maxCheatWarnings, 5)),
    maxAttempts: nonNegative(row.max_attempts ?? row.maxAttempts),
    max_attempts: nonNegative(row.max_attempts ?? row.maxAttempts),
    accessControl: {
      enabled: examFlag(accessObj.enabled) || !!startTime || !!endTime,
      startTime, endTime
    },
    tgBd: startTime || null,
    tgKt: endTime || null,
    tieu_de_bai_thi: text(row.tieu_de_bai_thi ?? row.tieuDeBaiThi)
  };
}

/** Refuse to save when the dropdown and authoritative loaded draft disagree. */
export function resolveExamSaveIdentity({newName = '', selectedId = '', draftId = '', draftName = ''} = {}) {
  const newTitle = text(newName).trim();
  const selected = text(selectedId).trim();
  const loaded = text(draftId).trim();
  if (newTitle && selected) return {ok:false, message:'Không thể đồng thời tạo mới và sửa đề đã chọn.'};
  if (!newTitle && !selected) return {ok:false, message:'Vui lòng chọn đề đã nạp hoặc nhập tên đề mới.'};
  if (newTitle && loaded) return {ok:false, message:'Đề cũ vẫn đang được nạp. Hãy chọn Tạo đề thi mới để tránh ghi đè.'};
  if (selected && selected !== loaded) return {ok:false, message:'Đề đang chọn chưa được nạp xong. Không thể lưu nhầm cấu hình.'};
  if (selected && !text(draftName).trim()) return {ok:false, message:'Chưa có cấu hình hợp lệ cho đề đã chọn.'};
  return {ok:true, intent: selected ? 'update' : 'create', id: selected || null,
    name: selected ? text(draftName).trim() : newTitle};
}
