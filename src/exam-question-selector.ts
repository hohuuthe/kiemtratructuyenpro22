export class ExamQuestionSelectionError extends Error {
  code = 'EXAM_QUESTION_POOL_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'ExamQuestionSelectionError';
  }
}

type Level = 'NB' | 'TH' | 'VD';

type Question = {
  id?: any;
  type?: any;
  level?: any;
  [key: string]: any;
};

export function selectQuestionsStrictByDifficulty(
  pool: Question[],
  type: string,
  typeLabel: string,
  targetCount: number,
  nbTarget: number,
  thTarget: number,
  vdTarget: number,
  shuffle: (items: Question[]) => Question[]
): Question[] {
  const requiredTotal = Math.max(0, Number(targetCount) || 0);
  if (requiredTotal <= 0) return [];

  const typePool = (Array.isArray(pool) ? pool : []).filter(q => q.type === type);
  if (typePool.length < requiredTotal) {
    throw new ExamQuestionSelectionError(
      `Ngân hàng đề không đủ câu hỏi [${typeLabel}] trong các bài học đã chọn. Yêu cầu ${requiredTotal} câu nhưng hiện chỉ có ${typePool.length} câu hợp lệ.`
    );
  }

  const requiredByLevel: Record<Level, number> = {
    NB: Math.max(0, Number(nbTarget) || 0),
    TH: Math.max(0, Number(thTarget) || 0),
    VD: Math.max(0, Number(vdTarget) || 0)
  };
  const detailedTotal = requiredByLevel.NB + requiredByLevel.TH + requiredByLevel.VD;

  // Cấu hình cũ không có cơ cấu mức độ vẫn được bốc theo tổng số.
  // Một khi đã có NB/TH/VD thì phải tuân thủ tuyệt đối, không được lấy mức khác bù.
  if (detailedTotal <= 0) {
    return shuffle(typePool).slice(0, requiredTotal);
  }

  if (detailedTotal !== requiredTotal) {
    throw new ExamQuestionSelectionError(
      `Cơ cấu mức độ của [${typeLabel}] không khớp tổng số câu: NB ${requiredByLevel.NB} + TH ${requiredByLevel.TH} + VD ${requiredByLevel.VD} = ${detailedTotal}, trong khi cấu hình tổng là ${requiredTotal}.`
    );
  }

  const selected: Question[] = [];
  const levelLabels: Record<Level, string> = {
    NB: 'Nhận biết',
    TH: 'Thông hiểu',
    VD: 'Vận dụng'
  };

  for (const level of ['NB', 'TH', 'VD'] as const) {
    const needed = requiredByLevel[level];
    if (needed <= 0) continue;
    const levelPool = typePool.filter(q => q.level === level);
    if (levelPool.length < needed) {
      throw new ExamQuestionSelectionError(
        `Ngân hàng đề không đủ câu [${typeLabel}] mức ${levelLabels[level]}. Cấu hình cần ${needed} câu nhưng cơ sở dữ liệu hiện chỉ có ${levelPool.length} câu hợp lệ. Hệ thống không lấy câu ở mức độ khác để bù.`
      );
    }
    selected.push(...shuffle(levelPool).slice(0, needed));
  }

  if (selected.length !== requiredTotal) {
    throw new ExamQuestionSelectionError(
      `Không thể tạo đúng cơ cấu mức độ cho [${typeLabel}]. Cần ${requiredTotal} câu nhưng chỉ chọn chính xác được ${selected.length} câu.`
    );
  }

  return selected;
}
