import { validateQuestionAnswer } from './exam-grading-core.js';

type Row = Record<string, any>;

export type ExamQuestionPoolShortage = {
  type: '4-1' | 'TF4' | 'SQ' | 'TL';
  typeLabel: string;
  level: 'TOTAL' | 'NB' | 'TH' | 'VD';
  levelLabel: string;
  required: number;
  available: number;
  missing: number;
};

export type ExamQuestionPoolValidation = {
  valid: boolean;
  code: string;
  examName: string;
  selectedLessons: string[];
  totalUsableQuestions: number;
  requiredTotal: number;
  availableByType: Record<string, number>;
  availableByTypeLevel: Record<string, Record<string, number>>;
  shortages: ExamQuestionPoolShortage[];
  message: string;
};

const TYPE_SPECS = [
  { type: '4-1' as const, key: '41', totalKeys: ['count_41', 'count41', 'num_trac_nghiem'], label: 'Trắc nghiệm [4-1]' },
  { type: 'TF4' as const, key: 'TF4', totalKeys: ['count_tf4', 'countTF4', 'num_dung_sai'], label: 'Đúng/Sai [TF4]' },
  { type: 'SQ' as const, key: 'SQ', totalKeys: ['count_sq', 'countSQ', 'num_tra_loi_ngan'], label: 'Trả lời ngắn [SQ]' },
  { type: 'TL' as const, key: 'TL', totalKeys: ['count_tl', 'countTL', 'num_tuluan'], label: 'Tự luận [TL]' }
] as const;

const LEVEL_LABELS: Record<string, string> = {
  TOTAL: 'Tổng số',
  NB: 'Nhận biết',
  TH: 'Thông hiểu',
  VD: 'Vận dụng'
};

function asObject(value: any): Row {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return {};
}

function asArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {}
  }
  return [];
}

function nonNegativeInt(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function firstCount(config: Row, keys: readonly string[]): number {
  for (const key of keys) {
    if (config[key] !== undefined && config[key] !== null && config[key] !== '') {
      return nonNegativeInt(config[key]);
    }
  }
  return 0;
}

function normalizeType(type: any): '4-1' | 'TF4' | 'SQ' | 'TL' | '' {
  const value = String(type || '').trim().toLowerCase();
  if (value === '4-1' || value === 'trac_nghiem' || value === 'mcq') return '4-1';
  if (value === 'tf4' || value === 'dung_sai' || value === 'true_false') return 'TF4';
  if (value === 'sq' || value === 'tra_loi_ngan' || value === 'short_answer') return 'SQ';
  if (value === 'tl' || value === 'tu_luan' || value === 'essay') return 'TL';
  return '';
}

function normalizeLevel(level: any): 'NB' | 'TH' | 'VD' | '' {
  const value = String(level || '').trim().toUpperCase();
  return value === 'NB' || value === 'TH' || value === 'VD' ? value : '';
}

function normalizeLesson(value: any): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function removeVietnameseTones(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function normalizeLessonKey(value: any): string {
  return removeVietnameseTones(String(value || '').trim().toLowerCase())
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lessonMatches(questionLesson: any, selectedLessons: string[]): boolean {
  if (!selectedLessons.length) return false;
  const raw = String(questionLesson || '').trim();
  if (!raw) return false;
  const norm = normalizeLesson(raw);
  const key = normalizeLessonKey(raw);
  return selectedLessons.some((lesson) => {
    const selected = String(lesson || '').trim();
    if (!selected) return false;
    return raw === selected || norm === normalizeLesson(selected) || key === normalizeLessonKey(selected);
  });
}

function parseOptions(value: any): Row {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return {};
}

function hasCompleteMcqOptions(options: Row): boolean {
  return ['A', 'B', 'C', 'D'].every((key) => {
    const option: any = options?.[key];
    const text = option && typeof option === 'object'
      ? String(option.text ?? option.content ?? option.value ?? '').trim()
      : String(option ?? '').trim();
    const image = option && typeof option === 'object'
      ? String(option.image ?? option.img ?? option.src ?? option.url ?? '').trim()
      : '';
    return Boolean(text || image);
  });
}

function buildMessage(config: Row, shortages: ExamQuestionPoolShortage[], selectedLessons: string[]): string {
  const name = String(config.name || config.tieu_de_bai_thi || '').trim() || 'đề thi này';
  if (!selectedLessons.length) {
    return `Đề "${name}" không còn hợp lệ vì cấu hình không còn bài học/chuyên đề hợp lệ. Vui lòng xóa đề và tạo đề khác hoặc chỉnh sửa lại cấu hình trước khi sử dụng.`;
  }
  if (!shortages.length) {
    return `Đề "${name}" đã được đối chiếu trực tiếp với cơ sở dữ liệu và ngân hàng câu hỏi hiện đủ theo cấu hình.`;
  }
  const detail = shortages.slice(0, 6).map((item) =>
    `${item.typeLabel} - ${item.levelLabel}: cần ${item.required}, hiện có ${item.available}, thiếu ${item.missing}`
  ).join('; ');
  const extra = shortages.length > 6 ? `; và còn ${shortages.length - 6} mục thiếu khác` : '';
  return `Đề "${name}" không còn hợp lệ vì ngân hàng câu hỏi trên cơ sở dữ liệu hiện không đủ theo cấu hình đã lưu. ${detail}${extra}. Bạn có thể xóa đề này và tạo đề khác, hoặc chỉnh sửa giảm/thay đổi số lượng câu hỏi cho phù hợp với ngân hàng hiện tại.`;
}

export function validateExamQuestionPool(config: Row, questionRows: any[]): ExamQuestionPoolValidation {
  const selectedLessons = asArray(config.selected_lessons ?? config.selectedLessons)
    .map((lesson) => String(lesson || '').trim())
    .filter(Boolean);
  const countsDetail = asObject(config.counts_detail ?? config.countsDetail);
  const seenIds = new Set<string>();

  const usable = (Array.isArray(questionRows) ? questionRows : []).filter((row) => {
    const id = String(row?.id || '').trim();
    if (!id || seenIds.has(id)) return false;
    const content = String(row?.content || '').trim();
    if (!content) return false;
    const type = normalizeType(row?.type);
    if (!type) return false;
    const level = normalizeLevel(row?.level);
    if (!level) return false;
    if (!lessonMatches(row?.lesson, selectedLessons)) return false;
    const options = parseOptions(row?.options);
    const answerVerdict = validateQuestionAnswer(type, row?.answer, options);
    if (!answerVerdict.ok) return false;
    if (type === '4-1' && !hasCompleteMcqOptions(options)) return false;
    seenIds.add(id);
    return true;
  }).map((row) => ({
    type: normalizeType(row.type),
    level: normalizeLevel(row.level)
  }));

  const availableByType: Record<string, number> = {};
  const availableByTypeLevel: Record<string, Record<string, number>> = {};
  for (const spec of TYPE_SPECS) {
    const typeRows = usable.filter((row) => row.type === spec.type);
    availableByType[spec.type] = typeRows.length;
    availableByTypeLevel[spec.type] = {
      NB: typeRows.filter((row) => row.level === 'NB').length,
      TH: typeRows.filter((row) => row.level === 'TH').length,
      VD: typeRows.filter((row) => row.level === 'VD').length
    };
  }

  const shortages: ExamQuestionPoolShortage[] = [];
  let requiredTotal = 0;
  for (const spec of TYPE_SPECS) {
    const required = firstCount(config, spec.totalKeys);
    requiredTotal += required;
    const available = availableByType[spec.type] || 0;
    if (available < required) {
      shortages.push({
        type: spec.type,
        typeLabel: spec.label,
        level: 'TOTAL',
        levelLabel: LEVEL_LABELS.TOTAL,
        required,
        available,
        missing: required - available
      });
    }

    const detailRequired = {
      NB: nonNegativeInt(countsDetail[`count${spec.key}NB`]),
      TH: nonNegativeInt(countsDetail[`count${spec.key}TH`]),
      VD: nonNegativeInt(countsDetail[`count${spec.key}VD`])
    };
    const detailSum = detailRequired.NB + detailRequired.TH + detailRequired.VD;
    if (detailSum > 0) {
      for (const level of ['NB', 'TH', 'VD'] as const) {
        const levelAvailable = availableByTypeLevel[spec.type]?.[level] || 0;
        const levelRequired = detailRequired[level];
        if (levelAvailable < levelRequired) {
          shortages.push({
            type: spec.type,
            typeLabel: spec.label,
            level,
            levelLabel: LEVEL_LABELS[level],
            required: levelRequired,
            available: levelAvailable,
            missing: levelRequired - levelAvailable
          });
        }
      }
      if (detailSum !== required) {
        shortages.push({
          type: spec.type,
          typeLabel: spec.label,
          level: 'TOTAL',
          levelLabel: 'Cơ cấu chi tiết',
          required,
          available: detailSum,
          missing: Math.abs(required - detailSum)
        });
      }
    }
  }

  const valid = selectedLessons.length > 0 && requiredTotal > 0 && shortages.length === 0;
  const code = !selectedLessons.length
    ? 'EXAM_SELECTED_LESSONS_INVALID'
    : requiredTotal <= 0
      ? 'EXAM_QUESTION_COUNT_INVALID'
      : shortages.length
        ? 'EXAM_QUESTION_POOL_INVALID'
        : 'OK';
  const message = requiredTotal <= 0
    ? 'Đề thi không còn hợp lệ vì cấu hình không yêu cầu câu hỏi nào. Vui lòng chỉnh sửa lại đề.'
    : buildMessage(config, shortages, selectedLessons);

  return {
    valid,
    code,
    examName: String(config.name || '').trim(),
    selectedLessons,
    totalUsableQuestions: usable.length,
    requiredTotal,
    availableByType,
    availableByTypeLevel,
    shortages,
    message
  };
}

export async function validateStoredExamQuestionPool(db: any, config: Row, creatorId: any): Promise<ExamQuestionPoolValidation> {
  const owner = String(creatorId || '').trim();
  if (!owner) {
    return {
      valid: false,
      code: 'EXAM_CREATOR_INVALID',
      examName: String(config?.name || '').trim(),
      selectedLessons: [],
      totalUsableQuestions: 0,
      requiredTotal: 0,
      availableByType: {},
      availableByTypeLevel: {},
      shortages: [],
      message: 'Không xác định được giáo viên sở hữu đề thi nên chưa thể xác minh ngân hàng câu hỏi.'
    };
  }
  const { results } = await db.prepare(
    'SELECT id, type, level, lesson, content, options, answer, image, creator_id FROM questions WHERE creator_id = ? OR creator_id IN (SELECT user_id FROM accounts WHERE id = ?) OR creator_id IN (SELECT id FROM accounts WHERE user_id = ?)'
  ).bind(owner, owner, owner).all();
  return validateExamQuestionPool(config, results || []);
}
